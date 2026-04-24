/**
 * Main entry point: `deployPersona`.
 *
 * Materialises a `DeployPersonaInput` (the `persona` section of
 * `EffectiveSessionConfig`) into an existing session directory.
 *
 * Callers must have already created the session directory via
 * `createSessionDir` before calling `deployPersona`.
 */

import { join } from "node:path";
import { type BuildClaudeMdOpts, buildClaudeMd } from "./claude-md.js";
import { copyFiles } from "./copy-files.js";
import { atomicWrite } from "./utils/atomic-write.js";
import type {
  CollisionLogEntry,
  DeployPersonaInput,
  DeployPersonaOpts,
  DeploymentResult,
  MissingSourceEntry,
} from "./utils/types.js";

/**
 * Materialize persona files into an ephemeral session directory.
 *
 * Given the persona arrays from `EffectiveSessionConfig.effective.persona`,
 * this function:
 *
 * 1. Concatenates all CLAUDE.md fragments (with source markers) and writes
 *    the result to `<sessionDir>/CLAUDE.md`.
 * 2. Copies agent, skill, slash-command, and memory files into the respective
 *    subdirectories under `<claudeConfigDir>`.
 *
 * **Collision semantics**: when two files share the same basename within a
 * category, the later one in the input array wins. See `CollisionLogEntry`.
 *
 * **Atomicity**: every file write goes through `atomicWrite` (temp + rename).
 * Partial success is acceptable; the caller's `cleanupSession` handles the
 * unhappy path.
 *
 * @param input          - Persona file paths and optional provenance map.
 * @param sessionDir     - Absolute path to the session root (created by `createSessionDir`).
 * @param claudeConfigDir - Absolute path to the `.claude` subdirectory.
 * @param opts           - Behavioural options (missing-source policy).
 *
 * @returns `DeploymentResult` with paths, collisions, and missing-source log.
 */
export async function deployPersona(
  input: DeployPersonaInput,
  sessionDir: string,
  claudeConfigDir: string,
  opts: DeployPersonaOpts = {}
): Promise<DeploymentResult> {
  const onMissingSource = opts.onMissingSource ?? "throw";
  const allCollisions: CollisionLogEntry[] = [];
  const allMissingSources: MissingSourceEntry[] = [];
  const allWrittenFiles: string[] = [];

  // ── 1. CLAUDE.md ────────────────────────────────────────────────────────────
  const claudeMdTargetPath = join(sessionDir, "CLAUDE.md");
  let claudeMdPath: string | null = null;

  const claudeMdOpts: BuildClaudeMdOpts = {
    targetPath: claudeMdTargetPath,
    onMissingSource,
  };
  if (input.provenanceMap !== undefined) {
    claudeMdOpts.provenanceMap = input.provenanceMap;
  }
  const claudeMdResult = await buildClaudeMd(input.claudeMd, claudeMdOpts);

  if (claudeMdResult !== null && claudeMdResult.content !== "") {
    await atomicWrite(claudeMdTargetPath, claudeMdResult.content);
    claudeMdPath = claudeMdTargetPath;
    allMissingSources.push(...claudeMdResult.missingSources);
  } else if (claudeMdResult !== null) {
    // All sources were skipped (skip mode, all missing).
    allMissingSources.push(...claudeMdResult.missingSources);
  }

  // ── 2. Agents ────────────────────────────────────────────────────────────────
  const agentsResult = await copyFiles("agents", input.agents, join(claudeConfigDir, "agents"), {
    onMissingSource,
  });
  allWrittenFiles.push(...agentsResult.writtenFiles);
  allCollisions.push(...agentsResult.collisions);
  allMissingSources.push(...agentsResult.missingSources);

  // ── 3. Skills ────────────────────────────────────────────────────────────────
  const skillsResult = await copyFiles("skills", input.skills, join(claudeConfigDir, "skills"), {
    onMissingSource,
  });
  allWrittenFiles.push(...skillsResult.writtenFiles);
  allCollisions.push(...skillsResult.collisions);
  allMissingSources.push(...skillsResult.missingSources);

  // ── 4. Slash commands ────────────────────────────────────────────────────────
  const cmdsResult = await copyFiles(
    "commands",
    input.slashCmds,
    join(claudeConfigDir, "commands"),
    { onMissingSource }
  );
  allWrittenFiles.push(...cmdsResult.writtenFiles);
  allCollisions.push(...cmdsResult.collisions);
  allMissingSources.push(...cmdsResult.missingSources);

  // ── 5. Memory seeds ──────────────────────────────────────────────────────────
  const memoryResult = await copyFiles("memory", input.memory, join(claudeConfigDir, "memory"), {
    onMissingSource,
  });
  allWrittenFiles.push(...memoryResult.writtenFiles);
  allCollisions.push(...memoryResult.collisions);
  allMissingSources.push(...memoryResult.missingSources);

  return {
    claudeMdPath,
    writtenFiles: allWrittenFiles,
    collisions: allCollisions,
    missingSources: allMissingSources,
  };
}
