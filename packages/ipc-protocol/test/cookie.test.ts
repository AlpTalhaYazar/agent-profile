import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
