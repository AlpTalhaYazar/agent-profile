import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ScopeDocT } from "@agent-profile/core";
import { ServiceError } from "../errors.js";
import { globalConfigDirFor } from "../paths.js";
import { assertAllowlistedScopePath, writeCanonicalScopeFile } from "./shared.js";

export type ProfileScopeLocation = "global" | "project";
export type ProfileScopeLayerType = "shared" | "role";

export interface ProfileCreateScopeMetadata {
  displayName?: string | undefined;
  purpose?: string | undefined;
}

export interface ProfileCreateScopeInput {
  home: string;
  cwd: string;
  location: ProfileScopeLocation;
  layerType: ProfileScopeLayerType;
  role?: string;
  force?: boolean;
  profile?: ProfileCreateScopeMetadata;
  authProfileId?: string;
}

export interface ProfileCreateScopeResult {
  created: true;
  path: string;
  scope: "global-shared" | "global-role" | "project-shared" | "project-role";
  role: string | null;
  content: ScopeDocT;
}

const ROLE_RE = /^[a-z0-9_-]+$/;
const UNSAFE_METADATA_RE =
  /keyring:\/\/|\$\{secret:|\$\{env:|secret:|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/i;

export function profileCreateScopeService(
  input: ProfileCreateScopeInput
): ProfileCreateScopeResult {
  const normalized = normalizeCreateScopeInput(input);
  const computedPath = targetPathForCreateScope(normalized);
  mkdirSync(dirname(computedPath), { recursive: true });
  const targetPath = assertAllowlistedScopePath(normalized.home, computedPath);

  if (existsSync(targetPath) && !normalized.force) {
    throw new ServiceError("config-invalid", `Scope file already exists: ${targetPath}`);
  }

  type ScopeDocWithProfile = ScopeDocT & {
    profile?: ProfileCreateScopeMetadata;
  };
  const content: ScopeDocWithProfile = {
    version: 1,
    mcpServers: {},
    env: {},
    settings: {},
    use: [],
    disabledServers: [],
  };
  if (normalized.profile) content.profile = normalized.profile;
  if (normalized.authProfileId) content.auth = { profileId: normalized.authProfileId };
  writeCanonicalScopeFile(targetPath, content as ScopeDocT);

  return {
    created: true,
    path: resolve(targetPath),
    scope: scopeNameForCreateScope(normalized),
    role: normalized.layerType === "role" ? normalized.role : null,
    content,
  };
}

interface NormalizedCreateScopeInput {
  home: string;
  cwd: string;
  location: ProfileScopeLocation;
  layerType: ProfileScopeLayerType;
  role: string;
  force: boolean;
  profile?: ProfileCreateScopeMetadata;
  authProfileId?: string;
}

function normalizeCreateScopeInput(input: ProfileCreateScopeInput): NormalizedCreateScopeInput {
  if (input.location !== "global" && input.location !== "project") {
    throw new ServiceError("config-invalid", "location must be global or project");
  }
  if (input.layerType !== "shared" && input.layerType !== "role") {
    throw new ServiceError("config-invalid", "layerType must be shared or role");
  }

  const rawRole = input.role?.trim() ?? "";
  if (input.layerType === "role") {
    if (!rawRole) {
      throw new ServiceError("config-invalid", "Role name is required for role-specific layers");
    }
    if (!ROLE_RE.test(rawRole)) {
      throw new ServiceError("config-invalid", "Role name must match [a-z0-9_-]+");
    }
  }

  const profile = normalizeProfileMetadata(input.profile);
  const authProfileId = normalizeAuthProfileId(input.authProfileId);

  return {
    home: input.home,
    cwd: input.cwd,
    location: input.location,
    layerType: input.layerType,
    role: rawRole,
    force: input.force ?? false,
    ...(profile ? { profile } : {}),
    ...(authProfileId ? { authProfileId } : {}),
  };
}

function normalizeAuthProfileId(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const authProfileId = normalizeDisplayText(input, 120);
  if (!authProfileId) return undefined;
  if (UNSAFE_METADATA_RE.test(authProfileId) || authProfileId.includes("//")) {
    throw new ServiceError("config-invalid", "Auth profile id is not valid");
  }
  return authProfileId;
}

function normalizeProfileMetadata(
  input: ProfileCreateScopeMetadata | undefined
): ProfileCreateScopeMetadata | undefined {
  if (!input) return undefined;
  const displayName = normalizeDisplayText(input.displayName, 120);
  const purpose = normalizeDisplayText(input.purpose, 280);
  const profile: ProfileCreateScopeMetadata = {};
  if (displayName && !UNSAFE_METADATA_RE.test(displayName)) profile.displayName = displayName;
  if (purpose && !UNSAFE_METADATA_RE.test(purpose)) profile.purpose = purpose;
  return Object.keys(profile).length > 0 ? profile : undefined;
}

function normalizeDisplayText(input: string | undefined, maxLength: number): string | undefined {
  if (input === undefined) return undefined;
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function targetPathForCreateScope(input: ReturnType<typeof normalizeCreateScopeInput>): string {
  if (input.location === "global" && input.layerType === "shared") {
    return join(globalConfigDirFor(input.home), "global", "shared.yml");
  }
  if (input.location === "global" && input.layerType === "role") {
    return join(globalConfigDirFor(input.home), "global", "roles", `${input.role}.yml`);
  }
  if (input.location === "project" && input.layerType === "shared") {
    return join(input.cwd, ".myclaude", "shared.yml");
  }
  return join(input.cwd, ".myclaude", "roles", `${input.role}.yml`);
}

function scopeNameForCreateScope(
  input: ReturnType<typeof normalizeCreateScopeInput>
): ProfileCreateScopeResult["scope"] {
  if (input.location === "global") {
    return input.layerType === "shared" ? "global-shared" : "global-role";
  }
  return input.layerType === "shared" ? "project-shared" : "project-role";
}
