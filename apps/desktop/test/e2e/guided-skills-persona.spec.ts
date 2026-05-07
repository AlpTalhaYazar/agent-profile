import { createServer, type Server } from "node:http";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { type Locator, expect, test } from "@playwright/test";
import {
  createDesktopFixture,
  launchDesktop,
  readText,
  seedProfileFixture,
} from "./helpers.js";

test("guided skills persona attaches installed and catalog skills safely", async () => {
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

  try {
    await expect(
      page.getByRole("heading", { name: "Agent Profiles" }),
    ).toBeVisible();
    await page.getByTestId("home-view-profile-details").click();
    await page.getByTestId("agent-profile-panel-section-skills").click();
    await page.getByTestId("agent-profile-panel-open-skills-persona").click();

    const panel = page.getByTestId("profile-skills-persona-panel");
    await expect(panel).toBeVisible();
    await expectRedactedSkillsPersona(panel);

    await panel.getByTestId("profile-skills-persona-load-installed").click();
    const installedSkill = panel
      .getByTestId("profile-skills-persona-installed-skill")
      .filter({ hasText: "Graphify" });
    await expect(installedSkill).toBeVisible({ timeout: 15_000 });
    await expectRedactedSkillsPersona(panel);

    await installedSkill
      .getByTestId("profile-skills-persona-attach-installed-skill")
      .click();
    await expect(panel.getByTestId("profile-skills-persona-row")).toHaveCount(
      1,
    );
    await expect(
      panel.getByTestId("profile-skills-persona-safe-skill-ref"),
    ).toContainText("Graphify");
    await expect(
      panel.getByTestId("profile-skills-persona-ref-input"),
    ).toHaveCount(0);
    await expectRedactedSkillsPersona(panel);

    await installedSkill
      .getByTestId("profile-skills-persona-attach-installed-skill")
      .click();
    await expect(
      panel.getByTestId("profile-skills-persona-skill-error"),
    ).toContainText("already attached");
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
    await expectRedactedSkillsPersona(installError);
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
    await expectRedactedSkillsPersona(panel);

    await panel.getByTestId("profile-skills-persona-preview-action").click();
    const preview = panel.getByTestId("profile-skills-persona-preview");
    await expect(preview).toContainText(/graphify/i, { timeout: 15_000 });
    await expect(preview).toContainText(/postgres/i);
    await expect(
      panel.getByTestId("profile-skills-persona-save"),
    ).toBeEnabled();
    await expectRedactedSkillsPersona(preview);

    await panel.getByTestId("profile-skills-persona-save").click();
    await expect(panel).toHaveCount(0, { timeout: 15_000 });

    const savedProfile = await readText(
      join(fixture.projectDir, ".myclaude", "roles", "backend.yml"),
    );
    expect(savedProfile).toContain("persona:");
    expect(savedProfile).toContain(join(fakeSkillsDir, "graphify"));
    expect(savedProfile).toContain(join(fakeSkillsDir, "postgres"));
    await expect(page.getByTestId("agent-profile-card")).toContainText(
      "2 skill/persona assets",
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
    await page.getByTestId("home-view-profile-details").click();
    await page.getByTestId("agent-profile-panel-section-skills").click();
    await expect(page.getByTestId("agent-profile-panel-skills")).toContainText(
      "2",
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
    await expectRedactedSkillsPersona(reloadedPanel);
  } finally {
    await app.close().catch(() => undefined);
    await catalog.close();
    await fixture.cleanup();
  }
});

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

async function expectRedactedSkillsPersona(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const text = await locator.innerText();
  expect(text).not.toMatch(/keyring:\/\//i);
  expect(text).not.toMatch(/\$\{secret:/i);
  expect(text).not.toMatch(/Bearer\s+\S+/i);
  expect(text).not.toMatch(/ghp_[A-Za-z0-9_]+/i);
  expect(text).not.toMatch(/github_pat_[A-Za-z0-9_]+/i);
  expect(text).not.toMatch(/project-role|global-role/i);
  expect(text).not.toMatch(/\/Users\//i);
  expect(text).not.toMatch(/\/tmp\//i);
  expect(text).not.toMatch(/\bnpx\b/i);
}
