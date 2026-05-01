/**
 * @module auth/list
 *
 * Pure data service for `auth list`.
 *
 * Reads `authProfiles.yml`, projects it into the wire shape the CLI prints and
 * the daemon will mirror over IPC, and returns. Never reads the keychain — the
 * keyring URIs returned by `--show-refs` are references, not values.
 */
import { loadAuthProfiles } from "./profiles-file.js";

/**
 * Input options for `authListService`.
 */
export interface AuthListInput {
  /**
   * Absolute path to the myclaude home (e.g. `/Users/alice/.myclaude`).
   * When omitted, falls back to `MYCLAUDE_HOME` env or `~/.myclaude` —
   * provided strictly for parity with the legacy `loadAuthProfiles()` shim.
   * The daemon should always pass an explicit value.
   */
  home?: string;
  /**
   * When true, the response includes the keyring URIs for the Anthropic key
   * and the per-MCP secret refs. When false, secrets are reduced to a list of
   * names (no URIs).
   */
  includeRefs?: boolean;
}

/**
 * One projected auth-profile entry as returned to the caller.
 */
export interface AuthListEntry {
  /** The profile id (the key in `authProfiles`). */
  id: string;
  /** Human-readable label, or `null` when not configured. */
  displayName: string | null;
  /** Anthropic mode (`apiKey`, `bedrock`, `vertex`, `gateway`). */
  mode: string;
  /** Names of MCP secrets declared on this profile (no values, no URIs). */
  secrets: string[];
  /**
   * When `includeRefs` was true, a map of secret name → keyring URI for every
   * MCP secret on this profile. Omitted entirely otherwise.
   */
  refs?: Record<string, string>;
  /**
   * When `includeRefs` was true, the keyring URI of the Anthropic API key.
   * Omitted otherwise.
   */
  anthropicRef?: string;
  /**
   * For `oauth` profiles, the public OAuth metadata stored alongside the
   * profile (no tokens, only the descriptive fields). Omitted for non-oauth
   * profiles or when no metadata was recorded.
   */
  oauth?: {
    email?: string;
    orgName?: string;
    planType?: string;
    accessTokenExpiresAt?: string;
    refreshTokenRef?: string;
  };
}

/**
 * Result returned by `authListService`.
 */
export interface AuthListResult {
  /** Auth profiles in the order they appear in the YAML file. */
  profiles: AuthListEntry[];
}

/**
 * Load `authProfiles.yml` and project it into the data shape the CLI prints and
 * the daemon mirrors over IPC.
 *
 * @param input - List options.
 * @returns The projected entries — never throws on a missing file.
 * @throws {ServiceError} If the file exists but cannot be parsed or validated.
 */
export function authListService(input: AuthListInput = {}): AuthListResult {
  const { home, includeRefs = false } = input;
  const doc = loadAuthProfiles(home);

  const profiles: AuthListEntry[] = [];
  for (const [id, profile] of Object.entries(doc.authProfiles)) {
    if (!profile) continue;
    const entry: AuthListEntry = {
      id,
      displayName: profile.displayName ?? null,
      mode: profile.anthropic.mode,
      secrets: Object.keys(profile.mcpSecretRefs),
    };
    if (includeRefs) {
      entry.refs = { ...profile.mcpSecretRefs };
      entry.anthropicRef = profile.anthropic.secretRef;
    }
    if (profile.anthropic.oauth) {
      const o = profile.anthropic.oauth;
      const meta: NonNullable<AuthListEntry["oauth"]> = {};
      if (o.email !== undefined) meta.email = o.email;
      if (o.orgName !== undefined) meta.orgName = o.orgName;
      if (o.planType !== undefined) meta.planType = o.planType;
      if (o.accessTokenExpiresAt !== undefined) meta.accessTokenExpiresAt = o.accessTokenExpiresAt;
      if (o.refreshTokenRef !== undefined) meta.refreshTokenRef = o.refreshTokenRef;
      entry.oauth = meta;
    }
    profiles.push(entry);
  }

  return { profiles };
}
