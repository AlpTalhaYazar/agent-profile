/**
 * @module output/format
 *
 * Human-readable formatters for effective config and provenance output.
 * All output uses consola + picocolors and respects NO_COLOR / CI / FORCE_COLOR.
 */
import type {
  AuthProfilesDocT,
  EffectiveSessionConfig,
  McpServerProvenance,
  McpServerT,
  Provenance,
  ScopeDocT,
  ScopeName,
} from "@agent-profile/core";
import type { MissingRef, ResolutionLogEntry, ResolveSecretsResult } from "@agent-profile/secrets";
import { bold, cyan, dim, magenta, red, yellow } from "./colors.js";
import { REDACTED, applyRedaction, isSensitiveField, unresolvedMarker } from "./redact.js";

/**
 * Format an MCP server type for display.
 * McpServerT is stdio (has `command`) | http/streamable-http/sse (has `url` + required `type`).
 */
function formatServerType(server: McpServerT): string {
  if ("command" in server) return "stdio";
  // "url" in server — McpHttpServer and McpSseServer always have a required `type` field.
  return server.type;
}

/**
 * Format a single scope name for display.
 * Strips the `:path` suffix from project scope names.
 */
export function formatScopeName(name: ScopeName): string {
  // project-shared:/abs/path => project-shared
  const colonIdx = name.indexOf(":");
  return colonIdx >= 0 ? name.slice(0, colonIdx) : name;
}

/**
 * Format the provenance chain for a single MCP server entry.
 */
function formatMcpProvenance(serverName: string, prov: Provenance): string {
  const p = prov.mcpServers[serverName];
  if (!p) return "";
  const chain = p.chain
    .map((c: McpServerProvenance["chain"][number]) => `${formatScopeName(c.scope)} [${c.event}]`)
    .join(" → ");
  if (p.suppressedBy) {
    return dim(` (suppressed by ${formatScopeName(p.suppressedBy)})`);
  }
  return dim(` (${chain})`);
}

/**
 * Options for the human-readable effective config printer.
 */
export interface FormatOptions {
  /** Include provenance chain detail for each entry. */
  provenance?: boolean;
  /** Current working directory for display. */
  cwd?: string;
}

/**
 * Render the effective session config as a human-readable string.
 *
 * Sections printed (when non-empty):
 * - Header line: Role / Auth / Cwd
 * - MCP servers
 * - Env vars
 * - Settings
 * - Persona
 *
 * @param result - Output of `resolve()`.
 * @param role - Role name used in the header.
 * @param authId - Auth profile ID used in the header (optional).
 * @param opts - Formatting options.
 * @returns Multi-line string ready for stdout.
 */
