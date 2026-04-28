/**
 * @module @agent-profile/ipc-protocol/codec
 *
 * Newline-delimited JSON (NDJSON) framing over an octet stream.
 *
 * Why NDJSON: the wire is a Unix Domain Socket / Named Pipe carrying small,
 * structured messages between two trusted processes on the same host. The
 * envelope cost of NDJSON is one byte per message (`\n`) and the parsing logic
 * is trivial. Length-prefixed framing would buy nothing here — the overhead
 * dominated would be parsing, not framing.
 *
 * Two layers live in this file:
 *
 *  - {@link encodeMessage} — serializes a single request or response and
 *    enforces the per-line size cap so a malformed caller cannot blow up the
 *    peer's buffer.
 *  - {@link MessageDecoder} — wraps a `Readable`, splits incoming chunks on
 *    `\n`, and emits parsed objects via an `onMessage` callback. The decoder is
 *    intentionally one-way (read-only) so the same class is reusable on both
 *    client and server sides.
 *
 * Both layers are codec-only: they do NOT Zod-validate against
 * {@link ../messages.ts}. The message-routing layer above (client/server)
 * owns schema validation. Keeping the codec schema-agnostic means it can carry
 * future message kinds without redeploying the codec.
 */

import type { Readable } from "node:stream";
import type { EvtT, ReqT, RespT } from "./messages.js";

/**
 * Maximum encoded byte length for a single NDJSON line, including the trailing
 * newline.
 *
 * 1 MiB is generous for our message shapes (the largest will be `profile.show.ok`
 * with a full effective config + provenance, typically a few KiB) but small
 * enough that a malicious peer cannot exhaust memory by sending an unbounded
 * line. Both encode and decode paths enforce this limit.
 */
export const MAX_LINE_BYTES = 1_048_576;

/**
 * Serialize a request, response, or event frame into a single NDJSON line.
 *
 * Throws synchronously if the encoded line (including the trailing `\n`) would
 * exceed {@link MAX_LINE_BYTES}. Callers should treat such an error as a
 * programmer bug — if you are sending a message that big, the wire shape needs
 * to change.
 *
 * Event frames ({@link EvtT}) are encoded without an `id` field. The codec
 * intentionally accepts the union without re-validating against the schema —
 * the message-routing layer above (client/server) owns Zod validation.
 *
 * @param msg - Any valid {@link ReqT}, {@link RespT}, or {@link EvtT} object.
 * @returns A `Buffer` containing the JSON-stringified message followed by `\n`.
 * @throws {Error} When the encoded line exceeds {@link MAX_LINE_BYTES}.
 */
export function encodeMessage(msg: ReqT | RespT | EvtT): Buffer {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(`${json}\n`, "utf8");
  if (buf.byteLength > MAX_LINE_BYTES) {
    throw new Error(
      `ipc-protocol: encoded message exceeds MAX_LINE_BYTES (${buf.byteLength} > ${MAX_LINE_BYTES})`
    );
  }
  return buf;
}

/**
 * Constructor options for {@link MessageDecoder}.
 */
export interface MessageDecoderOptions {
  /** The Node `Readable` stream to attach to. */
  stream: Readable;
  /** Called for each successfully parsed JSON object. Receives `unknown`; the caller validates. */
  onMessage: (raw: unknown) => void;
  /** Called when a line exceeds the byte cap or fails to parse as JSON. */
  onError: (err: Error) => void;
}

/**
 * Streaming NDJSON decoder.
 *
 * Buffers chunks until a `\n` is found, JSON-parses the line up to (excluding)
 * that newline, and dispatches the parsed object via `onMessage`. The buffer
 * carries leftover bytes across chunk boundaries so a message split across two
 * `data` events is reassembled correctly.
 *
 * The decoder enforces the line-byte cap continuously: as soon as the
 * accumulated buffer exceeds {@link MAX_LINE_BYTES} *without* seeing a newline,
 * it reports an error via `onError` and drops the buffer. This prevents an
 * unbounded line from consuming memory.
 *
 * Construction attaches stream listeners. {@link MessageDecoder.close} detaches
 * them. The decoder does not own the stream's lifecycle (it does not call
 * `destroy()` on the stream); it only adds and removes its own listeners.
 */
export class MessageDecoder {
  private readonly stream: Readable;
  private readonly onMessage: (raw: unknown) => void;
  private readonly onError: (err: Error) => void;
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;
  private readonly dataListener: (chunk: Buffer | string) => void;

  /**
   * Attach to a `Readable` and start dispatching parsed messages.
   *
   * The `data` listener is added immediately (which puts the stream into
   * flowing mode); call {@link close} to detach.
   */
  constructor(opts: MessageDecoderOptions) {
    this.stream = opts.stream;
    this.onMessage = opts.onMessage;
    this.onError = opts.onError;
    this.dataListener = (chunk) => {
      this.handleChunk(chunk);
    };
    this.stream.on("data", this.dataListener);
  }

  /**
   * Detach from the underlying stream.
   *
   * Idempotent. Does not destroy the stream — that responsibility belongs to
   * whoever owns the stream's lifecycle (client/server code, usually).
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stream.off("data", this.dataListener);
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Append a chunk of bytes to the line buffer and flush every complete line.
   *
   * Strings are converted to `Buffer` first so byte-length checks work
   * correctly with multi-byte UTF-8 sequences (each `\n` byte is unambiguous in
   * UTF-8, but counting characters would lie about size).
   */
  private handleChunk(chunk: Buffer | string): void {
    if (this.closed) return;
    const incoming = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.buffer = Buffer.concat([this.buffer, incoming]);

    while (true) {
      const newlineIdx = this.buffer.indexOf(0x0a);
      if (newlineIdx === -1) {
        // No newline yet — guard against an unbounded line.
        if (this.buffer.byteLength > MAX_LINE_BYTES) {
          const err = new Error(
            `ipc-protocol: incoming line exceeds MAX_LINE_BYTES (${this.buffer.byteLength} > ${MAX_LINE_BYTES})`
          );
          this.buffer = Buffer.alloc(0);
          this.onError(err);
        }
        return;
      }

      // The line itself excludes the trailing newline. The +1 includes the
      // newline so it is dropped from the residual buffer.
      const lineLen = newlineIdx;
      if (lineLen > MAX_LINE_BYTES) {
        const err = new Error(
          `ipc-protocol: incoming line exceeds MAX_LINE_BYTES (${lineLen} > ${MAX_LINE_BYTES})`
        );
        this.buffer = this.buffer.subarray(newlineIdx + 1);
        this.onError(err);
        continue;
      }

      const lineBuf = this.buffer.subarray(0, lineLen);
      this.buffer = this.buffer.subarray(newlineIdx + 1);
      // Skip empty keepalive lines silently.
      if (lineBuf.byteLength === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(lineBuf.toString("utf8"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.onError(new Error(`ipc-protocol: invalid JSON line: ${message}`));
        continue;
      }
      this.onMessage(parsed);
    }
  }
}
