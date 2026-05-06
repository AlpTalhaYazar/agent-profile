import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createDesktopFixture, launchDesktop, seedProfileFixture } from "./helpers.js";

test("new agent profile dialog guides purpose-first creation without persisting yet", async () => {
  const fixture = await createDesktopFixture("agent-profile-create-dialog-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-new-agent-profile").click();

    const dialog = page.getByTestId("profile-create-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create a new Agent Profile" })).toBeVisible();
    await expect(dialog.getByTestId("profile-create-purpose")).toBeFocused();
    await expect(dialog).toContainText("Purpose");
    await expect(dialog).toContainText("Workspace");
    await expect(dialog).toContainText("Claude identity");
    await expect(dialog).toContainText("Profile role preview");
    await expect(dialog).not.toContainText(/\bscope\b/i);
    await expect(dialog).not.toContainText(/\blayer\b/i);
    await expect(dialog).not.toContainText("keyring://");
    await expect(dialog).not.toContainText("secretRef");

    await expect(dialog.getByTestId("profile-create-review-action")).toBeDisabled();

    await dialog.getByTestId("profile-create-purpose").fill("backend");
    await expect(dialog.getByTestId("profile-create-preview")).toContainText("backend");
    await expect(dialog).toContainText("already exists");
    await expect(dialog.getByTestId("profile-create-review-action")).toBeDisabled();

    await dialog.getByTestId("profile-create-purpose").fill("Frontend Polish");
    await expect(dialog.getByTestId("profile-create-preview")).toContainText("frontend-polish");
    await expect(dialog.getByTestId("profile-create-review-action")).toBeEnabled();
    await dialog.getByTestId("profile-create-review-action").click();
    await expect(dialog.getByTestId("profile-create-ready")).toContainText(
      "Nothing has been changed yet"
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("home-new-agent-profile")).toBeFocused();
    await expect(page.getByTestId("agent-profile-card")).toContainText("Backend Agent");
    expect(existsSync(join(fixture.projectDir, ".myclaude", "roles", "frontend-polish.yml"))).toBe(
      false
    );
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("new agent profile dialog routes missing identity to Claude Auth", async () => {
  const fixture = await createDesktopFixture("agent-profile-create-no-identity-");
  await seedProfileFixture(fixture);
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
    `
version: 1
authProfiles: {}
`.trimStart()
  );
  await writeFile(join(fixture.myClaudeHome, ".setup-complete"), `${new Date().toISOString()}\n`);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("home-readiness-blocker")).toContainText(
      "Choose a Claude identity"
    );
    await page.getByTestId("home-new-agent-profile").click();

    const dialog = page.getByTestId("profile-create-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("profile-create-purpose").fill("Frontend Polish");
    await expect(dialog).toContainText("Add a Claude identity before creating an Agent Profile");
    await expect(dialog.getByTestId("profile-create-review-action")).toBeDisabled();
    await dialog.getByRole("button", { name: "Connect Claude identity" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Claude identities" })).toBeVisible();
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
