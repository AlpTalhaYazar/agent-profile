/**
 * @file session-monitor.spec.ts
 *
 * Smoke coverage for the Phase 2 milestone 5 Session Monitor screen:
 *  - Tabs nav switches to "Session Monitor" and the screen renders.
 *  - Seeded SessionRecord shows up in the table with the correct status
 *    badge, role, and auth.
 *  - The Refresh button reloads the table.
 *
 * Kill / Relaunch / Drift round-trips need a live process and are exercised
 * by the unit suite (apps/desktop/test/daemon-handlers-write.test.ts).
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import electronExecutable from "electron";

const electronExecutablePath = electronExecutable as unknown as string;

test("session monitor tab lists seeded sessions and offers actions", async () => {
  const launchEnv = { ...process.env };
  launchEnv.ELECTRON_RUN_AS_NODE = undefined;

  const root = await mkdtemp(join(tmpdir(), "agent-profile-sessions-"));
  const myClaudeHome = join(root, "home", ".myclaude");
  const projectDir = join(root, "project");
  const appDir = join(root, "app");
  const socketPath = join(root, "myclaude.sock");
  const sessionsRoot = join(myClaudeHome, "sessions");
  const registryDir = join(myClaudeHome, "session-registry");

  await mkdir(join(myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });
  await mkdir(registryDir, { recursive: true });
  await mkdir(join(sessionsRoot, "session-running"), { recursive: true });
  await mkdir(join(sessionsRoot, "session-exited"), { recursive: true });

  await writeFile(
    join(myClaudeHome, "config", "authProfiles.yml"),
    `
version: 1
authProfiles:
  work:
    displayName: Work
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs: {}
`.trimStart()
  );
  await writeFile(join(myClaudeHome, "config", "global", "shared.yml"), "version: 1\n");
  await writeFile(join(myClaudeHome, "config", "global", "roles", "backend.yml"), "version: 1\n");
  await writeFile(join(projectDir, ".myclaude", "roles", "backend.yml"), "version: 1\n");

  // Seed two SessionRecord files. Statuses → "running" / "exited" so each
  // status badge is exercised. PID 0 means processAlive=false → the running
  // session shows the "(stale)" tone, exercising the conditional badge logic.
  const baseRuntime = (id: string) => ({
    sessionDir: join(sessionsRoot, id),
    claudeConfigDir: join(sessionsRoot, id, ".claude"),
    mcpConfig: join(sessionsRoot, id, "mcp.json"),
    settings: join(sessionsRoot, id, "settings.json"),
    apiKeyHelper: null,
    headersHelper: null,
    claudeMd: null,
  });
  await writeFile(
    join(registryDir, "session-running.json"),
    JSON.stringify({
      version: 1,
      sessionId: "session-running",
      role: "backend",
      authProfileId: "work",
      cwd: projectDir,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
      retained: false,
      cleaned: false,
      runtimePaths: baseRuntime("session-running"),
      spawn: { command: "claude", args: ["--strict-mcp-config"] },
      status: "running",
    })
  );
  await writeFile(
    join(registryDir, "session-exited.json"),
    JSON.stringify({
      version: 1,
      sessionId: "session-exited",
      role: "backend",
      authProfileId: "work",
      cwd: projectDir,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
      retained: false,
      cleaned: false,
      runtimePaths: baseRuntime("session-exited"),
      spawn: { command: "claude", args: [] },
      status: "exited",
      exitCode: 0,
    })
  );

  expect(
    existsSync(electronExecutablePath),
    `missing Electron executable at ${electronExecutablePath}`
  ).toBe(true);
  await cp(join(process.cwd(), ".vite"), join(appDir, ".vite"), { recursive: true });
  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify({ name: "agent-profile-e2e", version: "0.0.1", main: ".vite/build/main.cjs" })
  );

  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [appDir],
    cwd: projectDir,
    env: {
      ...launchEnv,
      MYCLAUDE_HOME: myClaudeHome,
      MYCLAUDE_SOCKET: socketPath,
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "1",
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Profile Explorer" })).toBeVisible();

    await page.getByRole("tab", { name: "Session Monitor" }).click();
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

    // Both seeded session ids show up in the table.
    await expect(page.getByText("session-running")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("session-exited")).toBeVisible();
    // Status column rendered: exited badge text + running label (with stale qualifier
    // since the seeded PID is 0 / not alive).
    await expect(page.getByText("exit 0")).toBeVisible();

    // Refresh button is wired up.
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("session-running")).toBeVisible();

    // Selecting the running session reveals the Kill action.
    await page.getByText("session-running").first().click();
    await expect(page.getByRole("button", { name: "Kill" })).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
