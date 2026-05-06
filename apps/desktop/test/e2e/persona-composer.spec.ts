/**
 * @file persona-composer.spec.ts
 *
 * Smoke coverage for the Phase 2 milestone 6 Persona Composer screen:
 *  - Sidebar nav switches to "Persona" and the screen renders.
 *  - persona.render fires once role + auth + cwd are non-empty; the catalog
 *    surfaces the combined CLAUDE.md plus per-category counts.
 *  - Clicking the combined CLAUDE.md entry shows the Monaco preview.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import electronExecutable from "electron";

const electronExecutablePath = electronExecutable as unknown as string;

test("persona composer renders the combined CLAUDE.md and per-category catalog", async () => {
  const launchEnv = { ...process.env };
  launchEnv.ELECTRON_RUN_AS_NODE = undefined;

  const root = await mkdtemp(join(tmpdir(), "agent-profile-persona-"));
  const myClaudeHome = join(root, "home", ".myclaude");
  const projectDir = join(root, "project");
  const appDir = join(root, "app");
  const socketPath = join(root, "myclaude.sock");

  // The persona library lives under the user's myclaude home; render path
  // resolution expects absolute paths in scope files.
  const personaDir = join(myClaudeHome, "persona", "global-roles", "backend");
  const claudeMdPath = join(personaDir, "CLAUDE.md");
  const agentDir = join(personaDir, "agents");
  const agentPath = join(agentDir, "api-designer.md");

  await mkdir(join(myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });
  await mkdir(agentDir, { recursive: true });

  await writeFile(claudeMdPath, "# Backend persona\n\nYou are working on the Acme backend.\n");
  await writeFile(agentPath, "# api-designer\n\nReview API contracts.\n");

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
`.trimStart()
  );
  await writeFile(
    join(myClaudeHome, "config", "global", "shared.yml"),
    "version: 1\nenv:\n  EDITOR: nvim\n"
  );
  await writeFile(
    join(myClaudeHome, "config", "global", "roles", "backend.yml"),
    `
version: 1
persona:
  claudeMd:
    - ${claudeMdPath}
  agents:
    - ${agentPath}
`.trimStart()
  );
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
    await page.getByTestId("sidebar-editor").click();
    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();

    // Persona now lives under Profile Workspace → Debug.
    await page.getByRole("button", { name: "Debug", exact: true }).click();
    await page.getByRole("button", { name: "Persona", exact: true }).click();

    // Once persona.render resolves, the catalog appears. Wait for the
    // combined-CLAUDE.md entry — it implies the cascade returned a non-null
    // claudeMd block (driven by the seeded backend persona ref).
    const catalog = page.getByTestId("persona-catalog");
    await expect(catalog).toBeVisible();
    const combined = page.getByTestId("persona-claudemd-combined");
    await expect(combined).toBeVisible();

    // Agents section reflects the seeded api-designer.md.
    await expect(page.getByTestId("persona-file-agents-api-designer.md")).toBeVisible();

    // Clicking the combined entry opens the preview pane.
    await combined.click();
    const preview = page.getByTestId("persona-preview");
    await expect(preview.getByRole("heading", { name: "CLAUDE.md (combined)" })).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
