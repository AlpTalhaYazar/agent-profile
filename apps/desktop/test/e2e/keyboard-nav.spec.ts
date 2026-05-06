import { expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  openProfileWorkspace,
  seedProfileFixture,
} from "./helpers.js";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("keyboard navigation and focus restoration work across shell controls", async () => {
  const fixture = await createDesktopFixture("agent-profile-keyboard-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);
  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-nav")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await page.keyboard.press(`${modifier}+K`);
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();

    await openProfileWorkspace(page);
    await page.getByRole("button", { name: "Layers" }).click();
    await expect(page.getByText("Scope layers")).toBeVisible();
    const scopeButtons = page
      .locator("aside")
      .filter({ hasText: "Scope layers" })
      .getByRole("button");
    await expect(scopeButtons.first()).toBeVisible();
    await scopeButtons.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(scopeButtons.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");

    await page.keyboard.press(`${modifier}+3`);
    await expect(page.locator("#screen-heading")).toBeFocused();
    await expect(page.locator("#screen-heading")).toHaveText("Claude Auth");

    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-help")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-help")).toBeHidden();

    await page.getByRole("button", { name: /Connect Claude/ }).click();
    await expect(page.getByRole("heading", { name: "Connect Claude identity" })).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Connect Claude identity" })).toBeHidden();
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
