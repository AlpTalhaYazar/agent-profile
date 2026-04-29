/**
 * @module commands/render-persona
 *
 * `myclaude render persona [--role <r>] [--auth <a>] [--json] [--pretty]`
 *
 * Renders the persona section in memory for a `(role, auth, cwd)` triple
 * via the milestone 6 `persona.render` IPC kind. Disk is never written —
 * this is a preview-only path that mirrors what `myclaude launch` would
 * deploy.
 *
 * Goes through the daemon when one is running and falls back to the
 * in-process transport otherwise (the standalone path calls
 * `personaRenderService` directly from `@agent-profile/cli-services`).
 */
import type { PersonaRenderResult } from "@agent-profile/cli-services";
import { defineCommand } from "citty";
import { NO_ROLE_HELP, resolveActivation } from "../activation/resolve.js";
import { CliError, EXIT_GENERIC } from "../errors.js";
import { writeJson } from "../output/json.js";
import { getTransport } from "../transport/index.js";
import { myClaudeHome } from "../utils/paths.js";

/** Options for {@link runRenderPersona}. */
export interface RunRenderPersonaOptions {
  role?: string;
  auth?: string;
  home?: string;
  cwd?: string;
  json?: boolean;
  pretty?: boolean;
}

/**
 * Resolve activation, call the persona render transport, and emit text or
 * JSON output. Throws `CliError` with the matching exit code on failure.
 */
export async function runRenderPersona(
  opts: RunRenderPersonaOptions
): Promise<PersonaRenderResult> {
  const activationInput: Parameters<typeof resolveActivation>[0] = {};
  if (opts.role !== undefined) activationInput.flagRole = opts.role;
  if (opts.auth !== undefined) activationInput.flagAuth = opts.auth;
  if (opts.cwd !== undefined) activationInput.cwd = opts.cwd;
  if (opts.home !== undefined) activationInput.home = opts.home;
  const activation = resolveActivation(activationInput);

  if (!activation.role) {
    throw new CliError(NO_ROLE_HELP, EXIT_GENERIC);
  }

  const authProfileId = activation.auth ?? opts.auth;
  if (!authProfileId) {
    throw new CliError(
      "An auth profile is required for persona render. Pass --auth <id> or set one via `myclaude use <role> --auth <id>`.",
      EXIT_GENERIC
    );
  }

  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? myClaudeHome();
  const jsonMode = Boolean(opts.json) || Boolean(opts.pretty);

  const transportOpts: Parameters<typeof getTransport>[0] = {};
  if (opts.home !== undefined) transportOpts.home = opts.home;
  const transport = await getTransport(transportOpts);

  let result: PersonaRenderResult;
  try {
    result = await transport.personaRender({
      role: activation.role,
      authProfileId,
      cwd,
      home,
    });
  } finally {
    await transport.close();
  }

  if (jsonMode) {
    writeJson(result, Boolean(opts.pretty));
  } else {
    process.stdout.write(formatPersonaRender(result, activation.role, authProfileId));
  }

  return result;
}

/**
 * Format a `PersonaRenderResult` as a human-readable tree.
 */
function formatPersonaRender(result: PersonaRenderResult, role: string, auth: string): string {
  const lines: string[] = [];
  lines.push(`Persona render: role=${role} auth=${auth}`);
  lines.push("");

  if (result.claudeMd === null) {
    lines.push("CLAUDE.md: (no sources)");
  } else {
    const len = result.claudeMd.combinedContent.length;
    lines.push(`CLAUDE.md (combined): ${len} chars, ${result.claudeMd.sections.length} section(s)`);
    result.claudeMd.sections.forEach((section, idx) => {
      lines.push(`  ${idx + 1}. ${section.originScope}`);
      lines.push(`     ${section.sourcePath}`);
    });
  }
  lines.push("");

  for (const category of ["agents", "skills", "slashCmds", "memory"] as const) {
    const files = result.files.filter((f) => f.category === category);
    lines.push(`${labelFor(category)} (${files.length}):`);
    for (const file of files) {
      lines.push(`  ${file.basename}  (origin: ${file.originScope})`);
      lines.push(`    ${file.sourcePath}`);
    }
    lines.push("");
  }

  if (result.collisions.length > 0) {
    lines.push(`[Collisions: ${result.collisions.length}]`);
    for (const collision of result.collisions) {
      const cat = collision.category === "commands" ? "slashCmds" : collision.category;
      lines.push(
        `  ${cat}/${collision.target}: winner=${collision.winningSource}, overrode=${collision.overriddenSource}`
      );
    }
    lines.push("");
  }

  if (result.missingSources.length > 0) {
    lines.push(`[Missing sources: ${result.missingSources.length}]`);
    for (const entry of result.missingSources) {
      const cat = entry.category === "commands" ? "slashCmds" : entry.category;
      lines.push(`  ${cat}: ${entry.sourcePath}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function labelFor(category: "agents" | "skills" | "slashCmds" | "memory"): string {
  switch (category) {
    case "agents":
      return "Agents";
    case "skills":
      return "Skills";
    case "slashCmds":
      return "Slash commands";
    case "memory":
      return "Memory seeds";
  }
}

/** Citty `myclaude render persona` subcommand. */
export const renderPersonaCommand = defineCommand({
  meta: {
    name: "persona",
    description:
      "Render the persona section (CLAUDE.md + agents/skills/slashCmds/memory) in memory; disk is not written",
  },
  args: {
    role: {
      type: "string",
      description: "Role name (or resolved from activation state)",
      alias: "r",
    },
    auth: {
      type: "string",
      description: "Auth profile ID",
      alias: "a",
    },
    json: {
      type: "boolean",
      description: "Emit structured JSON to stdout",
      alias: "j",
      default: false,
    },
    pretty: {
      type: "boolean",
      description: "Pretty-print JSON output (implies --json)",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
    cwd: {
      type: "string",
      description: "Override working directory (for testing)",
    },
  },
  async run({ args }) {
    const opts: RunRenderPersonaOptions = {
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    };
    if (args.role !== undefined) opts.role = String(args.role);
    if (args.auth !== undefined) opts.auth = String(args.auth);
    if (args.home !== undefined) opts.home = String(args.home);
    if (args.cwd !== undefined) opts.cwd = String(args.cwd);
    await runRenderPersona(opts);
  },
});
