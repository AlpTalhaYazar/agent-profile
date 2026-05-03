/**
 * @module daemon/handlers-write
 *
 * Write-side handlers for the daemon (Phase 2 milestone 3):
 *
 *   `auth.add`, `auth.setSecret`, `auth.rotate`, `auth.remove`,
 *   `session.start`, `session.end`, `secret.get`, `secrets.migrate`.
 *
 * Each handler:
 *
 *   1. Decodes any `*B64` field with `Buffer.from(b64, "base64").toString("utf8")`
 *      ONCE, on the stack. Plaintext never touches a class field.
 *   2. Validates inputs the server's Zod schema cannot express
 *      (e.g. existence of an auth profile, valid `keyring://` URI).
 *   3. Routes the work through {@link SafeStorageStore} (preferred) or the
 *      keyring backend (fallback for entries not yet migrated).
 *   4. Appends the corresponding {@link AuditEntry}.
 *   5. Returns a response body — the framework adds `id` and `kind`.
 *
 * Capability gating: `secret.get` is the only write-side kind that requires
 * a capability token. `session.start` issues one; `session.end` revokes it;
 * `auth.rotate` revokes every live capability bound to the rotated profile.
 *
 * Audit invariant: rows are written even on the failure path so a forensic
 * read shows every attempt — successful or not.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityIssuer, CapabilityVerifier } from "@agent-profile/capability";
import {
  type SessionRecord,
  driftService,
  listSessionRecords,
  loadAuthProfiles,
  profileCreateScopeService,
  profileSaveService,
  readSessionRecord,
  saveAuthProfiles,
  sessionRegistryDir,
  updateSessionRecord,
  writeSessionRecord,
} from "@agent-profile/cli-services";
import type { AuthProfilesDocT } from "@agent-profile/core";
import {
  type EvtT,
  type HandlerMap,
  IpcError,
  type ReqAuthAddT,
  type ReqAuthRemoveT,
  type ReqAuthRotateT,
  type ReqAuthSetSecretT,
  type ReqAuthUpdateMetaT,
  type ReqProfileCreateScopeT,
  type ReqProfileSaveT,
  type ReqSecretGetT,
  type ReqSecretsMigrateT,
  type ReqSessionEndT,
  type ReqSessionStartT,
  type ReqSessionsDriftT,
  type ReqSessionsKillT,
  type ReqSessionsRelaunchT,
  type ReqSetupMarkCompleteT,
} from "@agent-profile/ipc-protocol";
import {
  type Backend,
  type SafeStorageStore,
  migrateKeyringToSafeStorage,
  parseKeyringUri,
  toKeyringKey,
} from "@agent-profile/secrets";
import type { AuditLog } from "./audit.js";
import { wrap } from "./wrap-handler.js";

/** Default capability-token TTL (60s; matches docs/06-security.md). */
const DEFAULT_SESSION_TTL_MS = 60_000;

/** Default expired-session sweep interval (60s). */
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

/** In-memory state mapping live sessions to their bound auth profile. */
export interface LiveSession {
  authProfileId?: string;
  pid: number;
  expiresAtMs: number;
  /** Captured at `session.start` for drift detection / future relaunch. */
  launchHash?: string;
  /** Cached for sessions that may relaunch without re-reading the registry. */
  role?: string;
  cwd?: string;
}

/** Shared Map type: callers may inject one to share state across handler maps. */
export type LiveSessionsMap = Map<string, LiveSession>;

/**
 * Drop sessions whose `expiresAtMs` has passed, revoking the matching
 * capability tokens and recording an audit row for each. Exported for unit
 * testing; the periodic `setInterval` invokes the same function.
 */
export async function runSessionCleanup(args: {
  sessions: LiveSessionsMap;
  now: number;
  issuer: CapabilityIssuer;
  audit: AuditLog;
  broadcast?: (evt: EvtT) => void;
}): Promise<void> {
  const { sessions, now, issuer, audit, broadcast } = args;
  const expired: Array<[string, LiveSession]> = [];
  for (const entry of sessions) {
    if (entry[1].expiresAtMs <= now) expired.push(entry);
  }
  for (const [sessionId, info] of expired) {
    sessions.delete(sessionId);
    issuer.revokeSession(sessionId);
    await audit.append({
      kind: "launch",
      sessionId,
      event: "ended",
      spawnPid: info.pid,
      ...(info.authProfileId !== undefined ? { authProfileId: info.authProfileId } : {}),
    });
    broadcast?.({ kind: "sessions.event", sessionId, event: "exited", ts: now });
  }
}

