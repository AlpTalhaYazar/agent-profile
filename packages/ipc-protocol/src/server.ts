/**
 * @module @agent-profile/ipc-protocol/server
 *
 * Server primitives for the daemon side of the IPC protocol.
 *
 * The server:
 *
 *  - Listens on a UDS / Named Pipe path.
 *  - Sets the socket file mode to `0o600` on POSIX (defense-in-depth alongside
 *    the placement under `$XDG_RUNTIME_DIR` or per-uid `/tmp`).
 *  - Runs a per-connection state machine: the first message MUST be `hello`
 *    with a matching cookie + compatible version. Any other first message is
 *    rejected with `error.AUTH` and the socket is closed.
 *  - Dispatches subsequent requests through a `handlers` table indexed by
 *    `kind`. Each handler returns a response body which the server wraps with
 *    the request `id` and the response `kind` derived from the request kind.
 *  - Tracks in-flight handlers so {@link DaemonServer.drainAndClose} can wait
 *    for them to finish before tearing down the listener.
 *
 * The server is **not** a complete daemon — peer-credential checks
 * (`SO_PEERCRED` / `LOCAL_PEEREID`) are the responsibility of the daemon host
 * (`apps/desktop`). The server here owns the wire-format and handshake-cookie
 * layer; the host wraps it with peer-auth, lifecycle, and capability tokens.
 */

import { unlink } from "node:fs/promises";
import { chmod } from "node:fs/promises";
import * as net from "node:net";
import { MessageDecoder, encodeMessage } from "./codec.js";
import { IpcError } from "./errors.js";
import { negotiateVersion, validateCookie } from "./handshake.js";
import { type IpcErrorCode, Req, type ReqT, type RespErrorT, type RespT } from "./messages.js";

/** Mapping from request kind to its `*.ok` response kind. */
const RESPONSE_KIND: Record<ReqT["kind"], RespT["kind"]> = {
  hello: "hello.ok",
  "auth.list": "auth.list.ok",
  "auth.get-secret-ref": "auth.get-secret-ref.ok",
  "profile.show": "profile.show.ok",
  "sessions.list": "sessions.list.ok",
  "daemon.status": "daemon.status.ok",
  "daemon.stop": "daemon.stop.ok",
};

/**
 * Context passed to a handler.
 *
 * `socket` is exposed so handlers can register per-connection cleanup if they
 * need to (e.g. attaching an unsolicited-event subscription to be torn down on
 * disconnect). `sessionId` is reserved for future per-connection session
 * tracking; it is `undefined` in this initial cut.
 */
export interface HandlerContext {
  socket: net.Socket;
  sessionId?: string | undefined;
}

/**
 * A request handler.
 *
 * The handler receives the parsed (and Zod-validated) request and returns a
 * **response body** — i.e. every field of the matching `*.ok` response except
 * `id` and `kind`. The server fills those in.
 *
 * Throwing inside a handler produces an `error.INTERNAL` response with the
 * thrown message; throwing an `IpcError` lets the handler choose the code.
 */
export type Handler<TReq extends ReqT = ReqT> = (
  req: TReq,
  ctx: HandlerContext
) => Promise<Record<string, unknown>>;

/**
 * Map of `kind` → handler. The `hello` handler is owned by the server itself
 * and SHOULD NOT be supplied by the caller; if supplied, it is ignored.
 */
export type HandlerMap = Partial<Record<ReqT["kind"], Handler>>;

/** Constructor options for {@link DaemonServer}. */
export interface DaemonServerOptions {
  /** Filesystem socket path (POSIX) or `\\.\pipe\...` (Windows). */
  socketPath: string;
  /** Boot cookie; clients must present this in `hello`. */
  cookie: string;
  /** Server version advertised in `hello.ok`. */
  serverVersion: string;
  /** Capability tags advertised in `hello.ok` (e.g. `["auth.list", "sessions.list"]`). */
  features?: string[];
  /** Per-kind handler map. `hello` is handled internally and ignored if present. */
  handlers: HandlerMap;
  /** Optional callback fired after a successful handshake on a new connection. */
  onClientConnected?: (socket: net.Socket) => void;
  /** Optional callback fired when a connection is fully closed. */
  onClientDisconnected?: (socket: net.Socket) => void;
}

