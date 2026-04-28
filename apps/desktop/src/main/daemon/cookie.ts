/**
 * @module daemon/cookie
 *
 * Thin wrapper around `@agent-profile/ipc-protocol`'s {@link writeBootCookie}.
 *
 * The boot cookie is rotated every time the daemon starts (per
 * `docs/06-security.md`'s "IPC authentication" triple-gate). The wrapper
 * exists so the lifecycle code does not have to import `os.homedir()` itself
 * and so a future change (e.g. honouring `MYCLAUDE_HOME` for tests) only
 * needs to touch one file.
 */
import { homedir } from "node:os";
import { writeBootCookie } from "@agent-profile/ipc-protocol";

/**
 * Generate and persist a fresh boot cookie at `~/.myclaude/ipc-cookie`.
 *
 * @returns The new cookie value (43-char base64url string).
 */
export async function rotateBootCookie(): Promise<string> {
  return writeBootCookie(homedir());
}