/** Constructor-style options the desktop wires up at boot. */
export interface WriteHandlerDeps {
  /** Absolute path to `<myClaudeHome>` (used as `home` arg by cli-services). */
  myClaudeHome: string;
  /** safeStorage-backed store. */
  store: SafeStorageStore;
  /** Optional fallback keyring backend (used by `secrets.migrate` only). */
  keyring?: Backend;
  /** Capability issuer and verifier, sharing a revocation registry. */
  issuer: CapabilityIssuer;
  verifier: CapabilityVerifier;
  /** Audit logger. */
  audit: AuditLog;
  /** Current process pid (the daemon's own pid; for audit defaults). */
  daemonPid: number;
  /** Clock used for capability TTL math; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Periodic interval (ms) at which the handler sweeps `sessions` for
   * expired entries. `0` disables the sweep (tests opt out and call
   * {@link runSessionCleanup} directly). Defaults to {@link
   * DEFAULT_CLEANUP_INTERVAL_MS}.
   */
  cleanupIntervalMs?: number;
  /**
   * Optional shared Map of live sessions. When provided, the read-side
   * `sessions.list` handler can enrich each record with capability liveness
   * by inspecting the same map this module mutates. When omitted, a fresh
   * Map is created internally.
   */
  sessions?: LiveSessionsMap;
  /**
   * Optional broadcast hook invoked when a session lifecycle event happens
   * (start / end / kill / relaunch / drift). When omitted (e.g. unit tests),
   * the handlers run silently. Production wiring passes
   * `evt => server.broadcast(evt)`.
   */
  broadcast?: (evt: EvtT) => void;
  /**
   * Override for `process.kill`. Tests pass a mock so killing a real PID is
   * not required. Defaults to `process.kill`.
   */
  killProcess?: (pid: number, signal?: number | NodeJS.Signals) => boolean;
}

/**
 * Build the write-side handler map. The result merges with the read-side map
 * built by `createHandlers` in `handlers.ts` to form the full
 * `HandlerMap` the daemon registers.
 */
