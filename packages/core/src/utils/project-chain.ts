import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
    const candidate = resolve(current, MYCLAUDE_DIR);
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

  return chain;
}
