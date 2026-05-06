import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createDesktopFixture, launchDesktop } from "./helpers.js";

test("first-run wizard creates setup marker and stays complete after relaunch", async () => {
  const fixture = await createDesktopFixture("agent-profile-first-run-");
  try {
    const { app, page } = await launchDesktop(fixture);
    await expect(page.getByTestId("first-run-wizard")).toBeVisible();
    await page.getByTestId("wizard-get-started").click();
    await expect(page.getByRole("heading", { name: "Add a Claude credential" })).toBeVisible();

    await page.getByLabel("Display name").fill("Work");
    const secretWindow = app.waitForEvent("window");
    await page.getByRole("button", { name: /Continue/ }).click();
    const secretPage = await secretWindow;
    await secretPage.getByLabel("Anthropic API key").fill("sk-ant-test");
    await secretPage.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { name: "Choose a starting role" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("heading", { name: "Setup complete" })).toBeVisible();
    await page.getByTestId("wizard-go-to-editor").click();
    await expect(page.getByTestId("first-run-wizard")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("sidebar-home")).toHaveAttribute("aria-current", "page");
    expect(existsSync(join(fixture.myClaudeHome, ".setup-complete"))).toBe(true);
    await app.close();

    const relaunch = await launchDesktop(fixture);
    try {
      await expect(relaunch.page.getByTestId("first-run-wizard")).toBeHidden();
      await expect(relaunch.page.getByTestId("sidebar-home")).toBeVisible();
      await expect(relaunch.page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    } finally {
      await relaunch.app.close();
    }
  } finally {
    await fixture.cleanup();
  }
});

test("dismissing first-run wizard does not write marker", async () => {
  const fixture = await createDesktopFixture("agent-profile-first-run-dismiss-");
  try {
    const { app, page } = await launchDesktop(fixture);
    await expect(page.getByTestId("first-run-wizard")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("first-run-wizard")).toBeHidden();
    expect(existsSync(join(fixture.myClaudeHome, ".setup-complete"))).toBe(false);
    await app.close();

    const relaunch = await launchDesktop(fixture);
    try {
      await expect(relaunch.page.getByTestId("first-run-wizard")).toBeVisible();
    } finally {
      await relaunch.app.close();
    }
  } finally {
    await fixture.cleanup();
  }
});
