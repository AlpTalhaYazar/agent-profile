import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MAX_LINE_BYTES, MessageDecoder, encodeMessage } from "../src/codec.js";
import type { EvtT, ReqT, RespPersonaRenderOkT } from "../src/messages.js";

function makeStream(): Readable {
  return new Readable({
    read() {
      // No-op; we push manually.
    },
  });
}

describe("encodeMessage", () => {
  it("round-trips a simple request", () => {
    const msg: ReqT = {
      id: "c-1",
      kind: "auth.list",
      includeRefs: true,
    };
    const encoded = encodeMessage(msg);
    expect(encoded[encoded.length - 1]).toBe(0x0a); // trailing newline
    const decoded = JSON.parse(encoded.subarray(0, encoded.length - 1).toString("utf8"));
    expect(decoded).toEqual(msg);
  });

  it("throws when the encoded line exceeds MAX_LINE_BYTES", () => {
    const big = "x".repeat(MAX_LINE_BYTES + 1);
    const msg = {
      id: "c-1",
      kind: "auth.get-secret-ref",
      authId: "work",
      name: big,
    } as ReqT;
    expect(() => encodeMessage(msg)).toThrow(/MAX_LINE_BYTES/);
  });

  it("round-trips a push event frame without an id", async () => {
    const evt: EvtT = {
      kind: "sessions.event",
      sessionId: "s-1",
      event: "killed",
      ts: 1_700_000_000,
    };
    const encoded = encodeMessage(evt);
    expect(encoded[encoded.length - 1]).toBe(0x0a);
    const line = encoded.subarray(0, encoded.length - 1).toString("utf8");
    expect(line).not.toContain('"id"');
    const decoded = JSON.parse(line);
    expect(decoded).toEqual(evt);
  });

  it("decodes a push event frame as a regular line", async () => {
    const stream = makeStream();
    const messages: unknown[] = [];
    const decoder = new MessageDecoder({
      stream,
      onMessage: (m) => messages.push(m),
      onError: () => {
        throw new Error("unexpected error");
      },
    });

    const evt: EvtT = {
      kind: "sessions.event",
      sessionId: "s-1",
      event: "drifted",
      ts: 42,
    };
    stream.push(encodeMessage(evt));
    await new Promise((r) => setImmediate(r));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(evt);
    decoder.close();
  });

  it("round-trips a persona.render.ok response frame", async () => {
    const resp: RespPersonaRenderOkT = {
      id: "c-1",
      kind: "persona.render.ok",
      claudeMd: {
        combinedContent: "## Backend\nbody\n",
        sections: [
          {
            sourcePath: "/repo/.myclaude/persona/backend/CLAUDE.md",
            originScope: "project-role",
            content: "## Backend\nbody\n",
          },
        ],
      },
      files: [
        {
          category: "agents",
          basename: "code-reviewer.md",
          sourcePath: "/repo/.myclaude/persona/backend/agents/code-reviewer.md",
          originScope: "project-role",
          content: "# Code Reviewer\n",
        },
      ],
      collisions: [],
      missingSources: [],
    };

    const stream = makeStream();
    const messages: unknown[] = [];
    const decoder = new MessageDecoder({
      stream,
      onMessage: (m) => messages.push(m),
      onError: () => {
        throw new Error("unexpected error");
      },
    });

    stream.push(encodeMessage(resp));
    await new Promise((r) => setImmediate(r));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(resp);
    decoder.close();
  });
});

describe("MessageDecoder", () => {
  it("emits one parsed message per line", async () => {
    const stream = makeStream();
    const messages: unknown[] = [];
    const errors: Error[] = [];
    const decoder = new MessageDecoder({
      stream,
      onMessage: (m) => messages.push(m),
      onError: (e) => errors.push(e),
    });

    stream.push(`${JSON.stringify({ id: "1", kind: "auth.list" })}\n`);
    stream.push(`${JSON.stringify({ id: "2", kind: "daemon.status" })}\n`);

    await new Promise((r) => setImmediate(r));
    expect(errors).toHaveLength(0);
    expect(messages).toHaveLength(2);
    expect((messages[0] as { id: string }).id).toBe("1");
    expect((messages[1] as { id: string }).id).toBe("2");
    decoder.close();
  });

  it("reassembles a message split across two chunks", async () => {
    const stream = makeStream();
    const messages: unknown[] = [];
    const decoder = new MessageDecoder({
      stream,
      onMessage: (m) => messages.push(m),
      onError: () => {
        throw new Error("unexpected error");
      },
    });

    const json = JSON.stringify({ id: "split", kind: "auth.list" });
    const half = Math.floor(json.length / 2);
    stream.push(json.substring(0, half));
    await new Promise((r) => setImmediate(r));
    expect(messages).toHaveLength(0);

    stream.push(`${json.substring(half)}\n`);
    await new Promise((r) => setImmediate(r));
    expect(messages).toHaveLength(1);
    expect((messages[0] as { id: string }).id).toBe("split");
    decoder.close();
  });

  it("handles two messages in a single chunk", async () => {
    const stream = makeStream();
    const messages: unknown[] = [];
    const decoder = new MessageDecoder({
      stream,
      onMessage: (m) => messages.push(m),
      onError: () => {
        throw new Error("unexpected error");
      },
    });

    const a = JSON.stringify({ id: "a", kind: "auth.list" });
    const b = JSON.stringify({ id: "b", kind: "daemon.status" });
    stream.push(`${a}\n${b}\n`);
    await new Promise((r) => setImmediate(r));
    expect(messages).toHaveLength(2);
    decoder.close();
  });

  it("emits an error when a single line exceeds MAX_LINE_BYTES", async () => {
    const stream = makeStream();
    const errors: Error[] = [];
    const decoder = new MessageDecoder({
      stream,
      onMessage: () => {
        throw new Error("unexpected message");
      },
      onError: (e) => errors.push(e),
    });

    // Push a chunk that is itself larger than the max, with no newline.
    stream.push(Buffer.alloc(MAX_LINE_BYTES + 1, 0x61));
    await new Promise((r) => setImmediate(r));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toMatch(/MAX_LINE_BYTES/);
    decoder.close();
  });

  it("emits an error on invalid JSON but keeps decoding subsequent lines", async () => {
    const stream = makeStream();
    const messages: unknown[] = [];
    const errors: Error[] = [];
    const decoder = new MessageDecoder({
      stream,
      onMessage: (m) => messages.push(m),
      onError: (e) => errors.push(e),
    });

    stream.push("{ not json }\n");
    stream.push(`${JSON.stringify({ id: "ok", kind: "auth.list" })}\n`);
    await new Promise((r) => setImmediate(r));

    expect(errors).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect((messages[0] as { id: string }).id).toBe("ok");
    decoder.close();
  });

  it("close() releases the stream listener", () => {
    const stream = makeStream();
    const decoder = new MessageDecoder({
      stream,
      onMessage: () => {},
      onError: () => {},
    });
    expect(stream.listenerCount("data")).toBe(1);
    decoder.close();
    expect(stream.listenerCount("data")).toBe(0);
    // Idempotent.
    decoder.close();
  });
});
