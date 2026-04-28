/**
 * @module @agent-profile/cli-services
 *
 * Pure data services that back the read-only `myclaude` commands and (in
 * Phase 2) the desktop daemon's IPC handlers.
 *
 * Every export is a plain async/sync function that takes injected paths and
 * returns plain data. Services do not write to stdout, do not prompt, and do
 * not spawn child processes — formatting and transport stay in the caller.
 *
 * The package deliberately does NOT depend on `@agent-profile/secrets`: auth
 * services here only handle metadata (keyring URIs, profile names), never
 * secret values.
 */

// ─── Errors ───────────────────────────────────────────────────────────────────

export { ServiceError, type ServiceErrorCode } from "./errors.js";

// ─── Path helpers ─────────────────────────────────────────────────────────────

export {
  globalConfigDirFor,
  globalFragmentsDirFor,
  authProfilesPathFor,
} from "./paths.js";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export {
  authProfilesPath,
  loadAuthProfiles,
  saveAuthProfiles,
} from "./auth/profiles-file.js";
export {
  authListService,
  type AuthListInput,
  type AuthListEntry,
  type AuthListResult,
} from "./auth/list.js";
export {
  authGetSecretRefService,
  type AuthGetSecretRefInput,
  type AuthGetSecretRefResult,
} from "./auth/get-secret-ref.js";

// ─── Profile ──────────────────────────────────────────────────────────────────

export {
  profileListService,
  type ProfileListInput,
  type ProfileListResult,
} from "./profile/list.js";
export {
  profilePreviewService,
  type ProfilePreviewInput,
  type ProfilePreviewResult,
} from "./profile/preview.js";
export {
  profileSaveService,
  type ProfileSaveInput,
  type ProfileSaveResult,
} from "./profile/save.js";
export { profileShowService, type ProfileShowInput } from "./profile/show.js";
export {
  profileValidateService,
  type ProfileValidateInput,
  type ProfileValidateResult,
} from "./profile/validate.js";

// ─── Sessions ─────────────────────────────────────────────────────────────────

export {
  type SessionRecord,
  type SessionStatus,
  type SessionSpawnMetadata,
  type ReadSessionRecordInput,
  type ListSessionRecordsInput,
  assertValidSessionId,
  sessionRegistryDir,
  sessionRecordPath,
  listSessionRecords,
  readSessionRecord,
  parseSessionRecord,
} from "./sessions/registry.js";
export {
  sessionsListService,
  type SessionsListInput,
} from "./sessions/list.js";

// ─── Daemon ───────────────────────────────────────────────────────────────────

export {
  daemonStatusService,
  type DaemonStatusInput,
  type DaemonStatus,
} from "./daemon/status.js";
