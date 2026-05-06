import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createDesktopFixture, launchDesktop, readText, seedProfileFixture } from "./helpers.js";

test("new agent profile dialog creates and restores a purpose-first profile", async () => {
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

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("home-new-agent-profile")).toBeFocused();
    await page.getByTestId("home-new-agent-profile").click();
    await expect(dialog).toBeVisible();

    await expect(dialog.getByTestId("profile-create-review-action")).toBeDisabled();

    await dialog.getByTestId("profile-create-purpose").fill("backend");
    await expect(dialog.getByTestId("profile-create-preview")).toContainText("backend");
    await expect(dialog).toContainText("already exists");
    await expect(dialog.getByTestId("profile-create-review-action")).toBeDisabled();

    await dialog.getByTestId("profile-create-purpose").fill("Frontend Polish");
    await expect(dialog.getByTestId("profile-create-preview")).toContainText("frontend-polish");
    await expect(dialog.getByTestId("profile-create-review-action")).toBeEnabled();
    await dialog.getByTestId("profile-create-review-action").click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("agent-profile-card")).toContainText("Frontend Polish");
    await expect(page.getByTestId("agent-profile-card")).toContainText("Ready to launch");
    expect(existsSync(join(fixture.projectDir, ".myclaude", "roles", "frontend-polish.yml"))).toBe(
      true
    );
    const createdProfileContent = await readText(
      join(fixture.projectDir, ".myclaude", "roles", "frontend-polish.yml")
    );
    expect(createdProfileContent).toContain("profile:");
    expect(createdProfileContent).toContain("displayName: Frontend Polish");
    expect(createdProfileContent).toContain("purpose: Frontend Polish");
    expect(createdProfileContent).toContain("auth:");
    expect(createdProfileContent).toContain("profileId: work");
    const library = page.getByTestId("agent-profile-library");
    await expect(library).toContainText("Frontend Polish");
    await expect(
      library.getByTestId("agent-profile-library-item").filter({ hasText: "Frontend Polish" })
    ).toContainText("Selected profile");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("agent-profile-card")).toContainText("Frontend Polish");
    await expect(page.getByTestId("agent-profile-card")).toContainText("Ready to launch");

    await page.getByTestId("home-new-agent-profile").click();
    await dialog.getByTestId("profile-create-purpose").fill("Frontend Polish");
    await expect(dialog).toContainText("already exists");
    await expect(dialog.getByTestId("profile-create-review-action")).toBeDisabled();
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("new agent profile dialog restores profiles created in a non-default workspace", async () => {
  const fixture = await createDesktopFixture("agent-profile-create-alt-workspace-");
  await seedProfileFixture(fixture);
  const alternateProjectDir = join(fixture.root, "alternate-project");
  await mkdir(alternateProjectDir, { recursive: true });
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-new-agent-profile").click();

    const dialog = page.getByTestId("profile-create-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("profile-create-purpose").fill("Data Migration Review");
    await dialog.getByTestId("profile-create-workspace").fill(alternateProjectDir);
    await expect(dialog.getByTestId("profile-create-review-action")).toBeEnabled();
    await dialog.getByTestId("profile-create-review-action").click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("agent-profile-card")).toContainText("Data Migration Review");
    await expect(
      page.getByTestId("agent-profile-library-item").filter({ hasText: "Data Migration Review" })
    ).toContainText("Selected profile");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("agent-profile-card")).toContainText("Data Migration Review");
    await expect(
      page.getByTestId("agent-profile-library-item").filter({ hasText: "Data Migration Review" })
    ).toContainText("Selected profile");

    const storedSelection = await page.evaluate(() =>
      window.localStorage.getItem("agent-profile.selectedProfile")
    );
    expect(storedSelection).toContain(alternateProjectDir);
    expect(
      existsSync(join(alternateProjectDir, ".myclaude", "roles", "data-migration-review.yml"))
    ).toBe(true);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("new agent profile dialog shows calm service errors without raw paths", async () => {
  const fixture = await createDesktopFixture("agent-profile-create-service-error-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-new-agent-profile").click();

    const dialog = page.getByTestId("profile-create-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("profile-create-purpose").fill("Race Duplicate");
    await expect(dialog.getByTestId("profile-create-review-action")).toBeEnabled();

    const duplicatePath = join(fixture.projectDir, ".myclaude", "roles", "race-duplicate.yml");
    await mkdir(join(fixture.projectDir, ".myclaude", "roles"), { recursive: true });
    await writeFile(duplicatePath, "version: 1\n");

    await dialog.getByTestId("profile-create-review-action").click();
    await expect(dialog.getByTestId("profile-create-error")).toContainText(
      "An Agent Profile with that generated role already exists"
    );
    await expect(dialog.getByTestId("profile-create-error")).not.toContainText(duplicatePath);
    await expect(dialog).toBeVisible();
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
