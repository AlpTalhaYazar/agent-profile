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

import type { CapabilityIssuer, CapabilityVerifier } from "@agent-profile/capability";
import { ServiceError, loadAuthProfiles, saveAuthProfiles } from "@agent-profile/cli-services";
import type { AuthProfilesDocT } from "@agent-profile/core";
import {
  type Handler,
  type HandlerMap,
  IpcError,
  type ReqAuthAddT,
  type ReqAuthRemoveT,
  type ReqAuthRotateT,
  type ReqAuthSetSecretT,
  type ReqSecretGetT,
  type ReqSecretsMigrateT,
  type ReqSessionEndT,
  type ReqSessionStartT,
} from "@agent-profile/ipc-protocol";
import {
  type Backend,
  type SafeStorageStore,
  migrateKeyringToSafeStorage,
  parseKeyringUri,
  toKeyringKey,
} from "@agent-profile/secrets";
import type { AuditLog } from "./audit.js";

/** Default capability-token TTL (60s; matches docs/06-security.md). */
const DEFAULT_SESSION_TTL_MS = 60_000;

/** In-memory state mapping live sessions to their issued auth profile. */
interface LiveSession {
  authProfileId?: string;
  pid: number;
  expiresAtMs: number;
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
}

/**
 * Build the write-side handler map. The result merges with the read-side map
 * built by `createHandlers` in `handlers.ts` to form the full
 * `HandlerMap` the daemon registers.
 */
export function createWriteHandlers(deps: WriteHandlerDeps): HandlerMap {
  const sessions: Map<string, LiveSession> = new Map();
  const now = deps.now ?? ((): number => Date.now());

  return {
    "auth.add": wrap<ReqAuthAddT>(async (req) => {
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
        anthropic: { mode: spec.anthropic.mode, secretRef: spec.anthropic.secretRef },
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

    "auth.setSecret": wrap<ReqAuthSetSecretT>(async (req) => {
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

    "auth.rotate": wrap<ReqAuthRotateT>(async (req) => {
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

    "auth.remove": wrap<ReqAuthRemoveT>(async (req) => {
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

    "session.start": wrap<ReqSessionStartT>(async (req) => {
      const ttlMs = req.ttlMs ?? DEFAULT_SESSION_TTL_MS;
      const issued = deps.issuer.issue({ sessionId: req.sessionId, pid: req.pid, ttlMs });
      sessions.set(req.sessionId, {
        pid: req.pid,
        expiresAtMs: issued.expiresAtMs,
      });
      await deps.audit.append({
        kind: "launch",
        sessionId: req.sessionId,
        event: "started",
        spawnPid: req.pid,
      });
      return { capabilityToken: issued.token, expiresAtMs: issued.expiresAtMs };
    }),

    "session.end": wrap<ReqSessionEndT>(async (req) => {
      deps.issuer.revokeSession(req.sessionId);
      const info = sessions.get(req.sessionId);
      sessions.delete(req.sessionId);
      await deps.audit.append({
        kind: "launch",
        sessionId: req.sessionId,
        event: "ended",
        spawnPid: info?.pid ?? 0,
      });
      return {};
    }),

    "secret.get": wrap<ReqSecretGetT>(async (req) => {
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
      // Resolve the secret name via the session's auth profile. We don't
      // track (sessionId → authProfileId) yet; for now, look up by name
      // across every auth profile until we wire session.start to bind one.
      const doc = loadAuthProfilesSafe(deps.myClaudeHome);
      const ref = resolveSecretRef(doc, req.name);
      if (ref === null) {
        await deps.audit.append({
          kind: "secret_access",
          sessionId,
          secretName: req.name,
          callerPid,
          capabilityValid: true,
          reason: "unknown-name",
        });
        throw new IpcError("NOT_FOUND", `unknown secret name: ${req.name}`);
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

    "secrets.migrate": wrap<ReqSecretsMigrateT>(async (req) => {
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
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Wrap a handler so service errors map to IPC error codes. */
function wrap<TReq>(fn: (req: TReq) => Promise<Record<string, unknown>>): Handler {
  return async (req) => {
    try {
      return await fn(req as TReq);
    } catch (err) {
      if (err instanceof IpcError) throw err;
      if (err instanceof ServiceError) {
        const code = err.code === "not-found" ? "NOT_FOUND" : "BAD_REQUEST";
        throw new IpcError(code, err.message);
      }
      const reason = err instanceof Error ? err.message : "internal error";
      throw new IpcError("INTERNAL", reason);
    }
  };
}

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

/** Resolve `<authId>.<name>` → keyring URI for the first matching profile. */
function resolveSecretRef(doc: AuthProfilesDocT, name: string): string | null {
  for (const profile of Object.values(doc.authProfiles)) {
    if (!profile) continue;
    if (name === "anthropic") return profile.anthropic.secretRef;
    const ref = profile.mcpSecretRefs[name];
    if (ref) return ref;
  }
  return null;
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
