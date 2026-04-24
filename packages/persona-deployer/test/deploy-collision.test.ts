import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deployPersona } from "../src/deploy.js";
import { createSessionDir } from "../src/session-dir.js";
import { atomicWrite } from "../src/utils/atomic-write.js";

let tmpRoot: string;
let fixtureDir: string;

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

async function makeAgent(dir: string, name: string, content: string): Promise<string> {
  const p = join(dir, name);
  await atomicWrite(p, content);
  return p;
}

describe("deployPersona — collision detection", () => {
  it("two agents with same basename: later wins, collision is logged", async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "collision-agents-"));
    tmpRoot = mkdtempSync(join(tmpdir(), "collision-test-"));

    const a = await makeAgent(fixtureDir, "reviewer.md", "# Reviewer A\nFrom global scope.\n");
    // Place second agent in a subdirectory to give it a different absolute path
    // but the same basename.
    const subDir = join(fixtureDir, "project");
    await import("node:fs/promises").then((fs) => fs.mkdir(subDir, { recursive: true }));
    const b = await makeAgent(subDir, "reviewer.md", "# Reviewer B\nFrom project scope.\n");

    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [], agents: [a, b], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    // One collision logged.
    expect(result.collisions).toHaveLength(1);
    const collision = result.collisions[0];
    expect(collision?.target).toBe("reviewer.md");
    expect(collision?.category).toBe("agents");
    expect(collision?.overriddenSource).toBe(a);
    expect(collision?.winningSource).toBe(b);

    // Deployed file matches the winner's content.
    const deployed = join(claudeConfigDir, "agents", "reviewer.md");
    const content = await readFile(deployed, "utf8");
    expect(content).toContain("From project scope.");
    expect(content).not.toContain("From global scope.");
  });

  it("collision across categories does not produce a collision entry", async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "cross-cat-collision-"));
    tmpRoot = mkdtempSync(join(tmpdir(), "cross-cat-test-"));

    // Agent and skill share the same basename but live in different source dirs
    // so they can have distinct content.
    const agentDir = join(fixtureDir, "agents");
    const skillDir = join(fixtureDir, "skills");
    const fs = await import("node:fs/promises");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(skillDir, { recursive: true });

    const agent = await makeAgent(agentDir, "shared-name.md", "# Agent\n");
    const skill = await makeAgent(skillDir, "shared-name.md", "# Skill\n");

    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [], agents: [agent], skills: [skill], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    // No collisions because they are in different categories.
    expect(result.collisions).toHaveLength(0);

    // Both files should be deployed in their respective directories.
    const deployedAgent = await readFile(join(claudeConfigDir, "agents", "shared-name.md"), "utf8");
    const deployedSkill = await readFile(join(claudeConfigDir, "skills", "shared-name.md"), "utf8");
    expect(deployedAgent).toContain("# Agent");
    expect(deployedSkill).toContain("# Skill");
  });

  it("three files with same basename: two collision entries logged step-by-step", async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "three-collision-"));
    const sub1 = join(fixtureDir, "scope1");
    const sub2 = join(fixtureDir, "scope2");
    const fs = await import("node:fs/promises");
    await fs.mkdir(sub1, { recursive: true });
    await fs.mkdir(sub2, { recursive: true });

    tmpRoot = mkdtempSync(join(tmpdir(), "three-collision-test-"));

    const a = await makeAgent(fixtureDir, "tool.md", "# Tool A\n");
    const b = await makeAgent(sub1, "tool.md", "# Tool B\n");
    const c = await makeAgent(sub2, "tool.md", "# Tool C\n");

    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [], agents: [a, b, c], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    // Two collision entries: A→B and B→C.
    expect(result.collisions).toHaveLength(2);

    const [first, second] = result.collisions;
    expect(first?.overriddenSource).toBe(a);
    expect(first?.winningSource).toBe(b);
    expect(second?.overriddenSource).toBe(b);
    expect(second?.winningSource).toBe(c);

    // Final deployed file is C.
    const deployed = join(claudeConfigDir, "agents", "tool.md");
    const content = await readFile(deployed, "utf8");
    expect(content).toContain("# Tool C");
  });

  it("no collisions when all basenames are unique within a category", async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "no-collision-"));
    tmpRoot = mkdtempSync(join(tmpdir(), "no-collision-test-"));

    const a = await makeAgent(fixtureDir, "alpha.md", "# Alpha\n");
    const b = await makeAgent(fixtureDir, "beta.md", "# Beta\n");

    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [], agents: [a, b], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    expect(result.collisions).toHaveLength(0);
    expect(result.writtenFiles).toHaveLength(2);
  });
});
