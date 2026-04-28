/**
 * @module profile/show
 *
 * Pure data service for `profile show` (and `render`).
 *
 * Wraps `@agent-profile/core`'s `resolve` cascade with the path conventions the
 * CLI and desktop daemon share. Returns the raw `EffectiveSessionConfig` —
 * formatting, JSON encoding, and secret resolution all live in callers.
 */
import { type EffectiveSessionConfig, resolve as coreResolve } from "@agent-profile/core";
import { globalConfigDirFor, globalFragmentsDirFor } from "../paths.js";

/**
 * Input options for `profileShowService`.
 */
export interface ProfileShowInput {
  /** Role name (e.g. `"backend"`). Pass `""` to skip the role-scoped layers. */
  role: string;
  /** Optional auth profile id to bind into the resolved cascade. */
  authProfileId?: string;
  /** The working directory used for project-chain resolution. */
  cwd: string;
  /**
   * Absolute path to the myclaude home (e.g. `/Users/alice/.myclaude`).
   * Required — services in this package never read `os.homedir()`. The CLI's
   * shim resolves the user's home before calling.
   */
  home: string;
}

/**
 * Run the cascade for a `(role, authProfileId, cwd)` triple and return the
 * effective configuration plus provenance.
 *
 * @param input - Resolution options.
 * @returns The same `EffectiveSessionConfig` shape that the CLI's
 *   `formatEffectiveConfig` and `renderResolved` accept directly.
 * @throws Whatever `coreResolve` throws (`SchemaError`, `CascadeError`,
 *   `FragmentNotFoundError`). Callers are expected to translate these for
 *   their surface — the CLI's `mapCoreError` already does so.
 */
export function profileShowService(input: ProfileShowInput): EffectiveSessionConfig {
  const { role, authProfileId, cwd, home } = input;

  const resolveInput: Parameters<typeof coreResolve>[0] = {
    role,
    cwd,
    globalConfigDir: globalConfigDirFor(home),
    fragmentDirs: [globalFragmentsDirFor(home)],
  };
  if (authProfileId !== undefined) resolveInput.authProfileId = authProfileId;

  return coreResolve(resolveInput);
}
