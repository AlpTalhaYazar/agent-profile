import { createServer, type Server } from "node:http";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { type Locator, type Page, expect, test } from "@playwright/test";
import {
  type DesktopFixture,
  createDesktopFixture,
  launchDesktop,
  readText,
  seedProfileFixture,
} from "./helpers.js";

test("guided skills persona attaches installed and catalog skills safely, saves, reloads counts, and stays redacted", async () => {
  const fixture = await createDesktopFixture("guided-skills-persona-");
  await seedProfileFixture(fixture);
  const catalog = await startCatalogServer();
  const fakeSkillsDir = join(fixture.root, "fake-skills");
  const fakeBinDir = join(fixture.root, "bin");
  await createFakeNpx({ binDir: fakeBinDir, skillsDir: fakeSkillsDir });

  let launched = await launchDesktop(fixture, {
    env: {
      MYCLAUDE_SKILLS_API_BASE: catalog.url,
      MYCLAUDE_E2E_SKILLS_DIR: fakeSkillsDir,
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
  let app = launched.app;
  let page = launched.page;
  const fixtureForbidden = forbiddenFixturePatterns(fixture);

  try {
    await expect(
      page.getByRole("heading", { name: "Agent Profiles" }),
    ).toBeVisible();
    await expectSafeSurface(
      page.getByTestId("agent-profile-card"),
      fixtureForbidden,
    );
    await page.getByTestId("home-view-profile-details").click();
    await page.getByTestId("agent-profile-panel-section-skills").click();
    await expectSafeSurface(
      page.getByTestId("agent-profile-side-panel"),
      fixtureForbidden,
    );
    await page.getByTestId("agent-profile-panel-open-skills-persona").click();

    const panel = page.getByTestId("profile-skills-persona-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-modal", "true");
    await expect(panel).toHaveAttribute(
      "aria-describedby",
      "profile-skills-persona-description",
    );
    await expect(
      panel.getByTestId("profile-skills-persona-add-skills"),
    ).toBeFocused();
    await expectSafeSurface(panel, fixtureForbidden);
    await expectNonPasswordControlsRedacted(panel, fixtureForbidden);

    await panel.getByTestId("profile-skills-persona-load-installed").click();
    const installedSkill = panel
      .getByTestId("profile-skills-persona-installed-skill")
      .filter({ hasText: "Graphify" });
    await expect(installedSkill).toBeVisible({ timeout: 15_000 });
    await expectLiveAnnouncement(page, "Installed skills loaded");
    await expectSafeSurface(panel, fixtureForbidden);

    await installedSkill
      .getByTestId("profile-skills-persona-attach-installed-skill")
      .click();
    await expectLiveAnnouncement(page, "Attached skill Graphify");
    await expect(panel.getByTestId("profile-skills-persona-row")).toHaveCount(
      1,
    );
    await expect(
      panel.getByTestId("profile-skills-persona-safe-skill-ref"),
    ).toContainText("Graphify");
    await expect(
      panel.getByTestId("profile-skills-persona-ref-input"),
    ).toHaveCount(0);
    await expectSafeSurface(panel, fixtureForbidden);
    await expectNonPasswordControlsRedacted(panel, fixtureForbidden);

    await installedSkill
      .getByTestId("profile-skills-persona-attach-installed-skill")
      .click();
    const duplicateError = panel.getByTestId(
      "profile-skills-persona-skill-error",
    );
    await expect(duplicateError).toContainText("already attached");
    await expectLiveAnnouncement(page, "already attached");
    await expectSafeSurface(duplicateError, fixtureForbidden);
    await expect(panel.getByTestId("profile-skills-persona-row")).toHaveCount(
      1,
    );

    await panel
      .getByTestId("profile-skills-persona-skill-search-input")
      .fill("broken");
    await panel.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      panel.getByTestId("profile-skills-persona-catalog-skill"),
    ).toContainText("Broken Skill", { timeout: 15_000 });
    await panel.getByTestId("profile-skills-persona-install-skill").click();
    const installError = panel.getByTestId(
      "profile-skills-persona-skill-error",
    );
    await expect(installError).toContainText("Skill install failed", {
      timeout: 15_000,
    });
    await expectLiveAnnouncement(page, "Skill install failed");
    await expectSafeSurface(installError, fixtureForbidden);
    await expect(panel.getByTestId("profile-skills-persona-row")).toHaveCount(
      1,
    );

    await panel
      .getByTestId("profile-skills-persona-skill-search-input")
      .fill("postgres");
    await panel.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      panel.getByTestId("profile-skills-persona-catalog-skill"),
    ).toContainText("Postgres Wizard", { timeout: 15_000 });
    await panel.getByTestId("profile-skills-persona-install-skill").click();
    await expect(panel.getByTestId("profile-skills-persona-row")).toHaveCount(
      2,
      {
        timeout: 15_000,
      },
    );
    await expect(
      panel
        .getByTestId("profile-skills-persona-safe-skill-ref")
        .filter({ hasText: /postgres/i }),
    ).toBeVisible();
    await expectLiveAnnouncement(page, "Installed and attached skill postgres");
    await expectSafeSurface(panel, fixtureForbidden);
    await expectNonPasswordControlsRedacted(panel, fixtureForbidden);

    await panel.getByTestId("profile-skills-persona-preview-action").click();
    const preview = panel.getByTestId("profile-skills-persona-preview");
    await expect(preview).toHaveAttribute("data-preview-status", "ready", {
      timeout: 15_000,
    });
    await expect(
      preview.getByTestId("profile-skills-persona-preview-status"),
    ).toContainText("Ready");
    await expect(preview).toContainText(/graphify/i);
    await expect(preview).toContainText(/postgres/i);
    await expectLiveAnnouncement(page, "Skills & Persona preview ready");
    await expect(
      panel.getByTestId("profile-skills-persona-save"),
    ).toBeEnabled();
    await expectSafeSurface(preview, fixtureForbidden);

    await panel.getByTestId("profile-skills-persona-save").click();
    await expect(panel).toHaveCount(0, { timeout: 15_000 });
    await expectLiveAnnouncement(page, "Guided Skills & Persona saved");

    const savedProfile = await readText(
      join(fixture.projectDir, ".myclaude", "roles", "backend.yml"),
    );
    expect(savedProfile).toContain("persona:");
    expect(savedProfile).toContain(join(fakeSkillsDir, "graphify"));
    expect(savedProfile).toContain(join(fakeSkillsDir, "postgres"));
    await expect(page.getByTestId("agent-profile-card")).toContainText(
      "2 skill/persona assets",
    );
    await expectSafeSurface(
      page.getByTestId("agent-profile-card"),
      fixtureForbidden,
    );
    await page.getByTestId("home-view-profile-details").click();
    await page.getByTestId("agent-profile-panel-section-skills").click();
    await expect(page.getByTestId("agent-profile-panel-skills")).toContainText(
      "2",
    );
    await expectSafeSurface(
      page.getByTestId("agent-profile-panel-skills"),
      fixtureForbidden,
    );

    await app.close();
    launched = await launchDesktop(fixture, {
      env: {
        MYCLAUDE_SKILLS_API_BASE: catalog.url,
        MYCLAUDE_E2E_SKILLS_DIR: fakeSkillsDir,
        PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
    app = launched.app;
    page = launched.page;

    await expect(
      page.getByRole("heading", { name: "Agent Profiles" }),
    ).toBeVisible();
    await expect(page.getByTestId("agent-profile-card")).toContainText(
      "2 skill/persona assets",
    );
    await expectSafeSurface(
      page.getByTestId("agent-profile-card"),
      fixtureForbidden,
    );
    await page.getByTestId("home-view-profile-details").click();
    await page.getByTestId("agent-profile-panel-section-skills").click();
    await expect(page.getByTestId("agent-profile-panel-skills")).toContainText(
      "2",
    );
    await expectSafeSurface(
      page.getByTestId("agent-profile-side-panel"),
      fixtureForbidden,
    );
    await page.getByTestId("agent-profile-panel-open-skills-persona").click();
    const reloadedPanel = page.getByTestId("profile-skills-persona-panel");
    await expect(
      reloadedPanel.getByTestId("profile-skills-persona-row"),
    ).toHaveCount(2);
    await expect(
      reloadedPanel
        .getByTestId("profile-skills-persona-safe-skill-ref")
        .filter({ hasText: "graphify" }),
    ).toBeVisible();
    await expect(
      reloadedPanel
        .getByTestId("profile-skills-persona-safe-skill-ref")
        .filter({ hasText: "postgres" }),
    ).toBeVisible();
    await expectSafeSurface(reloadedPanel, fixtureForbidden);
    await expectNonPasswordControlsRedacted(reloadedPanel, fixtureForbidden);
  } finally {
    await app.close().catch(() => undefined);
    await catalog.close();
    await fixture.cleanup();
  }
});

test("guided skills persona previews multi-category assets with missing and collision warnings, keyboard dirty guard, and live announcements", async () => {
  const fixture = await createDesktopFixture(
    "guided-skills-persona-categories-",
  );
  await seedProfileFixture(fixture);
  const assets = await createInlinePersonaAssets(fixture);
  const { app, page } = await launchDesktop(fixture);
  const fixtureForbidden = forbiddenFixturePatterns(fixture);

  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() =>
        page.evaluate(
          () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      )
      .toBe(true);
    await expect(
      page.getByRole("heading", { name: "Agent Profiles" }),
    ).toBeVisible();
    await page.getByTestId("profile-skills-persona-open").click();

    const panel = page.getByTestId("profile-skills-persona-panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByTestId("profile-skills-persona-add-skills"),
    ).toBeFocused();
    await expectLiveAnnouncement(page, "Guided Skills & Persona opened");

    await addManualPersonaRow(page, panel, "claudeMd", assets.claudeMd);
    await addManualPersonaRow(page, panel, "agents", assets.agentA);
    await addManualPersonaRow(page, panel, "agents", assets.agentB);
    await addManualPersonaRow(page, panel, "skills", assets.skill);
    await addManualPersonaRow(page, panel, "slashCmds", assets.command);
    await addManualPersonaRow(page, panel, "memory", assets.missingMemory);
    await addManualPersonaRow(page, panel, "memory", assets.missingMemory);

    await expect(
      panel.getByTestId("profile-skills-persona-error"),
    ).toContainText("only appear once");
    await expect(
      panel.getByTestId("profile-skills-persona-preview-action"),
    ).toBeDisabled();
    await panel
      .getByTestId("profile-skills-persona-section-memory")
      .getByRole("button", { name: /Remove memory file 2/i })
      .click();
    await expect(panel.getByTestId("profile-skills-persona-error")).toHaveCount(
      0,
    );

    const previewAction = panel.getByTestId(
      "profile-skills-persona-preview-action",
    );
    await previewAction.focus();
    await page.keyboard.press("Enter");
    const preview = panel.getByTestId("profile-skills-persona-preview");
    await expect(preview).toHaveAttribute("data-preview-status", "ready", {
      timeout: 15_000,
    });
    await expect(preview).toContainText("safe Skills & Persona");
    const missingMemoryWarning = preview
      .getByTestId("profile-skills-persona-missing-source-warning")
      .filter({ hasText: "missing.md" });
    await expect(missingMemoryWarning).toContainText(
      "Source could not be found",
    );
    await expect(missingMemoryWarning).toContainText("missing.md");
    await expect(
      preview.getByTestId("profile-skills-persona-collision-warning"),
    ).toContainText("reviewer.md");
    await expect(
      preview.getByTestId("profile-skills-persona-collision-warning"),
    ).toContainText("hidden source");
    await expectLiveAnnouncement(page, "Skills & Persona preview ready");
    await expect(
      panel.getByTestId("profile-skills-persona-save"),
    ).toBeEnabled();
    await expectSafeSurface(panel, fixtureForbidden);
    await expectSafeSurface(preview, fixtureForbidden);
    await expectNonPasswordControlsRedacted(panel, fixtureForbidden);

    await panel
      .getByTestId("profile-skills-persona-section-skills")
      .getByRole("button", { name: /Remove skill 1/i })
      .click();
    await expect(preview).toHaveAttribute("data-preview-status", "pending");
    await expect(
      preview.getByTestId("profile-skills-persona-preview-status"),
    ).toContainText("Stale");
    await expect(
      panel.getByTestId("profile-skills-persona-save"),
    ).toBeDisabled();

    await page.keyboard.press("Escape");
    const dirtyDialog = page.getByTestId("profile-skills-persona-dirty-dialog");
    await expect(dirtyDialog).toBeVisible();
    await expect(dirtyDialog).toHaveAttribute(
      "aria-describedby",
      "profile-skills-persona-dirty-description",
    );
    await expect(
      page.getByTestId("profile-skills-persona-dirty-cancel"),
    ).toBeFocused();
    await expectLiveAnnouncement(page, "Skills & Persona has unsaved changes");
    await expectSafeSurface(dirtyDialog, fixtureForbidden);

    await page.getByTestId("profile-skills-persona-dirty-cancel").click();
    await expect(panel).toBeVisible();
    await expect(
      panel.getByTestId("profile-skills-persona-cancel"),
    ).toBeFocused();
    await expectLiveAnnouncement(page, "Stayed in guided Skills & Persona");

    await page.keyboard.press("Escape");
    await page.getByTestId("profile-skills-persona-dirty-discard").click();
    await expect(panel).toHaveCount(0);
    await expectLiveAnnouncement(page, "Discarded Skills & Persona changes");
    await expect(page.getByTestId("agent-profile-card")).toContainText(
      "0 skill/persona assets",
    );
    await expectSafeSurface(
      page.getByTestId("agent-profile-card"),
      fixtureForbidden,
    );
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

test("guided skills persona save failure stays actionable, announced, and redacted", async () => {
  const fixture = await createDesktopFixture(
    "guided-skills-persona-save-failure-",
  );
  await seedProfileFixture(fixture);
  const assets = await createInlinePersonaAssets(fixture);
  const rolePath = join(
    fixture.projectDir,
    ".myclaude",
    "roles",
    "backend.yml",
  );
  const rolesDir = join(fixture.projectDir, ".myclaude", "roles");
  const { app, page } = await launchDesktop(fixture);
  const fixtureForbidden = forbiddenFixturePatterns(fixture);

  try {
    await expect(
      page.getByRole("heading", { name: "Agent Profiles" }),
    ).toBeVisible();
    await page.getByTestId("profile-skills-persona-open").click();
    const panel = page.getByTestId("profile-skills-persona-panel");
    await expect(panel).toBeVisible();
    await addManualPersonaRow(page, panel, "skills", assets.skill);
    await panel.getByTestId("profile-skills-persona-preview-action").click();
    await expect(
      panel.getByTestId("profile-skills-persona-preview"),
    ).toHaveAttribute("data-preview-status", "ready", { timeout: 15_000 });

    await chmod(rolePath, 0o444);
    await chmod(rolesDir, 0o555);
    await panel.getByTestId("profile-skills-persona-save").click();

    await expect(panel).toBeVisible();
    const alert = panel.getByTestId("profile-skills-persona-error");
    await expect(alert).toContainText("Skills & Persona could not be saved", {
      timeout: 15_000,
    });
    await expect(
      panel.getByTestId("profile-skills-persona-save-error"),
    ).toContainText("Skills & Persona could not be saved");
    await expectLiveAnnouncement(page, "Skills & Persona save failed");
    await expectSafeSurface(alert, fixtureForbidden);
    await expectSafeSurface(panel, fixtureForbidden);
    await expectNonPasswordControlsRedacted(panel, fixtureForbidden);
  } finally {
    await chmod(rolesDir, 0o755).catch(() => undefined);
    await chmod(rolePath, 0o644).catch(() => undefined);
    await app.close();
    await fixture.cleanup();
  }
});

async function createInlinePersonaAssets(fixture: DesktopFixture): Promise<{
  agentA: string;
  agentB: string;
  claudeMd: string;
  command: string;
  missingMemory: string;
  skill: string;
}> {
  await mkdir(join(fixture.projectDir, "persona-assets", "agents", "a"), {
    recursive: true,
  });
  await mkdir(join(fixture.projectDir, "persona-assets", "agents", "b"), {
    recursive: true,
  });
  await mkdir(join(fixture.projectDir, "persona-assets", "commands"), {
    recursive: true,
  });
  await mkdir(join(fixture.projectDir, "persona-assets", "skills", "review"), {
    recursive: true,
  });
  await mkdir(join(fixture.projectDir, "persona-assets", "memory"), {
    recursive: true,
  });
  await writeFile(
    join(fixture.projectDir, "persona-assets", "CLAUDE.md"),
    "# Guided profile instructions\n\nUse careful, accessible review language.\n",
  );
  await writeFile(
    join(fixture.projectDir, "persona-assets", "agents", "a", "reviewer.md"),
    "# Reviewer A\n\nReview backend changes.\n",
  );
  await writeFile(
    join(fixture.projectDir, "persona-assets", "agents", "b", "reviewer.md"),
    "# Reviewer B\n\nReview frontend accessibility changes.\n",
  );
  await writeFile(
    join(fixture.projectDir, "persona-assets", "commands", "ship.md"),
    "# /ship\n\nPrepare release notes.\n",
  );
  await writeFile(
    join(fixture.projectDir, "persona-assets", "skills", "review", "SKILL.md"),
    "# Review Skill\n\nInspect code safely.\n",
  );
  await writeFile(
    join(fixture.projectDir, "persona-assets", "memory", "project.md"),
    "# Project memory\n\nPrefer calm profile-facing surfaces.\n",
  );
  return {
    claudeMd: "persona-assets/CLAUDE.md",
    agentA: "persona-assets/agents/a/reviewer.md",
    agentB: "persona-assets/agents/b/reviewer.md",
    skill: "persona-assets/skills/review/SKILL.md",
    command: "persona-assets/commands/ship.md",
    missingMemory: "persona-assets/memory/missing.md",
  };
}

async function addManualPersonaRow(
  page: Page,
  panel: Locator,
  category: "claudeMd" | "agents" | "skills" | "slashCmds" | "memory",
  ref: string,
): Promise<void> {
  const section = panel.getByTestId(
    `profile-skills-persona-section-${category}`,
  );
  await section.getByTestId(`profile-skills-persona-add-${category}`).focus();
  await page.keyboard.press("Enter");
  await section
    .getByTestId("profile-skills-persona-ref-input")
    .last()
    .fill(ref);
}

async function createFakeNpx(input: {
  binDir: string;
  skillsDir: string;
}): Promise<void> {
  await mkdir(input.binDir, { recursive: true });
  await mkdir(join(input.skillsDir, "graphify"), { recursive: true });
  await writeFile(
    join(input.skillsDir, "graphify", "SKILL.md"),
    "# Graphify\n\nGraph workflows.\n",
  );
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const skillsDir = process.env.MYCLAUDE_E2E_SKILLS_DIR;
if (!skillsDir) process.exit(2);
const args = process.argv.slice(2);
const markerPath = path.join(skillsDir, ".installed.json");
function readInstalled() {
  try { return JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch { return []; }
}
function writeInstalled(slugs) {
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify(Array.from(new Set(slugs))));
}
function ensureSkill(slug) {
  const skillDir = path.join(skillsDir, slug);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# " + slug + "\\n\\nInstalled skill.\\n");
  return skillDir;
}
if (args.includes("skills") && args.includes("list")) {
  const slugs = ["graphify", ...readInstalled()];
  console.log(JSON.stringify({ skills: Array.from(new Set(slugs)).map((slug) => ({ name: slug === "graphify" ? "Graphify" : slug, slug, path: ensureSkill(slug) })) }));
  process.exit(0);
}
if (args.includes("skills") && args.includes("add")) {
  const skillIndex = args.indexOf("--skill");
  const slug = skillIndex >= 0 ? args[skillIndex + 1] : "unknown";
  if (slug === "broken") {
    console.error("npx failed in /tmp/private/.claude with ghp_secretvalue");
    process.exit(1);
  }
  const installed = readInstalled();
  installed.push(slug);
  writeInstalled(installed);
  ensureSkill(slug);
  console.log("installed " + slug + " at /tmp/private/.claude/skills/" + slug);
  process.exit(0);
}
console.error("unsupported fake npx invocation: " + args.join(" "));
process.exit(1);
`;
  const npxPath = join(input.binDir, "npx");
  await writeFile(npxPath, script, { mode: 0o755 });
  await chmod(npxPath, 0o755);
}

async function startCatalogServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/api/v1/skills/search") {
      const query = url.searchParams.get("q") ?? "";
      const skills = query.includes("broken")
        ? [
            {
              id: "broken",
              slug: "broken",
              name: "Broken Skill",
              source: "example/broken",
              installUrl: "https://example.test/broken",
              description: "Exercises safe install failure handling.",
            },
          ]
        : query.includes("postgres")
          ? [
              {
                id: "postgres",
                slug: "postgres",
                name: "Postgres Wizard",
                source: "example/postgres",
                installUrl: "https://example.test/postgres",
                description: "Database review workflow.",
              },
            ]
          : [];
      response.end(JSON.stringify({ skills }));
      return;
    }
    if (
      url.pathname.startsWith("/api/v1/skills/audit/") ||
      url.pathname.startsWith("/api/v1/skills/")
    ) {
      response.end(JSON.stringify({ status: "passed", summary: "safe" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("catalog server did not start");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function expectLiveAnnouncement(
  page: Page,
  expected: string | RegExp,
): Promise<void> {
  await expect(page.getByTestId("app-live-announcer")).toContainText(expected);
}

async function expectSafeSurface(
  locator: Locator,
  extraForbidden: readonly RegExp[] = [],
): Promise<void> {
  await expect(locator).toBeVisible();
  expectSafeText(await locator.innerText(), extraForbidden);
}

async function expectNonPasswordControlsRedacted(
  locator: Locator,
  extraForbidden: readonly RegExp[] = [],
): Promise<void> {
  const controlText = await locator
    .locator("input:not([type='password']), textarea, select")
    .evaluateAll((controls) =>
      controls
        .map((control) => {
          if (
            control instanceof HTMLInputElement ||
            control instanceof HTMLTextAreaElement
          ) {
            return control.value;
          }
          if (control instanceof HTMLSelectElement) {
            return [
              control.value,
              ...Array.from(control.selectedOptions).map(
                (option) => option.textContent ?? "",
              ),
            ].join("\n");
          }
          return control.textContent ?? "";
        })
        .join("\n"),
    );
  expectSafeText(controlText, extraForbidden);
}

function expectSafeText(
  text: string,
  extraForbidden: readonly RegExp[] = [],
): void {
  for (const forbidden of [
    ...DEFAULT_SURFACE_FORBIDDEN_TEXT,
    ...extraForbidden,
  ]) {
    expect(text).not.toMatch(forbidden);
  }
}

function forbiddenFixturePatterns(fixture: DesktopFixture): RegExp[] {
  return [
    new RegExp(escapeRegex(fixture.root)),
    new RegExp(escapeRegex(fixture.projectDir)),
    new RegExp(escapeRegex(fixture.myClaudeHome)),
  ];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DEFAULT_SURFACE_FORBIDDEN_TEXT = [
  /\.myclaude/i,
  /\/tmp\//i,
  /project-role/i,
  /global-role/i,
  /project-shared/i,
  /global-shared/i,
  /keyring:\/\//i,
  /\$\{secret:/i,
  /Bearer\s+\S+/i,
  /secretRef/i,
  /Authorization/i,
  /authProfiles\.yml/i,
  /originScope/i,
  /sourcePath/i,
  /ghp_[A-Za-z0-9_]+/i,
  /github_pat_[A-Za-z0-9_]+/i,
  /sk-ant-[A-Za-z0-9_-]+/i,
  /xox[baprs]-[A-Za-z0-9-]+/i,
];
