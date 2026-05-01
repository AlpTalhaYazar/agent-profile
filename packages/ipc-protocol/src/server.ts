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
import {
  type EvtT,
  type IpcErrorCode,
  Req,
  type ReqT,
  type RespErrorT,
  type RespT,
} from "./messages.js";
import {
  type SubscriptionChannel,
  eventChannelByKind,
  responseKindByRequest,
} from "./messages/registry.js";

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
 * Predicate evaluated for each subscribed connection during a broadcast.
 *
 * Receives the connection's socket; returning `false` skips that connection.
 */
export type BroadcastPredicate = (ctx: { socket: net.Socket }) => boolean;

/**
 * Daemon-side IPC server.
 *
 * Single-instance. Construct one per running daemon.
 */
export class DaemonServer {
  private readonly opts: DaemonServerOptions;
  private readonly server: net.Server;
  private readonly connections: Set<ConnectionState> = new Set();
  /**
   * Per-channel subscriber sets.
   *
   * Populated by the framework-owned `sessions.subscribe` handler when a
   * connection asks to receive push frames; entries are removed in
   * `handleConnection`'s `close` listener so a disconnected client never sits
   * in the broadcast loop.
   */
  private readonly subscribers: Map<SubscriptionChannel, Set<ConnectionState>> = new Map();
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

    // Tell the listener to stop accepting new connections, but **do not
    // await** the close callback yet — `net.Server.close`'s callback fires
    // only after every existing socket has gone, and we still need to
    // force-destroy lingering subscribers below. Awaiting first would
    // deadlock the drain on idle subscribers.
    const closePromise = new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });

    // Wait for in-flight handlers up to `drainMs`.
    const deadline = Date.now() + drainMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    // Force-close any lingering connections (idle subscribers, slow handlers,
    // etc.). With every socket destroyed, the listener-close callback above
    // will fire on the next tick.
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections.clear();
    this.subscribers.clear();

    // Now safe to await the listener-close callback.
    await closePromise;

    // Best-effort unlink. Windows pipes don't have a filesystem entry to remove.
    if (process.platform !== "win32") {
      try {
        await unlink(this.opts.socketPath);
      } catch {
        // The socket file may already be gone; that's fine.
      }
    }
  }

  /**
   * Broadcast an event frame to every connection currently subscribed to its
   * matching channel.
   *
   * The channel is derived from the event's `kind` discriminator —
   * `sessions.event` routes to the `"sessions"` subscriber set. Connections
   * that fail to write are detached and destroyed; a single bad peer never
   * blocks the rest of the broadcast.
   *
   * Optionally filter the recipient set with `predicate` (e.g. to skip the
   * connection that triggered the event). The predicate runs after the
   * subscription check.
   *
   * @param evt - The event frame to send. Must validate against {@link EvtT}.
   * @param predicate - Optional filter applied to each candidate connection.
   * @returns The number of connections the frame was successfully written to.
   */
  broadcast(evt: EvtT, predicate?: BroadcastPredicate): number {
    const channel = channelForEvent(evt);
    const subs = this.subscribers.get(channel);
    if (!subs || subs.size === 0) return 0;

    let encoded: Buffer;
    try {
      encoded = encodeMessage(evt);
    } catch {
      // Encoding failure (e.g. MAX_LINE_BYTES) is a programmer bug at the
      // caller. We swallow it here so a single bad event cannot tear down
      // every subscriber.
      return 0;
    }

    let delivered = 0;
    // Snapshot to a copy so a write-time `destroy()` mutating `subs` doesn't
    // invalidate the iterator.
    for (const conn of Array.from(subs)) {
      const sock = conn.getSocket();
      if (predicate && !predicate({ socket: sock })) continue;
      if (conn.isClosed() || sock.destroyed) {
        subs.delete(conn);
        continue;
      }
      try {
        sock.write(encoded);
        delivered += 1;
      } catch {
        // The peer has gone away or the socket buffer is broken; drop the
        // subscription and let the close listener clean up the rest.
        subs.delete(conn);
        conn.destroy();
      }
    }
    return delivered;
  }

  /** Handle a freshly-accepted connection: build per-connection state. */
  private handleConnection(socket: net.Socket): void {
    const conn = new ConnectionState(socket, this);
    this.connections.add(conn);
    socket.on("close", () => {
      this.connections.delete(conn);
      // Drop the connection from every channel it had joined. Subscriber sets
      // are bounded by the live connection count, so a `for..of` here is
      // negligible.
      for (const subs of this.subscribers.values()) {
        subs.delete(conn);
      }
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
  /**
   * @internal
   * Add `conn` to the subscriber set for `channel`. Idempotent.
   */
  addSubscription(conn: ConnectionState, channel: SubscriptionChannel): void {
    let set = this.subscribers.get(channel);
    if (!set) {
      set = new Set();
      this.subscribers.set(channel, set);
    }
    set.add(conn);
  }

  /**
   * @internal
   * Number of subscribers currently attached to `channel`. Test-only — the
   * runtime broadcast path does not need this.
   */
  subscriberCount(channel: SubscriptionChannel): number {
    return this.subscribers.get(channel)?.size ?? 0;
  }
}

/** Map an event frame to the subscriber channel it should reach. */
function channelForEvent(evt: EvtT): SubscriptionChannel {
  return eventChannelByKind[evt.kind];
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

  /** @internal — accessor for the parent server's broadcast loop. */
  getSocket(): net.Socket {
    return this.socket;
  }

  /** @internal — accessor for the parent server's broadcast loop. */
  isClosed(): boolean {
    return this.phase === "closed";
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
    // `sessions.subscribe` is owned by the framework — it mutates per-connection
    // bookkeeping that the user's handler map cannot reach. Idempotent ack.
    if (req.kind === "sessions.subscribe") {
      this.parent.addSubscription(this, "sessions");
      this.sendOk("sessions.subscribe.ok", req.id, { subscribed: true });
      return;
    }

    const handler = this.parent.getHandler(req.kind);
    if (!handler) {
      this.sendError("NOT_FOUND", `no handler for kind ${req.kind}`, req.id, req.kind);
      return;
    }
    this.parent.beginHandler();
    try {
      const body = await handler(req, { socket: this.socket });
      const respKind = responseKindByRequest[req.kind];
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
