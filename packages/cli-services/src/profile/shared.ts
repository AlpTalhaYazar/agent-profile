import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  type EffectiveConfig,
  type EffectiveSessionConfig,
  ScopeDoc,
  type ScopeDocT,
  resolve as coreResolve,
  findProjectChain,
} from "@agent-profile/core";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { ServiceError } from "../errors.js";
import { globalConfigDirFor, globalFragmentsDirFor } from "../paths.js";

export interface ProfileIssue {
  path: string;
  message: string;
  code: string;
}

export interface ProfileScopeEntry {
  scope: string;
  role: string | null;
  filePath: string;
  content: ScopeDocT | null;
  /** Per-file read/parse/validation issues; absent when the file loaded cleanly. */
  issues?: ProfileIssue[];
}

export interface ProfileDiffEntry {
  path: string;
  change: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

export interface ProfileResolvedPreview {
  effective: unknown;
  provenance: unknown;
}

export interface ParsedScopeContent {
  doc: ScopeDocT | null;
  issues: ProfileIssue[];
}

export function listScopeEntries(input: {
  home: string;
  cwd: string;
  roleFilter?: string;
}): ProfileScopeEntry[] {
  const { home, cwd, roleFilter } = input;
  const entries: ProfileScopeEntry[] = [];
  const globalConfigDir = globalConfigDirFor(home);

  const globalSharedPath = join(globalConfigDir, "global", "shared.yml");
  pushScope(entries, {
    scope: "global-shared",
    role: null,
    filePath: globalSharedPath,
  });

  const globalRolesDir = join(globalConfigDir, "global", "roles");
  pushRoleEntries(entries, globalRolesDir, "global-role", roleFilter);

  for (const projectDir of findProjectChain(cwd)) {
    const myClaudeDir = join(projectDir, ".myclaude");
    pushScope(entries, {
      scope: "project-shared",
      role: null,
      filePath: join(myClaudeDir, "shared.yml"),
    });
    pushScope(entries, {
      scope: "project-shared-local",
      role: null,
      filePath: join(myClaudeDir, "local.yml"),
    });
    pushRoleEntries(entries, join(myClaudeDir, "roles"), "project-role", roleFilter);
  }

  return entries;
}

export function validateScopeContent(content: unknown): ParsedScopeContent {
  const parsed = parseScopeContent(content);
  if (parsed.issues.length > 0) return { doc: null, issues: parsed.issues };

  const result = ScopeDoc.safeParse(parsed.value);
  if (!result.success) {
    return {
      doc: null,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    };
  }

  return { doc: result.data, issues: [] };
}

export function resolveCurrentProfile(input: {
  home: string;
  role: string;
  authProfileId?: string;
  cwd: string;
}): EffectiveSessionConfig {
  const { home, role, authProfileId, cwd } = input;
  const resolveInput: Parameters<typeof coreResolve>[0] = {
    role,
    cwd,
    globalConfigDir: globalConfigDirFor(home),
    fragmentDirs: [globalFragmentsDirFor(home)],
  };
  if (authProfileId !== undefined) resolveInput.authProfileId = authProfileId;
  return coreResolve(resolveInput);
}

export function summarizeEffectiveDiff(
  current: EffectiveConfig,
  preview: EffectiveConfig
): ProfileDiffEntry[] {
  const currentFlat = flattenEffectiveConfig(current);
  const previewFlat = flattenEffectiveConfig(preview);
  const allPaths = new Set([...currentFlat.keys(), ...previewFlat.keys()]);
  const diff: ProfileDiffEntry[] = [];

  for (const path of Array.from(allPaths).sort()) {
    const before = currentFlat.get(path);
    const after = previewFlat.get(path);

    if (before === undefined && after !== undefined) {
      diff.push({ path, change: "added", after });
      continue;
    }
    if (before !== undefined && after === undefined) {
      diff.push({ path, change: "removed", before });
      continue;
    }
    if (!deepEqual(before, after)) {
      diff.push({ path, change: "changed", before, after });
    }
  }

  return diff;
}

export function assertValidScopeDoc(content: unknown): ScopeDocT {
  const parsed = validateScopeContent(content);
  if (parsed.doc) return parsed.doc;

  const issue = parsed.issues[0];
  throw new ServiceError(
    "config-invalid",
    issue
      ? `Invalid scope content at "${issue.path || "(root)"}": ${issue.message}`
      : "Invalid scope content"
  );
}

export function assertAllowlistedScopePath(home: string, path: string): string {
  if (path.includes("\0")) {
    throw new ServiceError("config-invalid", "Refusing to save path with null byte");
  }
  const targetPath = resolve(path);
  // Resolve symlinks for the security comparison so a symlink inside the
  // allowlist cannot redirect writes outside it. Both sides of every check
  // run through realpath so platform quirks (e.g. macOS /var → /private/var)
  // don't cause false negatives. The returned path stays in the
  // caller-supplied form so downstream IO operates on the address the user
  // requested.
  const checkPath = resolveRealPath(targetPath);
  const globalRoot = resolveRealPath(join(globalConfigDirFor(home), "global"));

  if (checkPath === join(globalRoot, "shared.yml")) return targetPath;

  const globalRolesDir = join(globalRoot, "roles");
  if (dirname(checkPath) === globalRolesDir && checkPath.endsWith(".yml")) {
    return targetPath;
  }

  const segments = checkPath.split(sep);
  const myClaudeIndex = segments.lastIndexOf(".myclaude");
  if (myClaudeIndex === -1) {
    throw new ServiceError(
      "config-invalid",
      `Refusing to save outside an allowlisted scope: ${path}`
    );
  }

  const relativeSegments = segments.slice(myClaudeIndex + 1);
  if (
    relativeSegments.length === 1 &&
    (relativeSegments[0] === "shared.yml" || relativeSegments[0] === "local.yml")
  ) {
    return targetPath;
  }

  if (
    relativeSegments.length === 2 &&
    relativeSegments[0] === "roles" &&
    relativeSegments[1] !== undefined &&
    relativeSegments[1].endsWith(".yml")
  ) {
    return targetPath;
  }

  throw new ServiceError(
    "config-invalid",
    `Refusing to save outside an allowlisted scope: ${path}`
  );
}

/**
 * Resolve symlinks before allowlist comparison so a symlink placed inside an
 * allowlisted directory cannot redirect writes to a path the caller never
 * intended. Falls back to the input path when realpath fails (typical when
 * neither the file nor its parent directory exists yet).
 */
function resolveRealPath(targetPath: string): string {
  try {
    return realpathSync.native(targetPath);
  } catch {
    // File does not exist yet — resolve the deepest existing ancestor and
    // re-attach the trailing segments so symlink hops in the parent chain are
    // still followed.
    const parent = dirname(targetPath);
    if (parent === targetPath) return targetPath;
    try {
      return join(realpathSync.native(parent), basename(targetPath));
    } catch {
      return targetPath;
    }
  }
}

export function writeCanonicalScopeFile(path: string, doc: ScopeDocT): void {
  mkdirSync(dirname(path), { recursive: true });
  const canonicalDoc = canonicalizeScopeDoc(doc);
  const content = `${yamlStringify(canonicalDoc, { lineWidth: 0 })}`;
  const tmpPath = join(dirname(path), `.${basename(path)}.tmp.${process.pid}.${Date.now()}`);

  try {
    writeFileSync(tmpPath, content.endsWith("\n") ? content : `${content}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw new ServiceError(
      "io-error",
      `Failed to save scope file ${path}: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }
}

function parseScopeContent(content: unknown): { value: unknown; issues: ProfileIssue[] } {
  if (typeof content !== "string") {
    return { value: content, issues: [] };
  }

  try {
    return { value: yamlParse(content), issues: [] };
  } catch (err) {
    return {
      value: null,
      issues: [
        {
          path: "",
          message: err instanceof Error ? err.message : String(err),
          code: "yaml.parse",
        },
      ],
    };
  }
}

function pushScope(
  entries: ProfileScopeEntry[],
  entry: Omit<ProfileScopeEntry, "content" | "issues">
): void {
  const filePath = resolve(entry.filePath);
  if (!existsAsFile(filePath)) return;
  const { doc, issues } = readScopeDoc(filePath);
  entries.push({
    ...entry,
    filePath,
    content: doc,
    ...(issues.length > 0 ? { issues } : {}),
  });
}

function pushRoleEntries(
  entries: ProfileScopeEntry[],
  rolesDir: string,
  scope: string,
  roleFilter?: string
): void {
  let roleFiles: string[];
  try {
    roleFiles = readdirSync(rolesDir)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .sort();
  } catch {
    return;
  }

  for (const file of roleFiles) {
    const role = file.endsWith(".yaml") ? file.slice(0, -5) : file.slice(0, -4);
    if (roleFilter && role !== roleFilter) continue;
    const filePath = resolve(join(rolesDir, file));
    const { doc, issues } = readScopeDoc(filePath);
    entries.push({
      scope,
      role,
      filePath,
      content: doc,
      ...(issues.length > 0 ? { issues } : {}),
    });
  }
}

function existsAsFile(filePath: string): boolean {
  return existsSync(filePath);
}

function readScopeDoc(filePath: string): ParsedScopeContent {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      doc: null,
      issues: [
        {
          path: "",
          message: err instanceof Error ? err.message : String(err),
          code: "io.read",
        },
      ],
    };
  }
  return validateScopeContent(raw);
}

