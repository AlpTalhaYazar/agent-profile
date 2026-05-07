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

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AuthGetSecretRefResult,
  type AuthListResult,
  type DaemonStatus,
  type PersonaPreviewResult,
  type PersonaRenderResult,
  type ProfileListResult,
  type ProfilePreviewResult,
  type ProfileValidateResult,
  type SessionRecord,
  authGetSecretRefService,
  authListService,
  daemonStatusService,
  loadAuthProfiles,
  personaPreviewService,
  personaRenderService,
  profileListService,
  profilePreviewService,
  profileShowService,
  profileValidateService,
  sessionsListService,
} from "@agent-profile/cli-services";
import type {
  HandlerMap,
  ReqAuthGetSecretRefT,
  ReqAuthListT,
  ReqDaemonStatusT,
  ReqPersonaPreviewT,
  ReqPersonaRenderT,
  ReqProfileListT,
  ReqProfilePreviewT,
  ReqProfileShowT,
  ReqProfileValidateT,
  ReqSessionsListT,
  ReqSystemBootstrapT,
} from "@agent-profile/ipc-protocol";
import {
  type LiveSession,
  type LiveSessionsMap,
  type WriteHandlerDeps,
  createWriteHandlers,
} from "./handlers-write.js";
import { wrap } from "./wrap-handler.js";

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

  // Share the live-sessions Map across read and write handlers. The read-side
  // `sessions.list` handler uses it to enrich each record with capability
  // liveness; the write-side handlers in `createWriteHandlers` mutate it.
  const sharedSessions: LiveSessionsMap | undefined = writeDeps
    ? (writeDeps.sessions ?? new Map<string, LiveSession>())
    : undefined;
  const nowFn = writeDeps?.now ?? ((): number => Date.now());

  const readHandlers: HandlerMap = {
    "auth.list": wrap<ReqAuthListT>("auth.list", async (req) => {
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
          ...(p.oauth !== undefined ? { oauth: p.oauth } : {}),
        })),
      };
    }),

    "auth.get-secret-ref": wrap<ReqAuthGetSecretRefT>("auth.get-secret-ref", async (req) => {
      const result: AuthGetSecretRefResult = authGetSecretRefService({
        home: myClaudeHome,
        authId: req.authId,
        name: req.name,
      });
      return { ref: result.ref };
    }),

    "profile.show": wrap<ReqProfileShowT>("profile.show", async (req) => {
      const result = profileShowService({
        role: req.role,
        authProfileId: req.authProfileId,
        cwd: req.cwd,
        home: myClaudeHome,
      });
      // `core.resolve` returns `{ effective, provenance, runtimePaths }`. The
      // wire schema marks the two payload fields as `unknown`; consumers
      // (CLI / GUI) re-validate against the core schemas. `runtimePaths` is
      // always null inside the daemon; emitter packages populate it later.
      return {
        effective: result.effective,
        provenance: result.provenance,
      };
    }),

    "profile.list": wrap<ReqProfileListT>("profile.list", async (req) => {
      const result: ProfileListResult = profileListService({
        home: myClaudeHome,
        cwd: req.cwd,
        ...(req.roleFilter !== undefined ? { roleFilter: req.roleFilter } : {}),
      });
      return { scopes: result.scopes };
    }),

    "profile.validate": wrap<ReqProfileValidateT>("profile.validate", async (req) => {
      const result: ProfileValidateResult = profileValidateService({
        content: req.content,
      });
      return { issues: result.issues };
    }),

    "profile.preview": wrap<ReqProfilePreviewT>("profile.preview", async (req) => {
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

    "persona.render": wrap<ReqPersonaRenderT>("persona.render", async (req) => {
      const result: PersonaRenderResult = await personaRenderService({
        role: req.role,
        authProfileId: req.authProfileId,
        cwd: req.cwd,
        home: myClaudeHome,
      });
      return projectPersonaRender(result);
    }),

    "persona.preview": wrap<ReqPersonaPreviewT>("persona.preview", async (req) => {
      const result: PersonaPreviewResult = await personaPreviewService({
        role: req.role,
        authProfileId: req.authProfileId,
        cwd: req.cwd,
        home: myClaudeHome,
        draft: req.draft,
      });
      return {
        issues: result.issues,
        preview: result.preview,
        failure: result.failure,
      };
    }),

    "sessions.list": wrap<ReqSessionsListT>("sessions.list", async (req) => {
      const sessions: SessionRecord[] = await sessionsListService({
        sessionsRoot: sessionsRootForMyClaude(myClaudeHome),
        activeOnly: req.activeOnly ?? false,
      });
      const enriched = sharedSessions
        ? sessions.map((record) => enrichSessionRecord(record, sharedSessions, nowFn()))
        : sessions;
      return { sessions: enriched };
    }),

    "system.bootstrap": wrap<ReqSystemBootstrapT>("system.bootstrap", async () => {
      // Pure read — no side effects. The wizard relies on `firstRun` to gate
      // its visibility; the marker is written by `setup.markComplete`.
      const doc = loadAuthProfiles(myClaudeHome);
      const profileCount = Object.keys(doc.authProfiles).length;
      const setupCompleteMarker = await markerExists(myClaudeHome);
      return {
        firstRun: profileCount === 0 && !setupCompleteMarker,
        profileCount,
        setupCompleteMarker,
      };
    }),

    "daemon.status": wrap<ReqDaemonStatusT>("daemon.status", async () => {
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

    "daemon.stop": wrap("daemon.stop", async () => {
      lifecycle.requestShutdown();
      return {};
    }),
  };

  if (!writeDeps) return readHandlers;
  // Inject the shared sessions map so `createWriteHandlers` mutates the same
  // Map the read-side enricher reads from.
  const writeDepsWithShared: WriteHandlerDeps = {
    ...writeDeps,
    ...(sharedSessions ? { sessions: sharedSessions } : {}),
  };
  return { ...readHandlers, ...createWriteHandlers(writeDepsWithShared) };
}

/**
 * Enrich a `SessionRecord` (z.unknown() on the wire) with capability +
 * process liveness fields when the daemon has them. Returned object is the
 * record plus a few optional keys; older readers ignore the extras.
 */
function enrichSessionRecord(
  record: SessionRecord,
  sessions: LiveSessionsMap,
  nowMs: number
): SessionRecord & {
  liveCapability: boolean;
  capabilityExpiresAtMs?: number;
  processAlive: boolean;
} {
  const live = sessions.get(record.sessionId);
  const liveCapability = Boolean(live && live.expiresAtMs > nowMs);
  const pid = record.spawn?.args ? (live?.pid ?? 0) : 0;
  const processAlive = pid > 0 && checkProcessAlive(pid);
  return {
    ...record,
    liveCapability,
    ...(live ? { capabilityExpiresAtMs: live.expiresAtMs } : {}),
    processAlive,
  };
}

function checkProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe the GUI-only setup-complete marker at `<myClaudeHome>/.setup-complete`.
 * Returns `true` when the file exists, `false` on ENOENT or any other stat
 * failure (treating the absence-of-evidence as evidence-of-absence is safe:
 * the wizard will simply re-show, and `setup.markComplete` is idempotent).
 */
async function markerExists(myClaudeHome: string): Promise<boolean> {
  try {
    await stat(join(myClaudeHome, ".setup-complete"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Project a `PersonaRenderResult` (cli-services shape) into the wire body shape
 * matching `RespPersonaRenderOk`.
 *
 * The two shapes are very close but differ in two places:
 *
 *  - **Collisions.** cli-services emits one `CollisionLogEntry` per overwrite
 *    step (`{ target, category, overriddenSource, winningSource }`). The wire
 *    schema groups by `(category, basename)` with `overriddenSources` as an
 *    array. We honour the per-step granularity by emitting one wire entry per
 *    cli-services entry (`overriddenSources.length === 1`) — no information
 *    is lost and the schema accepts the shape verbatim.
 *
 *  - **Missing sources.** cli-services carries a `targetPath` for each missing
 *    file (the location it would have been deployed to). The wire schema drops
 *    `targetPath` because preview surfaces only need `(category, sourcePath)`
 *    to flag the missing entry; the deploy path keeps the richer shape.
 *
 *  The CLAUDE.md and persona-files projections are 1:1.
 */
function projectPersonaRender(result: PersonaRenderResult): Record<string, unknown> {
  return {
    claudeMd: result.claudeMd
      ? {
          combinedContent: result.claudeMd.combinedContent,
          sections: result.claudeMd.sections.map((sec) => ({
            sourcePath: sec.sourcePath,
            originScope: sec.originScope,
            content: sec.content,
          })),
        }
      : null,
    files: result.files.map((file) => ({
      category: file.category,
      basename: file.basename,
      sourcePath: file.sourcePath,
      originScope: file.originScope,
      content: file.content,
    })),
    collisions: result.collisions
      // The wire schema does not include a `claudeMd` collision category. The
      // in-memory render path does not produce CLAUDE.md collisions today, so
      // this filter is purely defensive — it lets the type system accept the
      // mapped category narrowing below.
      .filter(
        (
          collision
        ): collision is typeof collision & {
          category: "agents" | "skills" | "slashCmds" | "memory";
        } => collision.category !== "commands"
      )
      .map((collision) => ({
        category: collision.category,
        basename: collision.target,
        winningSource: collision.winningSource,
        overriddenSources: [collision.overriddenSource],
      })),
    missingSources: result.missingSources.map((entry) => ({
      category: entry.category === "commands" ? "slashCmds" : entry.category,
      sourcePath: entry.sourcePath,
    })),
  };
}
