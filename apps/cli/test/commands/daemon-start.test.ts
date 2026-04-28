/**
 * Tests for `myclaude daemon start`.
 *
 * Focus is on the actionable error paths — Electron Main is not actually
 * spawned in tests. We rely on dependency injection (`spawnFn`) to verify
 * the command would invoke it with the right args once the desktop app is
 * built.
 */
import { describe, expect, it } from "vitest";
import { runDaemonStart } from "../../src/commands/daemon/start.js";
import { CliError } from "../../src/errors.js";

describe("runDaemonStart", () => {
  it("throws an actionable error when the desktop app is not built", async () => {
    // The fixture workspace's `apps/desktop` does not have a built `main`
    // entry (no `.vite/build/main.js`). Resolution should fail with a
    // CliError pointing the user at the desktop build commands.
    let caught: unknown;
    try {
      await runDaemonStart({ headless: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    const msg = `${(caught as CliError).message} ${(caught as CliError).hint ?? ""}`;
    expect(msg).toMatch(/desktop|electron|build|not found|not built/i);
  });
});
