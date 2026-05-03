import { mkdtempSync, rmSync } from "node:fs";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deployPersona } from "../src/deploy.js";
import { createSessionDir } from "../src/session-dir.js";
import { atomicWrite } from "../src/utils/atomic-write.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "persona-fragments");
const AGENT_API = join(FIXTURES, "agent-api-designer.md");
const GLOBAL_BACKEND = join(FIXTURES, "global-backend-CLAUDE.md");

let tmpRoot: string;

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("deployPersona — empty persona", () => {
  it("fully empty persona: no files written, claudeMdPath null, empty arrays", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-empty-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [], agents: [], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    expect(result.claudeMdPath).toBeNull();
    expect(result.writtenFiles).toHaveLength(0);
    expect(result.collisions).toHaveLength(0);
    expect(result.missingSources).toHaveLength(0);

    // No CLAUDE.md in the session root.
    await expect(access(join(sessionDir, "CLAUDE.md"))).rejects.toThrow();
  });

  it("partial empty: claudeMd empty but agents populated — only agents dir populated", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-empty-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [], agents: [AGENT_API], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    expect(result.claudeMdPath).toBeNull();
    expect(result.writtenFiles).toHaveLength(1);
    expect(result.writtenFiles[0]).toContain("agent-api-designer.md");

    // CLAUDE.md must not exist.
    await expect(access(join(sessionDir, "CLAUDE.md"))).rejects.toThrow();

    // skills dir should be empty.
    const skillsEntries = await readdir(join(claudeConfigDir, "skills"));
    expect(skillsEntries).toHaveLength(0);
  });

  it("partial empty: agents empty but claudeMd populated — only CLAUDE.md written", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-empty-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [GLOBAL_BACKEND], agents: [], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    expect(result.claudeMdPath).not.toBeNull();
    expect(result.writtenFiles).toHaveLength(0);

    // Agents dir should be empty.
    const agentsEntries = await readdir(join(claudeConfigDir, "agents"));
    expect(agentsEntries).toHaveLength(0);
  });

  it("empty slashCmds and memory arrays produce empty commands and memory dirs", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-empty-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    await deployPersona(
      { claudeMd: [], agents: [], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    const commandsEntries = await readdir(join(claudeConfigDir, "commands"));
    const memoryEntries = await readdir(join(claudeConfigDir, "memory"));

    expect(commandsEntries).toHaveLength(0);
    expect(memoryEntries).toHaveLength(0);
  });

  it("full persona (3 claudeMd + 2 agents + 1 skill) writes all expected files", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-full-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const FIXTURES_DIR = join(import.meta.dirname, "fixtures", "persona-fragments");
    const globalBackend = join(FIXTURES_DIR, "global-backend-CLAUDE.md");
    const projectBackend = join(FIXTURES_DIR, "project-backend-CLAUDE.md");

    // Create a third CLAUDE.md on the fly.
    const extraDir = mkdtempSync(join(tmpdir(), "extra-fragment-"));
    const thirdMd = join(extraDir, "third.md");
    await atomicWrite(thirdMd, "# Third fragment\n");

    try {
      const result = await deployPersona(
        {
          claudeMd: [globalBackend, projectBackend, thirdMd],
          agents: [
            join(FIXTURES_DIR, "agent-api-designer.md"),
            join(FIXTURES_DIR, "agent-code-reviewer.md"),
          ],
          skills: [join(FIXTURES_DIR, "skill-postgres-query.md")],
          slashCmds: [],
          memory: [],
        },
        sessionDir,
        claudeConfigDir
      );

      // CLAUDE.md with 3 markers.
      expect(result.claudeMdPath).not.toBeNull();
      const { readFile } = await import("node:fs/promises");
      if (result.claudeMdPath === null) throw new Error("claudeMdPath must be non-null here");
      const claudeMdContent = await readFile(result.claudeMdPath, "utf8");
      const markerCount = (claudeMdContent.match(/<!-- source:/g) ?? []).length;
      expect(markerCount).toBe(3);

      // 2 agents + 1 skill = 3 written files.
      expect(result.writtenFiles).toHaveLength(3);

      // No collisions.
      expect(result.collisions).toHaveLength(0);
    } finally {
      rmSync(extraDir, { recursive: true, force: true });
    }
  });

  it("copies directory-backed skills recursively while preserving file-backed skills", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-skill-dir-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });
    const skillDir = join(tmpRoot, "skills", "graphify");
    await mkdir(join(skillDir, "references"), { recursive: true });
    await atomicWrite(join(skillDir, "SKILL.md"), "# Graphify\n");
    await atomicWrite(join(skillDir, "references", "usage.md"), "usage\n");

    const result = await deployPersona(
      {
        claudeMd: [],
        agents: [],
        skills: [skillDir, join(FIXTURES, "skill-postgres-query.md")],
        slashCmds: [],
        memory: [],
      },
      sessionDir,
      claudeConfigDir
    );

    expect(await readFile(join(claudeConfigDir, "skills", "graphify", "SKILL.md"), "utf8")).toBe(
      "# Graphify\n"
    );
    expect(
      await readFile(join(claudeConfigDir, "skills", "graphify", "references", "usage.md"), "utf8")
    ).toBe("usage\n");
    expect(
      await readFile(join(claudeConfigDir, "skills", "skill-postgres-query.md"), "utf8")
    ).toContain("PostgreSQL");
    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([
        join(claudeConfigDir, "skills", "graphify", "SKILL.md"),
        join(claudeConfigDir, "skills", "graphify", "references", "usage.md"),
        join(claudeConfigDir, "skills", "skill-postgres-query.md"),
      ])
    );
  });
});
