/**
 * Atomic file-write helper.
 *
 * Writes content to a `<targetPath>.tmp-<random>` sibling file, then renames
 * it to the final target path. This ensures that readers of `targetPath` never
 * observe a partially written file, and that a crash during the write leaves
 * at most a `.tmp-*` file rather than corrupting the destination.
 *
 * All writes inside `packages/persona-deployer` **must** go through this
 * helper; raw `writeFile` calls to final paths are forbidden.
 */

import { randomBytes } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Write `content` atomically to `targetPath`.
 *
 * Steps:
 * 1. Generate a sibling temp path `<dir>/<name>.tmp-<8-hex-chars>`.
 * 2. Write content to the temp path with the given mode (default `0o600`).
 * 3. `rename()` the temp path to `targetPath` (atomic on POSIX; best-effort on Windows).
 *
 * If `rename` fails, the temp file is deleted to avoid leaks, and the error
 * is re-thrown.
 *
 * @param targetPath - Absolute path of the final file.
 * @param content    - File content as a string (UTF-8) or `Uint8Array`.
 * @param mode       - File permission bits applied to the temp file before rename.
 *                     Defaults to `0o600`. On Windows, mode bits are silently
 *                     ignored by the OS; the default is still passed for
 *                     cross-platform consistency.
 */
export async function atomicWrite(
  targetPath: string,
  content: string | Uint8Array,
  mode = 0o600
): Promise<void> {
  const dir = dirname(targetPath);
  const suffix = randomBytes(4).toString("hex");
  const tmpPath = join(dir, `${targetPath.split("/").pop()}.tmp-${suffix}`);

  await writeFile(tmpPath, content, { mode });

  try {
    await rename(tmpPath, targetPath);
  } catch (err) {
    // Best-effort cleanup: remove the temp file to avoid leaving orphans.
    await unlink(tmpPath).catch(() => {
      // Ignore secondary cleanup errors — the rename error takes precedence.
    });
    throw err;
  }
}
