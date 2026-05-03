/**
 * @file auth-vault.spec.ts
 *
 * Smoke coverage for the Phase 2 milestone 5 Auth Vault screen:
 *  - Sidebar nav switches to "Auth Vault" and the screen renders.
 *  - Seeded auth profiles from authProfiles.yml are listed.
 *  - The "Add profile" dialog opens (the Main native key-entry step is
 *    deferred to a follow-up spec — covered manually for now).
 *  - The "Add secret" Renderer modal opens and shows the masked input toggle.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import electronExecutable from "electron";

const electronExecutablePath = electronExecutable as unknown as string;

test("auth vault tab lists seeded profiles and opens form dialogs", async () => {
  const launchEnv = { ...process.env };
  launchEnv.ELECTRON_RUN_AS_NODE = undefined;

  const root = await mkdtemp(join(tmpdir(), "agent-profile-authvault-"));
  const myClaudeHome = join(root, "home", ".myclaude");
  const projectDir = join(root, "project");
  const appDir = join(root, "app");
  const socketPath = join(root, "myclaude.sock");

  await mkdir(join(myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });

  await writeFile(
    join(myClaudeHome, "config", "authProfiles.yml"),
    `
version: 1
authProfiles:
  work:
    displayName: Work (Acme)
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs: {}
  personal:
    displayName: Personal
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/personal
    mcpSecretRefs: {}
`.trimStart()
  );
  await writeFile(
    join(myClaudeHome, "config", "global", "shared.yml"),
    `
version: 1
env:
  EDITOR: nvim
`.trimStart()
  );
  await writeFile(join(myClaudeHome, "config", "global", "roles", "backend.yml"), "version: 1\n");
  await writeFile(join(projectDir, ".myclaude", "roles", "backend.yml"), "version: 1\n");

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
    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();

    // Switch to the Claude Auth screen from the shell sidebar.
    await page.getByTestId("sidebar-auth-vault").click();
    await expect(page.getByRole("heading", { name: "Claude credentials" })).toBeVisible();

    // Seeded profiles appear in the list (the sidebar buttons each include
    // the id and a metadata sub-line). Strict-mode resolution requires us to
    // disambiguate against the header role select which also renders the
    // display name, so we anchor on the sidebar list specifically.
    const list = page.getByRole("button", { name: /work\s+Work \(Acme\)/ });
    await expect(list).toBeVisible();
    await expect(page.getByRole("button", { name: /personal\s+Personal/ })).toBeVisible();

    // "Connect Claude" dialog opens.
    await page.getByRole("button", { name: "Connect Claude", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Connect Claude credential" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Selected profile reveals Claude credential and MCP secret actions.
    await page.getByRole("button", { name: /work\s+Work \(Acme\)/ }).click();
    await expect(page.getByRole("button", { name: /Rotate Claude key/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add or update MCP secret" })).toBeVisible();
    await page.getByRole("button", { name: "Add or update MCP secret" }).click();
    await expect(page.getByRole("heading", { name: /Add secret to "work"/ })).toBeVisible();
    // Masked input → Show toggle is visible.
    await expect(page.getByRole("button", { name: "Show" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
