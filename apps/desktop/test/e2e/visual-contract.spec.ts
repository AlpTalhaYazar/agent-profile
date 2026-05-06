import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Locator, type Page, expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  openProfileWorkspace,
  seedProfileCapabilityFixture,
} from "./helpers.js";

const actualDir = resolve(process.cwd(), "../../.ai-page-designs");

test("desktop visual contract matches the modernized hierarchy", async () => {
  const fixture = await createDesktopFixture("agent-profile-visual-contract-");
  await seedProfileCapabilityFixture(fixture);
  await seedVisualSessions(fixture);
  await mkdir(actualDir, { recursive: true });
  const { app, page } = await launchDesktop(fixture);

  try {
    await page.setViewportSize({ width: 1586, height: 992 });
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("sidebar-home")).toHaveAttribute("aria-current", "page");
    await assertNoHorizontalOverflow(page);
    await assertVisibleBox(page.getByTestId("agent-profile-card"));
    await assertVisibleBox(page.getByText("Ready with review").first());
    await assertVisibleBox(page.getByTestId("home-readiness-warning"));
    await assertVisibleBox(page.getByTestId("home-launch-button"));
    await page.screenshot({ path: join(actualDir, "actual-agent-profiles-home-1586x992.png") });

    await page.getByTestId("home-view-profile-details").click();
    await assertVisibleBox(page.getByTestId("agent-profile-side-panel"));
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: join(actualDir, "actual-agent-profiles-side-panel-1586x992.png"),
    });
    await page.getByTestId("agent-profile-panel-section-tools").click();
    await assertVisibleBox(page.getByTestId("agent-profile-panel-tools"));
    await assertVisibleBox(page.getByText("Tools and MCP capability"));
    await assertVisibleBox(page.getByText("linear.token"));
    await expect(page.getByTestId("agent-profile-panel-tools")).not.toContainText("keyring://");
    await expect(page.getByTestId("agent-profile-panel-tools")).not.toContainText("Bearer");
    await page.screenshot({
      path: join(actualDir, "actual-agent-profiles-tools-panel-1586x992.png"),
    });
    await page.getByTestId("agent-profile-side-panel-close").click();
    await expect(page.getByTestId("agent-profile-side-panel")).toHaveCount(0);

    await openProfileWorkspace(page);
    await expect(page.getByTestId("sidebar-editor")).toHaveAttribute("aria-current", "page");
    await assertNoHorizontalOverflow(page);
    await assertBoxInRange(page.locator("header").first(), {
      minHeight: 52,
      maxHeight: 58,
      minWidth: 1500,
    });
    await assertBoxInRange(page.locator("aside").first(), {
      minHeight: 900,
      minWidth: 260,
      maxWidth: 290,
    });
    await assertVisibleBox(
      page.getByText(/Ready to launch|Ready with review|Select context to launch/)
    );
    await assertVisibleBox(page.getByRole("button", { name: /MCP Servers/ }));
    await assertVisibleBox(page.getByRole("button", { name: /Env Vars/ }));
    await assertVisibleBox(page.getByText("Launch readiness"));
    await assertVisibleBox(page.getByText("Effective profile summary"));
    await assertVisibleBox(page.getByText("Included layers"));
    await assertVisibleBox(page.getByText("Next actions"));
    await assertVisibleBox(page.getByRole("button", { name: /Working directory/ }));
    await assertVisibleBox(page.getByRole("button", { name: /Role/ }).first());
    await assertVisibleBox(page.getByRole("button", { name: /Claude credential/ }));
    await assertVisibleBox(page.getByRole("button", { name: /New role\/layer/ }));
    await assertVisibleBox(page.getByRole("button", { name: /Add MCP server/ }));
    await assertVisibleBox(page.getByRole("button", { name: /Add Skill/ }));
    await page.screenshot({ path: join(actualDir, "actual-profile-workspace-1586x992.png") });

    await page.setViewportSize({ width: 1280, height: 800 });
    await assertNoHorizontalOverflow(page);
    await page.getByTestId("sidebar-auth-vault").click();
    await expect(page.getByRole("heading", { name: "Claude Auth" })).toBeVisible();
    await expect(page.getByTestId("sidebar-auth-vault")).toHaveAttribute("aria-current", "page");
    await page.mouse.move(1270, 20);
    await assertVisibleBox(page.getByText("Claude identities").first());
    await assertVisibleBox(page.getByTestId("claude-auth-identity-summary"));
    await assertVisibleBox(page.getByTestId("claude-auth-tool-secret-support"));
    await assertVisibleBox(page.getByText("Advanced tool secret support"));
    await page.screenshot({ path: join(actualDir, "actual-claude-auth-1280x800.png") });

    await page.getByTestId("sidebar-sessions").click();
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await expect(page.getByTestId("sidebar-sessions")).toHaveAttribute("aria-current", "page");
    await page.mouse.move(1270, 20);
    await assertNoHorizontalOverflow(page);
    await page.getByText("session-running").first().click();
    await assertVisibleBox(page.getByRole("button", { name: "Run again" }).first());
    await assertVisibleBox(page.getByRole("button", { name: "Check drift" }));
    await assertVisibleBox(page.getByText("Session detail"));
    await page.screenshot({ path: join(actualDir, "actual-sessions-1280x800.png") });

    await page.setViewportSize({ width: 900, height: 700 });
    await assertNoHorizontalOverflow(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await assertVisibleBox(page.getByTestId("command-palette"));
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: join(actualDir, "actual-command-palette-900x700.png") });
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);

  const scrollableOffenders = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main, .app-scrollbar"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          visible: rect.width > 1 && rect.height > 1,
        };
      })
      .filter((entry) => entry.visible && entry.scrollWidth > entry.clientWidth + 1)
  );
  expect(scrollableOffenders).toEqual([]);
}

