/**
 * Atomic file-write helper for runtime artifacts.
 *
 * Temp files are created as siblings of the target file, which keeps rename
 * atomic under the session-directory invariant.
 */

import { randomBytes } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Write content to `targetPath` via sibling temp file + rename.
 *
 * @param targetPath - Final artifact path.
 * @param content - UTF-8 text or bytes to write.
 * @param mode - File permission bits for the temp file before rename.
 */
export async function atomicWrite(
  targetPath: string,
  content: string | Uint8Array,
  mode = 0o600
): Promise<void> {
  const dir = dirname(targetPath);
  const tmpPath = join(dir, `${basename(targetPath)}.tmp-${randomBytes(4).toString("hex")}`);

  await writeFile(tmpPath, content, { mode });

  try {
    await rename(tmpPath, targetPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {
      // Preserve the original rename error.
    });
    throw err;
  }
}
