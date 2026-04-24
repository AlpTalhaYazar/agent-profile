/**
 * CLAUDE.md concatenation with source markers.
 *
 * Each input fragment is read verbatim and prefixed with an HTML comment that
 * identifies its origin:
 *
 * ```md
 * <!-- source: global-role/backend -->
 * <fragment content>
 *
 * <!-- source: project-role/backend -->
 * <next fragment content>
 * ```
 *
 * Source tags come from the optional `provenanceMap` (keyed by absolute source
 * path); when absent the absolute path itself is used as the tag.
 *
 * **Security**: source markers contain only scope tags or file paths — never
 * secret values. The `provenanceMap` values must be vetted by the caller.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { SourceFileNotFoundError } from "./errors.js";
import type { MissingSourceEntry } from "./utils/types.js";

/**
 * Result of `buildClaudeMd`.
 */
export interface ClaudeMdBuildResult {
  /** Concatenated Markdown content, ready to be written to disk. */
  content: string;
  /**
   * Missing source files encountered (only when `onMissingSource === 'skip'`).
   */
  missingSources: MissingSourceEntry[];
}

/**
 * Options for `buildClaudeMd`.
 */
export interface BuildClaudeMdOpts {
  /** Provenance labels keyed by absolute source path. */
  provenanceMap?: Record<string, string>;
  /** Target CLAUDE.md path — used only in error messages and missing-source records. */
  targetPath: string;
  /** What to do when a source file is missing. */
  onMissingSource: "throw" | "skip";
}

/**
 * Read and concatenate CLAUDE.md fragments with source markers.
 *
 * Returns `null` when `sources` is empty (no file should be written).
 *
 * @param sources - Ordered array of absolute paths to CLAUDE.md fragments.
 * @param opts    - Provenance map, target path, and missing-source policy.
 */
export async function buildClaudeMd(
  sources: string[],
  opts: BuildClaudeMdOpts
): Promise<ClaudeMdBuildResult | null> {
  if (sources.length === 0) return null;

  const { provenanceMap = {}, targetPath, onMissingSource } = opts;
  const missingSources: MissingSourceEntry[] = [];
  const sections: string[] = [];

  for (const srcPath of sources) {
    // Determine the source tag — never include secret material.
    const tag = provenanceMap[srcPath] ?? srcPath;

    let content: string;
    try {
      content = await readFile(srcPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (onMissingSource === "skip") {
          missingSources.push({ category: "claudeMd", sourcePath: srcPath, targetPath });
          continue;
        }
        throw new SourceFileNotFoundError("claudeMd", srcPath, targetPath);
      }
      throw err;
    }

    // Normalise trailing newline: ensure exactly one trailing newline so that
    // the blank line separator between sections is consistent.
    const normalised = content.endsWith("\n") ? content : `${content}\n`;

    sections.push(`<!-- source: ${tag} -->\n${normalised}`);
  }

  if (sections.length === 0) {
    // All sources were missing and we're in skip mode.
    return { content: "", missingSources };
  }

  // Join sections with a blank line separator.
  const combined = sections.join("\n");

  return { content: combined, missingSources };
}

// Re-export basename to satisfy unused-import rules in callers that import
// this module solely for buildClaudeMd.
export { basename };
