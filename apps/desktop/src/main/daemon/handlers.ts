/**
 * @module daemon/handlers
 *
 * Per-kind IPC handlers wired into {@link DaemonServer}.
 *
 * Each handler:
 *
 *   - Translates the validated `Req` into a service call from
 *     `@agent-profile/cli-services`. Services are pure data — no formatting,
 *     no spawning — which keeps the wire layer thin.
 *   - Maps {@link ServiceError} into the IPC error codes defined in
 *     `@agent-profile/ipc-protocol`:
 *
 *     | ServiceErrorCode       | IpcError code   |
 *     |------------------------|-----------------|
 *     | `not-found`            | `NOT_FOUND`     |
 *     | `config-invalid`       | `BAD_REQUEST`   |
 *     | `io-error`             | `INTERNAL`      |
 *
 *     Any other thrown error is wrapped as `INTERNAL` with a non-leaky reason.
 *
 *   - Returns a **response body** — the server adds `id` and `kind` itself.
 *
 * `hello` is owned by the server; we do not provide a handler for it. The
 * `daemon.stop` handler delegates the actual shutdown to a {@link Lifecycle}
 * implementation passed in at construction so the handler stays unit-testable
 * without a running Electron runtime.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AuthGetSecretRefResult,
  type AuthListResult,
  type DaemonStatus,
  type ProfileListResult,
  type ProfilePreviewResult,
  type ProfileValidateResult,
  ServiceError,
  type SessionRecord,
  authGetSecretRefService,
  authListService,
  daemonStatusService,
  profileListService,
  profilePreviewService,
  profileShowService,
  profileValidateService,
  sessionsListService,
} from "@agent-profile/cli-services";
import {
  type Handler,
  type HandlerMap,
  IpcError,
  type ReqAuthGetSecretRefT,
  type ReqAuthListT,
  type ReqDaemonStatusT,
  type ReqProfileListT,
  type ReqProfilePreviewT,
  type ReqProfileShowT,
  type ReqProfileValidateT,
  type ReqSessionsListT,
} from "@agent-profile/ipc-protocol";
import { type WriteHandlerDeps, createWriteHandlers } from "./handlers-write.js";

/**
 * Resolve the "myclaude home" given a user home dir. The myclaude home is the
 * directory under which `config/`, `sessions/`, `audit.sqlite`, and the boot
 * cookie live — `~/.myclaude` on production hosts, a tmpdir in tests.
 *
 * The cli-services package treats `home` as the myclaude home (not the OS
 * home), so the daemon must derive it before delegating.
 */
function myClaudeHomeFor(userHome: string): string {
  return join(userHome, ".myclaude");
}

/** Mirror of `sessionsRootDefault()` parameterised by the myclaude home. */
function sessionsRootForMyClaude(myClaudeHome: string): string {
  return join(myClaudeHome, "sessions");
}

/**
 * Lifecycle handle the `daemon.stop` handler delegates to.
 *
 * Kept as an interface so tests can pass an in-memory stub and so the
 * concrete `DaemonLifecycle` class can stay free of circular imports.
 */
export interface LifecycleHandle {
  /** Daemon process id. */
  pid: number;
  /** Absolute path of the IPC socket. */
  socketPath: string;
  /** Wall-clock ms when the daemon process started. */
  startedAtMs: number;
  /** Sessions root used for status counting and `sessions.list`. */
  sessionsRoot: string;
  /**
   * Schedule a graceful shutdown. The actual drain happens in `before-quit`;
   * this method only flips a flag and asks Electron to quit.
   */
  requestShutdown: () => void;
}

/**
 * Build the {@link HandlerMap} consumed by `DaemonServer`.
 *
 * @param lifecycle - The daemon lifecycle handle, used by `daemon.status` and
 *   `daemon.stop`.
 * @param userHome - The OS user home directory (e.g. `/Users/alice`).
 *   Defaults to `os.homedir()`. Tests pass a tmpdir whose `.myclaude/`
 *   subtree contains the fixture config.
 * @param writeDeps - When provided, the write-side handler map is merged in.
 *   Tests that only need read-side coverage may omit this.
 */
