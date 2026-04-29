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
import type { MissingSourceEntry, PersonaClaudeMdSectionEntry } from "./utils/types.js";

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
 * Result of `buildClaudeMdSections`.
 *
 * Returned when the caller wants to render fragments individually in addition
 * to (or instead of) the concatenated output. `combine` is a pure helper — see
 * `combineClaudeMdSections`.
 */
export interface ClaudeMdSectionsResult {
  /**
   * Per-fragment breakdown in cascade order. Each entry carries the raw file
   * content (no source-marker prefix) plus an `originScope` resolved against
   * `provenanceMap`.
   */
  sections: PersonaClaudeMdSectionEntry[];
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
 * Options for `buildClaudeMdSections`.
 *
 * Unlike `BuildClaudeMdOpts` this helper has no on-disk target path — it does
 * not write — so missing-source entries record the source path with an empty
 * `targetPath`. Callers that need a target path (e.g. `buildClaudeMd`) wrap
 * this helper.
 */
export interface BuildClaudeMdSectionsOpts {
  /** Provenance labels keyed by absolute source path. */
  provenanceMap?: Record<string, string>;
  /** What to do when a source file is missing. */
  onMissingSource: "throw" | "skip";
  /**
   * Optional target path used only when populating missing-source records and
   * surface error messages. When omitted, missing-source entries carry an
   * empty string.
   */
  targetPath?: string;
}

/**
 * Read CLAUDE.md fragments and produce a per-section breakdown without
 * concatenating them.
 *
 * This is the in-memory primitive used by both `buildClaudeMd` (which combines
 * sections into the legacy combined string) and `renderPersonaInMemory`
 * (which exposes the breakdown directly to the GUI). The `originScope` field
 * is resolved by looking up `provenanceMap[srcPath]`; when the path is not in
 * the map it falls back to the literal string `"unknown"` — distinguishable
 * in UI from a real scope name.
 *
 * @param sources - Ordered array of absolute paths to CLAUDE.md fragments.
 * @param opts    - Provenance map and missing-source policy.
 */
export async function buildClaudeMdSections(
  sources: string[],
  opts: BuildClaudeMdSectionsOpts
): Promise<ClaudeMdSectionsResult> {
  const { provenanceMap = {}, onMissingSource, targetPath = "" } = opts;
  const missingSources: MissingSourceEntry[] = [];
  const sections: PersonaClaudeMdSectionEntry[] = [];

  for (const srcPath of sources) {
    let content: string;
    try {
      content = await readFile(srcPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (onMissingSource === "skip") {
          missingSources.push({
            category: "claudeMd",
            sourcePath: srcPath,
            targetPath,
          });
          continue;
        }
        throw new SourceFileNotFoundError("claudeMd", srcPath, targetPath);
      }
      throw err;
    }

    const originScope = provenanceMap[srcPath] ?? "unknown";
    sections.push({ sourcePath: srcPath, originScope, content });
  }

  return { sections, missingSources };
}

/**
 * Combine `PersonaClaudeMdSectionEntry`s into the legacy concatenated CLAUDE.md
 * string used by `deployPersona`.
 *
 * Each section is rendered as `<!-- source: <originScope> -->\n<content>` with
 * a single trailing newline; sections are joined by a blank line. This mirrors
 * the exact format of the original `buildClaudeMd` output.
 */
function combineClaudeMdSections(sections: PersonaClaudeMdSectionEntry[]): string {
  const rendered = sections.map((sec) => {
    const normalised = sec.content.endsWith("\n") ? sec.content : `${sec.content}\n`;
    return `<!-- source: ${sec.originScope} -->\n${normalised}`;
  });
  return rendered.join("\n");
}

/**
 * Read and concatenate CLAUDE.md fragments with source markers.
 *
 * Returns `null` when `sources` is empty (no file should be written).
 *
 * Internally calls `buildClaudeMdSections` and joins the result. The output
 * format is byte-identical to prior versions of this function.
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

  // Reuse the section-level helper so behaviour stays in lockstep, but adapt
  // its provenance fallback (`"unknown"`) to the legacy fallback (the source
  // path itself) by pre-populating `provenanceMap` for every input.
  const effectiveMap: Record<string, string> = {};
  for (const srcPath of sources) {
    effectiveMap[srcPath] = provenanceMap[srcPath] ?? srcPath;
  }

  const sectionsResult = await buildClaudeMdSections(sources, {
    provenanceMap: effectiveMap,
    onMissingSource,
    targetPath,
  });

  if (sectionsResult.sections.length === 0) {
    // All sources were missing and we're in skip mode.
    return { content: "", missingSources: sectionsResult.missingSources };
  }

  const combined = combineClaudeMdSections(sectionsResult.sections);

  return { content: combined, missingSources: sectionsResult.missingSources };
}

// Re-export basename to satisfy unused-import rules in callers that import
// this module solely for buildClaudeMd.
export { basename };
