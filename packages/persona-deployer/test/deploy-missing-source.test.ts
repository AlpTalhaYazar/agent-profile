import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deployPersona } from "../src/deploy.js";
import { SourceFileNotFoundError } from "../src/errors.js";
import { createSessionDir } from "../src/session-dir.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "persona-fragments");
const AGENT_API = join(FIXTURES, "agent-api-designer.md");
const GLOBAL_BACKEND = join(FIXTURES, "global-backend-CLAUDE.md");

let tmpRoot: string;

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("deployPersona — missing source files", () => {
  it("throws SourceFileNotFoundError when an agent file does not exist (default throw mode)", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-missing-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const missing = join(tmpRoot, "does-not-exist.md");

    await expect(
      deployPersona(
        { claudeMd: [], agents: [missing], skills: [], slashCmds: [], memory: [] },
        sessionDir,
        claudeConfigDir
      )
    ).rejects.toThrow(SourceFileNotFoundError);
  });

  it("SourceFileNotFoundError contains category, sourcePath, and targetPath", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-missing-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const missing = join(tmpRoot, "nonexistent-agent.md");

    let caught: SourceFileNotFoundError | undefined;
    try {
      await deployPersona(
        { claudeMd: [], agents: [missing], skills: [], slashCmds: [], memory: [] },
        sessionDir,
        claudeConfigDir
      );
    } catch (e) {
      caught = e as SourceFileNotFoundError;
    }

    expect(caught).toBeDefined();
    expect(caught?.fileCategory).toBe("agents");
    expect(caught?.sourcePath).toBe(missing);
    expect(caught?.targetPath).toContain("nonexistent-agent.md");
  });

  it("throws SourceFileNotFoundError for missing claudeMd source", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-missing-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const missing = join(tmpRoot, "missing-CLAUDE.md");

    await expect(
      deployPersona(
        { claudeMd: [missing], agents: [], skills: [], slashCmds: [], memory: [] },
        sessionDir,
        claudeConfigDir
      )
    ).rejects.toThrow(SourceFileNotFoundError);
  });

  it("skip mode: records missing agent in missingSources and continues", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-missing-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const missing = join(tmpRoot, "ghost-agent.md");

    const result = await deployPersona(
      { claudeMd: [], agents: [missing, AGENT_API], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir,
      { onMissingSource: "skip" }
    );

    // The missing file is recorded.
    expect(result.missingSources).toHaveLength(1);
    const entry = result.missingSources[0];
    expect(entry?.category).toBe("agents");
    expect(entry?.sourcePath).toBe(missing);

    // The existing file was still deployed.
    expect(result.writtenFiles).toHaveLength(1);
    expect(result.writtenFiles[0]).toContain("agent-api-designer.md");
  });

  it("skip mode: records missing claudeMd source and still writes others", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-missing-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const missing = join(tmpRoot, "ghost-CLAUDE.md");

    const result = await deployPersona(
      {
        claudeMd: [missing, GLOBAL_BACKEND],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      sessionDir,
      claudeConfigDir,
      { onMissingSource: "skip" }
    );

    // The missing CLAUDE.md source is recorded.
    expect(result.missingSources.some((m) => m.category === "claudeMd")).toBe(true);

    // The GLOBAL_BACKEND still contributed, so claudeMdPath is set.
    expect(result.claudeMdPath).not.toBeNull();
    if (result.claudeMdPath === null) throw new Error("claudeMdPath must be non-null here");
    const content = await readFile(result.claudeMdPath, "utf8");
    expect(content).toContain("<!-- source:");
  });

  it("skip mode: all claudeMd sources missing → claudeMdPath is null", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-missing-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const missing1 = join(tmpRoot, "ghost1.md");
    const missing2 = join(tmpRoot, "ghost2.md");

    const result = await deployPersona(
      {
        claudeMd: [missing1, missing2],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
      },
      sessionDir,
      claudeConfigDir,
      { onMissingSource: "skip" }
    );

    expect(result.claudeMdPath).toBeNull();
    expect(result.missingSources).toHaveLength(2);
  });

  it("error instance is a PersonaDeployError subclass", async () => {
    const { PersonaDeployError } = await import("../src/errors.js");

    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-missing-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const missing = join(tmpRoot, "missing.md");

    let caught: unknown;
    try {
      await deployPersona(
        { claudeMd: [], agents: [missing], skills: [], slashCmds: [], memory: [] },
        sessionDir,
        claudeConfigDir
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(SourceFileNotFoundError);
    expect(caught).toBeInstanceOf(PersonaDeployError);
  });
});
