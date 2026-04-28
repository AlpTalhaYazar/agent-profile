/**
 * @module @agent-profile/ipc-protocol/client
 *
 * Promise-based client for the daemon IPC protocol.
 *
 * The client owns:
 *
 *  - A `Duplex` stream (typically a `net.Socket`, but injectable for tests).
 *  - An NDJSON `MessageDecoder` that emits parsed objects.
 *  - A monotonic id counter and a Map<id, pending> of in-flight requests.
 *  - A handshake state machine that requires `connect()` to complete before
 *    `request()` is allowed.
 *
 * Lifecycle:
 *
 *  1. Construct with a `stream`, the client version, and the boot cookie.
 *  2. `await connect()` — sends `hello`, awaits `hello.ok`, throws on `error`.
 *  3. Many `await request(...)` calls — each gets a fresh id.
 *  4. `close()` — destroys the stream and rejects every in-flight request with
 *     `IpcError("DISCONNECTED", ...)`.
 *
 * The client is **not** retry-aware. Reconnection is the caller's job — the
 * CLI's daemon-detection layer handles spin-up + retry above this client.
 */

import type net from "node:net";
import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import { MessageDecoder, encodeMessage } from "./codec.js";
import { IpcError } from "./errors.js";
import { type ReqT, Resp, type RespT } from "./messages.js";

/** Default per-request timeout. Matches the 5s daemon-unreachable budget in `docs/04-cli-spec.md`. */
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/** In-flight request bookkeeping. */
interface Pending {
  resolve: (value: RespT) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  kind: ReqT["kind"];
}

/** Constructor options for {@link DaemonClient}. */
export interface DaemonClientOptions {
  /** Duplex stream connected to the daemon (typically a `net.Socket`). */
  stream: Duplex;
  /** Client semver (`<package.json>.version`). */
  clientVersion: string;
  /** Boot cookie read from `~/.myclaude/ipc-cookie`. */
  cookie: string;
  /** PID to advertise in `hello`. Defaults to `process.pid`. */
  pid?: number;
}

/** Options for {@link DaemonClient.request}. */
export interface RequestOptions {
  /** Per-call timeout override; defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Successful handshake info returned from {@link DaemonClient.connect}. */
export interface ConnectResult {
  serverVersion: string;
  features: string[];
}

/**
 * Newline-delimited JSON IPC client.
 *
 * Construct one per connection. Reuse across multiple `request` calls is the
 * intended pattern — the client multiplexes requests onto a single stream.
 */
export class DaemonClient {
  private readonly stream: Duplex;
  private readonly clientVersion: string;
  private readonly cookie: string;
  private readonly pid: number;
  private readonly decoder: MessageDecoder;
  private readonly pending: Map<string, Pending> = new Map();
  private nextIdSeq = 0;
  private connected = false;
  private closed = false;

  /** Construct a client. Does not send anything yet — call {@link connect}. */
  constructor(opts: DaemonClientOptions) {
    this.stream = opts.stream;
    this.clientVersion = opts.clientVersion;
    this.cookie = opts.cookie;
    this.pid = opts.pid ?? process.pid;

    this.decoder = new MessageDecoder({
      stream: this.stream,
      onMessage: (raw) => {
        this.dispatch(raw);
      },
      onError: (err) => {
        this.failAll(new IpcError("INTERNAL", `decode error: ${err.message}`));
      },
    });

    // If the stream goes away (peer FIN, error, etc.), reject every in-flight
    // request so callers do not hang forever.
    const onClose = (): void => {
      this.failAll(new IpcError("DISCONNECTED", "ipc stream closed"));
    };
    const onError = (err: Error): void => {
      this.failAll(new IpcError("DISCONNECTED", `ipc stream error: ${err.message}`));
    };
    this.stream.once("close", onClose);
    this.stream.once("error", onError);
  }

  /**
   * Send `hello` and await the matching `hello.ok`.
   *
   * After a successful return, the client transitions into the connected state
   * and {@link request} becomes callable. Any `error` response (auth failure,
   * version skew, etc.) is thrown as an `IpcError`.
   *
   * @returns The server's advertised version + feature list.
   * @throws {IpcError} On auth/version/transport failure.
   */
  async connect(): Promise<ConnectResult> {
    if (this.connected) {
      throw new IpcError("INTERNAL", "DaemonClient.connect called twice");
    }
    if (this.closed) {
      throw new IpcError("DISCONNECTED", "DaemonClient is closed");
    }
    const helloResp = await this.sendAndWait({
      kind: "hello",
      clientVersion: this.clientVersion,
      pid: this.pid,
      cookie: this.cookie,
    });
    if (helloResp.kind === "hello.ok") {
      this.connected = true;
      return { serverVersion: helloResp.serverVersion, features: helloResp.features };
    }
    if (helloResp.kind === "error") {
      throw new IpcError(helloResp.code, helloResp.reason, "hello");
    }
    throw new IpcError("INTERNAL", `unexpected hello response kind: ${helloResp.kind}`);
  }

