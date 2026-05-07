import { describe, expect, test } from "vitest";
import {
  buildProfileSkillsPersonaPatch,
  countProfileSkillsPersonaCapabilities,
  createProfileSkillsPersonaDraft,
  createSafeProfileSkillsPersonaCollisionSummary,
  createSafeProfileSkillsPersonaMissingSourceSummary,
  createSafeProfileSkillsPersonaPreviewSummary,
  formatProfileSkillsPersonaBridgeError,
  resolveProfileSkillsPersonaTarget,
  resolveProfileSkillsPersonaTargetFromList,
  shouldGuardProfileSkillsPersonaClose,
  validateProfileSkillsPersonaForm,
} from "../src/renderer/lib/profile-skills-persona.js";
import type { ScopeDoc, ScopeListEntry } from "../src/renderer/lib/types.js";

function scopeDoc(overrides: Partial<ScopeDoc> = {}): ScopeDoc {
  return {
    version: 1,
    profile: {
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
    },
    auth: { profileId: "work" },
    mcpServers: {
      github: {
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ${secret:github.pat}" },
      },
    },
    env: { SAFE_FLAG: "on" },
    settings: { model: "claude-sonnet" },
    persona: {
      claudeMd: ["CLAUDE.md"],
      agents: ["agents/reviewer.md"],
      skills: ["skills/react/SKILL.md"],
      slashCmds: [],
      memory: [],
    },
    use: ["project-shared"],
    disabledServers: ["legacy"],
    ...overrides,
  };
}

function entry(overrides: Partial<ScopeListEntry> = {}): ScopeListEntry {
  return {
    scope: "project-role",
    role: "backend-api-review",
    path: "/repo/project/.myclaude/roles/backend-api-review.yml",
    content: scopeDoc(),
    ...overrides,
  };
}