export function createWriteHandlers(deps: WriteHandlerDeps): HandlerMap {
  const sessions: LiveSessionsMap = deps.sessions ?? new Map();
  const now = deps.now ?? ((): number => Date.now());
  const cleanupMs = deps.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
  const broadcast = deps.broadcast;
  const killProcess = deps.killProcess ?? ((pid, signal) => process.kill(pid, signal));

  if (cleanupMs > 0) {
    // unref so the timer never blocks process exit; lifecycle.drainAndClose
    // does not need to track this timer for shutdown ordering.
    const timer = setInterval(() => {
      void runSessionCleanup({
        sessions,
        now: now(),
        issuer: deps.issuer,
        audit: deps.audit,
        ...(broadcast ? { broadcast } : {}),
      });
    }, cleanupMs);
    timer.unref();
  }

  function sessionsRoot(): string {
    return join(deps.myClaudeHome, "sessions");
  }

  return {
    "profile.save": wrap<ReqProfileSaveT>("profile.save", async (req) => {
      const result = profileSaveService({
        home: deps.myClaudeHome,
        path: req.path,
        content: req.content,
      });
      return { saved: result.saved, path: result.path };
    }),

    "profile.createScope": wrap<ReqProfileCreateScopeT>("profile.createScope", async (req) => {
      const result = profileCreateScopeService({
        home: deps.myClaudeHome,
        cwd: req.cwd,
        location: req.location,
        layerType: req.layerType,
        ...(req.role !== undefined ? { role: req.role } : {}),
        force: req.force ?? false,
      });
      return {
        created: result.created,
        path: result.path,
        scope: result.scope,
        role: result.role,
        content: result.content,
      };
    }),

    "auth.add": wrap<ReqAuthAddT>("auth.add", async (req) => {
      const { spec, anthropicSecretB64, force } = req;
      const doc = loadAuthProfilesSafe(deps.myClaudeHome);
      if (doc.authProfiles[spec.id] !== undefined && !force) {
        throw new IpcError("BAD_REQUEST", `auth profile "${spec.id}" already exists`);
      }
      const { service, account } = parseAnthropicRef(spec.anthropic.secretRef);
      const plaintext = decodeB64(anthropicSecretB64, "anthropicSecretB64");
      try {
        await deps.store.set(toKeyringKey(service, account), plaintext);
      } finally {
        // Buffer was a temporary local; nothing else holds it.
      }
      doc.authProfiles[spec.id] = {
        ...(spec.displayName !== undefined ? { displayName: spec.displayName } : {}),
        anthropic: {
          mode: spec.anthropic.mode,
          secretRef: spec.anthropic.secretRef,
          ...(spec.anthropic.oauth !== undefined ? { oauth: spec.anthropic.oauth } : {}),
        },
        mcpSecretRefs: spec.mcpSecretRefs ?? {},
      };
      saveAuthProfilesSafe(doc, deps.myClaudeHome);
      await deps.audit.append({
        kind: "config_change",
        actionKind: "auth.add",
        actor: "daemon",
        target: spec.id,
        diffSha256: null,
      });
      return {};
    }),

    "auth.setSecret": wrap<ReqAuthSetSecretT>("auth.setSecret", async (req) => {
      const { authId, name, valueB64, register } = req;
      const doc = loadAuthProfilesSafe(deps.myClaudeHome);
      const profile = doc.authProfiles[authId];
      if (!profile) {
        throw new IpcError("NOT_FOUND", `auth profile "${authId}" not found`);
      }
      const existingRef = profile.mcpSecretRefs[name];
      if (!existingRef && !register) {
        throw new IpcError(
          "BAD_REQUEST",
          `secret "${name}" not in authProfiles.${authId}.mcpSecretRefs (pass register=true to add)`
        );
      }
      const ref = existingRef ?? `keyring://${name.replace(/\./g, "-")}/${authId}`;
      const { service, account } = parseAnthropicRef(ref);
      const plaintext = decodeB64(valueB64, "valueB64");
      await deps.store.set(toKeyringKey(service, account), plaintext);
      if (!existingRef) {
        profile.mcpSecretRefs[name] = ref;
        saveAuthProfilesSafe(doc, deps.myClaudeHome);
      }
      await deps.audit.append({
        kind: "config_change",
        actionKind: "auth.setSecret",
        actor: "daemon",
        target: `${authId}.${name}`,
        diffSha256: null,
      });
      return {};
    }),

    "auth.rotate": wrap<ReqAuthRotateT>("auth.rotate", async (req) => {
      const { authId, anthropicSecretB64 } = req;
      const doc = loadAuthProfilesSafe(deps.myClaudeHome);
      const profile = doc.authProfiles[authId];
      if (!profile) {
        throw new IpcError("NOT_FOUND", `auth profile "${authId}" not found`);
      }
      const { service, account } = parseAnthropicRef(profile.anthropic.secretRef);
      const plaintext = decodeB64(anthropicSecretB64, "anthropicSecretB64");
      await deps.store.set(toKeyringKey(service, account), plaintext);
      // Revoke every live session bound to this auth profile so existing
      // capability tokens cannot be replayed against the new secret.
      for (const [sessionId, info] of sessions) {
        if (info.authProfileId === authId) {
          deps.issuer.revokeSession(sessionId);
        }
      }
      await deps.audit.append({
        kind: "config_change",
        actionKind: "auth.rotate",
        actor: "daemon",
        target: authId,
        diffSha256: null,
      });
      return {};
    }),

    "auth.update-meta": wrap<ReqAuthUpdateMetaT>("auth.update-meta", async (req) => {
      const { authId, displayName, oauth } = req;
      const doc = loadAuthProfilesSafe(deps.myClaudeHome);
      let profile = doc.authProfiles[authId];
      if (!profile) {
        throw new IpcError("NOT_FOUND", `auth profile "${authId}" not found`);
      }
      if (displayName !== undefined) {
        if (displayName === "") {
          const { displayName: _displayName, ...profileWithoutDisplayName } = profile;
          profile = profileWithoutDisplayName;
          doc.authProfiles[authId] = profile;
        } else {
          profile.displayName = displayName;
        }
      }
      if (oauth !== undefined) {
        profile.anthropic.oauth = { ...(profile.anthropic.oauth ?? {}), ...oauth };
      }
      saveAuthProfilesSafe(doc, deps.myClaudeHome);
      await deps.audit.append({
        kind: "config_change",
        actionKind: "auth.update-meta",
        actor: "daemon",
        target: authId,
        diffSha256: null,
      });
      return {};
    }),

    "auth.remove": wrap<ReqAuthRemoveT>("auth.remove", async (req) => {
      const { authId } = req;
      const doc = loadAuthProfilesSafe(deps.myClaudeHome);
      const profile = doc.authProfiles[authId];
      if (!profile) {
        throw new IpcError("NOT_FOUND", `auth profile "${authId}" not found`);
      }
      const failed: string[] = [];
      const tryRemove = async (ref: string, name: string): Promise<void> => {
        try {
          const { service, account } = parseAnthropicRef(ref);
          await deps.store.remove(toKeyringKey(service, account));
        } catch {
          failed.push(name);
        }
      };
      await tryRemove(profile.anthropic.secretRef, "anthropic");
      for (const [n, ref] of Object.entries(profile.mcpSecretRefs)) {
        await tryRemove(ref, n);
      }
      delete doc.authProfiles[authId];
      saveAuthProfilesSafe(doc, deps.myClaudeHome);
      // Also revoke any live sessions referencing this profile.
      for (const [sessionId, info] of sessions) {
        if (info.authProfileId === authId) deps.issuer.revokeSession(sessionId);
      }
      await deps.audit.append({
        kind: "config_change",
        actionKind: "auth.remove",
        actor: "daemon",
        target: authId,
        diffSha256: null,
      });
      return { failed };
    }),

    "session.start": wrap<ReqSessionStartT>("session.start", async (req) => {
      const ttlMs = req.ttlMs ?? DEFAULT_SESSION_TTL_MS;
      const issued = deps.issuer.issue({ sessionId: req.sessionId, pid: req.pid, ttlMs });
      const live: LiveSession = {
        pid: req.pid,
        expiresAtMs: issued.expiresAtMs,
        ...(req.authProfileId !== undefined ? { authProfileId: req.authProfileId } : {}),
        ...(req.launchHash !== undefined ? { launchHash: req.launchHash } : {}),
      };
      sessions.set(req.sessionId, live);
      await deps.audit.append({
        kind: "launch",
        sessionId: req.sessionId,
        event: "started",
        spawnPid: req.pid,
        ...(req.authProfileId !== undefined ? { authProfileId: req.authProfileId } : {}),
      });
      broadcast?.({
        kind: "sessions.event",
        sessionId: req.sessionId,
        event: "started",
        ts: now(),
      });
      return { capabilityToken: issued.token, expiresAtMs: issued.expiresAtMs };
    }),

    "session.end": wrap<ReqSessionEndT>("session.end", async (req) => {
      deps.issuer.revokeSession(req.sessionId);
      const info = sessions.get(req.sessionId);
      sessions.delete(req.sessionId);
      await deps.audit.append({
        kind: "launch",
        sessionId: req.sessionId,
        event: "ended",
        spawnPid: info?.pid ?? 0,
        ...(info?.authProfileId !== undefined ? { authProfileId: info.authProfileId } : {}),
      });
      broadcast?.({
        kind: "sessions.event",
        sessionId: req.sessionId,
        event: "exited",
        ts: now(),
      });
      return {};
    }),

    "secret.get": wrap<ReqSecretGetT>("secret.get", async (req) => {
      const result = deps.verifier.verify(req.capabilityToken, { now: now() });
      if (!result.ok) {
        await deps.audit.append({
          kind: "secret_access",
          sessionId: "",
          secretName: req.name,
          callerPid: 0,
          capabilityValid: false,
          reason: result.reason,
        });
        throw new IpcError("AUTH", `capability token invalid: ${result.reason}`);
      }
      const sessionId = result.payload.sessionId;
      const callerPid = result.payload.pid;
      const liveSession = sessions.get(sessionId);
      if (!liveSession) {
        await deps.audit.append({
          kind: "secret_access",
          sessionId,
          secretName: req.name,
          callerPid,
          capabilityValid: true,
          reason: "unknown-session",
        });
        throw new IpcError("AUTH", `session "${sessionId}" is not live`);
      }
      if (!liveSession.authProfileId) {
        await deps.audit.append({
          kind: "secret_access",
          sessionId,
          secretName: req.name,
          callerPid,
          capabilityValid: true,
          reason: "unbound-session",
        });
        throw new IpcError("BAD_REQUEST", `session "${sessionId}" is not bound to an auth profile`);
      }
      const doc = loadAuthProfilesSafe(deps.myClaudeHome);
      const profile = doc.authProfiles[liveSession.authProfileId];
      if (!profile) {
        await deps.audit.append({
          kind: "secret_access",
          sessionId,
          secretName: req.name,
          callerPid,
          capabilityValid: true,
          reason: "unknown-auth-profile",
        });
        throw new IpcError("NOT_FOUND", `auth profile "${liveSession.authProfileId}" not found`);
      }
      const ref = resolveSecretRef(profile, req.name);
      if (ref === null) {
        await deps.audit.append({
          kind: "secret_access",
          sessionId,
          secretName: req.name,
          callerPid,
          capabilityValid: true,
          reason: "unknown-name",
        });
        throw new IpcError(
          "NOT_FOUND",
          `unknown secret name for auth profile "${liveSession.authProfileId}": ${req.name}`
        );
      }
      const { service, account } = parseAnthropicRef(ref);
      const plaintext = await deps.store.get(toKeyringKey(service, account));
      if (plaintext === null) {
        // Fall back to the keyring backend if the entry hasn't been migrated.
        const fallback = deps.keyring
          ? await deps.keyring.get(toKeyringKey(service, account))
          : null;
        if (fallback === null) {
          await deps.audit.append({
            kind: "secret_access",
            sessionId,
            secretName: req.name,
            callerPid,
            capabilityValid: true,
            reason: "missing",
          });
          throw new IpcError("NOT_FOUND", `secret "${req.name}" not stored`);
        }
        await deps.audit.append({
          kind: "secret_access",
          sessionId,
          secretName: req.name,
          callerPid,
          capabilityValid: true,
        });
        return { valueB64: Buffer.from(fallback, "utf8").toString("base64") };
      }
      await deps.audit.append({
        kind: "secret_access",
        sessionId,
        secretName: req.name,
        callerPid,
        capabilityValid: true,
      });
      return { valueB64: Buffer.from(plaintext, "utf8").toString("base64") };
    }),

    "secrets.migrate": wrap<ReqSecretsMigrateT>("secrets.migrate", async (req) => {
      if (!deps.keyring) {
        throw new IpcError("BAD_REQUEST", "no keyring backend configured for migration");
      }
      const report = await migrateKeyringToSafeStorage({
        keyring: deps.keyring,
        safeStore: deps.store,
        ...(req.dryRun !== undefined ? { dryRun: req.dryRun } : {}),
        ...(req.keepKeyring !== undefined ? { keepKeyring: req.keepKeyring } : {}),
      });
      return {
        scanned: report.scanned,
        migrated: report.migrated,
        skipped: report.skipped,
        errors: report.errors,
      };
    }),

    // ─── Session monitor (Phase 2 milestone 5) ──────────────────────────────

    "sessions.kill": wrap<ReqSessionsKillT>("sessions.kill", async (req) => {
      const root = sessionsRoot();
      let record: SessionRecord;
      try {
        record = await readSessionRecord({ sessionsRoot: root, sessionId: req.sessionId });
      } catch {
        throw new IpcError("NOT_FOUND", `session "${req.sessionId}" was not found`);
      }

      const live = sessions.get(req.sessionId);
      const pid = live?.pid ?? 0;
      const alreadyExited =
        record.status !== "running" || pid === 0 || !isProcessAlive(pid, killProcess);

      if (alreadyExited) {
        // Best-effort: update record + revoke + emit even if no signal needed.
        sessions.delete(req.sessionId);
        deps.issuer.revokeSession(req.sessionId);
        if (record.status === "running") {
          await updateSessionRecord({
            sessionsRoot: root,
            sessionId: req.sessionId,
            patch: { status: "exited", updatedAt: new Date(now()).toISOString() },
          });
        }
        await deps.audit.append({
          kind: "launch",
          sessionId: req.sessionId,
          event: "killed",
          spawnPid: pid,
          ...(live?.authProfileId !== undefined ? { authProfileId: live.authProfileId } : {}),
        });
        broadcast?.({
          kind: "sessions.event",
          sessionId: req.sessionId,
          event: "killed",
          ts: now(),
        });
        return { killed: false };
      }

      const signal = req.signal ?? "SIGTERM";
      try {
        killProcess(pid, signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new IpcError("INTERNAL", `failed to signal pid ${pid}: ${message}`);
      }

      sessions.delete(req.sessionId);
      deps.issuer.revokeSession(req.sessionId);
      await updateSessionRecord({
        sessionsRoot: root,
        sessionId: req.sessionId,
        patch: { status: "exited", updatedAt: new Date(now()).toISOString() },
      });
      await deps.audit.append({
        kind: "launch",
        sessionId: req.sessionId,
        event: "killed",
        spawnPid: pid,
        ...(live?.authProfileId !== undefined ? { authProfileId: live.authProfileId } : {}),
      });
      broadcast?.({
        kind: "sessions.event",
        sessionId: req.sessionId,
        event: "killed",
        ts: now(),
      });
      return { killed: true };
    }),

    "sessions.relaunch": wrap<ReqSessionsRelaunchT>("sessions.relaunch", async (req) => {
      const root = sessionsRoot();
      let oldRecord: SessionRecord;
      try {
        oldRecord = await readSessionRecord({ sessionsRoot: root, sessionId: req.sessionId });
      } catch {
        throw new IpcError("NOT_FOUND", `session "${req.sessionId}" was not found`);
      }

      const newSessionId = randomUUID();
      const newSessionDir = join(root, newSessionId);
      const nowIso = new Date(now()).toISOString();
      // Strip terminal-state fields from the clone so the new record looks
      // like a fresh launch rather than inheriting the parent's exit metadata.
      const { exitCode: _exitCode, wallMs: _wallMs, endedAt: _endedAt, ...inheritable } = oldRecord;
      const newRecord: SessionRecord = {
        ...inheritable,
        sessionId: newSessionId,
        createdAt: nowIso,
        updatedAt: nowIso,
        startedAt: nowIso,
        status: "running",
        retained: false,
        cleaned: false,
        relaunchedFrom: req.sessionId,
        runtimePaths: {
          ...oldRecord.runtimePaths,
          sessionDir: newSessionDir,
          claudeConfigDir: join(newSessionDir, ".claude"),
          mcpConfig: join(newSessionDir, "mcp.json"),
          settings: join(newSessionDir, "settings.json"),
        },
      };

      await writeSessionRecord({ sessionsRoot: root, record: newRecord });

      // Mint a placeholder capability with pid=0; the caller (CLI / Main)
      // calls `session.start(newSessionId, realPid)` once the process is
      // spawned, which overwrites the in-memory entry with the real pid.
      const ttlMs = DEFAULT_SESSION_TTL_MS;
      const issued = deps.issuer.issue({ sessionId: newSessionId, pid: 0, ttlMs });
      sessions.set(newSessionId, {
        authProfileId: oldRecord.authProfileId,
        pid: 0,
        expiresAtMs: issued.expiresAtMs,
        ...(oldRecord.launchHash !== undefined ? { launchHash: oldRecord.launchHash } : {}),
      });

      await deps.audit.append({
        kind: "launch",
        sessionId: newSessionId,
        event: "started",
        spawnPid: 0,
        authProfileId: oldRecord.authProfileId,
        relaunchedFrom: req.sessionId,
      });
      broadcast?.({
        kind: "sessions.event",
        sessionId: newSessionId,
        event: "started",
        ts: now(),
      });

      return {
        sessionId: newSessionId,
        capabilityToken: issued.token,
        expiresAtMs: issued.expiresAtMs,
        relaunchedFrom: req.sessionId,
      };
    }),

    "setup.markComplete": wrap<ReqSetupMarkCompleteT>("setup.markComplete", async () => {
      // GUI-only marker; the CLI never reads or writes it. Idempotent: a
      // second call simply overwrites the timestamp.
      const markerPath = join(deps.myClaudeHome, ".setup-complete");
      const ts = new Date(now()).toISOString();
      await writeFile(markerPath, ts, { encoding: "utf8", mode: 0o600 });
      await deps.audit.append({
        kind: "config_change",
        actionKind: "setup.markComplete",
        actor: "gui",
        target: ".setup-complete",
        diffSha256: null,
      });
      return {};
    }),

    "sessions.drift": wrap<ReqSessionsDriftT>("sessions.drift", async (req) => {
      const root = sessionsRoot();
      const result = await driftService({
        sessionsRoot: root,
        sessionId: req.sessionId,
        home: deps.myClaudeHome,
      });
      if (result.drifted) {
        broadcast?.({
          kind: "sessions.event",
          sessionId: req.sessionId,
          event: "drifted",
          ts: now(),
        });
      }
      return {
        drifted: result.drifted,
        scopesChanged: result.scopesChanged,
        oldHash: result.oldHash,
        newHash: result.newHash,
      };
    }),
  };
}

/**
 * Liveness probe via signal 0 (POSIX) — `process.kill(pid, 0)` returns true
 * (no throw) when the process exists, throws ESRCH otherwise.
 */
function isProcessAlive(
  pid: number,
  killProcess: (pid: number, signal?: number | NodeJS.Signals) => boolean
): boolean {
  if (pid <= 0) return false;
  try {
    killProcess(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Decode a base64 field, mapping malformed input to `BAD_REQUEST`. */
function decodeB64(b64: string, fieldName: string): string {
  try {
    const buf = Buffer.from(b64, "base64");
    // `Buffer.from("invalid!", "base64")` does not throw; assert non-empty.
    if (buf.length === 0 && b64.length !== 0) {
      throw new Error("decoded to empty buffer");
    }
    return buf.toString("utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new IpcError("BAD_REQUEST", `invalid ${fieldName}: ${message}`);
  }
}

/** Parse a `keyring://service/account` URI; map errors to BAD_REQUEST. */
function parseAnthropicRef(ref: string): { service: string; account: string } {
  try {
    return parseKeyringUri(ref);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new IpcError("BAD_REQUEST", `invalid secretRef: ${message}`);
  }
}

/** Resolve a logical secret name against a single auth profile. */
function resolveSecretRef(
  profile: AuthProfilesDocT["authProfiles"][string],
  name: string
): string | null {
  if (name === "anthropic") return profile.anthropic.secretRef;
  return profile.mcpSecretRefs[name] ?? null;
}

/** loadAuthProfiles wrapped to translate the cli-services home convention. */
function loadAuthProfilesSafe(myClaudeHome: string): AuthProfilesDocT {
  return loadAuthProfiles(myClaudeHomeRootFor(myClaudeHome));
}
function saveAuthProfilesSafe(doc: AuthProfilesDocT, myClaudeHome: string): void {
  saveAuthProfiles(doc, myClaudeHomeRootFor(myClaudeHome));
}

/**
 * cli-services' loadAuthProfiles expects `home` to be the myclaude root
 * (`<userHome>/.myclaude`); the daemon already passes the resolved path, so
 * this is currently a pass-through. Wrapped so future changes (e.g. a new
 * env-relative scheme) only touch one place.
 */
function myClaudeHomeRootFor(myClaudeHome: string): string {
  // Path uniformity: cli-services accepts the explicit home directly.
  return myClaudeHome;
}
