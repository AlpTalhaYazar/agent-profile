import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, type Page } from "@playwright/test";
import electronExecutable from "electron";

const electronExecutablePath = electronExecutable as unknown as string;

export interface DesktopFixture {
  root: string;
  myClaudeHome: string;
  projectDir: string;
  appDir: string;
  socketPath: string;
  cleanup: () => Promise<void>;
}

export async function createDesktopFixture(prefix = "agent-profile-e2e-"): Promise<DesktopFixture> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const myClaudeHome = join(root, "home", ".myclaude");
  const projectDir = join(root, "project");
  const appDir = join(root, "app");
  const socketPath = join(root, "myclaude.sock");

  await mkdir(join(myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });
  expect(
    existsSync(electronExecutablePath),
    `missing Electron executable at ${electronExecutablePath}`
  ).toBe(true);
  await cp(join(process.cwd(), ".vite"), join(appDir, ".vite"), { recursive: true });
  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify({ name: "agent-profile-e2e", version: "0.0.1", main: ".vite/build/main.cjs" })
  );

  return {
    root,
    myClaudeHome,
    projectDir,
    appDir,
    socketPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function seedProfileFixture(fixture: DesktopFixture): Promise<{
  globalSharedPath: string;
}> {
  const globalSharedPath = join(fixture.myClaudeHome, "config", "global", "shared.yml");
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
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
  await writeFile(
    globalSharedPath,
    `
version: 1
env:
  EDITOR: nvim
settings:
  theme: dark
mcpServers:
  local:
    type: stdio
    command: node
    args:
      - server.js
`.trimStart()
  );
  await writeFile(
    join(fixture.myClaudeHome, "config", "global", "roles", "backend.yml"),
    "version: 1\n"
  );
  await writeFile(join(fixture.projectDir, ".myclaude", "roles", "backend.yml"), "version: 1\n");
  return { globalSharedPath };
}

export async function seedProfileCapabilityFixture(fixture: DesktopFixture): Promise<void> {
  await seedProfileFixture(fixture);
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
    [
      "version: 1",
      "authProfiles:",
      "  work:",
      "    displayName: Work",
      "    anthropic:",
      "      mode: apiKey",
      "      secretRef: keyring://anthropic/work",
      "    mcpSecretRefs:",
      "      github.pat: keyring://mcp/github",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.myClaudeHome, "config", "global", "shared.yml"),
    [
      "version: 1",
      "mcpServers:",
      "  github:",
      "    type: http",
      "    url: https://github.example/mcp",
      "    headers:",
      "      Authorization: Bearer ${secret:github.pat}",
      "  linear:",
      "    type: http",
      "    url: https://linear.example/mcp",
      "    headers:",
      "      Authorization: Bearer ${secret:linear.token}",
      "persona:",
      "  skills:",
      "    - skills/react/SKILL.md",
      "  agents:",
      "    - agents/reviewer.md",
      "",
    ].join("\n")
  );
}

export async function seedMissingToolSecretRepairFixture(
  fixture: DesktopFixture
): Promise<void> {
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
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
  await writeFile(
    join(fixture.myClaudeHome, "config", "global", "shared.yml"),
    `
version: 1
mcpServers:
  github:
    type: http
    url: https://github.example/mcp
    headers:
      Authorization: Bearer \${secret:github.pat}
`.trimStart()
  );
  await writeFile(
    join(fixture.myClaudeHome, "config", "global", "roles", "backend.yml"),
    "version: 1\n"
  );
  await writeFile(join(fixture.projectDir, ".myclaude", "roles", "backend.yml"), "version: 1\n");
}

export async function launchDesktop(fixture: DesktopFixture): Promise<{
  app: Awaited<ReturnType<typeof electron.launch>>;
  page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>["firstWindow"]>>;
}> {
  const launchEnv = { ...process.env };
  launchEnv.ELECTRON_RUN_AS_NODE = undefined;
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [fixture.appDir, `--user-data-dir=${join(fixture.root, "user-data")}`],
    cwd: fixture.projectDir,
    env: {
      ...launchEnv,
      MYCLAUDE_ALLOW_PLAINTEXT: "1",
      MYCLAUDE_E2E_PLAINTEXT_SECRETS: "1",
      MYCLAUDE_HOME: fixture.myClaudeHome,
      MYCLAUDE_SOCKET: fixture.socketPath,
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "1",
    },
  });
  return { app, page: await app.firstWindow() };
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function openAgentProfilesHome(page: Page): Promise<void> {
  await page.getByTestId("sidebar-home").click();
  await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
}

export async function openProfileWorkspace(page: Page): Promise<void> {
  await page.getByTestId("sidebar-editor").click();
  await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();
}