/** Options for {@link DaemonServer.drainAndClose}. */
export interface DrainOptions {
  /** Maximum time to wait for in-flight handlers, in ms. Defaults to 2000. */
  drainMs?: number;
}

/** Re-export so callers can `import { IpcError } from "@agent-profile/ipc-protocol"`. */
export { IpcError } from "./errors.js";

/**
 * Daemon-side IPC server.
 *
 * Single-instance. Construct one per running daemon.
 */
export class DaemonServer {
  private readonly opts: DaemonServerOptions;
  private readonly server: net.Server;
  private readonly connections: Set<ConnectionState> = new Set();
  private inFlight = 0;
  private started = false;
  private closing = false;

  constructor(opts: DaemonServerOptions) {
    this.opts = opts;
    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });
  }

  /**
   * Start listening on the configured socket path.
   *
   * On POSIX, the socket file's mode is set to `0o600` after `listen` resolves
   * so a same-user-but-different-group attacker cannot connect even if the
   * placement-directory permissions are unexpectedly relaxed.
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("DaemonServer.start called twice");
    }
    this.started = true;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        this.server.off("listening", onListening);
        reject(err);
      };
      const onListening = (): void => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.opts.socketPath);
    });

    if (process.platform !== "win32") {
      try {
        await chmod(this.opts.socketPath, 0o600);
      } catch {
        // chmod is defense-in-depth; the placement directory permissions are
        // the primary control. If chmod fails (e.g. tmpfs without owner), we
        // continue rather than refuse to serve.
      }
    }
  }

  /**
   * Stop accepting new connections, wait for in-flight handlers to finish (or
   * `drainMs` to elapse), close every existing connection, then unlink the
   * socket file.
   *
   * Idempotent: calling twice is a no-op.
   */
  async drainAndClose(opts: DrainOptions = {}): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const drainMs = opts.drainMs ?? 2000;

    // Stop accepting new connections.
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
      // `close` doesn't fire until all existing sockets are gone, so we'll
      // close the sockets explicitly below. The promise still resolves once
      // `net.Server` reports the listener gone.
    });

    // Wait for in-flight handlers up to `drainMs`.
    const deadline = Date.now() + drainMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    // Force-close any lingering connections.
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections.clear();

    // Best-effort unlink. Windows pipes don't have a filesystem entry to remove.
    if (process.platform !== "win32") {
      try {
        await unlink(this.opts.socketPath);
      } catch {
        // The socket file may already be gone; that's fine.
      }
    }
  }

  /** Handle a freshly-accepted connection: build per-connection state. */
  private handleConnection(socket: net.Socket): void {
    const conn = new ConnectionState(socket, this);
    this.connections.add(conn);
    socket.on("close", () => {
      this.connections.delete(conn);
      this.opts.onClientDisconnected?.(socket);
    });
  }

  // ─── Internal accessors used by ConnectionState ─────────────────────────────

  /** @internal */
  getCookie(): string {
    return this.opts.cookie;
  }
  /** @internal */
  getServerVersion(): string {
    return this.opts.serverVersion;
  }
  /** @internal */
  getFeatures(): string[] {
    return this.opts.features ?? [];
  }
  /** @internal */
  getHandler(kind: ReqT["kind"]): Handler | undefined {
    return this.opts.handlers[kind];
  }
  /** @internal */
  notifyClientConnected(socket: net.Socket): void {
    this.opts.onClientConnected?.(socket);
  }
  /** @internal */
  beginHandler(): void {
    this.inFlight += 1;
  }
  /** @internal */
  endHandler(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}

/**
 * Per-connection state machine.
 *
 * Two phases:
 *  - `awaiting-hello` — accept only `hello`, validate, transition to ready.
 *  - `ready` — dispatch any other request via the parent server's handler map.
 *
 * On any failure, the state machine sends an `error` response and destroys the
 * socket.
 */
class ConnectionState {
  private readonly socket: net.Socket;
  private readonly parent: DaemonServer;
  private readonly decoder: MessageDecoder;
  private phase: "awaiting-hello" | "ready" | "closed" = "awaiting-hello";

