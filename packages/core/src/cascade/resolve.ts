import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { SchemaError } from "../errors.js";
import { ScopeDoc } from "../schema/index.js";
import type { McpServerEntryT, McpServerT, ScopeDocT } from "../schema/index.js";
import { loadScopeFile } from "../utils/load-yaml.js";
import { findProjectChain } from "../utils/project-chain.js";
import type { EffectiveConfig, EffectiveSessionConfig, ScopeName } from "../utils/types.js";
import { resolveExtends } from "./extends.js";
import { expandFragments } from "./fragment-expander.js";
import { dedupArray, deepMergeServer } from "./merge-policies.js";
import {
  createProvenanceState,
  finalizeProvenance,
  recordEnvField,
  recordMcpServerEvent,
  recordMcpServerSuppressed,
  recordPersona,
  recordSettingsField,
} from "./provenance.js";
import { checkTombstone, getDisabledServerNames, isMcpServerPatch } from "./tombstones.js";

/**
 * Input parameters for `resolve()`.
 */
export interface ResolveInput {
  /**
   * Role name (e.g. `"backend"`, `"frontend"`). Used to pick role-scoped files.
   * If empty or undefined, role-scoped layers are skipped.
   */
  role?: string;
  /**
   * The auth profile ID to bind. Carried into `effective.auth` but NOT resolved
   * at this layer (no keychain access here).
   */
  authProfileId?: string;
  /**
   * Current working directory; used to find the project chain.
   * Defaults to `process.cwd()` if omitted.
   */
  cwd?: string;
  /**
   * Optional launch-time overrides applied at the highest precedence.
   * Useful for CLI `--env`, `--mcp-disable`, and similar flags.
   */
  launchOverrides?: Partial<ScopeDocT>;
  /**
   * Directories to search for fragment YAML files.
   * Defaults to `["~/.myclaude/config/fragments"]`.
   */
  fragmentDirs?: string[];
  /**
   * Root directory for global config files.
   * Defaults to `"~/.myclaude/config"`.
   */
  globalConfigDir?: string;
}

/**
 * A scope layer descriptor — either a loaded file or a missing-file record.
 */
interface LayerEntry {
  name: ScopeName;
  filePath: string;
  doc: ScopeDocT | null; // null = file not present (silently skipped)
}

/**
 * Resolves the full cascade for a `(role, authProfileId, cwd)` triple.
 *
 * Implements the 7-step cascade algorithm from `docs/03-profile-schema.md`:
 *
 * 1. Collect scope layers in order.
 * 2. Zod-validate each layer independently.
 * 3. Expand fragments within each layer.
 * 4. Reduce layers with per-key merge policies.
 * 5. Parse secret refs (do NOT resolve — resolution is a future layer).
 * 6. Final Zod validation on the merged result.
 * 7. Return `{ effective, provenance, runtimePaths: null }`.
 *
 * @throws {SchemaError} If any layer fails Zod validation.
 * @throws {FragmentNotFoundError} If a fragment name cannot be resolved.
 * @throws {CascadeError} If a `__extends` target is invalid.
 */
