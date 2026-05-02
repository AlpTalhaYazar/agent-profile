import { expect, test } from "@playwright/test";
import { createDesktopFixture, launchDesktop, seedProfileFixture } from "./helpers.js";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("keyboard navigation and focus restoration work across shell controls", async () => {
  const fixture = await createDesktopFixture("agent-profile-keyboard-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);
  try {
    await expect(page.getByRole("heading", { name: "Profile Editor" })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-nav")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await page.keyboard.press(`${modifier}+K`);
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();

    const scopeButtons = page.locator("main aside").first().getByRole("button");
    await scopeButtons.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(scopeButtons.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");

    await page.keyboard.press(`${modifier}+2`);
    await expect(page.locator("#screen-heading")).toBeFocused();
    await expect(page.locator("#screen-heading")).toHaveText("Auth Vault");

    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-help")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-help")).toBeHidden();

    await page.getByRole("button", { name: /Add profile/ }).click();
    await expect(page.getByRole("heading", { name: "Add auth profile" })).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Add auth profile" })).toBeHidden();
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
