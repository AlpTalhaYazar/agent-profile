/**
 * Main secret-resolution entry point.
 *
 * `resolveSecrets` takes a cascaded `ScopeDocT`, an optional `AuthProfilesDocT`
 * entry, and an optional injected `Backend`, then:
 *
 * 1. Walks all string fields that may contain secret refs.
 * 2. Collects unique ref tokens and issues at most one `backend.get` per
 *    unique namespaced key (batched to minimize keychain prompts on macOS).
 * 3. Substitutes resolved values in place; missing refs are returned, not thrown.
 * 4. Emits a `ResolutionLogEntry` for every ref encountered (no values in log).
 *
 * IMPORTANT — `ANTHROPIC_API_KEY` is NOT set here.
 * Per the security model (06-security.md), the Anthropic API key is delivered
 * to Claude Code via `apiKeyHelper.sh` in Sprint 5 (session manager), not via
 * environment variables. `authProfile.anthropic.secretRef` is intentionally
 * ignored in this sprint.
 *
 * TODO(sprint-5): Implement `apiKeyHelper.sh` generation in the session manager.
 * The `authProfile.anthropic.secretRef` field contains the keyring URI for the
 * Anthropic API key. The Sprint-5 session manager should read it and write a
 * helper script that proxies the key to Claude Code on demand.
 * See: docs/06-security.md#apiKeyHelper and docs/impl/phase-1-sprint-5-*.md
 */

import type { AuthProfilesDocT, ScopeDocT, SecretRef } from "@agent-profile/core";
import { getBackend } from "../backend/detect.js";
import type { Backend } from "../backend/types.js";
import { BackendUnsafeError } from "../errors.js";
import { parseKeyringUri, toKeyringKey } from "../namespace.js";
import { walkConfig } from "../utils/walk-config.js";
import { type ResolutionLogEntry, makeLogEntry } from "./resolution-log.js";
import { substitute } from "./substitute.js";

/**
 * A secret reference that could not be resolved, with its location in the config.
 */
export interface MissingRef {
  /** The ref kind. */
  kind: SecretRef["kind"];
  /** The ref name or service/account identifier. */
  name: string;
  /** JSON-path of the config field where the ref was found. */
  path: string;
}

/**
 * Input for `resolveSecrets`.
 */
export interface ResolveSecretsInput {
  /**
   * The cascaded config document whose string fields will be resolved in place.
   * A deep clone is made internally; the original is not mutated.
   */
  config: ScopeDocT;

  /**
   * The active auth profile entry (a single profile from `AuthProfilesDocT.authProfiles`).
   * Used to resolve `${secret:name}` refs via `mcpSecretRefs`.
   * If omitted, `${secret:...}` refs will all be reported as missing.
   */
  authProfile?: AuthProfilesDocT["authProfiles"][string] | undefined;

  /**
   * Injected environment variable map. Defaults to `process.env`.
   * Override in tests to avoid reading the real process environment.
   */
  env?: Record<string, string | undefined> | undefined;

  /**
   * Injected backend. If not provided, `getBackend()` is called to auto-detect.
   * Always inject a `MockBackend` in tests to avoid touching the real OS keychain.
   */
  backend?: Backend | undefined;
}

/**
 * Result of `resolveSecrets`.
 */
export interface ResolveSecretsResult {
  /** The config document with all resolvable refs substituted in place. */
  resolvedConfig: ScopeDocT;
  /**
   * Audit log of every ref encountered. No secret values are present.
   * Entries are in the order the fields were walked.
   */
  resolutionLog: ResolutionLogEntry[];
  /**
   * Refs that could not be resolved. Empty if all refs were satisfied.
   * The caller (CLI, session manager) decides whether to abort or proceed.
   */
  missingRefs: MissingRef[];
}

/**
 * Resolves all secret references in a cascaded config document.
 *
 * Missing refs are returned in `missingRefs`, not thrown. Individual
 * `getSecret` / `setSecret` calls still throw on error.
 *
 * @param input - Resolution inputs (config, authProfile, env, backend).
 * @returns Resolved config, resolution log, and list of missing refs.
 * @throws {BackendUnsafeError} If the backend is `basic-text` and
 *   `MYCLAUDE_ALLOW_PLAINTEXT` is not set.
 */