async function seedVisualSessions(
  fixture: Awaited<ReturnType<typeof createDesktopFixture>>
): Promise<void> {
  const sessionsRoot = join(fixture.myClaudeHome, "sessions");
  const registryDir = join(fixture.myClaudeHome, "session-registry");
  await mkdir(join(sessionsRoot, "session-running"), { recursive: true });
  await mkdir(join(sessionsRoot, "session-exited"), { recursive: true });
  await mkdir(registryDir, { recursive: true });

  const runtimePaths = (id: string) => ({
    sessionDir: join(sessionsRoot, id),
    claudeConfigDir: join(sessionsRoot, id, ".claude"),
    mcpConfig: join(sessionsRoot, id, "mcp.json"),
    settings: join(sessionsRoot, id, "settings.json"),
    apiKeyHelper: null,
    headersHelper: null,
    claudeMd: null,
  });

  await writeFile(
    join(registryDir, "session-running.json"),
    JSON.stringify({
      version: 1,
      sessionId: "session-running",
      role: "backend",
      authProfileId: "work",
      cwd: fixture.projectDir,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
      retained: false,
      cleaned: false,
      runtimePaths: runtimePaths("session-running"),
      spawn: { command: "claude", args: ["--strict-mcp-config"] },
      status: "running",
    })
  );
  await writeFile(
    join(registryDir, "session-exited.json"),
    JSON.stringify({
      version: 1,
      sessionId: "session-exited",
      role: "backend",
      authProfileId: "work",
      cwd: fixture.projectDir,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
      retained: false,
      cleaned: false,
      runtimePaths: runtimePaths("session-exited"),
      spawn: { command: "claude", args: [] },
      status: "exited",
      exitCode: 0,
    })
  );
}

async function assertVisibleBox(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(1);
  expect(box?.height ?? 0).toBeGreaterThan(1);
}

async function assertBoxInRange(
  locator: Locator,
  range: { minHeight?: number; maxHeight?: number; minWidth?: number; maxWidth?: number }
): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  if (range.minHeight !== undefined) expect(box.height).toBeGreaterThanOrEqual(range.minHeight);
  if (range.maxHeight !== undefined) expect(box.height).toBeLessThanOrEqual(range.maxHeight);
  if (range.minWidth !== undefined) expect(box.width).toBeGreaterThanOrEqual(range.minWidth);
  if (range.maxWidth !== undefined) expect(box.width).toBeLessThanOrEqual(range.maxWidth);
}
