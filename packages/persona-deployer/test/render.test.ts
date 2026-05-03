/**
 * Tests for `renderPersonaInMemory` — the in-memory persona render path.
 *
 * Mirrors `deploy-claude-md.test.ts`, `deploy-collision.test.ts`, and
 * `deploy-missing-source.test.ts` fixture conventions so a future regression
 * test can compare deploy and render outputs directly.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceFileNotFoundError } from "../src/errors.js";
import { renderPersonaInMemory } from "../src/render.js";
import { atomicWrite } from "../src/utils/atomic-write.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "persona-fragments");
const GLOBAL_BACKEND = join(FIXTURES, "global-backend-CLAUDE.md");
const PROJECT_BACKEND = join(FIXTURES, "project-backend-CLAUDE.md");
const AGENT_API = join(FIXTURES, "agent-api-designer.md");
const AGENT_REVIEWER = join(FIXTURES, "agent-code-reviewer.md");
const SKILL_POSTGRES = join(FIXTURES, "skill-postgres-query.md");
const CMD_REVIEW = join(FIXTURES, "cmd-review.md");

let scratchDir: string;

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("renderPersonaInMemory — CLAUDE.md", () => {
  it("single-scope claudeMd: combinedContent + sections + originScope from provenanceMap", async () => {
    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [GLOBAL_BACKEND],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      provenanceMap: { [GLOBAL_BACKEND]: "global-role" },
    });

    expect(result.claudeMd).not.toBeNull();
    expect(result.claudeMd?.sections).toHaveLength(1);
    const section = result.claudeMd?.sections[0];
    expect(section?.sourcePath).toBe(GLOBAL_BACKEND);
    expect(section?.originScope).toBe("global-role");
    expect(section?.content).toContain("Global Backend Instructions");

    // combinedContent carries the source-marker prefix.
    expect(result.claudeMd?.combinedContent).toContain("<!-- source: global-role -->");
    expect(result.claudeMd?.combinedContent).toContain("Global Backend Instructions");

    // No files, no collisions, no missing sources.
    expect(result.files).toHaveLength(0);
    expect(result.collisions).toHaveLength(0);
    expect(result.missingSources).toHaveLength(0);
  });

  it("multi-scope claudeMd: combinedContent merges in cascade order with each marker", async () => {
    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [GLOBAL_BACKEND, PROJECT_BACKEND],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      provenanceMap: {
        [GLOBAL_BACKEND]: "global-role",
        [PROJECT_BACKEND]: "project-role",
      },
    });

    expect(result.claudeMd).not.toBeNull();
    expect(result.claudeMd?.sections).toHaveLength(2);

    const combined = result.claudeMd?.combinedContent ?? "";
    const markerCount = (combined.match(/<!-- source:/g) ?? []).length;
    expect(markerCount).toBe(2);

    // Order: global before project.
    const globalPos = combined.indexOf("<!-- source: global-role -->");
    const projectPos = combined.indexOf("<!-- source: project-role -->");
    expect(globalPos).toBeGreaterThanOrEqual(0);
    expect(projectPos).toBeGreaterThanOrEqual(0);
    expect(globalPos).toBeLessThan(projectPos);

    // Section originScope tracks provenance map.
    expect(result.claudeMd?.sections[0]?.originScope).toBe("global-role");
    expect(result.claudeMd?.sections[1]?.originScope).toBe("project-role");
  });

  it("paths absent from provenanceMap fall back to the literal string 'unknown'", async () => {
    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [GLOBAL_BACKEND],
        agents: [AGENT_API],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      // Empty map — every path falls back.
      provenanceMap: {},
    });

    expect(result.claudeMd?.sections[0]?.originScope).toBe("unknown");
    expect(result.files[0]?.originScope).toBe("unknown");
    // Combined content uses the literal "unknown" tag.
    expect(result.claudeMd?.combinedContent).toContain("<!-- source: unknown -->");
  });
});

describe("renderPersonaInMemory — categories and collisions", () => {
  it("agents collision: later wins; collision logged with public 'agents' category", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "render-collision-agents-"));
    const subDir = join(scratchDir, "project");
    await import("node:fs/promises").then((fs) => fs.mkdir(subDir, { recursive: true }));

    const a = join(scratchDir, "reviewer.md");
    const b = join(subDir, "reviewer.md");
    await atomicWrite(a, "# Reviewer A\n");
    await atomicWrite(b, "# Reviewer B\n");

    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [],
        agents: [a, b],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      provenanceMap: { [a]: "global-role", [b]: "project-role" },
    });

    // claudeMd is null because no sources.
    expect(result.claudeMd).toBeNull();

    // One collision, public category name.
    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]?.category).toBe("agents");
    expect(result.collisions[0]?.target).toBe("reviewer.md");
    expect(result.collisions[0]?.overriddenSource).toBe(a);
    expect(result.collisions[0]?.winningSource).toBe(b);

    // Files: only the winner's content survives, with origin scope from the map.
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.basename).toBe("reviewer.md");
    expect(result.files[0]?.sourcePath).toBe(b);
    expect(result.files[0]?.originScope).toBe("project-role");
    expect(result.files[0]?.content).toContain("# Reviewer B");
    expect(result.files[0]?.content).not.toContain("# Reviewer A");
  });

  it("slashCmds: collisions and missing entries use public 'slashCmds' label, never 'commands'", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "render-slash-cmds-"));
    const sub1 = join(scratchDir, "scope1");
    const sub2 = join(scratchDir, "scope2");
    const fs = await import("node:fs/promises");
    await fs.mkdir(sub1, { recursive: true });
    await fs.mkdir(sub2, { recursive: true });

    const a = join(sub1, "review.md");
    const b = join(sub2, "review.md");
    await atomicWrite(a, "# review A\n");
    await atomicWrite(b, "# review B\n");

    // Add a missing source to verify the missing entry also uses the public name.
    const ghost = join(scratchDir, "ghost-cmd.md");

    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [],
        agents: [],
        skills: [],
        slashCmds: [a, b, ghost],
        memory: [],
      },
      provenanceMap: { [a]: "global-role", [b]: "project-role" },
      onMissingSource: "skip",
    });

    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]?.category).toBe("slashCmds");

    // Files use slashCmds too (winner survives).
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.category).toBe("slashCmds");

    // Missing source uses public name.
    expect(result.missingSources).toHaveLength(1);
    expect(result.missingSources[0]?.category).toBe("slashCmds");
    expect(result.missingSources[0]?.sourcePath).toBe(ghost);
  });
});

describe("renderPersonaInMemory — missing-source policy", () => {
  it("skip mode: records missing files in missingSources and continues", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "render-missing-skip-"));
    const ghostMd = join(scratchDir, "ghost-CLAUDE.md");
    const ghostAgent = join(scratchDir, "ghost-agent.md");

    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [ghostMd, GLOBAL_BACKEND],
        agents: [ghostAgent, AGENT_API],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      provenanceMap: {
        [GLOBAL_BACKEND]: "global-role",
        [AGENT_API]: "global-role",
      },
      onMissingSource: "skip",
    });

    // Missing entries: one claudeMd + one agents.
    expect(result.missingSources).toHaveLength(2);
    expect(result.missingSources.some((m) => m.category === "claudeMd")).toBe(true);
    expect(result.missingSources.some((m) => m.category === "agents")).toBe(true);

    // Surviving entries are present.
    expect(result.claudeMd?.sections).toHaveLength(1);
    expect(result.claudeMd?.sections[0]?.sourcePath).toBe(GLOBAL_BACKEND);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.sourcePath).toBe(AGENT_API);
  });

  it("throw mode: raises SourceFileNotFoundError for missing claudeMd", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "render-missing-throw-"));
    const ghost = join(scratchDir, "ghost.md");

    await expect(
      renderPersonaInMemory({
        effective: {
          claudeMd: [ghost],
          agents: [],
          skills: [],
          slashCmds: [],
          memory: [],
        },
        provenanceMap: {},
        onMissingSource: "throw",
      })
    ).rejects.toThrow(SourceFileNotFoundError);
  });

  it("throw mode: raises SourceFileNotFoundError for missing agent", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "render-missing-throw-agent-"));
    const ghost = join(scratchDir, "ghost-agent.md");

    let caught: SourceFileNotFoundError | undefined;
    try {
      await renderPersonaInMemory({
        effective: {
          claudeMd: [],
          agents: [ghost],
          skills: [],
          slashCmds: [],
          memory: [],
        },
        provenanceMap: {},
        onMissingSource: "throw",
      });
    } catch (e) {
      caught = e as SourceFileNotFoundError;
    }

    expect(caught).toBeInstanceOf(SourceFileNotFoundError);
    expect(caught?.fileCategory).toBe("agents");
    expect(caught?.sourcePath).toBe(ghost);
  });
});

describe("renderPersonaInMemory — empty inputs", () => {
  it("fully empty effective.persona arrays: claudeMd null, files empty, no collisions, no missing", async () => {
    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      provenanceMap: {},
    });

    expect(result.claudeMd).toBeNull();
    expect(result.files).toHaveLength(0);
    expect(result.collisions).toHaveLength(0);
    expect(result.missingSources).toHaveLength(0);
  });

  it("only claudeMd populated: files array empty but claudeMd populated", async () => {
    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [GLOBAL_BACKEND],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      provenanceMap: { [GLOBAL_BACKEND]: "global-role" },
    });

    expect(result.claudeMd).not.toBeNull();
    expect(result.files).toHaveLength(0);
  });
});

describe("renderPersonaInMemory — full pipeline", () => {
  it("full persona spread across categories carries the public category names", async () => {
    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [GLOBAL_BACKEND, PROJECT_BACKEND],
        agents: [AGENT_API, AGENT_REVIEWER],
        skills: [SKILL_POSTGRES],
        slashCmds: [CMD_REVIEW],
        memory: [],
      },
      provenanceMap: {
        [GLOBAL_BACKEND]: "global-role",
        [PROJECT_BACKEND]: "project-role",
        [AGENT_API]: "global-role",
        [AGENT_REVIEWER]: "global-role",
        [SKILL_POSTGRES]: "global-role",
        [CMD_REVIEW]: "global-role",
      },
    });

    expect(result.claudeMd?.sections).toHaveLength(2);
    expect(result.files).toHaveLength(4);

    // Categories carry public names.
    const categories = result.files.map((f) => f.category);
    expect(categories).toEqual(expect.arrayContaining(["agents", "skills", "slashCmds"]));
    expect(categories).not.toContain("commands");

    // Order: agents → skills → slashCmds → memory.
    expect(result.files.map((f) => f.basename)).toEqual([
      "agent-api-designer.md",
      "agent-code-reviewer.md",
      "skill-postgres-query.md",
      "cmd-review.md",
    ]);

    // Content is UTF-8 string, not Buffer.
    for (const file of result.files) {
      expect(typeof file.content).toBe("string");
    }
    expect(result.files[3]?.content).toContain("/review Slash Command");
  });

  it("renders directory-backed skills from SKILL.md while keeping the directory as the source", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "render-skill-dir-test-"));
    const skillDir = join(scratchDir, "graphify");
    await mkdir(skillDir, { recursive: true });
    await atomicWrite(join(skillDir, "SKILL.md"), "# Graphify\n");

    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [],
        agents: [],
        skills: [skillDir],
        slashCmds: [],
        memory: [],
      },
      provenanceMap: { [skillDir]: "project-role" },
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      category: "skills",
      basename: "graphify",
      sourcePath: skillDir,
      originScope: "project-role",
      content: "# Graphify\n",
    });
  });

  it("combinedContent matches the format deployPersona writes (byte-for-byte for the rendered string)", async () => {
    // Spot-check the format: each section is "<!-- source: ${tag} -->\n${content}\n"
    // joined with "\n" between sections.
    const result = await renderPersonaInMemory({
      effective: {
        claudeMd: [GLOBAL_BACKEND, PROJECT_BACKEND],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      provenanceMap: {
        [GLOBAL_BACKEND]: "global-role",
        [PROJECT_BACKEND]: "project-role",
      },
    });

    // Adjacent newlines should never exceed 2 (a marker line + a blank line).
    expect(result.claudeMd?.combinedContent).not.toMatch(/\n{3,}/);

    // Each section ends in a newline before the next marker.
    const combined = result.claudeMd?.combinedContent ?? "";
    expect(combined.endsWith("\n")).toBe(true);
  });
});
