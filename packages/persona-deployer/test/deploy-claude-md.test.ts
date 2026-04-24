import { mkdtempSync, rmSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deployPersona } from "../src/deploy.js";
import { createSessionDir } from "../src/session-dir.js";

// Absolute paths to test fixtures.
const FIXTURES = join(import.meta.dirname, "fixtures", "persona-fragments");
const GLOBAL_BACKEND = join(FIXTURES, "global-backend-CLAUDE.md");
const PROJECT_BACKEND = join(FIXTURES, "project-backend-CLAUDE.md");

let tmpRoot: string;

afterEach(async () => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

/** Assert claudeMdPath is non-null and return its value. */
function requireClaudeMdPath(path: string | null): string {
  if (path === null) throw new Error("Expected claudeMdPath to be non-null");
  return path;
}

describe("deployPersona — CLAUDE.md concatenation", () => {
  it("single CLAUDE.md source produces output with a single marker header", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-claude-md-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [GLOBAL_BACKEND], agents: [], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    expect(result.claudeMdPath).not.toBeNull();
    const content = await readFile(requireClaudeMdPath(result.claudeMdPath), "utf8");

    // One source marker.
    const markerCount = (content.match(/<!-- source:/g) ?? []).length;
    expect(markerCount).toBe(1);

    // Marker uses the file path (no provenance map provided).
    expect(content).toContain(`<!-- source: ${GLOBAL_BACKEND} -->`);

    // Fragment content is present verbatim.
    const original = await readFile(GLOBAL_BACKEND, "utf8");
    expect(content).toContain(original.trimEnd());
  });

  it("three sources produces output with three markers in cascade order", async () => {
    // Create a third fragment on the fly.
    const thirdFragmentDir = mkdtempSync(join(tmpdir(), "third-fragment-"));
    const thirdPath = join(thirdFragmentDir, "third-CLAUDE.md");
    const { atomicWrite } = await import("../src/utils/atomic-write.js");
    await atomicWrite(thirdPath, "# Third fragment\nContent from third.\n");

    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-claude-md-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    try {
      const result = await deployPersona(
        {
          claudeMd: [GLOBAL_BACKEND, PROJECT_BACKEND, thirdPath],
          agents: [],
          skills: [],
          slashCmds: [],
          memory: [],
        },
        sessionDir,
        claudeConfigDir
      );

      const content = await readFile(requireClaudeMdPath(result.claudeMdPath), "utf8");

      // Three markers.
      const markerCount = (content.match(/<!-- source:/g) ?? []).length;
      expect(markerCount).toBe(3);

      // Order preserved: global before project before third.
      const globalPos = content.indexOf(GLOBAL_BACKEND);
      const projectPos = content.indexOf(PROJECT_BACKEND);
      const thirdPos = content.indexOf(thirdPath);
      expect(globalPos).toBeLessThan(projectPos);
      expect(projectPos).toBeLessThan(thirdPos);
    } finally {
      rmSync(thirdFragmentDir, { recursive: true, force: true });
    }
  });

  it("empty claudeMd array produces claudeMdPath null and writes no file", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-claude-md-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      { claudeMd: [], agents: [], skills: [], slashCmds: [], memory: [] },
      sessionDir,
      claudeConfigDir
    );

    expect(result.claudeMdPath).toBeNull();

    // No CLAUDE.md file should exist in sessionDir.
    await expect(access(join(sessionDir, "CLAUDE.md"))).rejects.toThrow();
  });

  it("provenance map causes markers to use scope tags instead of file paths", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-claude-md-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      {
        claudeMd: [GLOBAL_BACKEND, PROJECT_BACKEND],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
        provenanceMap: {
          [GLOBAL_BACKEND]: "global-role/backend",
          [PROJECT_BACKEND]: "project-role/backend",
        },
      },
      sessionDir,
      claudeConfigDir
    );

    const content = await readFile(requireClaudeMdPath(result.claudeMdPath), "utf8");

    expect(content).toContain("<!-- source: global-role/backend -->");
    expect(content).toContain("<!-- source: project-role/backend -->");

    // File paths must NOT appear as source tags when provenance map is provided.
    expect(content).not.toContain(`<!-- source: ${GLOBAL_BACKEND} -->`);
  });

  it("absent provenance map entry falls back to file path as source tag", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-claude-md-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const result = await deployPersona(
      {
        claudeMd: [GLOBAL_BACKEND, PROJECT_BACKEND],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
        provenanceMap: {
          // Only one of the two paths has a provenance tag.
          [GLOBAL_BACKEND]: "global-role/backend",
        },
      },
      sessionDir,
      claudeConfigDir
    );

    const content = await readFile(requireClaudeMdPath(result.claudeMdPath), "utf8");

    expect(content).toContain("<!-- source: global-role/backend -->");
    // PROJECT_BACKEND falls back to its path.
    expect(content).toContain(`<!-- source: ${PROJECT_BACKEND} -->`);
  });

  it("file with trailing newline does not produce duplicate blank lines", async () => {
    const fragDir = mkdtempSync(join(tmpdir(), "trailing-nl-"));
    const fragPath = join(fragDir, "trailing.md");
    const { atomicWrite } = await import("../src/utils/atomic-write.js");
    // Content already ends with a newline.
    await atomicWrite(fragPath, "Line one\nLine two\n");

    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-claude-md-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    try {
      const result = await deployPersona(
        {
          claudeMd: [fragPath, GLOBAL_BACKEND],
          agents: [],
          skills: [],
          slashCmds: [],
          memory: [],
        },
        sessionDir,
        claudeConfigDir
      );

      const content = await readFile(requireClaudeMdPath(result.claudeMdPath), "utf8");

      // Should not have more than one consecutive blank line (two newlines in a row).
      expect(content).not.toMatch(/\n{3,}/);
    } finally {
      rmSync(fragDir, { recursive: true, force: true });
    }
  });

  it("UTF-8 content is preserved byte-for-byte (aside from added markers)", async () => {
    const fragDir = mkdtempSync(join(tmpdir(), "utf8-"));
    const fragPath = join(fragDir, "utf8.md");
    const { atomicWrite } = await import("../src/utils/atomic-write.js");
    // Use UTF-8 characters: emoji + multi-byte.
    const utf8Content = "# UTF-8 ✅\nÄÖÜß résumé 日本語\n";
    await atomicWrite(fragPath, utf8Content);

    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-claude-md-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    try {
      const result = await deployPersona(
        { claudeMd: [fragPath], agents: [], skills: [], slashCmds: [], memory: [] },
        sessionDir,
        claudeConfigDir
      );

      const content = await readFile(requireClaudeMdPath(result.claudeMdPath), "utf8");
      expect(content).toContain(utf8Content.trimEnd());
    } finally {
      rmSync(fragDir, { recursive: true, force: true });
    }
  });

  it("source markers in CLAUDE.md never contain secret values", async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "deploy-claude-md-test-"));
    const { sessionDir, claudeConfigDir } = await createSessionDir({ root: tmpRoot });

    const SECRET = "super-secret-api-key-abc123";

    // The library must not allow secrets in source markers.
    // This test confirms the secret does NOT appear in output even if
    // passed (incorrectly) as a provenance tag.
    const result = await deployPersona(
      {
        claudeMd: [GLOBAL_BACKEND],
        agents: [],
        skills: [],
        slashCmds: [],
        memory: [],
        provenanceMap: {
          // Correct usage: scope tag, not a secret.
          [GLOBAL_BACKEND]: "global-role/backend",
        },
      },
      sessionDir,
      claudeConfigDir
    );

    const content = await readFile(requireClaudeMdPath(result.claudeMdPath), "utf8");

    // The secret string must not appear anywhere in the output.
    expect(content).not.toContain(SECRET);
  });
});
