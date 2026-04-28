/**
 * @module @agent-profile/ipc-protocol/socket-path
 *
 * Default socket-path discovery for the daemon ↔ CLI IPC channel.
 *
 * Resolution order (matches `docs/05-gui-spec.md` "Socket discovery"):
 *
 *  1. `MYCLAUDE_SOCKET` env var — explicit override; always wins.
 *  2. Windows: `\\.\pipe\myclaude-<sid-or-pid>`.
 *  3. POSIX with `XDG_RUNTIME_DIR`: `<XDG_RUNTIME_DIR>/myclaude.sock`.
 *  4. POSIX without: `/tmp/myclaude-<uid>.sock`.
 *
 * The function is pure-ish: it accepts an injected `env` and `platform` so
 * callers (and tests) can reproduce any host configuration without mutating
 * `process.env`. The default arguments read from the live `process` so the
 * common case is a zero-arg call.
 */

/**
 * Compute the default IPC socket path for the current host.
 *
 * @param env - Environment to read from. Defaults to `process.env`.
 * @param platform - Platform string. Defaults to `process.platform`.
 * @returns An absolute path (POSIX) or a Named-Pipe path string (Windows).
 */
export function defaultSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  // 1. Explicit override via env var. Always wins.
  const override = env.MYCLAUDE_SOCKET;
  if (typeof override === "string" && override.length > 0) {
    return override;
  }

  // 2. Windows uses Named Pipes; the SID is approximated by USERNAME so two
  //    users on the same machine end up with distinct pipes. We fall back to
  //    the current PID rather than an empty string when USERNAME is unset.
  if (platform === "win32") {
    const username = env.USERNAME;
    const suffix =
      typeof username === "string" && username.length > 0 ? username : String(process.pid);
    return `\\\\.\\pipe\\myclaude-${suffix}`;
  }

  // 3. POSIX preferred path: $XDG_RUNTIME_DIR/myclaude.sock. The runtime dir
  //    is always user-owned mode 0700 on systemd-based distros, which gives us
  //    free filesystem-permission isolation.
  const xdgRuntimeDir = env.XDG_RUNTIME_DIR;
  if (typeof xdgRuntimeDir === "string" && xdgRuntimeDir.length > 0) {
    return `${xdgRuntimeDir}/myclaude.sock`;
  }

  // 4. POSIX fallback: /tmp/myclaude-<uid>.sock. We use the effective UID when
  //    available (Linux/macOS) and fall back to PID when `geteuid` isn't
  //    available (e.g. Windows under WSL emulation, or test injection).
  const geteuid = typeof process.geteuid === "function" ? process.geteuid.bind(process) : null;
  const uid = geteuid ? geteuid() : process.pid;
  return `/tmp/myclaude-${uid}.sock`;
}
