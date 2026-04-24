/**
 * @module activation/resolve
 *
 * Activation resolver — determines the active role and auth profile
 * for a given invocation context.
 *
 * Resolution order (highest precedence first) per `docs/04-cli-spec.md`:
 * 1. Explicit `--role` / `--auth` flag (passed as `flags` param).
 * 2. `$MYCLAUDE_ROLE` / `$MYCLAUDE_AUTH_PROFILE` environment variables.
 * 3. `./.myclaude/role` and `./.myclaude/auth` files, discovered by find-up from cwd.
 * 4. `~/.myclaude/default-role` and `~/.myclaude/default-auth`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { myClaudeHome } from "../utils/paths.js";

/**
 * Inputs to the activation resolver.
 */
export interface ResolveActivationInput {
  /** Explicit role flag (e.g. from `--role backend`). */
  flagRole?: string;
  /** Explicit auth flag (e.g. from `--auth work`). */
  flagAuth?: string;
  /** Working directory for find-up. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override for `~/.myclaude`. Used in tests. */
  home?: string;
}

/**
 * Result of the activation resolver.
 */
export interface ActivationResult {
  /** Resolved role name, or `null` if none found. */
  role: string | null;
  /** Resolved auth profile ID, or `null` if none found. */
  auth: string | null;
  /** The resolution layer that provided the role. */
  roleSource: "flag" | "env" | "file" | "default" | null;
  /** The resolution layer that provided the auth. */
  authSource: "flag" | "env" | "file" | "default" | null;
}

/**
 * Reads a one-line text file, returning its trimmed content.
 * Returns `null` if the file does not exist or is empty.
 */
function readTextFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8").trim();
  return content.length > 0 ? content : null;
}

/**
 * Walks up from `startDir` looking for `.myclaude/role` and `.myclaude/auth` files.
 * Returns the first pair found (may be partial — one or both can be null).
 */
function findUpActivationFiles(startDir: string): { role: string | null; auth: string | null } {
  let current = resolve(startDir);
  while (true) {
    const myClaudeDir = join(current, ".myclaude");
    const rolePath = join(myClaudeDir, "role");
    const authPath = join(myClaudeDir, "auth");

    const roleVal = readTextFile(rolePath);
    const authVal = readTextFile(authPath);

    if (roleVal !== null || authVal !== null) {
      return { role: roleVal, auth: authVal };
    }

    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  return { role: null, auth: null };
}

/**
 * Resolves the active role and auth profile for a CLI invocation.
 *
 * @param input - Resolution inputs (flags, cwd, home).
 * @returns The resolved activation result with role, auth, and their sources.
 */
export function resolveActivation(input: ResolveActivationInput = {}): ActivationResult {
  const { flagRole, flagAuth, cwd = process.cwd(), home } = input;
  const myHome = home ?? myClaudeHome();

  // ── Layer 1: Explicit flags ────────────────────────────────────────────────
  let role: string | null = flagRole ?? null;
  let auth: string | null = flagAuth ?? null;
  let roleSource: ActivationResult["roleSource"] = role ? "flag" : null;
  let authSource: ActivationResult["authSource"] = auth ? "flag" : null;

  // ── Layer 2: Environment variables ───────────────────────────────────────
  if (role === null) {
    const envRole = process.env.MYCLAUDE_ROLE?.trim() ?? null;
    if (envRole && envRole.length > 0) {
      role = envRole;
      roleSource = "env";
    }
  }
  if (auth === null) {
    const envAuth = process.env.MYCLAUDE_AUTH_PROFILE?.trim() ?? null;
    if (envAuth && envAuth.length > 0) {
      auth = envAuth;
      authSource = "env";
    }
  }

  // ── Layer 3: Find-up files ────────────────────────────────────────────────
  if (role === null || auth === null) {
    const fileActivation = findUpActivationFiles(cwd);
    if (role === null && fileActivation.role) {
      role = fileActivation.role;
      roleSource = "file";
    }
    if (auth === null && fileActivation.auth) {
      auth = fileActivation.auth;
      authSource = "file";
    }
  }

  // ── Layer 4: User defaults ─────────────────────────────────────────────────
  if (role === null) {
    const defaultRole = readTextFile(join(myHome, "default-role"));
    if (defaultRole) {
      role = defaultRole;
      roleSource = "default";
    }
  }
  if (auth === null) {
    const defaultAuth = readTextFile(join(myHome, "default-auth"));
    if (defaultAuth) {
      auth = defaultAuth;
      authSource = "default";
    }
  }

  return { role, auth, roleSource, authSource };
}

/**
 * The "No role selected" help block shown when no activation resolves.
 * Matches the exact text from `docs/04-cli-spec.md`.
 */
export const NO_ROLE_HELP = `No role selected. Choose one of:
  myclaude use backend               # shell state
  myclaude launch --role backend     # per-launch
  echo 'backend' > ~/.myclaude/default-role`;
