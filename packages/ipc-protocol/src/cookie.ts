/**
 * @module @agent-profile/ipc-protocol/cookie
 *
 * Boot-cookie filesystem helpers.
 *
 * The cookie is a 32-byte random value regenerated on every daemon boot and
 * persisted to `<myClaudeHome>/ipc-cookie` (canonically `~/.myclaude/ipc-cookie`)
 * with mode `0600`. The CLI reads it on connect and sends it as the first
 * message of the handshake; the daemon compares against its in-memory copy.
 * See `docs/06-security.md` "IPC authentication" for the daemon IPC
 * rationale. This helper enforces the boot-cookie file layer; peer credential
 * enforcement is host-owned.
 *
 * Path-arg convention: every helper here takes the **myclaude dir itself**
 * (e.g. `/Users/x/.myclaude`), matching the project-wide `myClaudeHome()`
 * helper in `apps/cli`. Callers who only have the OS home should pre-join
 * `.myclaude` themselves.
 *
 * Security invariants enforced here:
 *
 *  - Parent dir is created with mode `0700`.
 *  - File is written atomically via a sibling temp file, then renamed over the
 *    final path so readers never observe a partial cookie.
 *  - Temp and final files are chmodded to `0600` because some platforms /
 *    `umask` configurations ignore the `mode` option on file writes.
 *  - {@link readCookie} refuses to return the value if the file mode is more
 *    permissive than `0600`. A relaxed mode is treated as a tampering signal.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Length in bytes of the random cookie material. */
const COOKIE_BYTES = 32;

/** File mode the cookie file MUST carry; readers reject anything more permissive. */
const COOKIE_FILE_MODE = 0o600;

/** Mode for the myclaude dir (`~/.myclaude/`); user-only access. */
const COOKIE_DIR_MODE = 0o700;

/** Just the low 9 mode bits (rwx for u/g/o); used to compare against fs.stat results. */
const MODE_PERM_MASK = 0o777;

/** Default myclaude dir when callers don't pass one. */
function defaultMyClaudeHome(): string {
  return join(homedir(), ".myclaude");
}

/**
 * Compute the absolute path to the cookie file for a given myclaude dir.
 *
 * @param myClaudeHome - The `.myclaude` directory; defaults to `~/.myclaude`.
 * @returns `<myClaudeHome>/ipc-cookie`.
 */
export function cookiePath(myClaudeHome: string = defaultMyClaudeHome()): string {
  return join(myClaudeHome, "ipc-cookie");
}

/**
 * Generate a fresh boot cookie and persist it atomically.
 *
 * Steps, in order:
 *
 *  1. `mkdir(myClaudeHome, recursive: true, mode: 0o700)` — ensures the
 *     directory exists with strict perms even on first run.
 *  2. `writeFile(tmpPath, cookie, mode: 0o600)` — writes the value to a
 *     sibling temp file.
 *  3. `chmod(tmpPath, 0o600)` — defensively clamps temp-file permissions.
 *  4. `rename(tmpPath, path)` — atomically replaces the final file.
 *  5. `chmod(path, 0o600)` — defensively re-applies the final mode.
 *
 * @param myClaudeHome - The `.myclaude` directory; defaults to `~/.myclaude`.
 * @returns The new cookie value (43-char base64url string, 32 random bytes).
 */
export async function writeBootCookie(
  myClaudeHome: string = defaultMyClaudeHome()
): Promise<string> {
  await mkdir(myClaudeHome, { recursive: true, mode: COOKIE_DIR_MODE });

  const path = cookiePath(myClaudeHome);
  const tmpPath = join(myClaudeHome, `ipc-cookie.tmp-${randomBytes(4).toString("hex")}`);
  const cookie = randomBytes(COOKIE_BYTES).toString("base64url");

  try {
    await writeFile(tmpPath, cookie, { mode: COOKIE_FILE_MODE, encoding: "utf8" });
    await chmod(tmpPath, COOKIE_FILE_MODE);
    await rename(tmpPath, path);
    await chmod(path, COOKIE_FILE_MODE);
  } catch (err) {
    await unlink(tmpPath).catch(() => {
      // Preserve the original write/chmod/rename error.
    });
    throw err;
  }

  return cookie;
}

/**
 * Read the current boot cookie.
 *
 * Throws if:
 *  - the file does not exist (`ENOENT`),
 *  - the file's mode bits include any beyond `0600` (security guard against
 *    tampering or accidental `chmod`).
 *
 * @param myClaudeHome - The `.myclaude` directory; defaults to `~/.myclaude`.
 * @returns The cookie value as stored on disk.
 * @throws {Error} On `ENOENT` or relaxed file mode.
 */
export async function readCookie(myClaudeHome: string = defaultMyClaudeHome()): Promise<string> {
  const path = cookiePath(myClaudeHome);
  const info = await stat(path);
  const perm = info.mode & MODE_PERM_MASK;
  if (perm !== COOKIE_FILE_MODE) {
    throw new Error(
      `ipc-protocol: cookie file ${path} has mode 0o${perm.toString(8)}; expected 0o600`
    );
  }
  return (await readFile(path, "utf8")).trim();
}
