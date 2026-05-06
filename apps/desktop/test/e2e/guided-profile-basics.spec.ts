import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Locator, expect, test } from "@playwright/test";
import { createDesktopFixture, type DesktopFixture, launchDesktop, readText } from "./helpers.js";

const forbiddenSurfaceText = [
  /\.myclaude/i,
  /project-role/i,
  /keyring:\/\//i,
  /\$\{secret:/i,
  /Bearer\s+\S+/i,
  /secretRef/i,
  /Authorization/i,
  /OAuth/i,
];

async function seedGuidedBasicsFixture(fixture: DesktopFixture): Promise<void> {
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
    [
      "version: 1",
      "authProfiles:",
      "  work:",
      "    displayName: Work Claude",
      "    anthropic:",
      "      mode: apiKey",
      "      secretRef: keyring://anthropic/work",
      "    mcpSecretRefs:",
      "      github.pat: keyring://mcp/github",
      "  personal:",
      "    displayName: Personal Claude",
      "    anthropic:",
      "      mode: apiKey",
      "      secretRef: keyring://anthropic/personal",
      "    mcpSecretRefs: {}",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.myClaudeHome, "config", "global", "shared.yml"),
    [
      "version: 1",
      "mcpServers:",
      "  github:",
      "    type: http",
      "    url: https://github.example/mcp",
      "    headers:",
      "      Authorization: Bearer ${secret:github.pat}",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.projectDir, ".myclaude", "roles", "backend-api-review.yml"),
    [
      "version: 1",
      "profile:",
      "  displayName: Backend API Review",
      "  purpose: Review backend APIs before launch",
      "auth:",
      "  profileId: work",
      "env:",
      "  SAFE_FLAG: off",
      "settings:",
      "  theme: dark",
      "  review:",
      "    level: normal",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.projectDir, ".myclaude", "roles", "frontend-polish.yml"),
    [
      "version: 1",
      "profile:",
      "  displayName: Frontend Polish",
      "  purpose: Tune visible UI details before handoff",
      "auth:",
      "  profileId: personal",
      "env:",
      "  SAFE_FLAG: frontend",
      "settings:",
      "  theme: warm",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.projectDir, ".myclaude", "roles", "docs-review.yml"),
    [
      "version: 1",
      "profile:",
      "  displayName: Docs Review",
      "  purpose: Check documentation before release",
      "auth:",
      "  profileId: work",
      "",
    ].join("\n")
  );
}

async function seedStaleBasicsFixture(fixture: DesktopFixture): Promise<void> {
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
    [
      "version: 1",
      "authProfiles:",
      "  work:",
      "    displayName: Work Claude",
      "    anthropic:",
      "      mode: apiKey",
      "      secretRef: keyring://anthropic/work",
      "    mcpSecretRefs: {}",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.projectDir, ".myclaude", "roles", "backend-api-review.yml"),
    [
      "version: 1",
      "profile:",
      "  displayName: Backend API Review",
      "  purpose: Review backend APIs before launch",
      "auth:",
      "  profileId: deleted-auth",
      "env:",
      "  SAFE_FLAG: off",
      "settings:",
      "  theme: dark",
      "",
    ].join("\n")
  );
}

