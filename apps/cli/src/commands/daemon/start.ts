/**
 * @module commands/daemon/start
 *
 * `myclaude daemon start [--headless]`
 *
 * Spawns the Electron Main process detached, then polls `daemon status` for
 * up to 5 seconds. Surfaces an actionable error when the desktop app is not
 * built (the common case during CLI-only development).
 */
import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { CliError, EXIT_DAEMON_UNREACHABLE, EXIT_GENERIC } from "../../errors.js";
import { writeJson } from "../../output/json.js";
import { getTransport } from "../../transport/index.js";

/** Options for the `daemon start` command logic. */
export interface DaemonStartOptions {
  /** Skip Renderer creation; Main starts the daemon service only. */
  headless?: boolean;
  /** Emit structured JSON. */
  json?: boolean;
  /** Pretty-print JSON output. */
  pretty?: boolean;
  /** Override myclaude home directory (for tests). */
  home?: string;
  /** Inject a spawn function for tests. */
  spawnFn?: SpawnFn;
  /** Override the polling budget. Defaults to 5s. */
  pollTimeoutMs?: number;
  /** Override the polling interval. Defaults to 200ms. */
  pollIntervalMs?: number;
}

/**
 * Spawn signature compatible with `child_process.spawn`. Return `{ pid, unref }`
 * so tests can simulate detached spawn without needing a real `ChildProcess`.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions
) => Pick<ChildProcess, "pid" | "unref">;

/**
 * Core logic for `daemon start`. Returns once the daemon is reachable. Throws
 * `CliError` when the desktop app isn't built or the daemon never becomes
 * reachable within the polling window.
 */
export async function runDaemonStart(opts: DaemonStartOptions = {}): Promise<void> {
  const pretty = Boolean(opts.pretty);
  const json = Boolean(opts.json) || pretty;
  const headless = Boolean(opts.headless);
  const pollTimeoutMs = opts.pollTimeoutMs ?? 5000;
  const pollIntervalMs = opts.pollIntervalMs ?? 200;

  const resolved = resolveDesktopEntry();

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.MYCLAUDE_HEADLESS = headless ? "1" : "";
  // Pass the home override so the daemon writes the cookie/sessions there.
  if (opts.home !== undefined) env.MYCLAUDE_HOME = opts.home;

  const spawnFn: SpawnFn = opts.spawnFn ?? defaultSpawn;
  const child = spawnFn(resolved.electronBin, [resolved.mainEntry], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref?.();

  // Poll the daemon until it's reachable or we run out of budget.
  const deadline = Date.now() + pollTimeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    try {
      const transportOpts: Parameters<typeof getTransport>[0] = {
        requireDaemon: true,
        attemptTimeoutMs: pollIntervalMs,
      };
      if (opts.home !== undefined) transportOpts.home = opts.home;
      const transport = await getTransport(transportOpts);
      try {
        await transport.daemonStatus();
        if (json) {
          writeJson({ started: true, pid: child.pid ?? null, headless }, pretty);
          return;
        }
        const pid = child.pid ?? "?";
        process.stdout.write(`Daemon: started (pid ${pid})\n`);
        return;
      } finally {
        await transport.close();
      }
    } catch (err) {
      lastError = err;
      // Keep polling.
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");
  throw new CliError(
    `Daemon did not become reachable within ${pollTimeoutMs}ms.`,
    EXIT_DAEMON_UNREACHABLE,
    `Last error: ${reason}. Try running the desktop app directly: \`pnpm -C apps/desktop start\`.`
  );
}

/** `myclaude daemon start` command definition. */
export const daemonStartCommand = defineCommand({
  meta: {
    name: "start",
    description: "Launch the Electron Main daemon (use --headless to skip the GUI)",
  },
  args: {
    headless: {
      type: "boolean",
      description: "Start without a Renderer window (daemon-only)",
      default: false,
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
  },
  async run({ args }) {
    await runDaemonStart({
      headless: Boolean(args.headless),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    });
  },
});

interface ResolvedDesktopEntry {
  electronBin: string;
  mainEntry: string;
}

/**
 * Locate the workspace's Electron binary and the desktop app's `main` entry.
 *
 * Strategy:
 *  1. Walk up from the CLI's `dist/` directory to find the workspace root
 *     (the directory containing `pnpm-workspace.yaml`).
 *  2. Read `apps/desktop/package.json` to discover the `main` entry path.
 *  3. Resolve the Electron binary at `<workspace>/node_modules/.bin/electron`
 *     (pnpm hoists Electron to the desktop package's own `node_modules` in
 *     practice — we search both locations).
 *
 * If any step fails, throw an actionable `CliError` directing the user to
 * build the desktop app.
 */
function resolveDesktopEntry(): ResolvedDesktopEntry {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    throw new CliError(
      "Could not locate the workspace root from the CLI binary.",
      EXIT_GENERIC,
      "This usually means the CLI was installed outside the monorepo."
    );
  }

  const desktopPkgPath = join(workspaceRoot, "apps", "desktop", "package.json");
  if (!existsSync(desktopPkgPath)) {
    throw new CliError(
      "Desktop app not found in this workspace (apps/desktop missing).",
      EXIT_GENERIC,
      "The CLI cannot start the daemon without the desktop package."
    );
  }
  let desktopPkg: { main?: string };
  try {
    desktopPkg = JSON.parse(readFileSync(desktopPkgPath, "utf8")) as { main?: string };
  } catch (err) {
    throw new CliError(
      `Failed to parse apps/desktop/package.json: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_GENERIC
    );
  }
  if (typeof desktopPkg.main !== "string" || desktopPkg.main.length === 0) {
    throw new CliError(
      "apps/desktop/package.json has no `main` entry.",
      EXIT_GENERIC,
      "Run `pnpm -C apps/desktop package` to build the daemon entry point."
    );
  }

  const desktopRoot = join(workspaceRoot, "apps", "desktop");
  const mainEntry = join(desktopRoot, desktopPkg.main);
  if (!existsSync(mainEntry)) {
    throw new CliError(
      `Desktop app is not built (missing ${mainEntry}).`,
      EXIT_GENERIC,
      "Build it with `pnpm -C apps/desktop package`, or develop with `pnpm -C apps/desktop start`."
    );
  }

  const electronBin = findElectronBin(workspaceRoot, desktopRoot);
  if (!electronBin) {
    throw new CliError(
      "Could not find the Electron binary.",
      EXIT_GENERIC,
      "Run `pnpm install` from the workspace root, then retry."
    );
  }

  return { electronBin, mainEntry };
}

/** Walk up from this module to find the directory containing `pnpm-workspace.yaml`. */
function findWorkspaceRoot(): string | null {
  // import.meta.url points at .../apps/cli/dist/myclaude.js when bundled, or
  // at .../apps/cli/src/commands/daemon/start.ts during dev/test. Walk up.
  const here = fileURLToPath(import.meta.url);
  let dir = dirname(here);
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Locate the Electron binary across the workspace's possible install locations. */
function findElectronBin(workspaceRoot: string, desktopRoot: string): string | null {
  const platformBin = process.platform === "win32" ? "electron.cmd" : "electron";
  const candidates = [
    join(desktopRoot, "node_modules", ".bin", platformBin),
    join(workspaceRoot, "node_modules", ".bin", platformBin),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Default child_process.spawn wrapper that returns the subset our SpawnFn type advertises. */
function defaultSpawn(
  command: string,
  args: readonly string[],
  options?: SpawnOptions
): ChildProcess {
  return spawn(command, args as string[], options ?? {});
}

/** Small async sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
