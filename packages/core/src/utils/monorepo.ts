import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const MONOREPO_MARKER_ORDER = [
  "pnpm-workspace.yaml",
  "nx.json",
  "turbo.json",
  "lerna.json",
  "rush.json",
  "package.json#workspaces",
  "git",
] as const;

export type MonorepoMarker = (typeof MONOREPO_MARKER_ORDER)[number];

export interface MonorepoRoot {
  path: string;
  marker: MonorepoMarker;
  markerPath: string;
}

export interface WorkspaceCandidate {
  kind: "root" | "package";
  path: string;
  hasMyClaude: boolean;
  marker?: MonorepoMarker;
  markerPath?: string;
  packageName?: string;
}

const WORKSPACE_MARKERS: Exclude<MonorepoMarker, "git">[] = [
  "pnpm-workspace.yaml",
  "nx.json",
  "turbo.json",
  "lerna.json",
  "rush.json",
  "package.json#workspaces",
];

export function findMonorepoRoot(startDir: string): MonorepoRoot | null {
  const dirs = ancestorsFromDeepest(startDir);

  for (const dir of dirs) {
    const marker = findWorkspaceMarkerInDir(dir);
    if (marker) return { path: dir, marker: marker.marker, markerPath: marker.markerPath };
  }

  for (const dir of dirs) {
    const markerPath = join(dir, ".git");
    if (existsSync(markerPath)) {
      return { path: dir, marker: "git", markerPath };
    }
  }

  return null;
}

export function findWorkspaceCandidates(startDir: string): WorkspaceCandidate[] {
  const root = findMonorepoRoot(startDir);
  if (!root) return [];

  const rootKey = realpathKey(root.path);
  const rootPackageName = readPackageName(root.path);
  const candidates: WorkspaceCandidate[] = [
    {
      kind: "root",
      path: root.path,
      hasMyClaude: isDirectory(join(root.path, ".myclaude")),
      marker: root.marker,
      markerPath: root.markerPath,
      ...(rootPackageName ? { packageName: rootPackageName } : {}),
    },
  ];

  for (const dir of ancestorsFromRoot(startDir, rootKey).slice(1)) {
    if (!hasPackageJson(dir)) continue;
    candidates.push({
      kind: "package",
      path: dir,
      hasMyClaude: isDirectory(join(dir, ".myclaude")),
      ...packageNameField(dir),
    });
  }

  return candidates;
}

function packageNameField(dir: string): Partial<Pick<WorkspaceCandidate, "packageName">> {
  const packageName = readPackageName(dir);
  return packageName ? { packageName } : {};
}

function findWorkspaceMarkerInDir(
  dir: string
): { marker: Exclude<MonorepoMarker, "git">; markerPath: string } | null {
  for (const marker of WORKSPACE_MARKERS) {
    if (marker === "package.json#workspaces") {
      const markerPath = join(dir, "package.json");
      if (packageJsonHasWorkspaces(markerPath)) return { marker, markerPath };
      continue;
    }

    const markerPath = join(dir, marker);
    if (existsSync(markerPath)) return { marker, markerPath };
  }

  return null;
}

function ancestorsFromDeepest(startDir: string): string[] {
  const dirs: string[] = [];
  let current = resolve(startDir);

  while (true) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs;
}

function ancestorsFromRoot(startDir: string, rootKey: string): string[] {
  const dirs = ancestorsFromDeepest(startDir).reverse();
  const rootIndex = dirs.findIndex((dir) => realpathKey(dir) === rootKey);
  return rootIndex >= 0 ? dirs.slice(rootIndex) : [];
}

function packageJsonHasWorkspaces(packageJsonPath: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      workspaces?: unknown;
    };
    if (Array.isArray(parsed.workspaces)) return true;
    if (
      parsed.workspaces &&
      typeof parsed.workspaces === "object" &&
      Array.isArray((parsed.workspaces as { packages?: unknown }).packages)
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function hasPackageJson(dir: string): boolean {
  return existsAsFile(join(dir, "package.json"));
}

function readPackageName(dir: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name?: unknown;
    };
    return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

function existsAsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
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