  constructor(socket: net.Socket, parent: DaemonServer) {
    this.socket = socket;
    this.parent = parent;
    this.decoder = new MessageDecoder({
      stream: socket,
      onMessage: (raw) => {
        // Schedule onto the microtask queue so handler errors don't reject
        // synchronously inside the codec callback.
        void this.handleRaw(raw);
      },
      onError: (err) => {
        this.sendError("BAD_REQUEST", err.message);
        this.destroy();
      },
    });

    socket.on("error", () => {
      this.destroy();
    });
  }

  destroy(): void {
    if (this.phase === "closed") return;
    this.phase = "closed";
    this.decoder.close();
    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
  }

  private async handleRaw(raw: unknown): Promise<void> {
    if (this.phase === "closed") return;

    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      const id = readId(raw);
      this.sendError("BAD_REQUEST", parsed.error.issues[0]?.message ?? "invalid request", id);
      // A malformed first message is a hard fail; close the socket.
      if (this.phase === "awaiting-hello") {
        this.destroy();
      }
      return;
    }
    const req = parsed.data;

    if (this.phase === "awaiting-hello") {
      if (req.kind !== "hello") {
        this.sendError("AUTH", "first message must be hello", req.id, req.kind);
        this.destroy();
        return;
      }
      await this.handleHello(req);
      return;
    }

    if (req.kind === "hello") {
      this.sendError("BAD_REQUEST", "hello already received", req.id, "hello");
      return;
    }

    await this.dispatch(req);
  }

  private async handleHello(req: ReqT & { kind: "hello" }): Promise<void> {
    const versionResult = negotiateVersion(req.clientVersion, this.parent.getServerVersion());
    if (!versionResult.ok) {
      this.sendError("AUTH_VERSION", versionResult.reason, req.id, "hello");
      this.destroy();
      return;
    }
    if (!validateCookie(req.cookie, this.parent.getCookie())) {
      this.sendError("BAD_COOKIE", "cookie mismatch", req.id, "hello");
      this.destroy();
      return;
    }

    this.phase = "ready";
    this.sendOk("hello.ok", req.id, {
      serverVersion: this.parent.getServerVersion(),
      accepted: true,
      features: this.parent.getFeatures(),
    });
    this.parent.notifyClientConnected(this.socket);
  }

  private async dispatch(req: ReqT): Promise<void> {
    const handler = this.parent.getHandler(req.kind);
    if (!handler) {
      this.sendError("NOT_FOUND", `no handler for kind ${req.kind}`, req.id, req.kind);
      return;
    }
    this.parent.beginHandler();
    try {
      const body = await handler(req, { socket: this.socket });
      const respKind = RESPONSE_KIND[req.kind];
      this.sendOk(respKind, req.id, body);
    } catch (err) {
      if (err instanceof IpcError) {
        const code = err.code as IpcErrorCode | "TIMEOUT" | "DISCONNECTED";
        const reportable: IpcErrorCode =
          code === "TIMEOUT" || code === "DISCONNECTED" ? "INTERNAL" : code;
        this.sendError(reportable, err.message, req.id, req.kind);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.sendError("INTERNAL", message, req.id, req.kind);
      }
    } finally {
      this.parent.endHandler();
    }
  }

  private sendOk(kind: RespT["kind"], id: string, body: Record<string, unknown>): void {
    if (this.phase === "closed" || this.socket.destroyed) return;
    const msg = { id, kind, ...body } as RespT;
    try {
      this.socket.write(encodeMessage(msg));
    } catch {
      this.destroy();
    }
  }

  private sendError(code: IpcErrorCode, reason: string, id?: string, requestKind?: string): void {
    if (this.phase === "closed" || this.socket.destroyed) return;
    const err: RespErrorT = {
      id: id ?? "",
      kind: "error",
      code,
      reason,
      ...(requestKind !== undefined ? { requestKind } : {}),
    };
    try {
      this.socket.write(encodeMessage(err));
    } catch {
      this.destroy();
    }
  }
}

/** Best-effort `id` extraction from an unparsed object for error responses. */
function readId(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = (raw as { id?: unknown }).id;
  return typeof candidate === "string" ? candidate : undefined;
}
