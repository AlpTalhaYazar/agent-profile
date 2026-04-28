/**
 * @module auth/profiles-file
 *
 * Re-export shim. The real loader lives in `@agent-profile/cli-services` so
 * the desktop daemon can call it without depending on `apps/cli`. Existing
 * imports inside the CLI continue to use this path unchanged.
 *
 * The cli-services version throws `ServiceError` (which carries
 * `exitCode: 2` for `code: "config-invalid"`), so the CLI's
 * `EXIT_CONFIG_INVALID` exit-code contract is preserved without rewrapping.
 */
export {
  authProfilesPath,
  loadAuthProfiles,
  saveAuthProfiles,
} from "@agent-profile/cli-services";