function canonicalizeScopeDoc(doc: ScopeDocT): ScopeDocT {
  type ScopeDocWithProfile = ScopeDocT & {
    profile?: { displayName?: string; purpose?: string };
  };
  const source = doc as ScopeDocWithProfile;
  const canonical: ScopeDocWithProfile = {
    version: doc.version,
    mcpServers: sortRecord(doc.mcpServers),
    env: sortRecord(doc.env),
    settings: sortValue(doc.settings) as ScopeDocT["settings"],
    use: [...doc.use],
    disabledServers: [...doc.disabledServers],
  };

  if (source.profile) {
    canonical.profile = sortValue(source.profile) as { displayName?: string; purpose?: string };
  }
  if (doc.auth) canonical.auth = sortValue(doc.auth) as ScopeDocT["auth"];
  if (doc.persona) canonical.persona = sortValue(doc.persona) as ScopeDocT["persona"];

  return canonical as ScopeDocT;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.keys(record)
    .sort()
    .reduce<Record<string, T>>((acc, key) => {
      acc[key] = sortValue(record[key]) as T;
      return acc;
    }, {});
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function flattenEffectiveConfig(config: EffectiveConfig): Map<string, unknown> {
  const flat = new Map<string, unknown>();
  flattenValue("mcpServers", config.mcpServers, flat);
  flattenValue("env", config.env, flat);
  flattenValue("settings", config.settings, flat);
  flattenValue("persona", config.persona, flat);
  if (config.auth) {
    flattenValue("auth", config.auth, flat);
  }
  return flat;
}

function flattenValue(path: string, value: unknown, flat: Map<string, unknown>): void {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    flat.set(path, value);
    return;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    flat.set(path, {});
    return;
  }

  for (const [key, nested] of entries) {
    flattenValue(`${path}.${key}`, nested, flat);
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortValue(left)) === JSON.stringify(sortValue(right));
}
