import { describe, expect, it } from "vitest";
import { defaultSocketPath } from "../src/socket-path.js";

describe("defaultSocketPath", () => {
  it("honors MYCLAUDE_SOCKET when set", () => {
    expect(defaultSocketPath({ MYCLAUDE_SOCKET: "/custom/path.sock" }, "linux")).toBe(
      "/custom/path.sock"
    );
  });

  it("ignores empty MYCLAUDE_SOCKET", () => {
    const got = defaultSocketPath(
      { MYCLAUDE_SOCKET: "", XDG_RUNTIME_DIR: "/run/user/1000" },
      "linux"
    );
    expect(got).toBe("/run/user/1000/myclaude.sock");
  });

  it("uses XDG_RUNTIME_DIR on POSIX when set", () => {
    expect(defaultSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux")).toBe(
      "/run/user/1000/myclaude.sock"
    );
  });

  it("falls back to /tmp/myclaude-<uid>.sock on POSIX without XDG", () => {
    const got = defaultSocketPath({}, "linux");
    expect(got).toMatch(/^\/tmp\/myclaude-\d+\.sock$/);
  });

  it("uses Named Pipe path on Windows with USERNAME", () => {
    expect(defaultSocketPath({ USERNAME: "alice" }, "win32")).toBe("\\\\.\\pipe\\myclaude-alice");
  });

  it("falls back to PID-based pipe name when USERNAME is missing on Windows", () => {
    const got = defaultSocketPath({}, "win32");
    expect(got).toMatch(/^\\\\\.\\pipe\\myclaude-\d+$/);
  });
});
