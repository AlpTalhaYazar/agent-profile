/**
 * @module session/manifest
 *
 * Writes the helper-readable per-session manifest.
 *
 * The manifest contains only identifiers and header templates. Secret values are
 * resolved later by `myclaude-helper` from keyring refs and never materialized
 * into this file by the CLI.
 */
import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { generateCapabilityToken } from "@agent-profile/capability";
import type { AuthProfilesDocT, EffectiveConfig } from "@agent-profile/core";
import { CliError, EXIT_CONFIG_INVALID } from "../errors.js";

// Re-exported so internal CLI tests and callers can keep importing from this
// module while the canonical implementation now lives in `@agent-profile/capability`.
export { generateCapabilityToken };

const JSON_INDENT = 2;
const MANIFEST_FILE = "session.json";
const MANIFEST_MODE = 0o600;

type AuthProfile = AuthProfilesDocT["authProfiles"][string];
type ManifestAnthropic = AuthProfile["anthropic"];

/** The exact helper `SessionManifest` v1 JSON shape written by the CLI. */
export interface SessionManifest {
  version: 1;
  sessionId: string;
  capabilityToken: string;
  authProfileId: string;
  anthropic: ManifestAnthropic;
  mcpHeaders: Record<string, Record<string, string>>;
  mcpSecretRefs: Record<string, string>;
}

/** Inputs needed to bind an effective config to an auth profile for one session. */
export interface WriteSessionManifestInput {
  /** Absolute path to the session root directory. */
  sessionDir: string;
  /** Session identifier, conventionally the session directory UUID. */
  sessionId: string;
  /** Effective config produced by `@agent-profile/core.resolve()`. */
  effective: Pick<EffectiveConfig, "auth" | "mcpServers">;
  /** Loaded and validated `authProfiles.yml` document. */
  authProfiles: AuthProfilesDocT;
  /** Optional explicit auth profile override. Defaults to `effective.auth.profileId`. */
  authProfileId?: string;
  /** Optional pre-generated capability token. Defaults to a fresh random token. */
  capabilityToken?: string;
}

/** Result from writing a session manifest. */
export interface WriteSessionManifestResult {
  manifestPath: string;
  manifest: SessionManifest;
  capabilityToken: string;
}

/**
 * Write `<sessionDir>/session.json` using sibling temp-write + rename.
 */
export async function writeSessionManifest(
  input: WriteSessionManifestInput
): Promise<WriteSessionManifestResult> {
  const authProfileId = resolveAuthProfileId(input);
  const profile = input.authProfiles.authProfiles[authProfileId];
  if (!profile) {
    throw new CliError(
      `Auth profile "${authProfileId}" was not found for session manifest`,
      EXIT_CONFIG_INVALID
    );
  }

  const capabilityToken = input.capabilityToken ?? generateCapabilityToken();
  const manifest: SessionManifest = {
    version: 1,
    sessionId: input.sessionId,
    capabilityToken,
    authProfileId,
    anthropic: { ...profile.anthropic },
    mcpHeaders: extractMcpHeaders(input.effective),
    mcpSecretRefs: { ...profile.mcpSecretRefs },
  };

  const manifestPath = join(input.sessionDir, MANIFEST_FILE);
  await mkdir(input.sessionDir, { recursive: true, mode: 0o700 });
  await atomicWriteJson(manifestPath, manifest);

  return { manifestPath, manifest, capabilityToken };
}

/** Extract helper-resolvable MCP header templates from the effective servers. */
export function extractMcpHeaders(
  effective: Pick<EffectiveConfig, "mcpServers">
): Record<string, Record<string, string>> {
  const mcpHeaders: Record<string, Record<string, string>> = {};

  for (const [serverName, server] of Object.entries(effective.mcpServers)) {
    const headers = "headers" in server ? server.headers : undefined;
    if (isStringRecord(headers)) {
      mcpHeaders[serverName] = { ...headers };
    }
  }

  return mcpHeaders;
}

function resolveAuthProfileId(input: WriteSessionManifestInput): string {
  const authProfileId = input.authProfileId ?? input.effective.auth?.profileId;
  if (authProfileId === undefined || authProfileId.length === 0) {
    throw new CliError("Session manifest requires an auth profile", EXIT_CONFIG_INVALID);
  }
  return authProfileId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry): entry is string => typeof entry === "string");
}

async function atomicWriteJson(targetPath: string, value: SessionManifest): Promise<void> {
  const tmpPath = join(
    dirname(targetPath),
    `${basename(targetPath)}.tmp-${randomBytes(4).toString("hex")}`
  );
  const content = `${JSON.stringify(value, null, JSON_INDENT)}\n`;

  try {
    await writeFile(tmpPath, content, { encoding: "utf8", mode: MANIFEST_MODE });
    await rename(tmpPath, targetPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {
      // Preserve the original write/rename error.
    });
    throw err;
  }
}
