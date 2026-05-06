import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  seedProfileCapabilityFixture,
  seedProfileFixture,
} from "./helpers.js";

test("missing Claude identity shows a calm blocker with an Auth fix path", async () => {
  const fixture = await createDesktopFixture("agent-profile-failure-missing-identity-");
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
    await expect(page.getByTestId("agent-profile-card")).not.toContainText("keyring://");

    await page.getByTestId("home-secondary-action").click();
    await expect(page.getByRole("heading", { name: "Claude Auth" })).toBeVisible();
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("missing tool secrets show as profile-owned warning with a Tools fix path", async () => {
  const fixture = await createDesktopFixture("agent-profile-failure-missing-tools-");
  await seedProfileCapabilityFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("home-readiness-warning")).toContainText(
      "1 tool secret needs attention"
    );
    await expect(page.getByTestId("home-secondary-action")).toContainText("Review tools");

    await page.getByTestId("home-secondary-action").click();
    await expect(page.getByTestId("agent-profile-side-panel")).toHaveAttribute(
      "data-section",
      "tools"
    );
    const tools = page.getByTestId("agent-profile-panel-tools");
    await expect(tools).toContainText("linear.token");
    await expect(tools).toContainText("Missing");
    await expect(tools).not.toContainText("keyring://");
    await expect(tools).not.toContainText("${secret:");
    await expect(tools).not.toContainText("Authorization");
    await expect(tools).not.toContainText("Bearer");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
