import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { findWorkspaceCandidates } from "./monorepo.js";

/**
 * The marker directory that identifies a "myclaude project root".
 */
const MYCLAUDE_DIR = ".myclaude";

/**
 * Walks up from `startDir` towards the filesystem root, collecting every
 * directory that contains a `.myclaude/` subdirectory.
 *
 * Returns the chain ordered from outermost ancestor to `startDir` (i.e.,
 * repository root first, deepest package last). This ordering is used by
 * the cascade to ensure project-shared from the repo root is applied before
 * a workspace package's project-shared.
 *
 * If no `.myclaude`-bearing directory is found, returns an empty array.
 * The global scopes are always included regardless of this chain.
 *
 * @param startDir - Absolute path to start walking from (typically `cwd`).
 * @returns Array of absolute directory paths that contain `.myclaude/`,
 *          ordered outermost-first.
 */
export function findProjectChain(startDir: string): string[] {
  const chain: string[] = [];
  let current = resolve(startDir);

  while (true) {
    const candidate = join(current, MYCLAUDE_DIR);
    if (existsSync(candidate)) {
      chain.unshift(current); // prepend so root comes first
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root
      break;
    }
    current = parent;
  }

  return dedupeProjectChain([
    ...chain,
    ...findWorkspaceCandidates(startDir)
      .filter((candidate) => candidate.hasMyClaude)
      .map((candidate) => candidate.path),
  ]);
}

function dedupeProjectChain(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    const key = realpathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }

  return result.sort((left, right) => pathDepth(left) - pathDepth(right));
}

function pathDepth(path: string): number {
  return path.split(/[\\/]+/).filter(Boolean).length;
}

function realpathKey(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    try {
      return join(realpathSync.native(parent), basename(path));
    } catch {
      return path;
    }
  }
}