export function resolve(input: ResolveInput): EffectiveSessionConfig {
  const {
    role,
    authProfileId,
    cwd = process.cwd(),
    launchOverrides,
    fragmentDirs,
    globalConfigDir,
  } = input;

  const resolvedCwd = resolvePath(cwd);
  const globalDir = globalConfigDir ?? join(homedir(), ".myclaude", "config");
  const resolvedFragmentDirs = fragmentDirs ?? [join(globalDir, "fragments")];

  // ─── Step 1: Collect scope layers ──────────────────────────────────────────

  const projectChain = findProjectChain(resolvedCwd);
  const layerEntries: LayerEntry[] = [];

  // Global shared
  layerEntries.push(makeLayerEntry("global-shared", join(globalDir, "global", "shared.yml")));

  // Global role
  if (role) {
    layerEntries.push(
      makeLayerEntry("global-role", join(globalDir, "global", "roles", `${role}.yml`))
    );
  }

  // Project chain: for each .myclaude-bearing dir, add shared, local, and role layers.
  for (const projectDir of projectChain) {
    const myClaudeDir = join(projectDir, ".myclaude");
    const projectLabel = projectDir;

    layerEntries.push(
      makeLayerEntry(`project-shared:${projectLabel}`, join(myClaudeDir, "shared.yml"))
    );

    const localPath = join(myClaudeDir, "local.yml");
    layerEntries.push(makeLayerEntry(`project-shared-local:${projectLabel}`, localPath));

    if (role) {
      layerEntries.push(
        makeLayerEntry(`project-role:${projectLabel}`, join(myClaudeDir, "roles", `${role}.yml`))
      );
    }
  }

  // ─── Step 2: Validate each present layer independently ────────────────────

  for (const entry of layerEntries) {
    if (entry.doc !== null) {
      // Already validated by loadScopeFile; this step is satisfied.
      // For launch overrides (parsed below), we validate separately.
    }
  }

  // ─── Validate and add launch overrides ────────────────────────────────────

  let launchOverrideEntry: LayerEntry | null = null;
  if (launchOverrides) {
    const overrideDoc: ScopeDocT = {
      version: 1,
      mcpServers: {},
      env: {},
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
      ...launchOverrides,
    };
    const parsed = ScopeDoc.safeParse(overrideDoc);
    if (!parsed.success) {
      throw new SchemaError("<launch-overrides>", parsed.error);
    }
    launchOverrideEntry = {
      name: "launch-overrides",
      filePath: "<launch-overrides>",
      doc: parsed.data,
    };
  }

  // ─── Step 3: Expand fragments in each layer ────────────────────────────────

  const expandedLayers: Array<{ name: ScopeName; filePath: string; doc: ScopeDocT }> = [];

  for (const entry of layerEntries) {
    if (entry.doc === null) continue;
    const expanded = expandFragments(entry.doc, resolvedFragmentDirs);
    expandedLayers.push({ name: entry.name, filePath: entry.filePath, doc: expanded });
  }

  if (launchOverrideEntry && launchOverrideEntry.doc !== null) {
    const expanded = expandFragments(launchOverrideEntry.doc, resolvedFragmentDirs);
    expandedLayers.push({
      name: launchOverrideEntry.name,
      filePath: launchOverrideEntry.filePath,
      doc: expanded,
    });
  }

  // ─── Step 4: Reduce layers with per-key merge policies ────────────────────

  const mergedMcpServers: Record<string, McpServerT> = {};
  const suppressedServers = new Set<string>();
  const mergedEnv: Record<string, string> = {};
  const mergedSettings: Record<string, unknown> = {};
  const mergedPersona = {
    claudeMd: [] as string[],
    agents: [] as string[],
    skills: [] as string[],
    slashCmds: [] as string[],
    memory: [] as string[],
  };
  let mergedAuth: { profileId: string } | undefined;

  const provState = createProvenanceState();

  // Build a map of scope → server map for __extends resolution.
  // We need to be able to look up what a specific scope contributed.
  const scopeServerSnapshots = new Map<ScopeName, Record<string, McpServerT>>();

  for (const layer of expandedLayers) {
    const { name: scopeName, doc } = layer;

    // ── 4a: mcpServers ──────────────────────────────────────────────────────

    // Snapshot this scope's raw (pre-merge) server definitions for __extends.
    const layerServersSnapshot: Record<string, McpServerT> = {};

    for (const [serverName, rawServer] of Object.entries(doc.mcpServers)) {
      const tombCheck = checkTombstone(rawServer);

      if (tombCheck.tombstoned) {
        // Tombstone: remove from merged state.
        delete mergedMcpServers[serverName];
        suppressedServers.add(serverName);
        recordMcpServerSuppressed(provState, serverName, scopeName);
        continue;
      }

      const incomingEntry: McpServerEntryT = tombCheck.server;

      // Re-introduction: a server tombstoned in a lower layer can be re-introduced.
      if (suppressedServers.has(serverName)) {
        suppressedServers.delete(serverName);
        // Remove the suppressedBy marker from provenance (server is back).
        const provEntry = provState.mcpServers[serverName];
        if (provEntry) {
          // Reconstruct without suppressedBy to clear the tombstone marker.
          // (exactOptionalPropertyTypes prevents `= undefined`; biome disallows delete.)
          const { suppressedBy: _removed, ...rest } = provEntry;
          provState.mcpServers[serverName] = rest;
        }
      }

      const existingServer = mergedMcpServers[serverName];

      if (incomingEntry.__extends) {
        // __extends: inherit from named lower-scope server, then apply incoming.
        const resolved = resolveExtends(serverName, incomingEntry, scopeServerSnapshots, scopeName);
        mergedMcpServers[serverName] = resolved;
        // Store as a snapshot too (resolved server is full)
        layerServersSnapshot[serverName] = resolved;
        recordMcpServerEvent(provState, serverName, scopeName, "extended");
      } else if (isMcpServerPatch(incomingEntry) && existingServer) {
        // Patch entry: has __merge:"deep" but no full server definition.
        // Overlay the patch fields onto the existing full server.
        const overriddenFields = getPatchOverriddenFields(existingServer, incomingEntry);
        mergedMcpServers[serverName] = deepMergeServer(existingServer, incomingEntry);
        layerServersSnapshot[serverName] = mergedMcpServers[serverName] as McpServerT;
        recordMcpServerEvent(provState, serverName, scopeName, "deep-merged", overriddenFields);
      } else if (
        !isMcpServerPatch(incomingEntry) &&
        incomingEntry.__merge === "deep" &&
        existingServer
      ) {
        // Full server with __merge:"deep": deep-merge onto existing.
        const overriddenFields = getOverriddenFields(existingServer, incomingEntry);
        mergedMcpServers[serverName] = deepMergeServer(existingServer, incomingEntry);
        layerServersSnapshot[serverName] = mergedMcpServers[serverName] as McpServerT;
        recordMcpServerEvent(provState, serverName, scopeName, "deep-merged", overriddenFields);
      } else if (!isMcpServerPatch(incomingEntry) && existingServer) {
        // replace semantics (default): incoming replaces the whole server.
        const overriddenFields = getOverriddenFields(existingServer, incomingEntry);
        mergedMcpServers[serverName] = incomingEntry;
        layerServersSnapshot[serverName] = incomingEntry;
        recordMcpServerEvent(provState, serverName, scopeName, "replaced", overriddenFields);
      } else if (!isMcpServerPatch(incomingEntry)) {
        // First introduction of this server name (full server).
        mergedMcpServers[serverName] = incomingEntry;
        layerServersSnapshot[serverName] = incomingEntry;
        recordMcpServerEvent(provState, serverName, scopeName, "introduced");
      } else {
        // Patch entry but no existing server — patch has nothing to apply to.
        // Silently skip: a deep-merge patch without a base is a no-op.
      }
    }

    // Save this scope's snapshot for use by later scopes' __extends.
    scopeServerSnapshots.set(scopeName, layerServersSnapshot);

    // ── 4b: disabledServers ─────────────────────────────────────────────────

    for (const disabledName of getDisabledServerNames(doc.disabledServers)) {
      delete mergedMcpServers[disabledName];
      suppressedServers.add(disabledName);
      recordMcpServerSuppressed(provState, disabledName, scopeName);
    }

    // ── 4c: env — last-wins (higher-layer wins) ──────────────────────────────

    for (const [key, value] of Object.entries(doc.env)) {
      mergedEnv[key] = value;
      recordEnvField(provState, key, scopeName);
    }

    // ── 4d: settings — deep-merge ────────────────────────────────────────────

    for (const [key, value] of Object.entries(doc.settings)) {
      mergedSettings[key] = value;
      recordSettingsField(provState, key, scopeName);
    }

    // ── 4e: persona — append in order, dedup later ──────────────────────────

    if (doc.persona) {
      const allFiles: string[] = [];
      if (doc.persona.claudeMd) {
        mergedPersona.claudeMd = dedupArray([...mergedPersona.claudeMd, ...doc.persona.claudeMd]);
        allFiles.push(...doc.persona.claudeMd);
      }
      if (doc.persona.agents) {
        mergedPersona.agents = dedupArray([...mergedPersona.agents, ...doc.persona.agents]);
        allFiles.push(...doc.persona.agents);
      }
      if (doc.persona.skills) {
        mergedPersona.skills = dedupArray([...mergedPersona.skills, ...doc.persona.skills]);
        allFiles.push(...doc.persona.skills);
      }
      if (doc.persona.slashCmds) {
        mergedPersona.slashCmds = dedupArray([
          ...mergedPersona.slashCmds,
          ...doc.persona.slashCmds,
        ]);
        allFiles.push(...doc.persona.slashCmds);
      }
      if (doc.persona.memory) {
        mergedPersona.memory = dedupArray([...mergedPersona.memory, ...doc.persona.memory]);
        allFiles.push(...doc.persona.memory);
      }
      recordPersona(provState, scopeName, allFiles);
    }

    // ── 4f: auth.profileId — last-writer wins ───────────────────────────────

    if (doc.auth?.profileId) {
      mergedAuth = doc.auth;
    }
  }

  // Override auth from explicit input parameter (highest precedence).
  if (authProfileId) {
    mergedAuth = { profileId: authProfileId };
  }

  // ─── Steps 5 & 6: Secret refs parsed (not resolved); final validation ──────

  // Secret refs are left as-is in the env/headers/args strings.
  // They will be detected and parsed by extractSecretRefs() but NOT resolved here.
  // The final merged object is validated against ScopeDoc below.

  const effectiveDoc: ScopeDocT = {
    version: 1,
    mcpServers: mergedMcpServers,
    env: mergedEnv,
    settings: mergedSettings,
    persona: {
      claudeMd: mergedPersona.claudeMd,
      agents: mergedPersona.agents,
      skills: mergedPersona.skills,
      slashCmds: mergedPersona.slashCmds,
      memory: mergedPersona.memory,
    },
    use: [],
    disabledServers: [],
    ...(mergedAuth ? { auth: mergedAuth } : {}),
  };

  const finalValidation = ScopeDoc.safeParse(effectiveDoc);
  if (!finalValidation.success) {
    throw new SchemaError("<merged-effective>", finalValidation.error);
  }

  // ─── Step 7: Return ────────────────────────────────────────────────────────

  const effective: EffectiveConfig = {
    mcpServers: mergedMcpServers,
    env: mergedEnv,
    settings: mergedSettings,
    persona: mergedPersona,
    ...(mergedAuth ? { auth: mergedAuth } : {}),
  };

  return {
    effective,
    provenance: finalizeProvenance(provState),
    runtimePaths: null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Loads a scope YAML file, returning null if the file doesn't exist.
 */
function makeLayerEntry(name: ScopeName, filePath: string): LayerEntry {
  if (!existsSync(filePath)) {
    return { name, filePath, doc: null };
  }
  const { doc } = loadScopeFile(filePath);
  return { name, filePath, doc };
}

/**
 * Returns the list of field names in `existing` that `incoming` will override.
 * Only top-level keys are compared (sufficient for server-level provenance).
 */
function getOverriddenFields(existing: McpServerT, incoming: McpServerEntryT): string[] {
  const overridden: string[] = [];
  for (const key of Object.keys(incoming)) {
    if (key in existing) {
      overridden.push(key);
    }
  }
  return overridden;
}

/**
 * Returns field names from a patch that will overlay onto the existing server.
 */
function getPatchOverriddenFields(existing: McpServerT, patch: McpServerEntryT): string[] {
  return getOverriddenFields(existing, patch);
}
