import { expect, test } from "@playwright/test";
import { createDesktopFixture, launchDesktop, readText, seedProfileFixture } from "./helpers.js";

const screens = [
  ["editor", "Profile Editor"],
  ["auth-vault", "Auth Vault"],
  ["sessions", "Sessions"],
  ["provenance", "Provenance Inspector"],
  ["persona", "Persona Composer"],
] as const;

test("shell landmarks, headings, skip link, and live region are present", async () => {
  const fixture = await createDesktopFixture("agent-profile-a11y-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);
  try {
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("nav[aria-label='Primary']")).toBeVisible();
    await expect(page.locator("main#main-content")).toBeVisible();
    await expect(page.getByRole("status")).toBeAttached();

    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-nav")).toBeFocused();
    await page.locator(".skip-nav").blur();

    for (const [screen, heading] of screens) {
      await page.getByTestId(`sidebar-${screen}`).click();
      await expect(page.locator("#screen-heading")).toHaveCount(1);
      await expect(page.locator("#screen-heading")).toHaveText(heading);
    }
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("profile save updates live region", async () => {
  const fixture = await createDesktopFixture("agent-profile-a11y-save-");
  const { globalSharedPath } = await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);
  try {
    await expect(page.getByRole("heading", { name: "Profile Editor" })).toBeVisible();
    await page.getByPlaceholder("Value").first().fill("vim");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Profile saved", { timeout: 15_000 });
    await expect.poll(async () => readText(globalSharedPath)).toContain("EDITOR: vim");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
