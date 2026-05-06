import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Locator, expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  openAgentProfilesHome,
  openProfileWorkspace,
  seedProfileFixture,
} from "./helpers.js";

const defaultSurfaceForbiddenText = [
  /\.myclaude/i,
  /project-role/i,
  /global-role/i,
  /project-shared/i,
  /global-shared/i,
  /keyring:\/\//i,
  /\$\{secret:/i,
  /Bearer\s+\S+/i,
  /secretRef/i,
  /Authorization/i,
  /OAuth/i,
  /authProfiles\.yml/i,
  /Schema error/i,
  /Failed to parse/i,
];

test("agent profiles home is the default profile-first surface", async () => {
  const fixture = await createDesktopFixture();
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("sidebar-home")).toHaveAttribute("aria-current", "page");

    const card = page.getByTestId("agent-profile-card");
    const library = page.getByTestId("agent-profile-library");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Backend Agent");
    await expect(card).toContainText("Ready to launch");
    await expect(card).toContainText("Work");
    await expect(card).toContainText("1 MCP server");
    await expect(card).toContainText("0 skill/persona assets");
    await expect(page.getByTestId("home-launch-button")).toBeEnabled();
    await expect(page.getByTestId("profile-basics-open")).toBeVisible();
    await expect(page.getByTestId("profile-basics-open")).toBeEnabled();
    await page.getByTestId("profile-basics-open").click();
    await expect(page.getByTestId("profile-basics-panel")).toBeVisible();
    await expect(page.getByTestId("profile-basics-display-name")).toBeFocused();
    await expect(page.getByTestId("profile-basics-panel")).toContainText("Guided Basics");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("profile-basics-panel")).toHaveCount(0);
    await expect(page.getByTestId("profile-basics-open")).toBeFocused();
    await expect(library).toBeVisible();
    await expect(library.getByTestId("agent-profile-library-item")).toHaveCount(1);
    await expect(library).toContainText("Backend Agent");
    await expect(library.getByTestId("agent-profile-library-selected")).toHaveCount(1);

    await expect(page.getByText("Provenance")).toHaveCount(0);
    await expect(page.getByText("Effective preview")).toHaveCount(0);
    await expect(page.getByText("keyring://")).toHaveCount(0);
    await expect(page.getByText("project-role")).toHaveCount(0);
    await expect(page.getByText(".myclaude")).toHaveCount(0);
    await expect(page.getByTestId("app-statusbar")).toContainText("Profile selected");
    await expect(page.getByTestId("app-statusbar")).toContainText("Claude identity selected");
    await expect(page.getByTestId("app-statusbar")).toContainText("Workspace ready");
    await expectDefaultSurfaceRedacted(page.getByTestId("app-statusbar"), [
      new RegExp(escapeRegex(fixture.projectDir)),
      /backend\.yml/i,
      /\bbackend\s*@\s*work\b/i,
    ]);

    await openProfileWorkspace(page);
    await openAgentProfilesHome(page);

    await page.getByLabel("Open command palette").click();
    const palette = page.getByTestId("command-palette");
    await expect(page.getByTestId("command-palette-item-nav-home")).toBeVisible();
    await expectDefaultSurfaceRedacted(palette, [new RegExp(escapeRegex(fixture.projectDir))]);
    await expect(palette).toContainText("Profile layer");
    await expect(palette).toContainText("Manage this Claude identity");
    await page.getByTestId("command-palette-item-nav-editor").click();
    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("app shell sanitizes bootstrap and profile-load failures on default surfaces", async () => {
  const fixture = await createDesktopFixture("agent-profile-home-bootstrap-error-");
  await seedProfileFixture(fixture);
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
    [
      "version: 1",
      "authProfiles:",
      "  leaked:",
      "    displayName: keyring://anthropic/work",
      "    anthropic:",
      "      mode: oauth",
      "      secretRef: ${secret:anthropic.oauth}",
      "    mcpSecretRefs: []",
      "",
    ].join("\n")
  );
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByTestId("app-shell-error")).toContainText(
      "Agent Profile desktop data could not be loaded safely",
      { timeout: 15_000 }
    );
    await expectDefaultSurfaceRedacted(page.getByTestId("app-shell-error"), [
      /keyring:\/\/anthropic\/work/i,
      /anthropic\.oauth/i,
    ]);
    await expectDefaultSurfaceRedacted(page.getByTestId("app-statusbar"), [
      new RegExp(escapeRegex(fixture.projectDir)),
      /keyring:\/\/anthropic\/work/i,
      /anthropic\.oauth/i,
    ]);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("agent profiles home disables launch when identity is missing", async () => {
  const fixture = await createDesktopFixture("agent-profile-home-missing-identity-");
  await seedProfileFixture(fixture);
  await writeFile(join(fixture.myClaudeHome, ".setup-complete"), `${new Date().toISOString()}\n`);
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
    `
version: 1
authProfiles: {}
`.trimStart()
  );
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("home-readiness-blocker")).toContainText(
      "Choose a Claude identity to launch this profile"
    );
    await expect(page.getByTestId("home-launch-button")).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Sessions" })).toHaveCount(0);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

async function expectDefaultSurfaceRedacted(
  locator: Locator,
  extraForbidden: RegExp[] = []
): Promise<void> {
  await expect(locator).toBeVisible();
  const text = await locator.innerText();
  for (const forbidden of [...defaultSurfaceForbiddenText, ...extraForbidden]) {
    expect(text).not.toMatch(forbidden);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
