/**
 * Tests for `personaRenderService` — composes the cascade resolver with
 * `renderPersonaInMemory`.
 *
 * Each test builds a scratch `.myclaude` home (and optionally a project
 * tree) on disk, populates `roles/<role>.yml` and persona files, then runs
 * the service to verify the cascade-derived `provenanceMap` lines up with
 * the rendered output's `originScope` labels.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { personaRenderService } from "../src/persona/render.js";

let scratchRoot: string;

afterEach(() => {
  if (scratchRoot) {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

interface PersonaScopeFile {
  /** Relative directory under scratchRoot where the YAML lives. */
  scopeDir: string;
  /** Filename to write inside scopeDir. */
  scopeFilename: string;
  /** YAML body (already rendered). */
  yaml: string;
}

interface PersonaContentFile {
  /** Absolute or scratch-relative path. */
  path: string;
  /** Content to write. */
  content: string;
}

function setupHome(): { home: string } {
  scratchRoot = mkdtempSync(join(tmpdir(), "persona-render-svc-"));
  const home = join(scratchRoot, ".myclaude");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, "config", "global", "roles"), { recursive: true });
  return { home };
}

function writeYaml(scope: PersonaScopeFile): void {
  mkdirSync(scope.scopeDir, { recursive: true });
  writeFileSync(join(scope.scopeDir, scope.scopeFilename), scope.yaml, "utf8");
}

function writeContent(file: PersonaContentFile): void {
  mkdirSync(join(file.path, ".."), { recursive: true });
  writeFileSync(file.path, file.content, "utf8");
}

describe("personaRenderService — single-scope (global-role only)", () => {
  it("renders claudeMd + agents from a single global-role scope", async () => {
    const { home } = setupHome();
    const personaDir = join(home, "persona");
    const claudeMdPath = join(personaDir, "global-CLAUDE.md");
    const agentPath = join(personaDir, "global-agent.md");

    writeContent({ path: claudeMdPath, content: "# Global CLAUDE.md\n" });
    writeContent({ path: agentPath, content: "# Global agent\n" });

    writeYaml({
      scopeDir: join(home, "config", "global", "roles"),
      scopeFilename: "backend.yml",
      yaml: `version: 1
persona:
  claudeMd:
    - ${claudeMdPath}
  agents:
    - ${agentPath}
`,
    });

    const result = await personaRenderService({
      role: "backend",
      home,
      cwd: home,
    });

    expect(result.claudeMd).not.toBeNull();
    expect(result.claudeMd?.sections).toHaveLength(1);
    expect(result.claudeMd?.sections[0]?.originScope).toBe("global-role");
    expect(result.claudeMd?.combinedContent).toContain("<!-- source: global-role -->");

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.category).toBe("agents");
    expect(result.files[0]?.basename).toBe("global-agent.md");
    expect(result.files[0]?.originScope).toBe("global-role");
    expect(result.files[0]?.content).toContain("# Global agent");

    expect(result.collisions).toHaveLength(0);
    expect(result.missingSources).toHaveLength(0);
  });

  it("empty persona arrays in scope produce empty result with claudeMd null", async () => {
    const { home } = setupHome();

    writeYaml({
      scopeDir: join(home, "config", "global", "roles"),
      scopeFilename: "backend.yml",
      yaml: `version: 1
env:
  EDITOR: nvim
`,
    });

    const result = await personaRenderService({
      role: "backend",
      home,
      cwd: home,
    });

    expect(result.claudeMd).toBeNull();
    expect(result.files).toHaveLength(0);
    expect(result.collisions).toHaveLength(0);
    expect(result.missingSources).toHaveLength(0);
  });
});