export async function resolveSecrets(input: ResolveSecretsInput): Promise<ResolveSecretsResult> {
  const { authProfile, env = process.env } = input;

  // Resolve backend (use injected or auto-detect).
  const backend = input.backend ?? (await getBackend());

  // Fail closed on basic-text unless opted in.
  if (backend.kind === "basic-text" && !env.MYCLAUDE_ALLOW_PLAINTEXT) {
    throw new BackendUnsafeError("(resolve-secrets)");
  }

  // Deep-clone the config so we don't mutate the input.
  const resolvedConfig = structuredClone(input.config);

  const resolutionLog: ResolutionLogEntry[] = [];
  const missingRefs: MissingRef[] = [];

  // --- Pass 1: collect all unique ref tokens so we can batch backend reads ---
  // We walk the config to collect (jsonPath, value) pairs, extract ref tokens,
  // then build a deduplicated set of keychain keys to read.

  // Map from namespaced keychain key → resolved value (or null if not found).
  const keychainCache = new Map<string, string | null>();

  // Collect all fields and their ref tokens.
  const fields = Array.from(walkConfig(resolvedConfig));

  // First, scan all field values to collect unique keychain keys.
  for (const field of fields) {
    const refs = extractAllRefsFromString(field.value, authProfile);
    for (const ref of refs) {
      if (ref.kind === "keyring") {
        const key = toKeyringKey(ref.service, ref.account);
        if (!keychainCache.has(key)) {
          keychainCache.set(key, null); // placeholder
        }
      } else if (ref.kind === "secret") {
        // Resolve via authProfile.mcpSecretRefs → keyring URI
        const keyringUri = authProfile?.mcpSecretRefs[ref.name];
        if (keyringUri) {
          try {
            const { service, account } = parseKeyringUri(keyringUri);
            const key = toKeyringKey(service, account);
            if (!keychainCache.has(key)) {
              keychainCache.set(key, null); // placeholder
            }
          } catch {
            // Invalid URI in authProfile — will be reported as missing later.
          }
        }
      }
      // env refs don't need keychain reads
    }
  }

  // --- Pass 2: batch-read all unique keychain keys ---
  await Promise.all(
    Array.from(keychainCache.keys()).map(async (key) => {
      const value = await backend.get(key);
      keychainCache.set(key, value);
    })
  );

  // --- Pass 3: substitute each field ---
  for (const field of fields) {
    const { value: substituted, missing } = await substitute(
      field.value,
      makeResolver(authProfile, env, backend, keychainCache, resolutionLog, field.jsonPath)
    );

    if (substituted !== field.value) {
      field.set(substituted);
    }

    for (const ref of missing) {
      missingRefs.push({
        kind: ref.kind,
        name: refIdentifier(ref),
        path: field.jsonPath,
      });
    }
  }

  return { resolvedConfig, resolutionLog, missingRefs };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a `RefResolver` for a single field, capturing the resolution log,
 * keychain cache, and env map.
 */
function makeResolver(
  authProfile: AuthProfilesDocT["authProfiles"][string] | undefined,
  env: Record<string, string | undefined>,
  _backend: Backend,
  keychainCache: Map<string, string | null>,
  log: ResolutionLogEntry[],
  fieldPath: string
): (ref: SecretRef) => Promise<string | null> {
  return async (ref: SecretRef): Promise<string | null> => {
    if (ref.kind === "env") {
      const value = env[ref.name] ?? null;
      log.push(makeLogEntry(fieldPath, "env", ref.name, "env", value !== null));
      return value;
    }

    if (ref.kind === "keyring") {
      const key = toKeyringKey(ref.service, ref.account);
      const value = keychainCache.get(key) ?? null;
      log.push(makeLogEntry(fieldPath, "keyring", key, "keyring", value !== null));
      return value;
    }

    if (ref.kind === "secret") {
      const keyringUri = authProfile?.mcpSecretRefs[ref.name];
      if (!keyringUri) {
        log.push(makeLogEntry(fieldPath, "secret", ref.name, "secret-via-authprofile", false));
        return null;
      }

      try {
        const { service, account } = parseKeyringUri(keyringUri);
        const key = toKeyringKey(service, account);
        const value = keychainCache.get(key) ?? null;
        log.push(
          makeLogEntry(fieldPath, "secret", ref.name, "secret-via-authprofile", value !== null)
        );
        return value;
      } catch {
        log.push(makeLogEntry(fieldPath, "secret", ref.name, "secret-via-authprofile", false));
        return null;
      }
    }

    return null;
  };
}

/**
 * Extracts all SecretRef objects from a string value (may be embedded in larger strings).
 * Used in Pass 1 to collect unique keychain keys without resolving yet.
 */
function extractAllRefsFromString(
  value: string,
  authProfile?: AuthProfilesDocT["authProfiles"][string]
): SecretRef[] {
  const EMBEDDED_RE = /keyring:\/\/[^\s"']+|\$\{secret:[^}]+\}|\$\{env:[^}]+\}/g;
  const refs: SecretRef[] = [];

  for (const match of value.matchAll(EMBEDDED_RE)) {
    const token = match[0];

    const keyringM = /^keyring:\/\/([^/]+)\/(.+)$/.exec(token);
    if (keyringM?.[1] && keyringM[2]) {
      refs.push({ kind: "keyring", service: keyringM[1], account: keyringM[2], raw: token });
      continue;
    }

    const secretM = /^\$\{secret:([^}]+)\}$/.exec(token);
    if (secretM?.[1]) {
      refs.push({ kind: "secret", name: secretM[1], raw: token });
      // Pre-resolve ${secret:name} → keyring URI so we batch-read those too.
      if (authProfile) {
        const uri = authProfile.mcpSecretRefs[secretM[1]];
        if (uri) {
          const keyringU = /^keyring:\/\/([^/]+)\/(.+)$/.exec(uri);
          if (keyringU?.[1] && keyringU[2]) {
            refs.push({
              kind: "keyring",
              service: keyringU[1],
              account: keyringU[2],
              raw: uri,
            });
          }
        }
      }
      continue;
    }

    const envM = /^\$\{env:([^}]+)\}$/.exec(token);
    if (envM?.[1]) {
      refs.push({ kind: "env", name: envM[1], raw: token });
    }
  }

  return refs;
}

/**
 * Returns a human-readable identifier for a ref (never the value).
 */
function refIdentifier(ref: SecretRef): string {
  switch (ref.kind) {
    case "keyring":
      return `keyring://${ref.service}/${ref.account}`;
    case "secret":
      return ref.name;
    case "env":
      return ref.name;
  }
}
