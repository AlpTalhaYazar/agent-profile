/**
 * @module output/format
 *
 * Human-readable formatters for effective config and provenance output.
 * All output uses consola + picocolors and respects NO_COLOR / CI / FORCE_COLOR.
 */
import type {
  EffectiveSessionConfig,
  McpServerProvenance,
  McpServerT,
  Provenance,
  ScopeName,
} from "@agent-profile/core";
import { bold, cyan, dim, magenta, yellow } from "./colors.js";

/**
 * Format an MCP server type for display.
 */
function formatServerType(server: McpServerT): string {
  if ("command" in server && server.command) return "stdio";
  if ("url" in server) return server.type ?? "http";
  return "unknown";
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
