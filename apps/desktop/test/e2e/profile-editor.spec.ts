import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import electronExecutable from "electron";
import { createDesktopFixture, launchDesktop, openProfileWorkspace, seedProfileFixture } from "./helpers.js";

const electronExecutablePath = electronExecutable as unknown as string;

test("profile editor saves a scope and reloads the effective preview", async () => {
  const launchEnv = { ...process.env };
  launchEnv.ELECTRON_RUN_AS_NODE = undefined;

  const root = await mkdtemp(join(tmpdir(), "agent-profile-e2e-"));
  const myClaudeHome = join(root, "home", ".myclaude");
  const projectDir = join(root, "project");
  const appDir = join(root, "app");
  const socketPath = join(root, "myclaude.sock");
  const globalSharedPath = join(myClaudeHome, "config", "global", "shared.yml");

  await mkdir(join(myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });

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
  await writeFile(
    globalSharedPath,
    `
version: 1
env:
  EDITOR: nvim
settings:
  theme: dark
`.trimStart()
  );
  await writeFile(
    join(myClaudeHome, "config", "global", "roles", "backend.yml"),
    `
version: 1
env:
  NODE_ENV: development
`.trimStart()
  );
  await writeFile(
    join(projectDir, ".myclaude", "roles", "backend.yml"),
    `
version: 1
env:
  PROJECT_DB_POOL: "20"
`.trimStart()
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
      MYCLAUDE_ALLOW_PLAINTEXT: "1",
      MYCLAUDE_E2E_PLAINTEXT_SECRETS: "1",
      MYCLAUDE_HOME: myClaudeHome,
      MYCLAUDE_SOCKET: socketPath,
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "1",
    },
  });

  try {
    const page = await app.firstWindow();
    await openProfileWorkspace(page);
    await expect(page.getByText("Ready to launch").first()).toBeVisible();
    await expect(page.getByText("0 MCP servers").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Working directory/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Role/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Claude credential/ })).toBeVisible();
    await page.getByRole("button", { name: /Role/ }).first().click();
    await expect(page.getByRole("button", { name: "New role/layer" }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage selected" }).last()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /MCP Servers/ }).click();
    await expect(page.getByRole("dialog", { name: "Add MCP server" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: /Skills & Persona/ }).click();
    await expect(page.getByRole("dialog", { name: "Add Skill" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Scope layers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "global-shared" })).toBeVisible();
    await expect(page.getByText("Effective preview")).toBeVisible();
    await expect(page.getByText("EDITOR", { exact: true })).toBeVisible();

    await page.getByPlaceholder("Value").first().fill("vim");
    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("No changes")).toBeVisible({ timeout: 10_000 });

    await expect.poll(async () => readFile(globalSharedPath, "utf8")).toContain("EDITOR: vim");

    await page.reload();
    await openProfileWorkspace(page);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.getByPlaceholder("Value").first()).toHaveValue("vim", { timeout: 10_000 });
    await expect(page.getByText("EDITOR", { exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("profile editor saves a backend role layer and reloads role-specific env values", async () => {
  const launchEnv = { ...process.env };
  launchEnv.ELECTRON_RUN_AS_NODE = undefined;

  const root = await mkdtemp(join(tmpdir(), "agent-profile-e2e-"));
  const myClaudeHome = join(root, "home", ".myclaude");
  const projectDir = join(root, "project");
  const appDir = join(root, "app");
  const socketPath = join(root, "myclaude.sock");
  const globalSharedPath = join(myClaudeHome, "config", "global", "shared.yml");
  const globalRolePath = join(myClaudeHome, "config", "global", "roles", "backend.yml");
  const projectRolePath = join(projectDir, ".myclaude", "roles", "backend.yml");

  await mkdir(join(myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });

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
  await writeFile(
    globalSharedPath,
    `
version: 1
env:
  EDITOR: nvim
settings:
  theme: dark
`.trimStart()
  );
  await writeFile(
    globalRolePath,
    `
version: 1
env:
  NODE_ENV: development
`.trimStart()
  );
  await writeFile(
    projectRolePath,
    `
version: 1
env:
  PROJECT_DB_POOL: "20"
`.trimStart()
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
      MYCLAUDE_ALLOW_PLAINTEXT: "1",
      MYCLAUDE_E2E_PLAINTEXT_SECRETS: "1",
      MYCLAUDE_HOME: myClaudeHome,
      MYCLAUDE_SOCKET: socketPath,
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "1",
    },
  });

  try {
    const page = await app.firstWindow();
    await openProfileWorkspace(page);

    await page.getByRole("button", { name: /Role/ }).first().click();
    await page.getByRole("button", { name: "backend", exact: true }).click();

    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Scope layers" })).toBeVisible();
    await page.locator("button").filter({ hasText: projectRolePath }).click();

    await expect(page.locator('input[value="PROJECT_DB_POOL"]')).toBeVisible();
    await page.getByRole("button", { name: "Add variable" }).click();
    await page.getByPlaceholder("KEY").last().fill("ROLE_LAYER_ONLY");
    await page.getByPlaceholder("Value").last().fill("backend-specific");

    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("No changes")).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => readFile(projectRolePath, "utf8"))
      .toContain("ROLE_LAYER_ONLY: backend-specific");
    await expect
      .poll(async () => readFile(globalSharedPath, "utf8"))
      .not.toContain("ROLE_LAYER_ONLY");
    await expect
      .poll(async () => readFile(globalRolePath, "utf8"))
      .not.toContain("ROLE_LAYER_ONLY");

    await page.reload();
    await openProfileWorkspace(page);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page.locator("button").filter({ hasText: projectRolePath }).click();
    await expect(page.locator('input[value="ROLE_LAYER_ONLY"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[value="backend-specific"]')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("working directory dropdown selects detected monorepo workspace candidates", async () => {
  const fixture = await createDesktopFixture("agent-profile-workspace-picker-");
  await seedProfileFixture(fixture);
  const repoDir = fixture.projectDir;
  const packageDir = join(repoDir, "apps", "web");
  await mkdir(join(packageDir, ".myclaude", "roles"), { recursive: true });
  await writeFile(join(repoDir, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
  await writeFile(join(packageDir, "package.json"), JSON.stringify({ name: "web" }));
  await writeFile(join(packageDir, ".myclaude", "roles", "backend.yml"), "version: 1\n");
  fixture.projectDir = packageDir;

  const { app, page } = await launchDesktop(fixture);
  try {
    await openProfileWorkspace(page);
    await page.getByRole("button", { name: /Working directory/ }).click();
    await expect(page.getByText("Detected workspaces")).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`Root.*${escapeRegex(repoDir)}`) }).click();
    await expect(page.getByRole("button", { name: /Working directory/ })).toContainText(repoDir);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
