import { join } from "node:path";
import { type Locator, expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  readText,
  seedProfileCapabilityFixture,
  seedProfileFixture,
} from "./helpers.js";

test("profile side panel opens summary-first and resets after close", async () => {
  const fixture = await createDesktopFixture("agent-profile-side-panel-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-view-profile-details").click();

    const panel = page.getByTestId("agent-profile-side-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-section", "summary");
    await expect(page.getByTestId("agent-profile-side-panel-close")).toBeFocused();
    await expect(page.getByTestId("agent-profile-panel-summary")).toContainText("Ready to launch");
    await expect(page.getByTestId("agent-profile-panel-summary")).toContainText("Work");
    await expect(page.getByTestId("agent-profile-panel-summary")).toContainText("1 MCP server");
    await expect(page.getByTestId("agent-profile-panel-summary")).toContainText(
      "0 skill/persona assets"
    );

    await expect(panel).not.toContainText("keyring://");
    await expect(panel).not.toContainText("Effective preview");
    await expect(panel).not.toContainText("Provenance");
    await expect(panel).not.toContainText("EDITOR");

    await page.getByTestId("agent-profile-panel-section-inspect").click();
    await expect(panel).toHaveAttribute("data-section", "inspect");
    await expect(page.getByTestId("agent-profile-panel-inspect")).toContainText("Safe inspection");
    await expect(page.getByTestId("agent-profile-panel-inspect")).toContainText("MCP servers");
    await expect(page.getByTestId("agent-profile-panel-inspect")).not.toContainText("keyring://");
    await expect(page.getByTestId("agent-profile-panel-inspect")).not.toContainText("EDITOR");

    await page.getByTestId("agent-profile-side-panel-close").click();
    await expect(page.getByTestId("agent-profile-side-panel")).toHaveCount(0);
    await expect(page.getByTestId("home-view-profile-details")).toBeFocused();

    await page.getByTestId("home-view-profile-details").click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-section", "summary");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("agent-profile-side-panel")).toHaveCount(0);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("profile side panel tool actions preserve Profile Workspace access", async () => {
  const fixture = await createDesktopFixture("agent-profile-side-panel-tools-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-view-profile-details").click();
    await page.getByTestId("agent-profile-panel-section-tools").click();

    const tools = page.getByTestId("agent-profile-panel-tools");
    await expect(tools).toContainText("Tools and MCP capability");
    await expect(tools).toContainText("local");
    await page.getByTestId("agent-profile-panel-open-layers").click();
    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Scope layers" })).toBeVisible();
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("profile side panel guided tools editor previews, saves, discards, and stays redacted", async () => {
  const fixture = await createDesktopFixture("agent-profile-side-panel-guided-tools-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-view-profile-details").click();
    await page.getByTestId("agent-profile-panel-section-tools").click();
    await page.getByTestId("agent-profile-panel-open-tools-editor").click();

    const panel = page.getByTestId("profile-tools-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Guided Tools");
    await expect(panel.getByTestId("profile-tools-empty")).toContainText("No profile-owned MCP tools yet");
    await expectRedactedTools(panel);

    await panel.getByTestId("profile-tools-add-github").click();
    await expect(panel.getByTestId("profile-tools-tool-card")).toHaveCount(1);
    await expect(panel.getByTestId("profile-tools-server-name")).toHaveValue("github");
    await expect(panel.getByTestId("profile-tools-command-url")).toHaveValue(
      "https://api.githubcopilot.com/mcp/"
    );
    await panel.getByTestId("profile-tools-preview-action").click();
    await expect(panel.getByTestId("profile-tools-preview")).toContainText("safe Tools", {
      timeout: 15_000,
    });
    await expect(panel.getByTestId("profile-tools-preview")).toContainText("github");
    await expectRedactedTools(panel.getByTestId("profile-tools-preview"));

    await panel.getByTestId("profile-tools-cancel").click();
    await expect(page.getByTestId("profile-tools-dirty-dialog")).toBeVisible();
    await page.getByTestId("profile-tools-dirty-discard").click();
    await expect(panel).toHaveCount(0);

    await page.getByTestId("agent-profile-panel-open-tools-editor").click();
    await expect(panel.getByTestId("profile-tools-empty")).toBeVisible();
    await panel.getByTestId("profile-tools-add-github").click();
    await panel.getByTestId("profile-tools-save").click();
    await expect(panel).toHaveCount(0, { timeout: 15_000 });

    const savedProfile = await readText(join(fixture.projectDir, ".myclaude", "roles", "backend.yml"));
    expect(savedProfile).toContain("github:");
    expect(savedProfile).toContain("github.pat");
    await page.getByTestId("home-view-profile-details").click();
    await page.getByTestId("agent-profile-panel-section-tools").click();
    await expect(page.getByTestId("agent-profile-panel-tools")).toContainText("github");
    await expect(page.getByTestId("agent-profile-panel-tools")).toContainText("github.pat");
    await expectRedactedTools(page.getByTestId("agent-profile-panel-tools"));

    await page.getByTestId("agent-profile-panel-open-tools-editor").click();
    await expect(panel.getByTestId("profile-tools-tool-card")).toHaveCount(1);
    await panel.getByTestId("profile-tools-delete-tool").click();
    await expect(panel.getByTestId("profile-tools-empty")).toBeVisible();
    await panel.getByTestId("profile-tools-cancel").click();
    await page.getByTestId("profile-tools-dirty-discard").click();
    await page.getByTestId("agent-profile-panel-open-tools-editor").click();
    await expect(panel.getByTestId("profile-tools-server-name")).toHaveValue("github");
    await expectRedactedTools(panel);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("profile side panel frames identity, tools, and skills as profile capability", async () => {
  const fixture = await createDesktopFixture("agent-profile-side-panel-capability-");
  await seedProfileCapabilityFixture(fixture);

  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-view-profile-details").click();

    const panel = page.getByTestId("agent-profile-side-panel");
    await page.getByTestId("agent-profile-panel-section-identity").click();
    await expect(panel).toHaveAttribute("data-section", "identity");
    await expect(page.getByTestId("agent-profile-panel-identity")).toContainText("Claude identity");
    await expect(page.getByTestId("agent-profile-panel-identity")).toContainText("Work");

    await page.getByTestId("agent-profile-panel-section-tools").click();
    const tools = page.getByTestId("agent-profile-panel-tools");
    await expect(tools).toContainText("github");
    await expect(tools).toContainText("linear");
    await expect(tools).toContainText("github.pat");
    await expect(tools).toContainText("Present");
    await expect(tools).toContainText("linear.token");
    await expect(tools).toContainText("Missing");
    await expect(tools).not.toContainText("keyring://");
    await expect(tools).not.toContainText("${secret:");
    await expect(tools).not.toContainText("Authorization");
    await expect(tools).not.toContainText("Bearer");

    await page.getByTestId("agent-profile-panel-section-skills").click();
    const skills = page.getByTestId("agent-profile-panel-skills");
    await expect(skills).toContainText("Skills and persona assets");
    await expect(skills).toContainText("Skills");
    await expect(skills).toContainText("Agents");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("profile side panel suppresses motion when reduced motion is requested", async () => {
  const fixture = await createDesktopFixture("agent-profile-side-panel-motion-");
  await seedProfileFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await page.getByTestId("home-view-profile-details").click();

    const frame = page.getByTestId("agent-profile-side-panel-frame");
    const panel = page.getByTestId("agent-profile-side-panel");
    await expect(frame).toHaveAttribute("data-motion", "reduced");
    await expect(frame).toHaveAttribute("data-state", "open");
    await expect
      .poll(async () => readMaxTransitionDurationMs(panel))
      .toBeLessThanOrEqual(0.02);
    await expect
      .poll(async () => panel.evaluate((element) => getComputedStyle(element).transform))
      .toBe("none");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

async function expectRedactedTools(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const text = await locator.innerText();
  expect(text).not.toMatch(/keyring:\/\//i);
  expect(text).not.toMatch(/\$\{secret:/i);
  expect(text).not.toMatch(/Bearer\s+\S+/i);
  expect(text).not.toMatch(/ghp_[A-Za-z0-9_]+/i);
  expect(text).not.toMatch(/github_pat_[A-Za-z0-9_]+/i);
}

async function readMaxTransitionDurationMs(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.transitionDuration
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((value) => {
        if (value.endsWith("ms")) return Number.parseFloat(value);
        if (value.endsWith("s")) return Number.parseFloat(value) * 1000;
        return Number.parseFloat(value) || 0;
      })
      .reduce((max, value) => Math.max(max, value), 0);
  });
}
