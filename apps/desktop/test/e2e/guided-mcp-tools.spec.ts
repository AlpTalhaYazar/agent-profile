import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { type Locator, type Page, expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  readText,
  seedProfileFixture,
} from "./helpers.js";

const RAW_SECRET_VALUE = "ghp_guidedSECRET123";

const FORBIDDEN_VISIBLE_PATTERNS: readonly [label: string, pattern: RegExp][] = [
  ["keyring URI", /keyring:\/\//i],
  ["raw secret template", /\$\{secret:/i],
  ["raw bearer/header value", /Authorization\s*:\s*Bearer|Bearer\s+\S+/i],
  ["OAuth internals", /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|oauth[_-]?token)\b/i],
];

test("guided MCP tools add GitHub, repair missing secret readiness, and survive reload redacted", async () => {
  const fixture = await createDesktopFixture("agent-profile-guided-mcp-tools-");
  await seedProfileFixture(fixture);
  const rolePath = join(fixture.projectDir, ".myclaude", "roles", "backend.yml");
  const { app, page } = await launchDesktop(fixture);

  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("home-readiness-warning")).toHaveCount(0);
    await expect(page.getByTestId("agent-profile-card")).toContainText("Ready to launch");
    await expectNoForbiddenVisibleText(page.locator("body"), RAW_SECRET_VALUE);

    let tools = await openToolsSection(page);
    await expect(tools).toContainText("local");
    await expect(tools.getByTestId("agent-profile-tool-secret-missing")).toHaveCount(0);
    await page.getByTestId("agent-profile-panel-open-tools-editor").click();

    const editor = page.getByTestId("profile-tools-panel");
    await expect(editor).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Guided Profile Tools opened");
    await expect(editor.getByTestId("profile-tools-add-github")).toBeFocused();
    await editor.getByTestId("profile-tools-add-github").click();
    await expect(editor.getByTestId("profile-tools-tool-card")).toHaveCount(1);
    await expect(editor.getByTestId("profile-tools-server-name")).toHaveValue("github");
    await expect(editor.getByTestId("profile-tools-command-url")).toHaveValue(
      "https://api.githubcopilot.com/mcp/"
    );
    await expect(editor.getByLabel("Header logical secrets 1 field")).toHaveValue(
      "Authorization"
    );
    await expect(editor.getByLabel("Header logical secrets 1 secret name")).toHaveValue(
      "github.pat"
    );
    await editor.getByTestId("profile-tools-preview-action").click();
    await expect(editor.getByTestId("profile-tools-preview")).toContainText("safe Tools", {
      timeout: 15_000,
    });
    await expect(editor.getByTestId("profile-tools-preview")).toContainText("github");
    await expectNoForbiddenVisibleText(editor, RAW_SECRET_VALUE);

    await editor.getByTestId("profile-tools-save").click();
    await expect(editor).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("status")).toContainText("Guided Profile Tools saved");

    const savedProfile = await readText(rolePath);
    expect(savedProfile).toContain("github:");
    expect(savedProfile).toContain("Authorization: Bearer ${secret:github.pat}");
    expect(savedProfile).not.toContain(RAW_SECRET_VALUE);

    tools = await openToolsSection(page);
    await expect(tools).toContainText("github");
    await expect(tools).toContainText("github.pat");
    await expect(tools.getByTestId("agent-profile-tool-secret-missing")).toContainText(
      "github.pat",
      { timeout: 15_000 }
    );
    await expect(tools).toContainText("Missing");
    await expectNoForbiddenVisibleText(tools, RAW_SECRET_VALUE);

    await tools.getByTestId("agent-profile-tool-secret-repair-github-pat").click();
    await expect(page.getByRole("heading", { name: "Claude Auth" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Add secret to \"work\"/ })).toBeVisible();
    await expect(page.getByTestId("auth-secret-name-input")).toHaveValue("github.pat");
    await expect(page.getByTestId("auth-secret-value-input")).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Show" })).toBeVisible();
    await page.getByTestId("auth-secret-value-input").fill(RAW_SECRET_VALUE);
    await expect(page.getByTestId("auth-secret-value-input")).toHaveAttribute("type", "password");
    await expectNoForbiddenVisibleText(page.locator("body"), RAW_SECRET_VALUE);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByRole("heading", { name: /Add secret to \"work\"/ })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByRole("status")).toContainText("Tool secret saved");
    const toolSupport = page.getByTestId("claude-auth-tool-secret-support");
    await toolSupport.getByText("Advanced tool secret support").click();
    await expect(toolSupport).toContainText("github.pat");
    await expect(toolSupport).toContainText("present");
    await expectNoForbiddenVisibleText(page.locator("body"), RAW_SECRET_VALUE);

    await page.getByTestId("sidebar-home").click();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("home-readiness-warning")).toHaveCount(0);
    await expect(page.getByTestId("agent-profile-card")).toContainText("Ready to launch");

    tools = await openToolsSection(page);
    await expect(tools.getByTestId("agent-profile-tool-secret-present")).toContainText(
      "github.pat"
    );
    await expect(tools.getByTestId("agent-profile-tool-secret-missing")).toHaveCount(0);
    await expectNoForbiddenVisibleText(tools, RAW_SECRET_VALUE);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("home-readiness-warning")).toHaveCount(0);
    await expect(page.getByTestId("agent-profile-card")).toContainText("Ready to launch");
    await expect(page.getByTestId("agent-profile-card")).toContainText("2 MCP servers");
    await expectNoForbiddenVisibleText(page.locator("body"), RAW_SECRET_VALUE);

    tools = await openToolsSection(page);
    await expect(tools).toContainText("github");
    await expect(tools).toContainText("local");
    await expect(tools.getByTestId("agent-profile-tool-secret-present")).toContainText(
      "github.pat"
    );
    await expect(tools.getByTestId("agent-profile-tool-secret-missing")).toHaveCount(0);
    await expectNoForbiddenVisibleText(tools, RAW_SECRET_VALUE);

    const authProfiles = await readText(join(fixture.myClaudeHome, "config", "authProfiles.yml"));
    expect(authProfiles).toContain("github.pat");
    expect(authProfiles).not.toContain(RAW_SECRET_VALUE);
    const auditLog = await readText(join(fixture.myClaudeHome, "audit.log"));
    expect(auditLog).toContain("auth.setSecret");
    expect(auditLog).toContain("work.github.pat");
    expect(auditLog).not.toContain(RAW_SECRET_VALUE);
    expect(auditLog).not.toContain("keyring://");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("guided MCP tools reports profile save failures without leaking raw values", async () => {
  const fixture = await createDesktopFixture("agent-profile-guided-mcp-save-failure-");
  await seedProfileFixture(fixture);
  const roleDir = join(fixture.projectDir, ".myclaude", "roles");
  const rolePath = join(roleDir, "backend.yml");
  const { app, page } = await launchDesktop(fixture);
  let roleDirLocked = false;

  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible({
      timeout: 15_000,
    });
    await openToolsSection(page);
    await page.getByTestId("agent-profile-panel-open-tools-editor").click();
    const editor = page.getByTestId("profile-tools-panel");
    await expect(editor).toBeVisible();
    await editor.getByTestId("profile-tools-add-github").click();
    await expect(editor.getByTestId("profile-tools-save")).toBeEnabled();

    await chmod(roleDir, 0o500);
    roleDirLocked = true;
    await editor.getByTestId("profile-tools-save").click();

    await expect(editor).toBeVisible();
    await expect(editor.getByTestId("profile-tools-error")).toContainText(
      "Profile Tools could not be saved",
      { timeout: 15_000 }
    );
    await expect(page.getByRole("status")).toContainText("Profile Tools save failed");
    await expectNoForbiddenVisibleText(page.locator("body"), RAW_SECRET_VALUE);

    const savedProfile = await readText(rolePath);
    expect(savedProfile).not.toContain("github:");
    expect(savedProfile).not.toContain("${secret:github.pat}");
  } finally {
    if (roleDirLocked) await chmod(roleDir, 0o700).catch(() => undefined);
    await app.close();
    await fixture.cleanup();
  }
});

async function openToolsSection(page: Page): Promise<Locator> {
  const sidePanel = page.getByTestId("agent-profile-side-panel");
  if ((await sidePanel.count()) === 0) {
    await page.getByTestId("home-view-profile-details").click();
  }
  await expect(sidePanel).toBeVisible();

  const tools = page.getByTestId("agent-profile-panel-tools");
  if ((await tools.count()) > 0) {
    await expect(tools).toBeVisible();
    return tools;
  }

  await page.getByTestId("agent-profile-panel-section-tools").click();
  await expect(tools).toBeVisible();
  return tools;
}

async function expectNoForbiddenVisibleText(locator: Locator, rawSecretValue: string): Promise<void> {
  await expect(locator).toBeVisible();
  const patterns: [label: string, pattern: RegExp][] = [
    ["dummy raw token", new RegExp(escapeRegExp(rawSecretValue), "i")],
    ...FORBIDDEN_VISIBLE_PATTERNS,
  ];

  const visibleText = await locator.innerText();
  for (const [label, pattern] of patterns) {
    expect(visibleText, `visible UI text should not expose ${label}`).not.toMatch(pattern);
  }

  const leakingControls = await locator.locator("input, textarea").evaluateAll((nodes, raw) => {
    const escapedRaw = String(raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const forbidden = [
      new RegExp(escapedRaw, "i"),
      /keyring:\/\//i,
      /\$\{secret:/i,
      /Authorization\s*:\s*Bearer|Bearer\s+\S+/i,
      /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|oauth[_-]?token)\b/i,
    ];

    return nodes.flatMap((node) => {
      const element = node as HTMLInputElement | HTMLTextAreaElement;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;
      if (!visible) return [];
      const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : "textarea";
      if (type === "hidden" || type === "password") return [];
      return forbidden.some((pattern) => pattern.test(element.value))
        ? [
            element.getAttribute("data-testid") ??
              element.getAttribute("aria-label") ??
              element.tagName,
          ]
        : [];
    });
  }, rawSecretValue);
  expect(leakingControls, "visible non-password fields should not expose secret material").toEqual(
    []
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
