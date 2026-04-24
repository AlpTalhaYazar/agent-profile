/**
 * Helper wrapper generation for Claude Code runtime artifacts.
 */

/** Default helper executable used by generated wrapper scripts. */
export const DEFAULT_HELPER_EXECUTABLE = "myclaude-helper";

const SAFE_COMMAND_RE = /^[A-Za-z0-9_./:-]+$/;

/**
 * Shell-quote one argument for POSIX `sh`.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Render a command token for POSIX `sh`.
 *
 * Common executable names stay readable, while paths containing whitespace or
 * shell metacharacters are quoted.
 */
export function shellCommand(value: string): string {
  return SAFE_COMMAND_RE.test(value) ? value : shellQuote(value);
}

/**
 * Build the POSIX shell wrapper used by Claude Code to fetch the Anthropic key.
 */
export function apiKeyHelperScript(helperExecutable: string): string {
  return [
    "#!/bin/sh",
    `exec ${shellCommand(helperExecutable)} anthropic "$MYCLAUDE_SESSION_ID" "$MYCLAUDE_CAPABILITY_TOKEN"`,
    "",
  ].join("\n");
}

/**
 * Build the POSIX shell wrapper used by Claude Code to fetch remote MCP headers.
 */
export function headersHelperScript(helperExecutable: string): string {
  return [
    "#!/bin/sh",
    `exec ${shellCommand(helperExecutable)} mcp-headers "$MYCLAUDE_SESSION_ID" "$MYCLAUDE_CAPABILITY_TOKEN" "$1"`,
    "",
  ].join("\n");
}
