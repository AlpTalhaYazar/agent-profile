import { z } from "zod";

const NonEmptyString = z.string().min(1);

/**
 * Request the in-memory persona render for a `(role, authProfileId, cwd)`
 * triple.
 *
 * Mirrors `ReqProfileShow` structurally — same identity inputs, no
 * draft / override surface — but resolves all the way through the persona
 * deployer's read paths to produce concrete file contents. The response
 * carries utf-8 string content for every file (no base64; persona files are
 * not secrets — see ADR 005).
 */
export const ReqPersonaRender = z
  .object({
    id: NonEmptyString,
    kind: z.literal("persona.render"),
    role: NonEmptyString,
    authProfileId: NonEmptyString,
    cwd: NonEmptyString,
  })
  .strict();

/**
 * One persona file the renderer materialised from disk.
 *
 * `category` distinguishes the four flat categories the deployer copies into
 * `~/.claude/{agents,skills,commands,memory}/`. The single combined CLAUDE.md
 * lives outside this list — see `RespPersonaRenderOk.claudeMd`.
 *
 *  - `sourcePath` — absolute path on disk where the file was read from.
 *  - `originScope` — the scope name (e.g. `"global-role"`,
 *    `"project-shared"`) that won the cascade for this file.
 *  - `content` — the raw utf-8 file body.
 */
export const PersonaFileWire = z
  .object({
    category: z.enum(["agents", "skills", "slashCmds", "memory"]),
    basename: NonEmptyString,
    sourcePath: NonEmptyString,
    originScope: NonEmptyString,
    content: z.string(),
  })
  .strict();

/**
 * One CLAUDE.md fragment that contributed to the combined render.
 *
 * The combined CLAUDE.md is the cascade-ordered concatenation of every
 * fragment; `sections` exposes the per-source slices so the Composer UI can
 * highlight which scope contributed which paragraph. `content` is the raw
 * fragment body (no `<!-- source: ... -->` marker prefix).
 */
export const PersonaClaudeMdSection = z
  .object({
    sourcePath: NonEmptyString,
    originScope: NonEmptyString,
    content: z.string(),
  })
  .strict();

/**
 * One collision the deployer detected for a persona file.
 *
 * A collision occurs when more than one scope contributes a file of the same
 * basename within the same category. `winningSource` is the cascade-winning
 * source path; `overriddenSources` lists the loser source paths in cascade
 * order (oldest -> newest before the winner).
 */
export const PersonaCollisionWire = z
  .object({
    category: z.enum(["agents", "skills", "slashCmds", "memory"]),
    basename: NonEmptyString,
    winningSource: NonEmptyString,
    overriddenSources: z.array(z.string()),
  })
  .strict();

/**
 * One missing source the deployer encountered.
 *
 * `category` includes `"claudeMd"` because a missing CLAUDE.md fragment is
 * collapsed into the single combined render and so does not appear in
 * `RespPersonaRenderOk.files`; the rest of the categories
 * (`"agents"`, `"skills"`, `"slashCmds"`, `"memory"`) are flat per-file
 * entries that just go absent on a successful render.
 */
export const PersonaMissingWire = z
  .object({
    category: z.enum(["claudeMd", "agents", "skills", "slashCmds", "memory"]),
    sourcePath: NonEmptyString,
  })
  .strict();

/**
 * Response to `persona.render`.
 *
 * `claudeMd` is `null` when no scope contributed a CLAUDE.md fragment;
 * otherwise it carries the combined render and the per-source breakdown.
 * `files` is the flat list of agents / skills / slashCmds / memory files.
 * `collisions` and `missingSources` mirror the deployer's existing
 * collision-log and missing-source-entry shapes for UI surfacing.
 */
export const RespPersonaRenderOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("persona.render.ok"),
    claudeMd: z
      .object({
        combinedContent: z.string(),
        sections: z.array(PersonaClaudeMdSection),
      })
      .strict()
      .nullable(),
    files: z.array(PersonaFileWire),
    collisions: z.array(PersonaCollisionWire),
    missingSources: z.array(PersonaMissingWire),
  })
  .strict();

/** Static type for `persona.render` requests. */
export type ReqPersonaRenderT = z.infer<typeof ReqPersonaRender>;
/** Static type for `persona.render.ok` responses. */
export type RespPersonaRenderOkT = z.infer<typeof RespPersonaRenderOk>;
/** Static type for a single persona file entry on the wire. */
export type PersonaFileWireT = z.infer<typeof PersonaFileWire>;
/** Static type for one CLAUDE.md fragment slice on the wire. */
export type PersonaClaudeMdSectionT = z.infer<typeof PersonaClaudeMdSection>;
/** Static type for a persona collision entry on the wire. */
export type PersonaCollisionWireT = z.infer<typeof PersonaCollisionWire>;
/** Static type for a missing-source entry on the wire. */
export type PersonaMissingWireT = z.infer<typeof PersonaMissingWire>;
