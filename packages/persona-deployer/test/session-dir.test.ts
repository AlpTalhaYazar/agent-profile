import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionPathUnsafeError } from "../src/errors.js";
import { cleanupSession, createSessionDir, listOrphanedSessions } from "../src/session-dir.js";

let tmpRoot: string;

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe("createSessionDir", () => {
  it("creates the expected directory tree", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    // All four category dirs must exist.
    for (const cat of ["agents", "skills", "commands", "memory"]) {
      await expect(access(join(claudeConfigDir, cat))).resolves.toBeUndefined();
    }

    // sessionDir must exist.
    await expect(access(sessionDir)).resolves.toBeUndefined();
  });

  it("returns a non-empty sessionId", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const { sessionId } = await createSessionDir({ root: tmpRoot });

    expect(sessionId).toBeTruthy();
    // UUID v4 format
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("claudeConfigDir is the .claude subdirectory of sessionDir", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    expect(claudeConfigDir).toBe(join(sessionDir, ".claude"));
  });

  it("directories have mode 0700 on POSIX", async () => {
    if (process.platform === "win32") return;

    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const { sessionDir } = await createSessionDir({ root: tmpRoot });

    const s = await stat(sessionDir);
    // eslint-disable-next-line no-bitwise
    expect(s.mode & 0o777).toBe(0o700);
  });

  it("creates unique session IDs on repeated calls", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const a = await createSessionDir({ root: tmpRoot });
    const b = await createSessionDir({ root: tmpRoot });

    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe("cleanupSession", () => {
  it("removes the session directory and its contents", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const { sessionDir } = await createSessionDir({ root: tmpRoot });

    await cleanupSession(sessionDir, { allowedRoots: [tmpRoot] });

    await expect(access(sessionDir)).rejects.toThrow();
  });

  it("throws SessionPathUnsafeError when path is outside allowed roots", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    // Use a completely different root as the allowed root.
    const otherRoot = mkdtempSync(join(tmpdir(), "other-root-"));
    try {
      const { sessionDir } = await createSessionDir({ root: tmpRoot });

      await expect(cleanupSession(sessionDir, { allowedRoots: [otherRoot] })).rejects.toThrow(
        SessionPathUnsafeError
      );
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("is idempotent — does not throw if already deleted (force: true)", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const { sessionDir } = await createSessionDir({ root: tmpRoot });

    await cleanupSession(sessionDir, { allowedRoots: [tmpRoot] });
    // Second call should not throw.
    await expect(cleanupSession(sessionDir, { allowedRoots: [tmpRoot] })).resolves.toBeUndefined();
  });
});

describe("listOrphanedSessions", () => {
  it("returns an empty array when the root does not exist", async () => {
    const nonExistent = join(tmpdir(), `does-not-exist-${Date.now()}`);
    const result = await listOrphanedSessions({ root: nonExistent, olderThanMs: 0 });
    expect(result).toEqual([]);
  });

  it("returns all sessions when olderThanMs is 0", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    await createSessionDir({ root: tmpRoot });
    await createSessionDir({ root: tmpRoot });

    const result = await listOrphanedSessions({ root: tmpRoot, olderThanMs: 0 });
    expect(result).toHaveLength(2);
  });

  it("returns only sessions older than the threshold", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const fresh = await createSessionDir({ root: tmpRoot });
    const old = await createSessionDir({ root: tmpRoot });

    // Backdate the 'old' session directory by 2 hours via utimes.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(old.sessionDir, twoHoursAgo, twoHoursAgo);

    const result = await listOrphanedSessions({ root: tmpRoot, olderThanMs: 60 * 60 * 1000 });

    const ids = result.map((r) => r.sessionId);
    expect(ids).toContain(old.sessionId);
    expect(ids).not.toContain(fresh.sessionId);
  });

  it("result entries contain expected fields", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const session = await createSessionDir({ root: tmpRoot });

    const result = await listOrphanedSessions({ root: tmpRoot, olderThanMs: 0 });

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry?.sessionId).toBe(session.sessionId);
    expect(entry?.sessionDir).toBe(session.sessionDir);
    expect(typeof entry?.createdAtMs).toBe("number");
    expect(typeof entry?.ageMs).toBe("number");
  });

  it("sorts results with oldest first", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    const s1 = await createSessionDir({ root: tmpRoot });
    const s2 = await createSessionDir({ root: tmpRoot });

    // Make s1 older than s2.
    const earlier = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(s1.sessionDir, earlier, earlier);

    const result = await listOrphanedSessions({ root: tmpRoot, olderThanMs: 0 });

    expect(result.length).toBeGreaterThanOrEqual(2);
    // First result should be the older session.
    const first = result[0];
    const second = result[1];
    expect(first?.createdAtMs).toBeLessThanOrEqual(second?.createdAtMs ?? Number.MAX_SAFE_INTEGER);
  });

  it("skips non-directory entries inside the root", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "session-dir-test-"));

    // Create a file (not a dir) inside the root.
    const { atomicWrite } = await import("../src/utils/atomic-write.js");
    await atomicWrite(join(tmpRoot, "not-a-session.txt"), "noise");

    await createSessionDir({ root: tmpRoot });

    const result = await listOrphanedSessions({ root: tmpRoot, olderThanMs: 0 });
    // Only the real session dir should be returned.
    for (const entry of result) {
      expect(entry.sessionId).not.toBe("not-a-session.txt");
    }
  });
});