export function createHandlers(
  lifecycle: LifecycleHandle,
  userHome: string = homedir(),
  writeDeps?: WriteHandlerDeps
): HandlerMap {
  const myClaudeHome = writeDeps?.myClaudeHome ?? myClaudeHomeFor(userHome);

  const readHandlers: HandlerMap = {
    "auth.list": wrap<ReqAuthListT>(async (req) => {
      const result: AuthListResult = authListService({
        home: myClaudeHome,
        includeRefs: req.includeRefs ?? false,
      });
      return {
        profiles: result.profiles.map((p) => ({
          id: p.id,
          // Wire schema requires `displayName: string`; treat null as empty.
          displayName: p.displayName ?? "",
          mode: p.mode,
          secrets: p.secrets,
        })),
      };
    }),

    "auth.get-secret-ref": wrap<ReqAuthGetSecretRefT>(async (req) => {
      const result: AuthGetSecretRefResult = authGetSecretRefService({
        home: myClaudeHome,
        authId: req.authId,
        name: req.name,
      });
      return { ref: result.ref };
    }),

    "profile.show": wrap<ReqProfileShowT>(async (req) => {
      const effective = profileShowService({
        role: req.role,
        authProfileId: req.authProfileId,
        cwd: req.cwd,
        home: myClaudeHome,
      });
      return {
        // The wire schema marks both fields as `unknown`; we pass through
        // whatever core returned. Concrete-shape narrowing happens in the
        // CLI / GUI consumers.
        effective,
        // `core.resolve` returns the effective config + provenance bundled
        // together; today we only have one object so we re-publish it under
        // both fields. ST-F's `profile show` consumer only reads `effective`.
        provenance: (effective as { provenance?: unknown }).provenance ?? null,
      };
    }),

    "profile.list": wrap<ReqProfileListT>(async (req) => {
      const result: ProfileListResult = profileListService({
        home: myClaudeHome,
        cwd: req.cwd,
        ...(req.roleFilter !== undefined ? { roleFilter: req.roleFilter } : {}),
      });
      return { scopes: result.scopes };
    }),

    "profile.validate": wrap<ReqProfileValidateT>(async (req) => {
      const result: ProfileValidateResult = profileValidateService({
        content: req.content,
      });
      return { issues: result.issues };
    }),

    "profile.preview": wrap<ReqProfilePreviewT>(async (req) => {
      const result: ProfilePreviewResult = profilePreviewService({
        home: myClaudeHome,
        role: req.role,
        authProfileId: req.authProfileId,
        cwd: req.cwd,
        draft: req.draft,
      });
      return {
        issues: result.issues,
        current: result.current,
        preview: result.preview,
        diff: result.diff,
      };
    }),

    "sessions.list": wrap<ReqSessionsListT>(async (req) => {
      const sessions: SessionRecord[] = await sessionsListService({
        sessionsRoot: sessionsRootForMyClaude(myClaudeHome),
        activeOnly: req.activeOnly ?? false,
      });
      return { sessions };
    }),

    "daemon.status": wrap<ReqDaemonStatusT>(async () => {
      const status: DaemonStatus = await daemonStatusService({
        pid: lifecycle.pid,
        socketPath: lifecycle.socketPath,
        startedAtMs: lifecycle.startedAtMs,
        sessionsRoot: lifecycle.sessionsRoot,
      });
      return {
        pid: status.pid,
        socketPath: status.socketPath,
        uptimeMs: status.uptimeMs,
        sessionCounts: status.sessionCounts,
      };
    }),

    "daemon.stop": wrap(async () => {
      lifecycle.requestShutdown();
      return {};
    }),
  };

  if (!writeDeps) return readHandlers;
  return { ...readHandlers, ...createWriteHandlers(writeDeps) };
}

/**
 * Wrap a typed handler so any thrown {@link ServiceError} or generic Error is
 * mapped to a corresponding {@link IpcError}.
 *
 * The IPC server already wraps unknown throws as `INTERNAL`; we still do the
 * mapping here so service-level codes (`not-found` ↔ `NOT_FOUND`) survive the
 * trip and so we control the user-visible reason string.
 */
function wrap<TReq>(fn: (req: TReq) => Promise<Record<string, unknown>>): Handler {
  return async (req) => {
    try {
      return await fn(req as TReq);
    } catch (err) {
      if (err instanceof ServiceError) {
        const code =
          err.code === "not-found"
            ? "NOT_FOUND"
            : err.code === "io-error"
              ? "INTERNAL"
              : "BAD_REQUEST";
        throw new IpcError(code, err.message);
      }
      // Generic failure — keep the reason short to avoid leaking internals.
      const reason = err instanceof Error ? err.message : "internal error";
      throw new IpcError("INTERNAL", reason);
    }
  };
}
