import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookiePath, readCookie, writeBootCookie } from "../src/cookie.js";

describe("cookie helpers", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "ipc-cookie-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("cookiePath joins to <myClaudeHome>/ipc-cookie", () => {
    expect(cookiePath("/h/x/.myclaude")).toBe(join("/h/x/.myclaude", "ipc-cookie"));
  });

  it("writes a cookie at mode 0600 and round-trips through readCookie", async () => {
    const written = await writeBootCookie(home);
    expect(written).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(written.length).toBeGreaterThanOrEqual(43);

    const path = cookiePath(home);
    const info = await stat(path);
    expect(info.mode & 0o777).toBe(0o600);

    const read = await readCookie(home);
    expect(read).toBe(written);
  });

  it("leaves no temp cookie files after a successful write", async () => {
    await writeBootCookie(home);

    const entries = await readdir(home);
    expect(entries.filter((entry) => entry.startsWith("ipc-cookie.tmp-"))).toEqual([]);
  });

  it("overwrites an existing relaxed-mode cookie with a fresh strict cookie", async () => {
    const path = cookiePath(home);
    await writeFile(path, "old-cookie", { mode: 0o600, encoding: "utf8" });
    await chmod(path, 0o644);

    const written = await writeBootCookie(home);

    expect(written).not.toBe("old-cookie");
    await expect(readCookie(home)).resolves.toBe(written);
    const info = await stat(path);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("cleans up the temp cookie when rename fails", async () => {
    const renameFailure = new Error("rename failed");
    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      return {
        ...actual,
        rename: vi.fn(async () => {
          throw renameFailure;
        }),
      };
    });

    try {
      const { writeBootCookie: writeBootCookieWithRenameFailure } = await import(
        "../src/cookie.js"
      );
      await expect(writeBootCookieWithRenameFailure(home)).rejects.toThrow(renameFailure);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }

    await expect(stat(cookiePath(home))).rejects.toMatchObject({ code: "ENOENT" });
    const entries = await readdir(home);
    expect(entries.filter((entry) => entry.startsWith("ipc-cookie.tmp-"))).toEqual([]);
  });

  it("readCookie throws on a relaxed file mode", async () => {
    await mkdir(home, { recursive: true });
    const path = cookiePath(home);
    await writeFile(path, "tampered", { mode: 0o600, encoding: "utf8" });
    await chmod(path, 0o644);

    await expect(readCookie(home)).rejects.toThrow(/expected 0o600/);
  });

  it("readCookie throws when the cookie file is missing", async () => {
    await expect(readCookie(home)).rejects.toThrow();
  });
});
