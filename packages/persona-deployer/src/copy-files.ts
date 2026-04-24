/**
 * File copy logic for agents, skills, slash commands, and memory seeds.
 *
 * Each incoming file's `basename` is the deployment key within its category
 * directory. When two source paths share the same basename, the later one
 * overwrites the earlier one and a `CollisionLogEntry` is appended to the
 * collision log.
 *
 * Categories are independent: an agent and a skill may share the same
 * filename without a collision being reported.
 */

import { mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { SourceFileNotFoundError } from "./errors.js";
import { atomicWrite } from "./utils/atomic-write.js";
import type { CollisionLogEntry, FileCategory, MissingSourceEntry } from "./utils/types.js";

/**
 * Result of `copyFiles`.
 */
export interface CopyFilesResult {
  /** Absolute paths of every file written to the target directory. */
  writtenFiles: string[];
  /** Collision log entries produced during this copy operation. */
  collisions: CollisionLogEntry[];
  /** Missing source files (only when `onMissingSource === 'skip'`). */
  missingSources: MissingSourceEntry[];
}

/**
 * Options for `copyFiles`.
 */
export interface CopyFilesOpts {
  /** What to do when a source file does not exist. */
  onMissingSource: "throw" | "skip";
}

/**
 * Copy an array of persona files into a target directory.
 *
 * - Each file is read and written via `atomicWrite` (no raw `writeFile` calls).
 * - Filename collisions within the same category: later wins; overwrite is logged.
 * - If `onMissingSource === 'throw'`, throws `SourceFileNotFoundError` immediately.
 * - If `onMissingSource === 'skip'`, records the missing file and continues.
 *
 * @param category    - The persona category (for collision log and error messages).
 * @param sources     - Ordered array of absolute source file paths.
 * @param targetDir   - Absolute path to the destination directory.
 * @param opts        - Missing-source policy.
 */
export async function copyFiles(
  category: FileCategory,
  sources: string[],
  targetDir: string,
  opts: CopyFilesOpts
): Promise<CopyFilesResult> {
  const writtenFiles: string[] = [];
  const collisions: CollisionLogEntry[] = [];
  const missingSources: MissingSourceEntry[] = [];

  // Track which basename → winning source path, for collision detection.
  const basenameMap = new Map<string, string>();

  // Ensure the target directory exists (it should already from createSessionDir,
  // but be defensive here in case deployPersona is called without it).
  await mkdir(targetDir, { recursive: true, mode: 0o700 });

  for (const srcPath of sources) {
    const name = basename(srcPath);
    const targetPath = join(targetDir, name);

    let content: Buffer;
    try {
      content = await readFile(srcPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (opts.onMissingSource === "skip") {
          missingSources.push({ category, sourcePath: srcPath, targetPath });
          continue;
        }
        throw new SourceFileNotFoundError(category, srcPath, targetPath);
      }
      throw err;
    }

    // Collision detection: if a previous source already maps to this basename,
    // record the overwrite before proceeding.
    const prior = basenameMap.get(name);
    if (prior !== undefined) {
      collisions.push({
        target: name,
        category,
        overriddenSource: prior,
        winningSource: srcPath,
      });
    }

    await atomicWrite(targetPath, content);

    basenameMap.set(name, srcPath);

    // Add to writtenFiles only if not already present (for the overwrite case,
    // the target path is the same — we keep one entry per final file).
    if (!writtenFiles.includes(targetPath)) {
      writtenFiles.push(targetPath);
    }
  }

  return { writtenFiles, collisions, missingSources };
}
