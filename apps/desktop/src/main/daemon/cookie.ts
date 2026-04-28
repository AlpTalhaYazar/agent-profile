/**
 * @module daemon/cookie
 *
 * Thin wrapper around `@agent-profile/ipc-protocol`'s {@link writeBootCookie}.
 *
 * The boot cookie is rotated every time the daemon starts (per
 * `docs/06-security.md`'s "IPC authentication" triple-gate). The wrapper
 * resolves the canonical myclaude dir (`$MYCLAUDE_HOME` if set, else
 * `~/.myclaude`) so test runs and dev environments stay consistent with the
 * CLI's `myClaudeHome()` resolution.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { writeBootCookie } from "@agent-profile/ipc-protocol";

/** Resolve the myclaude dir using the same precedence the CLI uses. */
function myClaudeHome(): string {
  return process.env.MYCLAUDE_HOME ?? join(homedir(), ".myclaude");
}

/**
 * Generate and persist a fresh boot cookie at `<myClaudeHome>/ipc-cookie`.
 *
 * @returns The new cookie value (43-char base64url string).
 */
export async function rotateBootCookie(): Promise<string> {
  return writeBootCookie(myClaudeHome());
}
