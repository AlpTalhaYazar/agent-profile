import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  openAgentProfilesHome,
  openProfileWorkspace,
  seedProfileFixture,
} from "./helpers.js";

test("agent profiles home is the default profile-first surface", async () => {
  const fixture = await createDesktopFixture();
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("sidebar-home")).toHaveAttribute("aria-current", "page");

    const card = page.getByTestId("agent-profile-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Backend Agent");
    await expect(card).toContainText("Ready to launch");
    await expect(card).toContainText("Work");
    await expect(card).toContainText("1 MCP server");
    await expect(card).toContainText("0 skill/persona assets");
    await expect(page.getByTestId("home-launch-button")).toBeEnabled();

    await expect(page.getByText("Provenance")).toHaveCount(0);
    await expect(page.getByText("Effective preview")).toHaveCount(0);
    await expect(page.getByText("keyring://")).toHaveCount(0);

    await openProfileWorkspace(page);
    await openAgentProfilesHome(page);

    await page.getByLabel("Open command palette").click();
    await expect(page.getByTestId("command-palette-item-nav-home")).toBeVisible();
    await page.getByTestId("command-palette-item-nav-editor").click();
    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();
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
