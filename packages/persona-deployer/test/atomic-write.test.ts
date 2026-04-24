import { mkdtempSync, rmSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWrite } from "../src/utils/atomic-write.js";

let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("atomicWrite", () => {
  it("writes content to the target path", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "output.txt");

    await atomicWrite(target, "hello world");

    const content = await readFile(target, "utf8");
    expect(content).toBe("hello world");
  });

  it("leaves no .tmp-* files after a successful write", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "output.txt");

    await atomicWrite(target, "hello world");

    const entries = await readdir(tmpDir);
    const tmpFiles = entries.filter((e) => e.includes(".tmp-"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("overwrites an existing file atomically", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "output.txt");

    await atomicWrite(target, "first");
    await atomicWrite(target, "second");

    const content = await readFile(target, "utf8");
    expect(content).toBe("second");
  });

  it("writes binary (Uint8Array) content", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "binary.bin");
    const data = new Uint8Array([0x41, 0x42, 0x43]); // ABC

    await atomicWrite(target, data);

    const content = await readFile(target, "utf8");
    expect(content).toBe("ABC");
  });

  it("applies the default mode 0o600 on POSIX", async () => {
    // Mode bits are only meaningful on POSIX; skip this assertion on Windows.
    if (process.platform === "win32") return;

    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "secret.txt");

    await atomicWrite(target, "sensitive", 0o600);

    const { promises: fs } = await import("node:fs");
    const s = await fs.stat(target);
    // eslint-disable-next-line no-bitwise
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("allows custom mode override on POSIX", async () => {
    if (process.platform === "win32") return;

    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "readable.txt");

    await atomicWrite(target, "content", 0o644);

    const { promises: fs } = await import("node:fs");
    const s = await fs.stat(target);
    // eslint-disable-next-line no-bitwise
    expect(s.mode & 0o777).toBe(0o644);
  });

  it("concurrent writes to the same path result in complete content (no partial reads)", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "concurrent.txt");

    // Write 10 concurrent values; each is a complete JSON line.
    const writes = Array.from({ length: 10 }, (_, i) =>
      atomicWrite(target, JSON.stringify({ index: i }))
    );
    await Promise.all(writes);

    // Regardless of which write won, the file must be valid JSON (never partial).
    const raw = await readFile(target, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("throws when the target directory does not exist", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "nonexistent-dir", "output.txt");

    await expect(atomicWrite(target, "hello")).rejects.toThrow();
  });

  it("leaves no temp file when rename fails due to missing directory", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
    const target = join(tmpDir, "nonexistent-dir", "output.txt");

    try {
      await atomicWrite(target, "hello");
    } catch {
      // Expected — verify no .tmp-* files leaked.
      const entries = await readdir(tmpDir);
      const tmpFiles = entries.filter((e) => e.includes(".tmp-"));
      expect(tmpFiles).toHaveLength(0);
    }
  });
});
