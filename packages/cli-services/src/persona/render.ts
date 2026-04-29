/**
 * @module persona/render
 *
 * Pure data service for the in-memory persona render path.
 *
 * Composes the cascade resolver (`resolveCurrentProfile`) with
 * `renderPersonaInMemory` from `@agent-profile/persona-deployer` to produce a
 * `PersonaRenderResult` for a given `(role, authProfileId, cwd)` triple.
 *
 * **Disk safety**: this service performs reads only. No session directory is
 * created and no `CLAUDE.md` is written; the render output is intended for
 * preview surfaces (Persona Composer GUI, `myclaude render persona` CLI).
 */
import { type PersonaRenderResult, renderPersonaInMemory } from "@agent-profile/persona-deployer";
import { resolveCurrentProfile } from "../profile/shared.js";

/**
 * Input options for `personaRenderService`.
 */
export interface PersonaRenderInput {
  /** Role name (e.g. `"backend"`). Pass `""` to skip the role-scoped layers. */
  role: string;
  /** Optional auth profile id to bind into the resolved cascade. */
  authProfileId?: string;
  /** The working directory used for project-chain resolution. */
  cwd: string;
  /**
   * Absolute path to the myclaude home (e.g. `/Users/alice/.myclaude`).
   * Required — services in this package never read `os.homedir()`.
   */
  home: string;
}

/**
 * Run the cascade for a `(role, authProfileId, cwd)` triple, then render the
 * resulting persona section in memory.
 *
 * Steps:
 *
 * 1. `resolveCurrentProfile(...)` produces an `EffectiveSessionConfig` whose
 *    `effective.persona` arrays carry absolute file paths and whose
 *    `provenance.persona` is the per-scope contribution log.
 * 2. The provenance log is flattened into a `Record<sourcePath, ScopeName>`
 *    map so every persona file gets a stable origin label.
 * 3. `renderPersonaInMemory(...)` reads each file, builds the combined
 *    CLAUDE.md, and labels every output with the public-facing category name
 *    (`slashCmds` rather than the internal `commands`).
 *
 * Missing-source policy is fixed to `"skip"`: preview surfaces should be
 * tolerant of stale paths and surface them as a warning rather than blowing
 * up the entire render.
 *
 * @param input - Resolution options.
 * @returns The `PersonaRenderResult` from `renderPersonaInMemory`.
 * @throws Whatever `resolveCurrentProfile` throws (`SchemaError`,
 *   `CascadeError`, `FragmentNotFoundError`); persona-deployer errors are
 *   suppressed by the `"skip"` policy.
 */
export async function personaRenderService(
  input: PersonaRenderInput
): Promise<PersonaRenderResult> {
  const { role, authProfileId, cwd, home } = input;
  const resolved = resolveCurrentProfile({
    role,
    cwd,
    home,
    ...(authProfileId !== undefined ? { authProfileId } : {}),
  });

  // Flatten provenance.persona — an array of `{ source, files: [] }` entries —
  // into a per-path origin map. Later entries overwrite earlier ones so the
  // final map reflects the winning scope for any file that appears multiple
  // times in the cascade.
  const provenanceMap: Record<string, string> = {};
  for (const entry of resolved.provenance.persona) {
    for (const filePath of entry.files) {
      provenanceMap[filePath] = entry.source;
    }
  }

  return renderPersonaInMemory({
    effective: resolved.effective.persona,
    provenanceMap,
    onMissingSource: "skip",
  });
}