describe("profile skills and persona draft contract", () => {
  test("builds a persona-only patch from a writable project-role target", () => {
    const target = resolveProfileSkillsPersonaTarget({
      scopeEntries: [entry()],
      selectedRole: "backend api review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const result = buildProfileSkillsPersonaPatch({
      target,
      draft: {
        rows: [
          { id: "skill-row", category: "skills", ref: "skills/typescript/SKILL.md" },
          { id: "agent-row", category: "agents", ref: "agents/reviewer.md" },
          { id: "claude-row", category: "claudeMd", ref: "CLAUDE.md" },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected profile skills/persona patch");
    expect(result.path).toBe(target.path);
    expect(result.content).toMatchObject({
      profile: target.content.profile,
      auth: target.content.auth,
      mcpServers: target.content.mcpServers,
      env: target.content.env,
      settings: target.content.settings,
      use: target.content.use,
      disabledServers: target.content.disabledServers,
      persona: {
        claudeMd: ["CLAUDE.md"],
        agents: ["agents/reviewer.md"],
        skills: ["skills/typescript/SKILL.md"],
        slashCmds: [],
        memory: [],
      },
    });

    const summary = createSafeProfileSkillsPersonaPreviewSummary(target.content, result.content);
    expect(summary).toEqual([{ category: "skills", label: "typescript", change: "changed" }]);
    expect(JSON.stringify(summary)).not.toContain("skills/typescript/SKILL.md");
    expect(JSON.stringify(summary)).not.toContain(".myclaude");
    expect(JSON.stringify(summary)).not.toContain("${secret:");
  });

  test("projects existing persona rows with per-category dedupe, safe labels, and counts", () => {
    const target = resolveProfileSkillsPersonaTarget({
      scopeEntries: [
        entry({
          content: scopeDoc({
            persona: {
              claudeMd: ["docs/CLAUDE.md", "docs/CLAUDE.md"],
              agents: ["agents/reviewer.md"],
              skills: ["catalog/typescript/SKILL.md"],
              slashCmds: ["commands/release.md"],
              memory: ["memory/research-notes.md"],
            },
          }),
        }),
      ],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    let nextId = 0;
    const draft = createProfileSkillsPersonaDraft(target, () => `row-${++nextId}`);

    expect(draft.rows).toEqual([
      {
        id: "row-1",
        category: "claudeMd",
        ref: "docs/CLAUDE.md",
        originalRef: "docs/CLAUDE.md",
        displayLabel: "CLAUDE.md",
      },
      {
        id: "row-2",
        category: "agents",
        ref: "agents/reviewer.md",
        originalRef: "agents/reviewer.md",
        displayLabel: "reviewer.md",
      },
      {
        id: "row-3",
        category: "skills",
        ref: "catalog/typescript/SKILL.md",
        originalRef: "catalog/typescript/SKILL.md",
        displayLabel: "typescript",
      },
      {
        id: "row-4",
        category: "slashCmds",
        ref: "commands/release.md",
        originalRef: "commands/release.md",
        displayLabel: "release.md",
      },
      {
        id: "row-5",
        category: "memory",
        ref: "memory/research-notes.md",
        originalRef: "memory/research-notes.md",
        displayLabel: "research-notes.md",
      },
    ]);
    expect(countProfileSkillsPersonaCapabilities(target.content.persona)).toEqual([
      { category: "claudeMd", count: 2 },
      { category: "agents", count: 1 },
      { category: "skills", count: 1 },
      { category: "slashCmds", count: 1 },
      { category: "memory", count: 1 },
    ]);
    expect(draft.rows.map((row) => row.displayLabel).join("|")).not.toContain("/");
  });

  test("rejects missing, malformed, global, shared, and stale non-profile targets", () => {
    expect(resolveProfileSkillsPersonaTarget({ scopeEntries: [], selectedRole: "" })).toMatchObject(
      {
        status: "unavailable",
        role: null,
        message: "Choose an Agent Profile before editing skills and persona.",
      }
    );

    const globalTarget = resolveProfileSkillsPersonaTarget({
      scopeEntries: [entry({ scope: "global-role", path: "/global/raw.yml" })],
      selectedRole: "backend api review",
    });
    expect(globalTarget).toMatchObject({ status: "unavailable", role: "backend-api-review" });
    expect(JSON.stringify(globalTarget)).not.toContain("/global/raw.yml");

    const sharedTarget = resolveProfileSkillsPersonaTarget({
      scopeEntries: [entry({ scope: "project-shared", path: "/project/shared.yml" })],
      selectedRole: "backend api review",
    });
    expect(sharedTarget).toMatchObject({ status: "unavailable", role: "backend-api-review" });
    expect(JSON.stringify(sharedTarget)).not.toContain("/project/shared.yml");

    expect(
      resolveProfileSkillsPersonaTargetFromList({
        listed: [entry({ content: null })],
        selectedRole: "backend api review",
      })
    ).toMatchObject({
      status: "invalid",
      role: "backend-api-review",
      message:
        "Selected Agent Profile skills and persona could not be prepared. Refresh the profile and try again.",
    });
  });

  test("blocks empty rows, unsupported categories, duplicates, credentials, and absolute paths", () => {
    const target = resolveProfileSkillsPersonaTarget({
      scopeEntries: [entry()],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const validation = validateProfileSkillsPersonaForm({
      target,
      draft: {
        rows: [
          { id: "empty", category: "skills", ref: "   " },
          { id: "skill-one", category: "skills", ref: "skills/typescript/SKILL.md" },
          { id: "skill-two", category: "skills", ref: "skills/typescript/SKILL.md" },
          { id: "unsupported", category: "assets" as never, ref: "skills/other/SKILL.md" },
          { id: "token", category: "memory", ref: "ghp_secretvalue" },
          { id: "secret-ref", category: "claudeMd", ref: "${secret:persona}" },
          { id: "keyring", category: "agents", ref: "keyring://persona/agent" },
          {
            id: "absolute",
            category: "skills",
            ref: "/Users/alice/project/skills/private/SKILL.md",
          },
        ],
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.field)).toEqual([
      "ref",
      "ref",
      "category",
      "ref",
      "ref",
      "ref",
      "ref",
    ]);
    expect(validation.issues.map((issue) => issue.message)).toEqual([
      "Choose an installed or catalog-backed persona asset before saving.",
      "Each Skills & Persona asset can only appear once per category.",
      "Choose a supported Skills & Persona category before saving.",
      "Use a persona asset reference without tokens, keyring URIs, or secret references.",
      "Use a persona asset reference without tokens, keyring URIs, or secret references.",
      "Use a persona asset reference without tokens, keyring URIs, or secret references.",
      "Use a persona asset reference that can be shown by a safe name.",
    ]);

    const blocked = buildProfileSkillsPersonaPatch({
      target,
      draft: {
        rows: [
          {
            id: "absolute",
            category: "skills",
            ref: "/Users/alice/project/skills/private/SKILL.md",
          },
        ],
      },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.content).toBeNull();

    const serializedIssues = JSON.stringify({ validation, blocked });
    expect(serializedIssues).not.toContain("ghp_secretvalue");
    expect(serializedIssues).not.toContain("${secret:");
    expect(serializedIssues).not.toContain("keyring://");
    expect(serializedIssues).not.toContain("/Users/alice");
    expect(serializedIssues).not.toContain("private/SKILL.md");
    expect(serializedIssues).not.toContain("assets");
  });

  test("redacts missing sources, collisions, bridge errors, and dirty-close state", () => {
    const missing = createSafeProfileSkillsPersonaMissingSourceSummary([
      { category: "skills", sourcePath: "/Users/alice/project/.myclaude/skills/github/SKILL.md" },
      { category: "claudeMd", sourcePath: "keyring://persona/CLAUDE.md" },
    ]);
    expect(missing).toEqual([
      { category: "skills", label: "github", count: 1, detail: "Source could not be found." },
      {
        category: "claudeMd",
        label: "Claude memory",
        count: 1,
        detail: "Source could not be found.",
      },
    ]);

    const collisions = createSafeProfileSkillsPersonaCollisionSummary([
      {
        category: "agents",
        basename: "reviewer.md",
        winningSource: "/Users/alice/project/.myclaude/agents/reviewer.md",
        overriddenSources: ["/repo/.myclaude/agents/reviewer.md", "global-role"],
      },
    ]);
    expect(collisions).toEqual([
      {
        category: "agents",
        label: "reviewer.md",
        count: 2,
        detail: "2 sources are hidden by the selected asset.",
      },
    ]);

    expect(shouldGuardProfileSkillsPersonaClose({ isDirty: true, isSaving: false })).toBe(true);
    expect(shouldGuardProfileSkillsPersonaClose({ isDirty: false, isSaving: false })).toBe(false);
    expect(shouldGuardProfileSkillsPersonaClose({ isDirty: true, isSaving: true })).toBe(false);

    const fallback =
      "Skills & Persona could not be saved. Review the selected assets and try again.";
    const unsafe = formatProfileSkillsPersonaBridgeError(
      new Error(
        "preview failed for /Users/alice/project/.myclaude/roles/backend-api-review.yml project-role keyring://persona Bearer ghp_secretvalue"
      ),
      fallback
    );
    const generic = formatProfileSkillsPersonaBridgeError(
      new Error("persona preview failed"),
      fallback
    );

    expect(unsafe).toBe(fallback);
    expect(generic).toBe(
      "Skills & Persona could not be checked. Review the selected assets and try again."
    );
    const serialized = JSON.stringify({ missing, collisions, unsafe, generic });
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain(".myclaude");
    expect(serialized).not.toContain("project-role");
    expect(serialized).not.toContain("global-role");
    expect(serialized).not.toContain("keyring://");
    expect(serialized).not.toContain("ghp_secretvalue");
  });
});
