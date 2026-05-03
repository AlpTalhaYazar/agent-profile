import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ScopeDocT } from "@agent-profile/core";
import { ServiceError } from "../errors.js";
import { globalConfigDirFor } from "../paths.js";
import { assertAllowlistedScopePath, writeCanonicalScopeFile } from "./shared.js";

export type ProfileScopeLocation = "global" | "project";
export type ProfileScopeLayerType = "shared" | "role";

export interface ProfileCreateScopeInput {
  home: string;
  cwd: string;
  location: ProfileScopeLocation;
  layerType: ProfileScopeLayerType;
  role?: string;
  force?: boolean;
}

export interface ProfileCreateScopeResult {
  created: true;
  path: string;
  scope: "global-shared" | "global-role" | "project-shared" | "project-role";
  role: string | null;
  content: ScopeDocT;
}

const ROLE_RE = /^[a-z0-9_-]+$/;

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

  const content: ScopeDocT = {
    version: 1,
    mcpServers: {},
    env: {},
    settings: {},
    use: [],
    disabledServers: [],
  };
  writeCanonicalScopeFile(targetPath, content);

  return {
    created: true,
    path: resolve(targetPath),
    scope: scopeNameForCreateScope(normalized),
    role: normalized.layerType === "role" ? normalized.role : null,
    content,
  };
}

function normalizeCreateScopeInput(input: ProfileCreateScopeInput): Required<
  Pick<ProfileCreateScopeInput, "home" | "cwd" | "location" | "layerType">
> & {
  role: string;
  force: boolean;
} {
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

  return {
    home: input.home,
    cwd: input.cwd,
    location: input.location,
    layerType: input.layerType,
    role: rawRole,
    force: input.force ?? false,
  };
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
