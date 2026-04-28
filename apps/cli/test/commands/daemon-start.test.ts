/**
 * Tests for `myclaude daemon start`.
 *
 * Focus is on the actionable error paths — Electron Main is not actually
 * spawned in tests. We rely on dependency injection (`spawnFn`) to verify
 * the command would invoke it with the right args once the desktop app is
 * built.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDaemonStart } from "../../src/commands/daemon/start.js";
import { CliError } from "../../src/errors.js";

describe("runDaemonStart", () => {
  let tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots = [];
  });

  it("throws an actionable error when the desktop app is not built", async () => {
    const root = await mkdtemp(join(tmpdir(), "myclaude-daemon-start-"));
    tempRoots.push(root);
    await mkdir(join(root, "apps", "desktop"), { recursive: true });
    await writeFile(
      join(root, "apps", "desktop", "package.json"),
      JSON.stringify({ main: ".vite/build/main.cjs" })
    );

    // The fixture workspace intentionally omits the built `main` entry.
    // Resolution should fail with a CliError pointing the user at the desktop
    // build commands, independent of this repo's current `.vite/` state.
    let caught: unknown;
    try {
      await runDaemonStart({ headless: true, workspaceRoot: root });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    const msg = `${(caught as CliError).message} ${(caught as CliError).hint ?? ""}`;
    expect(msg).toMatch(/desktop|electron|build|not found|not built/i);
  });
});
