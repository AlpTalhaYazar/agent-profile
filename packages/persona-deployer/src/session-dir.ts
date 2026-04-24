/**
 * Session directory lifecycle: create, list orphans, and remove.
 *
 * A session directory holds all ephemeral files for one `claude` process
 * invocation: CLAUDE.md, agent/skill/command/memory files, and (in later
 * sprints) mcp.json, settings.json, and helper scripts.
 *
 * Layout created by `createSessionDir`:
 *
 * ```
 * <root>/<uuid>/
 * └── .claude/
 *     ├── agents/
 *     ├── skills/
 *     ├── commands/
 *     └── memory/
 * ```
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertInsideRoot } from "./path-safety.js";
import type { OrphanedSession, SessionInfo } from "./utils/types.js";

/** Default root directory for ephemeral session directories. */
export function sessionsRootDefault(): string {
  return join(homedir(), ".myclaude", "sessions");
}

/**
 * Options for `createSessionDir`.
 */
export interface CreateSessionDirOpts {
  /**
   * Parent directory under which the session UUID directory will be created.
   * Defaults to `sessionsRootDefault()` (`~/.myclaude/sessions`).
   * Override in tests to use `os.tmpdir()`.
   */
  root?: string;
}

/**
 * Create a new ephemeral session directory and return its metadata.
 *
 * The directory tree is created with mode `0o700` on POSIX (only the owning
 * user can read/write/execute). On Windows, the mode argument is silently
 * ignored by the OS; access control is governed by the file system ACL.
 *
 * The returned `claudeConfigDir` is the `.claude` subdirectory — pass it as
 * `CLAUDE_CONFIG_DIR` when spawning `claude`.
 *
 * @param opts - Optional overrides (primarily `root` for tests).
 * @returns Session metadata including UUID, session dir path, and config dir.
 */
export async function createSessionDir(opts: CreateSessionDirOpts = {}): Promise<SessionInfo> {
  const root = opts.root ?? sessionsRootDefault();
  const sessionId = randomUUID();
  const sessionDir = join(resolve(root), sessionId);
  const claudeConfigDir = join(sessionDir, ".claude");

  // Create the full tree. mode 0o700 on POSIX; ignored on Windows.
  await mkdir(join(claudeConfigDir, "agents"), { recursive: true, mode: 0o700 });
  await mkdir(join(claudeConfigDir, "skills"), { recursive: true, mode: 0o700 });
  await mkdir(join(claudeConfigDir, "commands"), { recursive: true, mode: 0o700 });
  await mkdir(join(claudeConfigDir, "memory"), { recursive: true, mode: 0o700 });

  return { sessionId, sessionDir, claudeConfigDir };
}

/**
 * Options for `cleanupSession`.
 */
export interface CleanupSessionOpts {
  /**
   * Roots the session directory must be inside.
   * Defaults to `[sessionsRootDefault()]`.
   * Tests should pass their own tmpdir as an allowed root.
   */
  allowedRoots?: string[];
}

/**
 * Recursively delete a session directory.
 *
 * Before any deletion, `assertInsideRoot` verifies that `sessionDir` is
 * inside one of the `allowedRoots`. This prevents a bug in the caller from
 * accidentally deleting an arbitrary directory (e.g. `/`).
 *
 * @param sessionDir - Absolute path to the session directory to remove.
 * @param opts       - Optional overrides for `allowedRoots`.
 *
 * @throws {SessionPathUnsafeError} If `sessionDir` is outside every allowed root.
 */
export async function cleanupSession(
  sessionDir: string,
  opts: CleanupSessionOpts = {}
): Promise<void> {
  const allowedRoots = opts.allowedRoots ?? [sessionsRootDefault()];
  assertInsideRoot(sessionDir, allowedRoots);

  await rm(sessionDir, { recursive: true, force: true });
}

/**
 * Options for `listOrphanedSessions`.
 */
export interface ListOrphanedSessionsOpts {
  /**
   * Root directory to scan.
   * Defaults to `sessionsRootDefault()`.
   */
  root?: string;

  /**
   * Age threshold in milliseconds.
   * Directories whose `mtime` is older than this are considered orphaned.
   * Defaults to 24 hours (`86_400_000` ms).
   * Pass `0` to return all sessions regardless of age.
   */
  olderThanMs?: number;
}

const DEFAULT_OLDER_THAN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * List session directories that are older than `olderThanMs` milliseconds.
 *
 * Designed for use by garbage-collection routines (`myclaude doctor`,
 * `myclaude sessions gc`). Does not delete anything — callers decide what to
 * do with the returned list.
 *
 * Non-directory entries inside the root are silently skipped.
 *
 * @param opts - Optional root and age threshold overrides.
 * @returns Array of orphaned session metadata, sorted by age (oldest first).
 */
export async function listOrphanedSessions(
  opts: ListOrphanedSessionsOpts = {}
): Promise<OrphanedSession[]> {
  const root = opts.root ?? sessionsRootDefault();
  const olderThanMs = opts.olderThanMs ?? DEFAULT_OLDER_THAN_MS;
  const now = Date.now();

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (err) {
    // If the sessions root doesn't exist yet, there are no orphans.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const results: OrphanedSession[] = [];

  for (const entry of entries) {
    const sessionDir = join(root, entry);
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(sessionDir);
    } catch {
      continue; // Skip entries we can't stat.
    }
    if (!s.isDirectory()) continue;

    const createdAtMs = s.mtimeMs;
    const ageMs = now - createdAtMs;

    if (ageMs >= olderThanMs) {
      results.push({ sessionId: entry, sessionDir, createdAtMs, ageMs });
    }
  }

  // Return oldest first.
  results.sort((a, b) => a.createdAtMs - b.createdAtMs);
  return results;
}
