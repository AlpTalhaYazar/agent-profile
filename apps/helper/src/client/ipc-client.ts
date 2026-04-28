/**
 * @module client/ipc-client
 *
 * Daemon-routed `HelperClient` implementation.
 *
 * When the user has the desktop daemon running, the helper prefers this path:
 * the secret value comes back from `safeStorage` instead of the standalone
 * keyring. The capability token presented at the helper boundary is verified
 * by the daemon — the helper itself does not see the signing key.
 *
 * Failure modes:
 *  - Cannot read the cookie file or open the socket → throws an `IpcError`
 *    with `code: "DISCONNECTED"`. The entry-point catches that and falls back
 *    to the in-process client.
 *  - Daemon rejects the capability token → translated to
 *    `EXIT_CAPABILITY_DENIED`.
 *  - Daemon reports an unknown secret name → `EXIT_AUTH`.
 *
 * Helper bundle invariant: this module pulls only `@agent-profile/ipc-protocol`,
 * which itself depends on `node:net` + `zod`. No Electron, no native modules.
 */

import {
  type DaemonClient,
  IpcError,
  type RespSecretGetOkT,
  connectToSocket,
  defaultSocketPath,
  readCookie,
} from "@agent-profile/ipc-protocol";
import {
  EXIT_AUTH,
  EXIT_CAPABILITY_DENIED,
  EXIT_DAEMON_UNREACHABLE,
  HelperError,
} from "../errors.js";
import type { AnthropicRequest, HelperClient, McpHeadersRequest } from "./types.js";

/** Hard-coded helper version sent in the IPC `hello` handshake. */
const HELPER_HANDSHAKE_VERSION = "0.0.1";

/** Default attempt timeout — keeps fallback fast when the daemon is absent. */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 1000;

/** Constructor options for {@link createIpcHelperClient}. */
export interface IpcHelperClientOptions {
  /** Override the resolved myclaude home (defaults to `MYCLAUDE_HOME` / `~/.myclaude`). */
  myClaudeHome?: string;
  /** Override the socket path (defaults to {@link defaultSocketPath}, honouring `MYCLAUDE_SOCKET`). */
  socketPath?: string;
  /** Bound the daemon-attempt phase. */
  attemptTimeoutMs?: number;
  /** Override the cookie loader for tests. */
  readCookie?: (home: string) => Promise<string>;
}

/**
 * Probe the daemon and return a {@link HelperClient} that routes `secret.get`
 * over IPC. Throws an `IpcError` if the daemon is unreachable so the entry
 * point can fall back to the in-process client.
 */
export async function createIpcHelperClient(
  opts: IpcHelperClientOptions = {}
): Promise<HelperClient> {
  const home =
    opts.myClaudeHome ?? process.env.MYCLAUDE_HOME ?? `${process.env.HOME ?? ""}/.myclaude`;
  const socketPath = opts.socketPath ?? defaultSocketPath();
  const cookieLoader = opts.readCookie ?? readCookie;
  const cookie = await cookieLoader(home);

  // Bound the connect with a timeout so a stale socket file does not hang us.
  const client = await withTimeout(
    connectToSocket({
      socketPath,
      clientVersion: HELPER_HANDSHAKE_VERSION,
      cookie,
    }),
    opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
    "daemon connect timed out"
  );

  return new IpcHelperClient(client);
}

/** Concrete {@link HelperClient} that delegates `anthropic` to `secret.get`. */
class IpcHelperClient implements HelperClient {
  private readonly client: DaemonClient;
  private closed = false;

  constructor(client: DaemonClient) {
    this.client = client;
  }

  async anthropic(request: AnthropicRequest): Promise<string> {
    try {
      const resp = await this.client.request<RespSecretGetOkT>("secret.get", {
        capabilityToken: request.capabilityToken,
        name: "anthropic",
      });
      return Buffer.from(resp.valueB64, "base64").toString("utf8");
    } catch (err) {
      throw mapIpcError(err);
    } finally {
      this.close();
    }
  }

  async mcpHeaders(_request: McpHeadersRequest): Promise<Record<string, string>> {
    // mcp-headers requires per-server header templates the daemon cannot
    // currently render (no `secret.get-headers` kind in this milestone).
    // Throwing `DISCONNECTED` causes the entry point to fall back to the
    // in-process resolver, which has the manifest and templates available.
    this.close();
    throw new HelperError(
      "ipc helper does not yet support mcp-headers; falling back to in-process",
      EXIT_DAEMON_UNREACHABLE
    );
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
  }
}

/** Translate IPC failures into `HelperError`s with stable exit codes. */
function mapIpcError(err: unknown): HelperError {
  if (err instanceof IpcError) {
    if (err.code === "AUTH" || err.code === "AUTH_VERSION" || err.code === "BAD_COOKIE") {
      return new HelperError(`capability token denied: ${err.message}`, EXIT_CAPABILITY_DENIED);
    }
    if (err.code === "NOT_FOUND") {
      return new HelperError(`secret not found via daemon: ${err.message}`, EXIT_AUTH);
    }
    if (err.code === "DISCONNECTED" || err.code === "TIMEOUT") {
      return new HelperError(`daemon unreachable: ${err.message}`, EXIT_DAEMON_UNREACHABLE);
    }
    return new HelperError(`daemon error: ${err.message}`, EXIT_AUTH);
  }
  if (err instanceof Error) {
    return new HelperError(`daemon error: ${err.message}`, EXIT_DAEMON_UNREACHABLE);
  }
  return new HelperError("daemon error: unknown failure", EXIT_DAEMON_UNREACHABLE);
}

/** Race a promise against a timeout; reject if it doesn't settle in time. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new IpcError("TIMEOUT", message));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
