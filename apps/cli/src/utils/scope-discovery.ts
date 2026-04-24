/**
 * @module utils/scope-discovery
 *
 * Discovers all scope YAML files from global and project-level directories.
 * Used by `profile list` and `profile validate` to enumerate known scopes.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { findProjectChain } from "@agent-profile/core";
import { globalConfigDir, globalRolesDir, myClaudeHome } from "./paths.js";

/**
 * A discovered scope file entry.
 */
export interface ScopeEntry {
  /** Human-readable scope category label. */
  scope: string;
  /** Role name, or `—` for shared/generic scopes. */
  role: string;
  /** Absolute path to the YAML file. */
  filePath: string;
}

/**
 * Options for scope discovery.
 */
export interface DiscoverOptions {
  /** Override for `~/.myclaude`. Defaults to `myClaudeHome()`. */
  home?: string | undefined;
  /** Working directory for project chain find-up. Defaults to `process.cwd()`. */
  cwd?: string | undefined;
  /**
   * If provided, only return entries that contribute to this role
   * (i.e., global-shared, global-role/<role>, project-shared, project-role/<role>).
   */
  filterRole?: string | undefined;
}

/**
 * Discovers all scope files reachable from the given home and cwd.
 *
 * Order is deterministic: global scopes first, then project chain outermost→innermost.
 * Within each scope category, role files are sorted alphabetically.
 *
 * @param opts - Discovery options.
 * @returns Array of scope entries in cascade order.
 */
export function discoverScopes(opts: DiscoverOptions = {}): ScopeEntry[] {
  const home = opts.home ?? myClaudeHome();
  const cwd = opts.cwd ?? process.cwd();
  const filterRole = opts.filterRole;

  const entries: ScopeEntry[] = [];
  const cfgDir = globalConfigDir(home);

  // ── Global shared ─────────────────────────────────────────────────────────
  const globalSharedPath = join(cfgDir, "global", "shared.yml");
  if (existsSync(globalSharedPath)) {
    if (!filterRole) {
      entries.push({ scope: "global-shared", role: "—", filePath: globalSharedPath });
    } else {
      // shared always contributes to every role
      entries.push({ scope: "global-shared", role: "—", filePath: globalSharedPath });
    }
  }

  // ── Global roles ──────────────────────────────────────────────────────────
  const rolesDir = globalRolesDir(home);
  if (existsSync(rolesDir)) {
    const roleFiles = readdirSync(rolesDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .sort();
    for (const file of roleFiles) {
      const roleName = basename(file, file.endsWith(".yaml") ? ".yaml" : ".yml");
      if (filterRole && roleName !== filterRole) continue;
      entries.push({
        scope: "global-role",
        role: roleName,
        filePath: join(rolesDir, file),
      });
    }
  }

  // ── Project chain ─────────────────────────────────────────────────────────
  const projectChain = findProjectChain(cwd);
  for (const projectDir of projectChain) {
    const myClaudeDir = join(projectDir, ".myclaude");

    // project-shared
    const sharedPath = join(myClaudeDir, "shared.yml");
    if (existsSync(sharedPath)) {
      if (!filterRole) {
        entries.push({ scope: "project-shared", role: "—", filePath: sharedPath });
      } else {
        entries.push({ scope: "project-shared", role: "—", filePath: sharedPath });
      }
    }

    // project-shared local
    const localPath = join(myClaudeDir, "local.yml");
    if (existsSync(localPath)) {
      if (!filterRole) {
        entries.push({ scope: "project-shared-local", role: "—", filePath: localPath });
      } else {
        entries.push({ scope: "project-shared-local", role: "—", filePath: localPath });
      }
    }

    // project roles
    const projectRolesDir = join(myClaudeDir, "roles");
    if (existsSync(projectRolesDir)) {
      const roleFiles = readdirSync(projectRolesDir)
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .sort();
      for (const file of roleFiles) {
        const roleName = basename(file, file.endsWith(".yaml") ? ".yaml" : ".yml");
        if (filterRole && roleName !== filterRole) continue;
        entries.push({
          scope: "project-role",
          role: roleName,
          filePath: join(projectRolesDir, file),
        });
      }
    }
  }

  return entries;
}