test("guided Profile Basics edits, previews, saves, reloads, and restores safe state", async () => {
  const fixture = await createDesktopFixture("guided-profile-basics-save-");
  await seedGuidedBasicsFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("agent-profile-library-item")).toHaveCount(3);
    await expect(page.getByTestId("agent-profile-card")).toContainText("Backend API Review");
    await expectRedacted(page.getByTestId("agent-profiles-home"));

    await page.getByTestId("profile-basics-open").click();
    const panel = page.getByTestId("profile-basics-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Guided Profile Basics opened");
    await expect(panel.getByTestId("profile-basics-display-name")).toBeFocused();
    await expect(panel).toContainText("Guided Basics");
    await expect(panel.getByTestId("profile-basics-preview")).toContainText("No Basics changes yet");
    await expectRedacted(panel);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("profile-basics-open")).toBeFocused();
    await expect(page.getByRole("status")).toContainText("Guided Profile Basics closed");

    await page.getByTestId("profile-basics-open").click();
    await expect(panel).toBeVisible();
    await panel.getByTestId("profile-basics-display-name").fill("Backend Incident Captain");
    await panel.getByTestId("profile-basics-purpose").fill("Coordinate backend incidents safely");
    await panel.getByLabel("Claude identity").selectOption("personal");
    await panel.getByLabel("Environment variable 1 value").fill("enabled");
    await panel.getByRole("button", { name: "Add variable" }).click();
    await panel.getByLabel("Environment variable 2 name").fill("EXTRA_CONTEXT");
    await panel.getByLabel("Environment variable 2 value").fill("guided");
    await panel
      .getByTestId("profile-basics-settings")
      .fill(JSON.stringify({ theme: "light", review: { level: "deep" }, safeCount: 2 }, null, 2));

    const preview = panel.getByTestId("profile-basics-preview");
    await expect(preview).toContainText("safe Basics", { timeout: 15_000 });
    await expect(preview).toContainText("Changes Profile · display name");
    await expect(preview).toContainText("Changes Profile · purpose");
    await expect(preview).toContainText("Changes Claude identity · Claude identity");
    await expect(preview).toContainText("Changes Environment · SAFE_FLAG");
    await expect(preview).toContainText("Adds Environment · EXTRA_CONTEXT");
    await expect(preview).toContainText("Changes Settings · theme");
    await expectRedacted(preview);
    await expect(panel.getByTestId("profile-basics-save")).toBeEnabled();

    await panel.getByTestId("profile-basics-save").click();
    await expect(panel).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("agent-profile-card")).toContainText("Backend Incident Captain");
    await expect(page.getByTestId("agent-profile-card")).toContainText(
      "Coordinate backend incidents safely"
    );
    await expect(page.getByTestId("agent-profile-card")).toContainText("Personal Claude");
    await expectRedacted(page.getByTestId("agent-profiles-home"));

    const savedProfile = await readText(
      join(fixture.projectDir, ".myclaude", "roles", "backend-api-review.yml")
    );
    expect(savedProfile).toContain("displayName: Backend Incident Captain");
    expect(savedProfile).toContain("purpose: Coordinate backend incidents safely");
    expect(savedProfile).toContain("profileId: personal");
    expect(savedProfile).toContain("SAFE_FLAG: enabled");
    expect(savedProfile).toContain("EXTRA_CONTEXT: guided");
    expect(savedProfile).toContain("theme: light");
    expect(savedProfile).toContain("level: deep");
    expect(savedProfile).toContain("safeCount: 2");

    const storedSelection = await page.evaluate(() =>
      window.localStorage.getItem("agent-profile.selectedProfile")
    );
    expect(storedSelection).toContain("backend-api-review");
    expect(storedSelection).toContain("personal");
    expect(storedSelection).toContain(fixture.projectDir);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("agent-profile-card")).toContainText("Backend Incident Captain");
    await expect(page.getByTestId("agent-profile-card")).toContainText("Personal Claude");
    await page.getByTestId("profile-basics-open").click();
    await expect(panel.getByTestId("profile-basics-display-name")).toHaveValue(
      "Backend Incident Captain"
    );
    await expect(panel.getByTestId("profile-basics-purpose")).toHaveValue(
      "Coordinate backend incidents safely"
    );
    await expect(panel.locator('input[value="SAFE_FLAG"]')).toBeVisible();
    await expect(panel.locator('input[value="enabled"]')).toBeVisible();
    await expect(panel.locator('input[value="EXTRA_CONTEXT"]')).toBeVisible();
    await expect(panel.locator('input[value="guided"]')).toBeVisible();
    const restoredWorkspace = await panel.getByTestId("profile-basics-workspace").inputValue();
    expect(restoredWorkspace.endsWith("/project")).toBe(true);
    const restoredSettings = JSON.parse(
      await panel.getByTestId("profile-basics-settings").inputValue()
    );
    expect(restoredSettings).toEqual({ theme: "light", review: { level: "deep" }, safeCount: 2 });
    await expectRedacted(panel.getByTestId("profile-basics-preview"));
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("guided Profile Basics blocks stale identities, invalid JSON, and secret-like values calmly", async () => {
  const fixture = await createDesktopFixture("guided-profile-basics-negative-");
  await seedStaleBasicsFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("profile-basics-open").click();
    const panel = page.getByTestId("profile-basics-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("previously selected Claude identity is unavailable");
    await expect(panel.getByTestId("profile-basics-error")).toContainText(
      "Choose an available Claude identity before saving basics"
    );
    await expect(panel.getByTestId("profile-basics-save")).toBeDisabled();
    await expectRedacted(panel.getByTestId("profile-basics-error"));

    await panel.getByLabel("Claude identity").selectOption("work");
    await panel.getByTestId("profile-basics-settings").fill("{ invalid");
    await expect(panel.getByTestId("profile-basics-error")).toContainText(
      "Settings must be valid JSON"
    );
    await expect(panel.getByTestId("profile-basics-save")).toBeDisabled();
    await expectRedacted(panel.getByTestId("profile-basics-error"));

    await panel
      .getByTestId("profile-basics-settings")
      .fill(JSON.stringify({ headers: { Authorization: "Bearer ghp_secretvalue" } }, null, 2));
    await expect(panel.getByTestId("profile-basics-error")).toContainText(
      "Move secret-like settings values to the identity vault before saving basics"
    );
    await expect(panel.getByTestId("profile-basics-error")).not.toContainText("Bearer");
    await expect(panel.getByTestId("profile-basics-error")).not.toContainText("ghp_secretvalue");
    await expectRedacted(panel.getByTestId("profile-basics-error"));

    await panel.getByTestId("profile-basics-settings").fill("{}");
    await panel.getByLabel("Environment variable 1 value").fill("keyring://anthropic/work");
    await expect(panel.getByTestId("profile-basics-error")).toContainText(
      "Move secret-like environment values to the identity vault before saving basics"
    );
    await expect(panel.getByTestId("profile-basics-error")).not.toContainText("keyring://");
    await expect(panel.getByTestId("profile-basics-preview")).toContainText(
      "Fix validation issues to preview safely"
    );
    await expectRedacted(panel.getByTestId("profile-basics-preview"));
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

async function expectRedacted(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const text = await locator.innerText();
  for (const forbidden of forbiddenSurfaceText) {
    expect(text).not.toMatch(forbidden);
  }
}
