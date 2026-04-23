import { existsSync } from "node:fs";
import { join } from "node:path";
import { FragmentNotFoundError } from "../errors.js";
import { FragmentDoc } from "../schema/index.js";
import type { ScopeDocT } from "../schema/index.js";
import { loadYamlAs } from "../utils/load-yaml.js";

/**
 * Expands the `use: [name, ...]` list in a scope document by loading the
 * named fragment files and inlining their `mcpServer` and `env` entries
 * into the scope's own `mcpServers` and `env`.
 *
 * Expansion rules (per spec):
 * - The scope's OWN `mcpServers` entries take precedence over the fragment's.
 *   (i.e., fragment provides defaults, scope can override.)
 * - The scope's OWN `env` entries take precedence over the fragment's.
 * - Fragments cannot reference other fragments (v1 limitation). Attempting to
 *   do so throws an error.
 * - Fragments are searched in `fragmentDirs` (in order). First match wins.
 *
 * @param layer - The scope document to expand in-place (returned as a new object).
 * @param fragmentDirs - Directories to search for fragment YAML files.
 * @returns A new scope document with fragment content inlined.
 * @throws {FragmentNotFoundError} If a fragment name cannot be resolved.
 */
export function expandFragments(layer: ScopeDocT, fragmentDirs: string[]): ScopeDocT {
  if (!layer.use || layer.use.length === 0) {
    return layer;
  }

  let mergedMcpServers = { ...layer.mcpServers };
  let mergedEnv = { ...layer.env };

  for (const fragmentName of layer.use) {
    const fragmentPath = findFragmentFile(fragmentName, fragmentDirs);

    const frag = loadYamlAs(fragmentPath, FragmentDoc);

    // Sanity check: fragments must not have a `use` field (v1: no recursion).
    // The FragmentDoc schema doesn't have `use`, so this is enforced structurally.

    // Fragment mcpServer entries are defaults: scope's own entries override fragment's.
    if (frag.mcpServer) {
      for (const [serverName, server] of Object.entries(frag.mcpServer)) {
        if (!(serverName in mergedMcpServers)) {
          // Fragment provides this server; scope doesn't have it yet.
          mergedMcpServers = { ...mergedMcpServers, [serverName]: server };
        }
        // If scope already has the server, it overrides (fragment is skipped for that key).
      }
    }

    // Fragment env entries are defaults: scope's own entries override.
    for (const [envKey, envVal] of Object.entries(frag.env)) {
      if (!(envKey in mergedEnv)) {
        mergedEnv = { ...mergedEnv, [envKey]: envVal };
      }
    }
  }

  return {
    ...layer,
    mcpServers: mergedMcpServers,
    env: mergedEnv,
  };
}

/**
 * Resolves a fragment name to an absolute file path.
 * Searches `fragmentDirs` in order; returns the first match.
 *
 * @throws {FragmentNotFoundError} if no match is found.
 */
function findFragmentFile(name: string, fragmentDirs: string[]): string {
  const searchedPaths: string[] = [];

  for (const dir of fragmentDirs) {
    const candidate = join(dir, `${name}.yml`);
    searchedPaths.push(candidate);
    if (existsSync(candidate)) {
      return candidate;
    }
    // Also try .yaml extension
    const candidateYaml = join(dir, `${name}.yaml`);
    searchedPaths.push(candidateYaml);
    if (existsSync(candidateYaml)) {
      return candidateYaml;
    }
  }

  throw new FragmentNotFoundError(name, searchedPaths);
}
