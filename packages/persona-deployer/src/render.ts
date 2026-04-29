/**
 * In-memory persona render path.
 *
 * `renderPersonaInMemory` is the disk-free counterpart of `deployPersona`. It
 * orchestrates the same `buildClaudeMdSections` and `readCategoryFiles`
 * primitives that the deploy path uses, but instead of writing to a session
 * directory it returns the rendered content as plain TypeScript values for
 * GUI preview (Persona Composer), CLI subcommand (`myclaude render persona`),
 * and any other ahead-of-time inspection.
 *
 * **Shape parity:** `claudeMd.combinedContent` is byte-identical to the file
 * `deployPersona` writes (`<sessionDir>/CLAUDE.md`), so callers can compare
 * deploy and render outputs with a string equality check.
 *
 * **Public category names:** the cascade exposes slash commands as
 * `slashCmds`. The internal `FileCategory` enum still uses `commands` for the
 * disk subdirectory; this module translates `commands` → `slashCmds` at the
 * public boundary so consumers see only the cascade-aligned name.
 */

import { buildClaudeMdSections } from "./claude-md.js";
import { readCategoryFiles } from "./copy-files.js";
import type {
  CollisionLogEntry,
  FileCategory,
  MissingSourceEntry,
  PersonaRenderCategory,
  PersonaRenderClaudeMd,
  PersonaRenderFile,
  PersonaRenderInput,
  PersonaRenderResult,
} from "./utils/types.js";

interface CategoryMapping {
  /** Public-facing category name (mirrors `EffectiveConfig.persona`). */
  publicName: PersonaRenderCategory;
  /** Internal `FileCategory` literal used by `readCategoryFiles`. */
  internalName: FileCategory;
  /**
   * Source array key on `PersonaRenderInput.effective` (matches `publicName`
   * 1:1 — kept as a separate field for clarity of intent).
   */
  effectiveKey: keyof PersonaRenderInput["effective"];
}

/**
 * Render-order pipeline: agents → skills → slashCmds → memory.
 *
 * `slashCmds` maps to the legacy disk directory `commands`; the rest are
 * 1:1 between the public name and the internal `FileCategory` literal.
 */
const CATEGORY_PIPELINE: readonly CategoryMapping[] = [
  { publicName: "agents", internalName: "agents", effectiveKey: "agents" },
  { publicName: "skills", internalName: "skills", effectiveKey: "skills" },
  { publicName: "slashCmds", internalName: "commands", effectiveKey: "slashCmds" },
  { publicName: "memory", internalName: "memory", effectiveKey: "memory" },
];

/**
 * Render the persona section of an `EffectiveConfig` in-memory.
 *
 * Steps:
 *
 * 1. CLAUDE.md fragments are read via `buildClaudeMdSections` and exposed both
 *    as a per-section breakdown and as the combined string `deployPersona`
 *    would write. When `effective.claudeMd` is empty the result's `claudeMd`
 *    field is `null`.
 * 2. Each persona category (`agents`, `skills`, `slashCmds`, `memory`) is read
 *    via `readCategoryFiles`. Collisions and missing-source entries are
 *    aggregated; collision/missing `category` values are translated from the
 *    internal `commands` literal to the public `slashCmds` literal as
 *    appropriate.
 * 3. The resulting flat `PersonaRenderFile[]` carries the original UTF-8
 *    decoded content tagged with the public category name and the origin
 *    scope resolved against `provenanceMap` (or `"unknown"` when absent).
 *
 * No disk writes occur; this function is safe to call from preview surfaces.
 *
 * @param input - Effective persona arrays + provenance map + missing-source policy.
 */
export async function renderPersonaInMemory(
  input: PersonaRenderInput
): Promise<PersonaRenderResult> {
  const onMissingSource = input.onMissingSource ?? "skip";
  const provenanceMap = input.provenanceMap;

  const allCollisions: CollisionLogEntry[] = [];
  const allMissingSources: MissingSourceEntry[] = [];

  // ── 1. CLAUDE.md ────────────────────────────────────────────────────────────
  let claudeMd: PersonaRenderClaudeMd | null = null;
  if (input.effective.claudeMd.length > 0) {
    const sectionsResult = await buildClaudeMdSections(input.effective.claudeMd, {
      provenanceMap,
      onMissingSource,
    });
    allMissingSources.push(...sectionsResult.missingSources);

    const combinedContent = sectionsResult.sections
      .map((sec) => {
        const normalised = sec.content.endsWith("\n") ? sec.content : `${sec.content}\n`;
        return `<!-- source: ${sec.originScope} -->\n${normalised}`;
      })
      .join("\n");

    claudeMd = {
      combinedContent,
      sections: sectionsResult.sections,
    };
  }

  // ── 2. Per-category file reads ──────────────────────────────────────────────
  const files: PersonaRenderFile[] = [];

  for (const mapping of CATEGORY_PIPELINE) {
    const sources = input.effective[mapping.effectiveKey];
    const readResult = await readCategoryFiles(mapping.internalName, sources, {
      onMissingSource,
    });

    // `readCategoryFiles.files` preserves cascade order including losers; for
    // the public render output we keep only the winner per basename
    // (last-wins, matching the disk-deployment semantics).
    const winnerByBasename = new Map<string, (typeof readResult.files)[number]>();
    for (const file of readResult.files) {
      winnerByBasename.set(file.basename, file);
    }
    for (const file of winnerByBasename.values()) {
      const originScope = provenanceMap[file.sourcePath] ?? "unknown";
      files.push({
        category: mapping.publicName,
        basename: file.basename,
        sourcePath: file.sourcePath,
        originScope,
        content: file.content.toString("utf8"),
      });
    }

    for (const collision of readResult.collisions) {
      allCollisions.push({
        target: collision.target,
        category: mapping.publicName,
        overriddenSource: collision.overriddenSource,
        winningSource: collision.winningSource,
      });
    }

    for (const missing of readResult.missingSources) {
      allMissingSources.push({
        category: mapping.publicName,
        sourcePath: missing.sourcePath,
        targetPath: missing.targetPath,
      });
    }
  }

  return {
    claudeMd,
    files,
    collisions: allCollisions,
    missingSources: allMissingSources,
  };
}
