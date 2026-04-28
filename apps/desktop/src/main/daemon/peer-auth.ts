/**
 * @module daemon/peer-auth
 *
 * Defense-in-depth peer-credential checks for the IPC daemon.
 *
 * ## Threat model recap
 *
 * `docs/06-security.md` "IPC authentication" specifies a triple-gate:
 *
 *   1. **Filesystem permissions.** UDS path is `0600` and lives under either
 *      `$XDG_RUNTIME_DIR` (user-only `0700`) or `/tmp/myclaude-<uid>.sock`
 *      with `chmod 0600` from `DaemonServer.start`.
 *   2. **`euid` peer check.** The peer's effective uid must equal the daemon's.
 *   3. **Boot cookie.** A 32-byte random value rotated on every boot.
 *
 * Layers (1) and (3) are airtight: a same-user attacker would have to read a
 * `0600` file to forge the cookie (which means they already have the user's
 * shell), and a different-user attacker cannot even open the socket file.
 *
 * Layer (2) — the peer-uid check — is **not** implemented yet. Node does not
 * expose `SO_PEERCRED` (Linux) or `LOCAL_PEEREID` (macOS) on `net.Socket`;
 * implementing it would require either a native addon or a child-process
 * shell-out (e.g. `lsof`/`procfs`) that is unreliable across platforms.
 *
 * ## Stance for ST-E (Phase 2 Foundation)
 *
 * For this sprint, {@link verifyPeer} is a documented no-op pass-through. The
 * filesystem-permission gate plus the boot cookie are sufficient for the
 * same-user threat model the daemon defends against.
 *
 * Tracked in `docs/09-open-questions.md`-style follow-up: build a tiny native
 * addon (or shell-out behind a feature flag) once an integration sprint
 * needs the third layer. See `verifyPeer` JSDoc below for the exact scope.
 *
 * On **Windows**, Node's `net.createServer` listening on a `\\.\pipe\...` path
 * does NOT automatically restrict the pipe DACL to the current user's SID.
 * The default DACL is "anyone". Hardening Windows requires creating the pipe
 * with the explicit DACL via the Win32 `CreateNamedPipeW` API — same scope as
 * the POSIX `SO_PEERCRED` work and tracked alongside it.
 */

import type * as net from "node:net";

/** Result returned from {@link verifyPeer}. */
export type VerifyPeerResult =
  | {
      ok: true;
      /** The peer's effective uid, when available. Currently always `undefined`. */
      uid?: number | undefined;
      /** The peer's process id, when available. Currently always `undefined`. */
      pid?: number | undefined;
      /** Optional session id, reserved for future use. */
      sid?: string | undefined;
    }
  | {
      ok: false;
      /** Free-form reason; surfaced in the daemon log but never to the wire. */
      reason: string;
    };

/**
 * Pass-through peer verification.
 *
 * **TODO(Phase 2 Wave 3)** — wire `SO_PEERCRED` (Linux), `LOCAL_PEEREID`
 * (macOS), and an explicit named-pipe DACL check on Windows. Until then,
 * returns `{ ok: true }` and logs a one-shot warning per process.
 *
 * Callers in {@link DaemonServer.handlers} can treat any `{ ok: false }` as
 * grounds to destroy the socket. Today none ever fires; the function exists
 * so the integration point is ready when the native addon lands.
 *
 * @param _socket - The newly-accepted peer socket. Currently unused.
 * @returns Always `{ ok: true }` in Phase 2.
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
