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

import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
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
 * Result of `readCategoryFiles`.
 *
 * Pure read primitive — no `mkdir`, no `atomicWrite`. Returns the buffered
 * file contents alongside the same collision and missing-source bookkeeping
 * that `copyFiles` produces, so callers can either deploy to disk (the
 * `copyFiles` wrapper) or render in-memory (`renderPersonaInMemory`).
 *
 * `files` preserves cascade order including colliding entries; callers that
 * only want the winning content per basename (e.g. `renderPersonaInMemory`)
 * should post-filter on `basename` keeping the last occurrence.
 */
export interface ReadCategoryFilesResult {
  /** Successfully read files in cascade order — colliding entries included. */
  files: Array<{
    /** File basename (deployment key, e.g. `code-reviewer.md`). */
    basename: string;
    /** Absolute source path on disk. */
    sourcePath: string;
    /** Raw file content (unparsed bytes). */
    content: Buffer;
    /** Directory-backed skills are deployed recursively; `content` is SKILL.md. */
    kind: "file" | "directory";
  }>;
  /** Collision log entries produced during the read. */
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
 * Options for `readCategoryFiles`.
 */
export interface ReadCategoryFilesOpts {
  /** What to do when a source file does not exist. */
  onMissingSource: "throw" | "skip";
  /**
   * Optional target directory used only when populating missing-source
   * records and `SourceFileNotFoundError.targetPath`. When omitted, missing
   * entries carry an empty `targetPath`.
   */
  targetDir?: string;
}

/**
 * Read an array of persona files for a given category and surface collisions
 * + missing-source entries without writing to disk.
 *
 * Behaviour mirrors `copyFiles` byte-for-byte (collision detection, ENOENT
 * handling, basename → winning source map) so that `copyFiles` can wrap this
 * helper for disk deployment while `renderPersonaInMemory` consumes the same
 * primitive for in-memory preview.
 *
 * @param category  - The persona category (used in collision/missing logs).
 * @param sources   - Ordered array of absolute source file paths.
 * @param opts      - Missing-source policy and optional target directory.
 */
export async function readCategoryFiles(
  category: FileCategory,
  sources: string[],
  opts: ReadCategoryFilesOpts
): Promise<ReadCategoryFilesResult> {
  const files: ReadCategoryFilesResult["files"] = [];
  const collisions: CollisionLogEntry[] = [];
  const missingSources: MissingSourceEntry[] = [];

  // Track which basename → winning source path, for collision detection.
  const basenameMap = new Map<string, string>();

  for (const srcPath of sources) {
    let sourceStat: Awaited<ReturnType<typeof stat>>;
    try {
      sourceStat = await stat(srcPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (opts.onMissingSource === "skip") {
          missingSources.push({
            category,
            sourcePath: srcPath,
            targetPath: targetPathForSource(srcPath, opts.targetDir),
          });
          continue;
        }
        throw new SourceFileNotFoundError(
          category,
          srcPath,
          targetPathForSource(srcPath, opts.targetDir)
        );
      }
      throw err;
    }

    const isSkillDirectory = category === "skills" && sourceStat.isDirectory();
    const name = basename(srcPath);
    const skillEntryPath = isSkillDirectory ? join(srcPath, "SKILL.md") : srcPath;
    const targetPath = targetPathForSource(srcPath, opts.targetDir, isSkillDirectory);

    let content: Buffer;
    try {
      content = await readFile(skillEntryPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (opts.onMissingSource === "skip") {
          missingSources.push({ category, sourcePath: skillEntryPath, targetPath });
          continue;
        }
        throw new SourceFileNotFoundError(category, skillEntryPath, targetPath);
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

    basenameMap.set(name, srcPath);

    // Append every successfully-read entry in order. Callers that only need
    // the winning content per basename should keep the last occurrence.
    files.push({
      basename: name,
      sourcePath: srcPath,
      content,
      kind: isSkillDirectory ? "directory" : "file",
    });
  }

  return { files, collisions, missingSources };
}

/**
 * Copy an array of persona files into a target directory.
 *
 * - Each file is read and written via `atomicWrite` (no raw `writeFile` calls).
 * - Filename collisions within the same category: later wins; overwrite is logged.
 * - If `onMissingSource === 'throw'`, throws `SourceFileNotFoundError` immediately.
 * - If `onMissingSource === 'skip'`, records the missing file and continues.
 *
 * Internally this delegates the read pass to `readCategoryFiles` and then
 * performs the `mkdir` + `atomicWrite` per surviving file. The external
 * behaviour (`writtenFiles`, `collisions`, `missingSources`) is preserved
 * byte-for-byte.
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
  // Ensure the target directory exists (it should already from createSessionDir,
  // but be defensive here in case deployPersona is called without it).
  await mkdir(targetDir, { recursive: true, mode: 0o700 });

  const readResult = await readCategoryFiles(category, sources, {
    onMissingSource: opts.onMissingSource,
    targetDir,
  });

  // Write each successfully-read source in cascade order. Colliding entries
  // overwrite their predecessors on disk via `atomicWrite`'s rename step;
  // `writtenFiles` records each unique target once (deduplicated by path so
  // overwrites do not produce duplicate entries).
  const writtenFiles: string[] = [];
  const seen = new Set<string>();
  for (const file of readResult.files) {
    if (file.kind === "directory") {
      const targetRoot = join(targetDir, file.basename);
      await rm(targetRoot, { recursive: true, force: true });
      const copied = await copyDirectoryRecursive(file.sourcePath, targetRoot);
      for (const targetPath of copied) {
        if (!seen.has(targetPath)) {
          writtenFiles.push(targetPath);
          seen.add(targetPath);
        }
      }
      continue;
    }

    const targetPath = join(targetDir, file.basename);
    await rm(targetPath, { recursive: true, force: true });
    await atomicWrite(targetPath, file.content);
    if (!seen.has(targetPath)) {
      writtenFiles.push(targetPath);
      seen.add(targetPath);
    }
  }

  return {
    writtenFiles,
    collisions: readResult.collisions,
    missingSources: readResult.missingSources,
  };
}

function targetPathForSource(
  sourcePath: string,
  targetDir: string | undefined,
  skillDirectory = false
): string {
  if (targetDir === undefined) return "";
  const name = basename(sourcePath);
  return skillDirectory ? join(targetDir, name, "SKILL.md") : join(targetDir, name);
}

async function copyDirectoryRecursive(sourceDir: string, targetDir: string): Promise<string[]> {
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const writtenFiles: string[] = [];
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      writtenFiles.push(...(await copyDirectoryRecursive(sourcePath, targetPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    await atomicWrite(targetPath, await readFile(sourcePath));
    writtenFiles.push(targetPath);
  }

  return writtenFiles;
}