export function formatEffectiveConfig(
  result: EffectiveSessionConfig,
  role: string,
  authId?: string,
  opts: FormatOptions = {}
): string {
  const { effective, provenance } = result;
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  const headerParts: string[] = [`${bold("Role:")}  ${magenta(role)}`];
  if (authId) headerParts.push(`${bold("Auth:")}  ${cyan(authId)}`);
  if (opts.cwd) headerParts.push(`${bold("Cwd:")}  ${dim(opts.cwd)}`);
  lines.push(headerParts.join("   "));
  lines.push("");

  // ── MCP servers ───────────────────────────────────────────────────────────
  const serverEntries = Object.entries(effective.mcpServers);
  if (serverEntries.length > 0) {
    lines.push(bold(`MCP servers (${serverEntries.length}):`));
    for (const [name, server] of serverEntries) {
      const type = formatServerType(server);
      const prov = opts.provenance ? formatMcpProvenance(name, provenance) : "";
      lines.push(`  ${cyan(name.padEnd(16))} ${type}${prov}`);
      // Show env vars for stdio servers
      if ("command" in server && server.env && Object.keys(server.env).length > 0) {
        for (const [envKey, envVal] of Object.entries(server.env)) {
          lines.push(`    env.${envKey} = ${envVal}`);
        }
      }
      // Show headers for HTTP servers
      if ("url" in server && server.headers && Object.keys(server.headers).length > 0) {
        for (const [hKey, hVal] of Object.entries(server.headers)) {
          lines.push(`    header.${hKey} = ${hVal}`);
        }
      }
    }
    lines.push("");
  }

  // ── Env vars ──────────────────────────────────────────────────────────────
  const envEntries = Object.entries(effective.env);
  if (envEntries.length > 0) {
    lines.push(bold(`Env (${envEntries.length}):`));
    for (const [key, value] of envEntries) {
      const prov = opts.provenance
        ? dim(` (${formatScopeName(provenance.env[key]?.source ?? "unknown")})`)
        : "";
      lines.push(`  ${key.padEnd(20)} = ${value}${prov}`);
    }
    lines.push("");
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  const settingEntries = Object.entries(effective.settings);
  if (settingEntries.length > 0) {
    lines.push(bold(`Settings (${settingEntries.length}):`));
    for (const [key, value] of settingEntries) {
      const prov = opts.provenance
        ? dim(` (${formatScopeName(provenance.settings[key]?.source ?? "unknown")})`)
        : "";
      lines.push(`  ${key} = ${JSON.stringify(value)}${prov}`);
    }
    lines.push("");
  }

  // ── Persona ───────────────────────────────────────────────────────────────
  const { persona } = effective;
  const hasPersona =
    persona.claudeMd.length > 0 ||
    persona.agents.length > 0 ||
    persona.skills.length > 0 ||
    persona.slashCmds.length > 0 ||
    persona.memory.length > 0;

  if (hasPersona) {
    lines.push(bold("Persona:"));
    if (persona.claudeMd.length > 0) {
      lines.push(`  CLAUDE.md   ${persona.claudeMd.length} source(s):`);
      for (const p of persona.claudeMd) {
        lines.push(`    ${dim(p)}`);
      }
    }
    if (persona.agents.length > 0) {
      lines.push(`  agents/     ${persona.agents.map((p) => dim(p)).join(", ")}`);
    }
    if (persona.skills.length > 0) {
      lines.push(`  skills/     ${persona.skills.map((p) => dim(p)).join(", ")}`);
    }
    if (persona.slashCmds.length > 0) {
      lines.push(`  slashCmds/  ${persona.slashCmds.map((p) => dim(p)).join(", ")}`);
    }
    if (persona.memory.length > 0) {
      lines.push(`  memory/     ${persona.memory.map((p) => dim(p)).join(", ")}`);
    }
    lines.push("");
  }

  // Strip trailing blank line
  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

/**
 * Format a table row for `profile list`.
 *
 * @param scope - Scope display name.
 * @param role - Role name or `—` for shared scopes.
 * @param filePath - Absolute path to the scope file.
 * @returns Formatted row string.
 */
export function formatListRow(scope: string, role: string, filePath: string): string {
  return `${scope.padEnd(16)}${yellow(role.padEnd(24))}${dim(filePath)}`;
}

/**
 * Format the header for `profile list`.
 */
export function formatListHeader(): string {
  return bold(`${"SCOPE".padEnd(16)}${"ROLE".padEnd(24)}FILE`);
}

/**
 * Options for `renderResolved`.
 */
export interface RenderResolvedOptions {
  /** Include actual secret values in output. Default: false (redact). */
  showValues?: boolean;
  /** Role name used in the header. */
  role: string;
  /** Auth profile ID used in the header (undefined if not provided). */
  authId?: string | undefined;
  /** Current working directory for display. */
  cwd?: string | undefined;
}

/**
 * Renders the resolved effective config with sensitive fields redacted.
 *
 * Compares the pre-resolution config with the post-resolution one to
 * determine which fields changed (i.e., were sensitive).  Sensitive fields
 * are replaced with `«redacted»` unless `--show-values` is set.
 *
 * Missing refs are shown as `«unresolved: <ref>»`.
 *
 * @param original - The cascaded config BEFORE secret resolution.
 * @param result - The output of `resolveSecrets()`.
 * @param opts - Rendering options.
 * @returns Multi-line string ready for stdout.
 */
export function renderResolved(
  original: ScopeDocT,
  result: ResolveSecretsResult,
  opts: RenderResolvedOptions
): string {
  const { resolvedConfig, missingRefs } = result;
  const { showValues = false, role, authId, cwd } = opts;

  const lines: string[] = [];

  // ── Header ───────────────────────────────────────────────────────────────────
  const headerParts: string[] = [`${bold("Role:")}  ${magenta(role)}`];
  if (authId) headerParts.push(`${bold("Auth:")}  ${cyan(authId)}`);
  if (cwd) headerParts.push(`${bold("Cwd:")}  ${dim(cwd)}`);
  lines.push(headerParts.join("   "));
  if (!showValues) {
    lines.push(
      dim("[secrets resolved — sensitive fields are redacted; use --show-values to reveal]")
    );
  }
  lines.push("");

  // ── MCP servers ──────────────────────────────────────────────────────────────
  const serverEntries = Object.entries(resolvedConfig.mcpServers);
  if (serverEntries.length > 0) {
    lines.push(bold(`MCP servers (${serverEntries.length}):`));
    for (const [name, server] of serverEntries) {
      if (!server) continue;
      const originalServer = original.mcpServers[name];
      if ("command" in server && server.command) {
        lines.push(`  ${cyan(name.padEnd(16))} stdio  ${dim(server.command)}`);
        if ("env" in server && server.env && Object.keys(server.env).length > 0) {
          for (const [envKey, envVal] of Object.entries(server.env)) {
            const origEnv =
              originalServer && "env" in originalServer ? (originalServer.env ?? {}) : {};
            const origEnvVal = (origEnv as Record<string, string>)[envKey] ?? "";
            const display = applyRedaction(origEnvVal, envVal, showValues);
            lines.push(`    env.${envKey} = ${display}`);
          }
        }
      } else if ("url" in server) {
        const serverType = server.type;
        const serverUrl = String(server.url);
        lines.push(`  ${cyan(name.padEnd(16))} ${serverType}  ${dim(serverUrl)}`);
        if ("headers" in server && server.headers && Object.keys(server.headers).length > 0) {
          for (const [hKey, hVal] of Object.entries(server.headers)) {
            const origHeaders =
              originalServer && "headers" in originalServer ? (originalServer.headers ?? {}) : {};
            const origHVal = (origHeaders as Record<string, string>)[hKey] ?? "";
            const display = applyRedaction(origHVal, hVal, showValues);
            lines.push(`    header.${hKey} = ${display}`);
          }
        }
      }
    }
    lines.push("");
  }

  // ── Env vars ─────────────────────────────────────────────────────────────────
  const envEntries = Object.entries(resolvedConfig.env);
  if (envEntries.length > 0) {
    lines.push(bold(`Env (${envEntries.length}):`));
    for (const [key, value] of envEntries) {
      const origVal = original.env[key] ?? "";
      const display = applyRedaction(origVal, value, showValues);
      lines.push(`  ${key.padEnd(20)} = ${display}`);
    }
    lines.push("");
  }

  // ── Settings ─────────────────────────────────────────────────────────────────
  const settingEntries = Object.entries(resolvedConfig.settings);
  if (settingEntries.length > 0) {
    lines.push(bold(`Settings (${settingEntries.length}):`));
    for (const [key, value] of settingEntries) {
      lines.push(`  ${key} = ${JSON.stringify(value)}`);
    }
    lines.push("");
  }

  // ── Missing refs ─────────────────────────────────────────────────────────────
  if (missingRefs.length > 0) {
    lines.push(bold(`Unresolved refs (${missingRefs.length}):`));
    for (const ref of missingRefs) {
      lines.push(`  ${red(unresolvedMarker(ref.name))}  ${dim(`at ${ref.path}`)}`);
    }
    lines.push("");
  }

  // ── Footer note ──────────────────────────────────────────────────────────────
  lines.push(
    dim(
      "(ANTHROPIC_API_KEY is not materialized into env — Claude Code will\n" +
        " receive it via apiKeyHelper.sh at launch time. See docs/06-security.md.)"
    )
  );

  return lines.join("\n");
}

/**
 * Format a table of auth profiles for `auth list`.
 *
 * @param profiles - Map of profile ID to profile data.
 * @param showRefs - If true, include keyring URIs for each secret.
 * @returns Multi-line string ready for stdout.
 */
export function formatAuthList(
  profiles: AuthProfilesDocT["authProfiles"],
  showRefs = false
): string {
  const entries = Object.entries(profiles);
  if (entries.length === 0) {
    return "No auth profiles configured.\n\nAdd one with: myclaude auth add <id>";
  }

  const lines: string[] = [];
  lines.push(bold(`${"ID".padEnd(16)}${"DISPLAY NAME".padEnd(24)}${"MODE".padEnd(12)}SECRETS`));

  for (const [id, profile] of entries) {
    if (!profile) continue;
    const displayName = profile.displayName ?? "(no name)";
    const mode = profile.anthropic.mode;
    const secrets = Object.keys(profile.mcpSecretRefs);
    const secretsDisplay = secrets.length > 0 ? secrets.join(", ") : "(none)";
    lines.push(
      `${cyan(id.padEnd(16))}${displayName.padEnd(24)}${yellow(mode.padEnd(12))}${secretsDisplay}`
    );

    if (showRefs) {
      lines.push(`  ${dim("anthropic:")} ${dim(profile.anthropic.secretRef)}`);
      for (const [secretName, ref] of Object.entries(profile.mcpSecretRefs)) {
        lines.push(`  ${dim(`${secretName}:`)} ${dim(ref)}`);
      }
    }
  }

  return lines.join("\n");
}
