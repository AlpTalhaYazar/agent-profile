import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  openProfileWorkspace,
  seedProfileFixture,
} from "./helpers.js";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

async function openLayerEditor(
  page: Awaited<ReturnType<typeof launchDesktop>>["page"]
): Promise<void> {
  await openProfileWorkspace(page);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Scope layers" })).toBeVisible();
  const sharedLayer = page.locator("button").filter({ hasText: "shared.yml" }).first();
  await sharedLayer.click();
  await expect(page.getByPlaceholder("Value").first()).toBeVisible();
}

test("dirty profile navigation can be cancelled and discarded", async () => {
  const fixture = await createDesktopFixture("agent-profile-unsaved-discard-");
  const { globalSharedPath } = await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await openLayerEditor(page);
    await page.getByPlaceholder("Value").first().fill("emacs");
    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("sidebar-home").click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-cancel").click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();
    await expect(page.getByPlaceholder("Value").first()).toHaveValue("emacs");
    await expect(page.getByTestId("sidebar-home")).toBeFocused();

    await page.getByTestId("sidebar-home").click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-discard").click();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect.poll(async () => readFile(globalSharedPath, "utf8")).toContain("EDITOR: nvim");

    await openLayerEditor(page);
    await expect(page.getByPlaceholder("Value").first()).toHaveValue("nvim");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("dirty profile navigation can save before leaving", async () => {
  const fixture = await createDesktopFixture("agent-profile-unsaved-save-");
  const { globalSharedPath } = await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await openLayerEditor(page);
    await page.getByPlaceholder("Value").first().fill("vim");
    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("sidebar-auth-vault").click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-save").click();
    await expect(page.getByRole("heading", { name: "Claude Auth" })).toBeVisible();
    await expect.poll(async () => readFile(globalSharedPath, "utf8")).toContain("EDITOR: vim");

    await openLayerEditor(page);
    await expect(page.getByPlaceholder("Value").first()).toHaveValue("vim");
    await expect(page.getByText("No changes")).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("dirty profile layer and identity switches are guarded", async () => {
  const fixture = await createDesktopFixture("agent-profile-unsaved-context-");
  const { globalSharedPath } = await seedProfileFixture(fixture);
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
  personal:
    displayName: Personal
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/personal
    mcpSecretRefs: {}
`.trimStart()
  );
  await writeFile(
    join(fixture.myClaudeHome, "config", "global", "roles", "backend.yml"),
    `
version: 1
env:
  NODE_ENV: development
`.trimStart()
  );
  const { app, page } = await launchDesktop(fixture);

  try {
    await openLayerEditor(page);
    await page.getByPlaceholder("Value").first().fill("nano");
    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });

    const backendLayer = page.locator("button").filter({ hasText: "backend.yml" }).first();
    await backendLayer.click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-cancel").click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toHaveCount(0);
    await expect(page.getByPlaceholder("Value").first()).toHaveValue("nano");
    await expect(backendLayer).toBeFocused();

    await backendLayer.click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-discard").click();
    await expect(page.locator('input[value="NODE_ENV"]')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => readFile(globalSharedPath, "utf8")).toContain("EDITOR: nvim");

    await page.getByRole("button", { name: "Add variable" }).click();
    await page.getByPlaceholder("KEY").last().fill("TEMP_FLAG");
    await page.getByPlaceholder("Value").last().fill("production");
    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Claude credential/ }).click();
    await page.getByRole("button", { name: /Personal/ }).click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-save").click();
    await expect(page.getByRole("button", { name: /Personal/ })).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("dirty profile launch prompts before leaving workspace", async () => {
  const fixture = await createDesktopFixture("agent-profile-unsaved-launch-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await openLayerEditor(page);
    await page.getByPlaceholder("Value").first().fill("helix");
    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Launch Claude" }).first().click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-cancel").click();
    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sessions" })).toHaveCount(0);
    await expect(page.getByPlaceholder("Value").first()).toHaveValue("helix");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("dirty profile shortcut and command-palette navigation are guarded", async () => {
  const fixture = await createDesktopFixture("agent-profile-unsaved-shortcuts-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await openLayerEditor(page);
    await page.getByPlaceholder("Value").first().fill("code");
    await expect(page.getByText("Ready to save")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press(`${modifier}+1`);
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-cancel").click();
    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();

    await page.keyboard.press(`${modifier}+K`);
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByTestId("command-palette-item-nav-auth").click();
    await expect(page.getByTestId("profile-unsaved-dialog")).toBeVisible();
    await page.getByTestId("profile-unsaved-discard").click();
    await expect(page.getByRole("heading", { name: "Claude Auth" })).toBeVisible();
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
