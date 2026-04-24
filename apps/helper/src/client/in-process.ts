/**
 * @module client/in-process
 *
 * Default `HelperClient` implementation: reads the per-session manifest from
 * disk and the secret values from the OS keychain, all in the current
 * process. Suitable for the stock `myclaude-helper` binary. A future IPC
 * client will satisfy the same contract via a local daemon.
 *
 * Security invariants:
 *  - Capability tokens are compared with `timingSafeEqualString`.
 *  - Error messages never include token values, secret values, or keychain
 *    contents. Only structural identifiers (session IDs, keyring URIs,
 *    ref identifiers) appear in messages.
 *  - The client itself writes nothing to stdout or stderr — it returns values
 *    or throws. The CLI entrypoint owns all I/O.
 */

import { join } from "node:path";
import { sessionsRootDefault } from "@agent-profile/persona-deployer";
import {
  type Backend,
  BackendUnsafeError,
  getBackend,
  parseKeyringUri,
  toKeyringKey,
} from "@agent-profile/secrets";
import { EXIT_AUTH, EXIT_CAPABILITY_DENIED, EXIT_SESSION_UNKNOWN, HelperError } from "../errors.js";
import { resolveHeaders } from "../resolve/headers.js";
import { timingSafeEqualString } from "./capability.js";
import { type SessionManifestT, loadSessionManifest } from "./manifest.js";
import type { AnthropicRequest, HelperClient, McpHeadersRequest } from "./types.js";

/**
 * Options for {@link createInProcessHelperClient}.
 */
export interface InProcessHelperClientOptions {
  /**
   * Override for the sessions root (default `~/.myclaude/sessions`). When
   * unset, `$MYCLAUDE_SESSIONS_ROOT` is consulted, then `sessionsRootDefault`.
   */
  sessionsRoot?: string;

  /** Injected backend. Defaults to `getBackend()` from `@agent-profile/secrets`. */
  backend?: Backend;

  /** Injected env map. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Create a `HelperClient` that resolves values in-process.
 *
 * @param opts - Optional overrides for the sessions root, backend, or env.
 * @returns A `HelperClient` suitable for direct use by the helper CLI.
 */
export function createInProcessHelperClient(opts: InProcessHelperClientOptions = {}): HelperClient {
  const env = opts.env ?? process.env;
  const sessionsRoot = opts.sessionsRoot ?? env.MYCLAUDE_SESSIONS_ROOT ?? sessionsRootDefault();

  return {
    async anthropic(request: AnthropicRequest): Promise<string> {
      const manifest = await loadManifest(sessionsRoot, request.sessionId);
      assertCapability(manifest, request.capabilityToken);

      const { service, account } = parseAnthropicRef(manifest.anthropic.secretRef);
      const backend = await acquireBackend(opts.backend, env);

      const key = toKeyringKey(service, account);
      let value: string | null;
      try {
        value = await backend.get(key);
      } catch (err) {
        throw mapSecretError(err, manifest.anthropic.secretRef);
      }
      if (value === null) {
        throw new HelperError(
          `anthropic api key missing for ${manifest.anthropic.secretRef}`,
          EXIT_AUTH
        );
      }
      return value;
    },

    async mcpHeaders(request: McpHeadersRequest): Promise<Record<string, string>> {
      const manifest = await loadManifest(sessionsRoot, request.sessionId);
      assertCapability(manifest, request.capabilityToken);

      const headers = manifest.mcpHeaders[request.serverName];
      if (!headers) {
        throw new HelperError(
          `unknown mcp server in session: ${request.serverName}`,
          EXIT_SESSION_UNKNOWN
        );
      }

      const backend = await acquireBackend(opts.backend, env);

      return resolveHeaders({
        headers,
        mcpSecretRefs: manifest.mcpSecretRefs,
        backend,
        env,
      });
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compose the session directory and load the manifest. */
async function loadManifest(sessionsRoot: string, sessionId: string): Promise<SessionManifestT> {
  const sessionDir = join(sessionsRoot, sessionId);
  return loadSessionManifest(sessionDir);
}

/**
 * Constant-time compare the capability token. Throws on mismatch.
 * The thrown message intentionally omits both tokens.
 */
function assertCapability(manifest: SessionManifestT, presentedToken: string): void {
  if (!timingSafeEqualString(manifest.capabilityToken, presentedToken)) {
    throw new HelperError("capability token denied for session", EXIT_CAPABILITY_DENIED);
  }
}

/** Parse the manifest's anthropic.secretRef, mapping errors to EXIT_AUTH. */
function parseAnthropicRef(secretRef: string): { service: string; account: string } {
  try {
    return parseKeyringUri(secretRef);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HelperError(`invalid anthropic.secretRef: ${message}`, EXIT_AUTH);
  }
}

/**
 * Acquire a backend: use the injected one if present, otherwise detect.
 * Applies the fail-closed plaintext policy before returning so downstream
 * code can assume a safe backend (or the explicit opt-in is set).
 */
async function acquireBackend(
  injected: Backend | undefined,
  env: Record<string, string | undefined>
): Promise<Backend> {
  let backend: Backend;
  try {
    backend = injected ?? (await getBackend());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HelperError(`keychain unavailable: ${message}`, EXIT_AUTH);
  }

  if (backend.kind === "basic-text" && env.MYCLAUDE_ALLOW_PLAINTEXT !== "1") {
    // Surface the canonical BackendUnsafeError message — it already includes
    // install hints and the MYCLAUDE_ALLOW_PLAINTEXT escape hatch.
    throw new HelperError(new BackendUnsafeError("(helper)").message, EXIT_AUTH);
  }

  return backend;
}

/**
 * Translate backend.get failures to the helper's EXIT_AUTH surface.
 * Secret values never appear in thrown messages; only ref identifiers do.
 * `keyringUri` is retained for parity with future callers that may want to
 * echo the ref identifier; current failures echo only the error message.
 */
function mapSecretError(err: unknown, _keyringUri: string): HelperError {
  if (err instanceof HelperError) return err;
  if (err instanceof BackendUnsafeError) {
    return new HelperError(err.message, EXIT_AUTH);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new HelperError(`anthropic api key lookup failed: ${message}`, EXIT_AUTH);
}
