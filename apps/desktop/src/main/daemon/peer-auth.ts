/**
 * @module daemon/peer-auth
 *
 * Defense-in-depth peer-verification hook for the IPC daemon.
 *
 * ## Threat model recap
 *
 * `docs/06-security.md` "IPC authentication" originally specified a triple-gate:
 *
 *   1. **Filesystem permissions.** UDS path is `0600` and lives under either
 *      `$XDG_RUNTIME_DIR` (user-only `0700`) or `/tmp/myclaude-<uid>.sock`
 *      with `chmod 0600` from `DaemonServer.start`.
 *   2. **`euid` peer check.** The peer's effective uid should equal the daemon's.
 *   3. **Boot cookie.** A 32-byte random value rotated on every boot.
 *
 * Layers (1) and (3) are the controls enforced today: a same-user attacker
 * would have to read a `0600` file to forge the cookie, and a different-user
 * attacker should be blocked by owner-only filesystem permissions on POSIX.
 *
 * Layer (2) — the peer-uid check — is **not** implemented yet. Node does not
 * expose `SO_PEERCRED` (Linux) or `LOCAL_PEEREID` (macOS) on `net.Socket`;
 * implementing it would require either a native addon or a child-process
 * shell-out (e.g. `lsof`/`procfs`) that is unreliable across platforms.
 *
 * ## Current stance
 *
 * {@link verifyPeer} is wired into `DaemonServer` before handshake data is read,
 * but it remains a documented no-op pass-through until a native peer-credential
 * binding exists. The current enforced controls are filesystem permissions plus
 * the boot cookie.
 *
 * Tracked in `docs/09-open-questions.md`: build a tiny native addon once an
 * integration sprint needs OS peer-credential enforcement. Shell-out based peer
 * lookup is deliberately out of scope.
 *
 * On **Windows**, Node's `net.createServer` listening on a `\\.\pipe\...` path
 * does NOT automatically restrict the pipe DACL to the current user's SID.
 * The default DACL is "anyone". Hardening Windows requires creating the pipe
 * with the explicit DACL via the Win32 `CreateNamedPipeW` API — same scope as
 * the POSIX `SO_PEERCRED` work and tracked alongside it.
 */

import type * as net from "node:net";
import type { PeerVerificationResult } from "@agent-profile/ipc-protocol";

/** Result returned from {@link verifyPeer}. */
export type VerifyPeerResult = PeerVerificationResult;

/**
 * Pass-through peer verification.
 *
 * **TODO(peer-auth hardening)** — implement `SO_PEERCRED` (Linux),
 * `LOCAL_PEEREID` (macOS), and an explicit named-pipe DACL check on Windows
 * through native bindings. Until then, returns `{ ok: true }` and logs a
 * one-shot warning per process.
 *
 * `DaemonServer` treats any `{ ok: false }` as grounds to destroy the socket
 * before handshake data is processed. Today none ever fires; the function
 * exists so the integration point is ready when the native addon lands.
 *
 * @param _socket - The newly-accepted peer socket. Currently unused.
 * @returns Always `{ ok: true }` until native peer credentials are implemented.
 */
export function verifyPeer(_socket: net.Socket): VerifyPeerResult {
  warnPeerVerificationOnce();
  return { ok: true };
}

let warned = false;
function warnPeerVerificationOnce(): void {
  if (warned) return;
  warned = true;
  // Use stderr so the warning surfaces in the dev terminal but doesn't pollute
  // stdout (Forge captures both, but tooling parses stdout).
  process.stderr.write(
    "[agent-profile/desktop] peer-credential check is a pass-through in Phase 2; relying on filesystem permissions + boot cookie. See src/main/daemon/peer-auth.ts.\n"
  );
}
