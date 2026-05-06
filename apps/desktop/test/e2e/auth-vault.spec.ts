/**
 * @file auth-vault.spec.ts
 *
 * Smoke coverage for the Claude Auth identity-management screen:
 *  - Sidebar nav switches to "Claude Auth" and the screen renders identity-first.
 *  - Seeded auth profiles from authProfiles.yml are listed as Claude identities.
 *  - The "Connect Claude" dialog opens (the Main native key-entry step is
 *    deferred to a follow-up spec — covered manually for now).
 *  - The advanced tool-secret area preserves the secure Renderer modal path.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import electronExecutable from "electron";
import { type DesktopFixture, createDesktopFixture, launchDesktop, readText } from "./helpers.js";

const electronExecutablePath = electronExecutable as unknown as string;

test("claude auth manages identities and keeps tool secrets advanced", async () => {
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
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();

    // Switch to the Claude Auth screen from the shell sidebar.
    await page.getByTestId("sidebar-auth-vault").click();
    await expect(page.getByRole("heading", { name: "Claude identities" })).toBeVisible();
    await expect(
      page.getByText("Claude identities used by Agent Profiles launch and readiness")
    ).toBeVisible();

    // Seeded profiles appear in the list (the sidebar buttons each include
    // the id and a metadata sub-line). Strict-mode resolution requires us to
    // disambiguate against the header role select which also renders the
    // display name, so we anchor on the sidebar list specifically.
    const list = page.getByRole("button", { name: /work\s+Work \(Acme\)/ });
    await expect(list).toBeVisible();
    await expect(page.getByRole("button", { name: /personal\s+Personal/ })).toBeVisible();

    // "Connect Claude" dialog opens.
    await page.getByRole("button", { name: "Connect Claude", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Connect Claude identity" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Selected profile reveals Claude identity health and keeps tool secrets advanced.
    await page.getByRole("button", { name: /work\s+Work \(Acme\)/ }).click();
    await expect(page.getByTestId("claude-auth-identity-summary")).toBeVisible();
    await expect(page.getByRole("button", { name: /Rotate Claude key/ })).toBeVisible();
    const toolSupport = page.getByTestId("claude-auth-tool-secret-support");
    await expect(toolSupport).toBeVisible();
    await expect(toolSupport.getByText("Advanced tool secret support")).toBeVisible();
    await toolSupport.getByText("Advanced tool secret support").click();
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

test("profile Tools can repair a missing MCP logical secret through Auth without leaking values", async () => {
  const fixture = await createDesktopFixture("agent-profile-auth-repair-");
  await seedMissingToolSecretRepairFixture(fixture);
  const { app, page } = await launchDesktop(fixture);
  const rawSecretValue = "ghp_repairSECRET123";

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("home-readiness-warning")).toContainText(
      "1 tool secret needs attention"
    );
    await page.getByTestId("home-secondary-action").click();

    const tools = page.getByTestId("agent-profile-panel-tools");
    await expect(tools).toContainText("github.pat");
    await expect(tools).toContainText("Missing");
    await tools.getByTestId("agent-profile-tool-secret-repair-github-pat").click();

    await expect(page.getByRole("heading", { name: "Claude Auth" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Add secret to "work"/ })).toBeVisible();
    await expect(page.getByTestId("auth-secret-name-input")).toHaveValue("github.pat");
    await page.getByTestId("auth-secret-value-input").fill(rawSecretValue);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByRole("heading", { name: /Add secret to "work"/ })).toHaveCount(0, {
      timeout: 15_000,
    });
    const toolSupport = page.getByTestId("claude-auth-tool-secret-support");
    await toolSupport.getByText("Advanced tool secret support").click();
    await expect(toolSupport).toContainText("github.pat");
    await expect(toolSupport).toContainText("present");
    await expect(page.locator("body")).not.toContainText(rawSecretValue);
    await expect(page.locator("body")).not.toContainText("keyring://");
    await expect(page.locator("body")).not.toContainText("${secret:");

    await page.getByTestId("sidebar-home").click();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("home-readiness-warning")).toHaveCount(0);
    await expect(page.getByTestId("agent-profile-card")).toContainText("Ready to launch");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("home-readiness-warning")).toHaveCount(0);
    await expect(page.getByTestId("agent-profile-card")).toContainText("Ready to launch");

    const authProfiles = await readText(join(fixture.myClaudeHome, "config", "authProfiles.yml"));
    expect(authProfiles).toContain("github.pat");
    expect(authProfiles).not.toContain(rawSecretValue);
    const auditLog = await readText(join(fixture.myClaudeHome, "audit.log"));
    expect(auditLog).toContain("auth.setSecret");
    expect(auditLog).toContain("work.github.pat");
    expect(auditLog).not.toContain(rawSecretValue);
    expect(auditLog).not.toContain("keyring://");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("Auth tool-secret dialog blocks unsafe names, preserves cancellation, and reports write failure", async () => {
  const fixture = await createDesktopFixture("agent-profile-auth-repair-negative-");
  await seedMissingToolSecretRepairFixture(fixture);
  const { app, page } = await launchDesktop(fixture);
  const rejectedValue = "ghp_rejectedSECRET456";

  try {
    await page.getByTestId("sidebar-auth-vault").click();
    await expect(page.getByRole("heading", { name: "Claude Auth" })).toBeVisible();
    await page.getByRole("button", { name: /work\s+Work/ }).click();
    const toolSupport = page.getByTestId("claude-auth-tool-secret-support");
    await toolSupport.getByText("Advanced tool secret support").click();
    await page.getByRole("button", { name: "Add or update MCP secret" }).click();

    await page.getByTestId("auth-secret-name-input").fill("keyring://github/pat");
    await page.getByTestId("auth-secret-value-input").fill("ghp_shouldNotWrite");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Use a logical secret name such as github.pat")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Add secret to "work"/ })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: /Add secret to "work"/ })).toHaveCount(0);
    let authProfiles = await readText(join(fixture.myClaudeHome, "config", "authProfiles.yml"));
    expect(authProfiles).not.toContain("github.pat");
    expect(authProfiles).not.toContain("ghp_shouldNotWrite");

    await page.getByRole("button", { name: "Add or update MCP secret" }).click();
    await writeFile(
      join(fixture.myClaudeHome, "config", "authProfiles.yml"),
      "version: 1\nauthProfiles: {}\n"
    );

    await page.getByTestId("auth-secret-name-input").fill("github.pat");
    await page.getByTestId("auth-secret-value-input").fill(rejectedValue);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText(/auth profile "work" not found|Tool secret could not be saved/)
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /Add secret to "work"/ })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(rejectedValue);

    await page.getByRole("button", { name: "Cancel" }).click();
    authProfiles = await readText(join(fixture.myClaudeHome, "config", "authProfiles.yml"));
    expect(authProfiles).not.toContain("github.pat");
    expect(authProfiles).not.toContain(rejectedValue);
    const auditPath = join(fixture.myClaudeHome, "audit.log");
    const auditLog = existsSync(auditPath) ? await readText(auditPath) : "";
    expect(auditLog).not.toContain("auth.setSecret");
    expect(auditLog).not.toContain(rejectedValue);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

async function seedMissingToolSecretRepairFixture(fixture: DesktopFixture): Promise<void> {
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
