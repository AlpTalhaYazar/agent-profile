import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import electronExecutable from "electron";

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
      MYCLAUDE_HOME: myClaudeHome,
      MYCLAUDE_SOCKET: socketPath,
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "1",
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Profile Explorer" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "global-shared" })).toBeVisible();
    await expect(page.getByText("Effective preview")).toBeVisible();
    await expect(page.getByText("EDITOR", { exact: true })).toBeVisible();

    await page.getByPlaceholder("Value").first().fill("vim");
    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("No changes")).toBeVisible({ timeout: 10_000 });

    await expect.poll(async () => readFile(globalSharedPath, "utf8")).toContain("EDITOR: vim");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Profile Explorer" })).toBeVisible();
    await expect(page.getByPlaceholder("Value").first()).toHaveValue("vim", { timeout: 10_000 });
    await expect(page.getByText("EDITOR", { exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