  /**
   * Send a request and resolve with the matching response body.
   *
   * The client auto-assigns a fresh `id`; the caller supplies only the `kind`
   * and any additional fields. The promise rejects with an `IpcError` on:
   *
   *  - the timeout firing,
   *  - the server replying with `error`,
   *  - the stream closing before a reply arrives.
   *
   * @typeParam R - The expected `RespT` variant (`RespAuthListOkT`, etc.).
   *   The caller is responsible for picking the right type — the client does
   *   not enforce it at compile time because it does not know which response
   *   variant maps to which request kind without an extra mapping layer.
   * @param kind - The request kind discriminator.
   * @param data - Additional fields for the request shape.
   * @param opts - Per-call options (timeout override).
   */
  async request<R extends RespT>(
    kind: ReqT["kind"],
    data: Record<string, unknown> = {},
    opts: RequestOptions = {}
  ): Promise<R> {
    if (!this.connected) {
      throw new IpcError("INTERNAL", "DaemonClient.request before connect");
    }
    if (this.closed) {
      throw new IpcError("DISCONNECTED", "DaemonClient is closed");
    }
    const resp = await this.sendAndWait(
      { kind, ...data },
      opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    );
    if (resp.kind === "error") {
      throw new IpcError(resp.code, resp.reason, kind);
    }
    return resp as R;
  }

  /**
   * Tear the client down.
   *
   * Destroys the underlying stream (best-effort) and rejects every in-flight
   * request with `IpcError("DISCONNECTED", ...)`. Idempotent.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.decoder.close();
    this.failAll(new IpcError("DISCONNECTED", "DaemonClient closed by caller"));
    if (!this.stream.destroyed) {
      this.stream.destroy();
    }
  }

  /**
   * Attach an `id`, write the encoded message to the stream, and register a
   * pending entry to be resolved when the matching response arrives.
   *
   * `body` is typed as a generic record so callers can construct each kind's
   * shape without TypeScript's excess-property check on the omitted-id union
   * variants. The codec accepts any JSON-serializable object; the wire-shape
   * narrowing happens on the server side via `Req.safeParse`.
   */
  private sendAndWait(
    body: { kind: ReqT["kind"] } & Record<string, unknown>,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<RespT> {
    const id = this.nextId();
    const msg = { id, ...body } as ReqT;
    return new Promise<RespT>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new IpcError("TIMEOUT", `ipc request timed out after ${timeoutMs}ms`, body.kind));
      }, timeoutMs);
      // `unref` so a stuck timer never holds the event loop open.
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, kind: body.kind });
      try {
        this.stream.write(encodeMessage(msg));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        const message = err instanceof Error ? err.message : String(err);
        reject(new IpcError("INTERNAL", `ipc write failed: ${message}`, body.kind));
      }
    });
  }

  /** Route an incoming raw object to the matching pending entry. */
  private dispatch(raw: unknown): void {
    const result = Resp.safeParse(raw);
    if (!result.success) {
      // Unknown shape: surface to all in-flight callers as a transport error,
      // since we cannot match it to any single id.
      this.failAll(new IpcError("INTERNAL", "received malformed response from daemon"));
      return;
    }
    const resp = result.data;
    const entry = this.pending.get(resp.id);
    if (!entry) {
      // Spurious response (server bug or replay). Ignore.
      return;
    }
    this.pending.delete(resp.id);
    clearTimeout(entry.timer);
    entry.resolve(resp);
  }

  /** Reject every pending request with `err`. Used on close / fatal stream events. */
  private failAll(err: IpcError): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  /** Generate a fresh request id. The PID + counter avoids collisions across reconnects. */
  private nextId(): string {
    this.nextIdSeq += 1;
    return `c-${this.pid}-${this.nextIdSeq}`;
  }
}

/** Options for {@link connectToSocket}. */
export interface ConnectToSocketOptions {
  /** Filesystem socket path (POSIX) or `\\.\pipe\...` (Windows). */
  socketPath: string;
  /** Forwarded to {@link DaemonClient}. */
  clientVersion: string;
  /** Forwarded to {@link DaemonClient}. */
  cookie: string;
  /** Forwarded to {@link DaemonClient}. Defaults to `process.pid`. */
  pid?: number;
}

/**
 * Convenience: open a UDS / Named Pipe connection and return a
 * {@link DaemonClient} with the handshake already performed.
 *
 * Caller still owns the lifecycle — call `client.close()` when done.
 *
 * @param opts - Socket path + handshake parameters.
 * @returns A connected client.
 * @throws {IpcError} On socket failure or handshake rejection.
 */
export async function connectToSocket(opts: ConnectToSocketOptions): Promise<DaemonClient> {
  const socket = await openSocket(opts.socketPath);
  const client = new DaemonClient({
    stream: socket,
    clientVersion: opts.clientVersion,
    cookie: opts.cookie,
    ...(opts.pid !== undefined ? { pid: opts.pid } : {}),
  });
  try {
    await client.connect();
  } catch (err) {
    client.close();
    throw err;
  }
  return client;
}

/** Promise-wrap `net.createConnection` so it integrates with `await`. */
function openSocket(path: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path });
    const onError = (err: Error): void => {
      socket.off("connect", onConnect);
      reject(new IpcError("DISCONNECTED", `failed to connect to ${path}: ${err.message}`));
    };
    const onConnect = (): void => {
      socket.off("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}