describe("personaRenderService — multi-scope cascade with provenance map labels", () => {
  it("merges global-role + project-shared + project-role with correct origin labels", async () => {
    const { home } = setupHome();

    // Project tree.
    const projectDir = join(scratchRoot, "project");
    mkdirSync(join(projectDir, ".myclaude", "roles"), { recursive: true });

    // Persona files (fragments) in distinct locations to keep provenance crisp.
    const globalClaudeMd = join(home, "persona", "global-CLAUDE.md");
    const projectSharedClaudeMd = join(projectDir, "persona", "shared-CLAUDE.md");
    const projectRoleClaudeMd = join(projectDir, "persona", "role-CLAUDE.md");
    const globalAgent = join(home, "persona", "agents", "global-agent.md");
    const projectRoleAgent = join(projectDir, "persona", "agents", "project-agent.md");

    writeContent({ path: globalClaudeMd, content: "# Global CLAUDE.md\n" });
    writeContent({ path: projectSharedClaudeMd, content: "# Project shared CLAUDE.md\n" });
    writeContent({ path: projectRoleClaudeMd, content: "# Project role CLAUDE.md\n" });
    writeContent({ path: globalAgent, content: "# Global agent\n" });
    writeContent({ path: projectRoleAgent, content: "# Project role agent\n" });

    writeYaml({
      scopeDir: join(home, "config", "global", "roles"),
      scopeFilename: "backend.yml",
      yaml: `version: 1
persona:
  claudeMd:
    - ${globalClaudeMd}
  agents:
    - ${globalAgent}
`,
    });

    writeYaml({
      scopeDir: join(projectDir, ".myclaude"),
      scopeFilename: "shared.yml",
      yaml: `version: 1
persona:
  claudeMd:
    - ${projectSharedClaudeMd}
`,
    });

    writeYaml({
      scopeDir: join(projectDir, ".myclaude", "roles"),
      scopeFilename: "backend.yml",
      yaml: `version: 1
persona:
  claudeMd:
    - ${projectRoleClaudeMd}
  agents:
    - ${projectRoleAgent}
`,
    });

    const result = await personaRenderService({
      role: "backend",
      home,
      cwd: projectDir,
    });

    // Three CLAUDE.md sections in cascade order. The cascade engine
    // disambiguates project-level scopes by suffixing the project label, so
    // we assert with `startsWith` rather than exact equality.
    expect(result.claudeMd).not.toBeNull();
    expect(result.claudeMd?.sections).toHaveLength(3);
    expect(result.claudeMd?.sections[0]?.originScope).toBe("global-role");
    expect(result.claudeMd?.sections[1]?.originScope.startsWith("project-shared")).toBe(true);
    expect(result.claudeMd?.sections[2]?.originScope.startsWith("project-role")).toBe(true);

    // Combined content has each marker (prefix match — full label includes path).
    const combined = result.claudeMd?.combinedContent ?? "";
    expect(combined).toContain("<!-- source: global-role -->");
    expect(combined).toMatch(/<!-- source: project-shared(:|\s)/);
    expect(combined).toMatch(/<!-- source: project-role(:|\s)/);

    // Two agents from two distinct scopes.
    expect(result.files).toHaveLength(2);
    const agentByName = new Map(result.files.map((f) => [f.basename, f]));
    expect(agentByName.get("global-agent.md")?.originScope).toBe("global-role");
    expect(agentByName.get("project-agent.md")?.originScope.startsWith("project-role")).toBe(true);

    expect(result.collisions).toHaveLength(0);
    expect(result.missingSources).toHaveLength(0);
  });

  it("multi-scope with shared basename: collision is logged and winner overrides", async () => {
    const { home } = setupHome();
    const projectDir = join(scratchRoot, "project");
    mkdirSync(join(projectDir, ".myclaude", "roles"), { recursive: true });

    // Same basename in both scopes — last-wins semantics from copyFiles.
    const globalAgent = join(home, "persona", "global", "reviewer.md");
    const projectAgent = join(projectDir, "persona", "project", "reviewer.md");

    writeContent({ path: globalAgent, content: "# Global reviewer\n" });
    writeContent({ path: projectAgent, content: "# Project reviewer\n" });

    writeYaml({
      scopeDir: join(home, "config", "global", "roles"),
      scopeFilename: "backend.yml",
      yaml: `version: 1
persona:
  agents:
    - ${globalAgent}
`,
    });

    writeYaml({
      scopeDir: join(projectDir, ".myclaude", "roles"),
      scopeFilename: "backend.yml",
      yaml: `version: 1
persona:
  agents:
    - ${projectAgent}
`,
    });

    const result = await personaRenderService({
      role: "backend",
      home,
      cwd: projectDir,
    });

    // One collision: global was overridden by project.
    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]?.category).toBe("agents");
    expect(result.collisions[0]?.target).toBe("reviewer.md");
    expect(result.collisions[0]?.overriddenSource).toBe(globalAgent);
    expect(result.collisions[0]?.winningSource).toBe(projectAgent);

    // Surviving file is the project version with project-role originScope.
    // (project-role label is suffixed with the project path label.)
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.sourcePath).toBe(projectAgent);
    expect(result.files[0]?.originScope.startsWith("project-role")).toBe(true);
    expect(result.files[0]?.content).toContain("# Project reviewer");
  });
});

describe("personaRenderService — missing-source policy default", () => {
  it("missing persona files are tolerated under the implicit 'skip' policy", async () => {
    const { home } = setupHome();

    // Reference a file path that intentionally does not exist on disk.
    const ghostMd = join(home, "persona", "ghost-CLAUDE.md");

    writeYaml({
      scopeDir: join(home, "config", "global", "roles"),
      scopeFilename: "backend.yml",
      yaml: `version: 1
persona:
  claudeMd:
    - ${ghostMd}
`,
    });

    const result = await personaRenderService({
      role: "backend",
      home,
      cwd: home,
    });

    // claudeMd is non-null because the cascade contributed paths, but every
    // section was skipped → empty sections array, empty combined string.
    expect(result.claudeMd).not.toBeNull();
    expect(result.claudeMd?.sections).toHaveLength(0);
    expect(result.claudeMd?.combinedContent).toBe("");

    // Missing source is recorded under category 'claudeMd'.
    expect(result.missingSources).toHaveLength(1);
    expect(result.missingSources[0]?.category).toBe("claudeMd");
    expect(result.missingSources[0]?.sourcePath).toBe(ghostMd);
  });
});
