import { type Locator, expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  openProfileWorkspace,
  readText,
  seedProfileFixture,
} from "./helpers.js";

const screens = [
  ["home", "Agent Profiles"],
  ["editor", "Profile Workspace"],
  ["auth-vault", "Claude Auth"],
  ["sessions", "Sessions"],
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

test("profile side panel preserves heading landmark and closes with Escape", async () => {
  const fixture = await createDesktopFixture("agent-profile-a11y-side-panel-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);
  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-view-profile-details").click();
    await expect(page.getByTestId("agent-profile-side-panel")).toBeVisible();
    await expect(page.locator("#screen-heading")).toHaveCount(1);
    await expect(page.getByTestId("agent-profile-side-panel-close")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("agent-profile-side-panel")).toHaveCount(0);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("primary profile controls meet target-size expectations", async () => {
  const fixture = await createDesktopFixture("agent-profile-a11y-targets-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);
  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();

    await assertMinTarget(page.getByTestId("home-launch-button"));
    await assertMinTarget(page.getByTestId("home-view-profile-details"));
    await assertMinTarget(page.getByTestId("home-secondary-action"));

    await page.getByTestId("home-view-profile-details").click();
    await assertMinTarget(page.getByTestId("agent-profile-side-panel-close"));
    for (const section of ["summary", "identity", "tools", "skills", "inspect"]) {
      await assertMinTarget(page.getByTestId(`agent-profile-panel-section-${section}`));
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
    await openProfileWorkspace(page);
    await page.getByRole("button", { name: "Layers" }).click();
    await expect(page.getByRole("heading", { name: "Scope layers" })).toBeVisible();
    await page.locator("button").filter({ hasText: "shared.yml" }).first().click();
    await expect(page.getByPlaceholder("Value").first()).toBeVisible();
    await page.getByPlaceholder("Value").first().fill("vim");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Profile saved", { timeout: 15_000 });
    await expect.poll(async () => readText(globalSharedPath)).toContain("EDITOR: vim");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

async function assertMinTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);
}
