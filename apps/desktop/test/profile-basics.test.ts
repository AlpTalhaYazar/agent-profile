import { describe, expect, test } from "vitest";
import {
  buildProfileBasicsPatch,
  buildProfileBasicsDraftFromRows,
  createProfileBasicsDraft,
  createSafeProfileBasicsPreviewSummary,
  resolveProfileBasicsTarget,
  shouldGuardProfileBasicsClose,
  validateProfileBasicsDraft,
  validateProfileBasicsForm,
} from "../src/renderer/lib/profile-basics.js";
import type { AuthProfileOption, ScopeDoc, ScopeListEntry } from "../src/renderer/lib/types.js";

const workAuth: AuthProfileOption = {
  id: "work",
  displayName: "Work Claude",
  mode: "oauth",
  secretCount: 1,
  secretNames: ["github.pat"],
};

const personalAuth: AuthProfileOption = {
  id: "personal",
  displayName: "Personal Claude",
  mode: "apiKey",
  secretCount: 0,
  secretNames: [],
};

function scopeDoc(overrides: Partial<ScopeDoc> = {}): ScopeDoc {
  return {
    version: 1,
    profile: {
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
    },
    auth: { profileId: "work" },
    mcpServers: {
      browser: {
        type: "stdio",
        command: "npx",
        args: ["@agent-browser/cli"],
        env: { SAFE_MCP_FLAG: "enabled" },
      },
    },
    env: { FEATURE_FLAG: "off" },
    settings: { model: "claude-opus" },
    persona: {
      claudeMd: ["CLAUDE.md"],
      agents: ["agents/reviewer.md"],
      skills: ["skills/react/SKILL.md"],
      slashCmds: ["commands/review.md"],
      memory: ["memory/review.md"],
    },
    use: ["browser"],
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

describe("profile basics target and draft contract", () => {
  test("patches the selected project role basics without dropping advanced scope fields", () => {
    const globalLayer = entry({
      scope: "global-role",
      path: "/home/.myclaude/roles/backend-api-review.yml",
      content: scopeDoc({ profile: { displayName: "Global Backend", purpose: "Global default" } }),
    });
    const projectLayer = entry({
      scope: "project-role",
      path: "/repo/project/.myclaude/roles/backend-api-review.yml",
    });

    const target = resolveProfileBasicsTarget({
      scopeEntries: [globalLayer, projectLayer],
      selectedRole: "backend-api-review",
    });

    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");
    expect(target.path).toBe(projectLayer.path);

    const draft = createProfileBasicsDraft(target, {
      role: "backend-api-review",
      authProfileId: "work",
      cwd: "/repo/project",
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
    });

    expect(draft).toMatchObject({
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
      authProfileId: "work",
      cwd: "/repo/project",
      env: { FEATURE_FLAG: "off" },
      settingsJson: '{\n  "model": "claude-opus"\n}',
    });

    const result = buildProfileBasicsPatch({
      target,
      authProfiles: [workAuth, personalAuth],
      draft: {
        ...draft,
        displayName: "Backend Launch Guide",
        purpose: "Review backend launch readiness",
        authProfileId: "personal",
        cwd: "/repo/project",
        env: { FEATURE_FLAG: "on" },
        settingsJson: '{"model":"claude-sonnet"}',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected basics patch");
    expect(result.path).toBe(projectLayer.path);
    expect(result.selection).toEqual({
      role: "backend-api-review",
      authProfileId: "personal",
      cwd: "/repo/project",
    });
    expect(result.content).toMatchObject({
      profile: {
        displayName: "Backend Launch Guide",
        purpose: "Review backend launch readiness",
      },
      auth: { profileId: "personal" },
      env: { FEATURE_FLAG: "on" },
      settings: { model: "claude-sonnet" },
      mcpServers: projectLayer.content?.mcpServers,
      persona: projectLayer.content?.persona,
      use: ["browser"],
      disabledServers: ["legacy"],
    });
    expect(result.content).not.toHaveProperty("cwd");
  });

  test("returns calm unavailable or invalid targets for missing project-owned scope content", () => {
    const missingRole = resolveProfileBasicsTarget({ scopeEntries: [entry()], selectedRole: "" });
    const globalOnly = resolveProfileBasicsTarget({
      scopeEntries: [
        entry({ scope: "global-role", path: "/home/.myclaude/roles/backend-api-review.yml" }),
      ],
      selectedRole: "backend-api-review",
    });
    const nullProjectContent = resolveProfileBasicsTarget({
      scopeEntries: [entry({ content: null })],
      selectedRole: "backend-api-review",
    });

    expect(missingRole).toMatchObject({
      status: "unavailable",
      message: "Choose an Agent Profile before editing basics.",
    });
    expect(globalOnly).toMatchObject({
      status: "unavailable",
      message:
        "This Agent Profile needs a writable project layer before guided basics can be saved.",
    });
    expect(nullProjectContent).toMatchObject({
      status: "invalid",
      message:
        "Selected Agent Profile basics could not be prepared. Refresh the profile and try again.",
    });

    const serialized = JSON.stringify([missingRole, globalOnly, nullProjectContent]);
    expect(serialized).not.toContain(".myclaude");
    expect(serialized).not.toContain("project-role");
    expect(serialized).not.toContain("global-role");
  });

  test("blocks save for stale identities and invalid settings JSON without producing a patch", () => {
    const target = resolveProfileBasicsTarget({
      scopeEntries: [entry({ content: scopeDoc({ auth: { profileId: "deleted" } }) })],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const draft = createProfileBasicsDraft(target, {
      role: "backend-api-review",
      authProfileId: "deleted",
      cwd: "/repo/project",
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
    });

    const result = buildProfileBasicsPatch({
      target,
      authProfiles: [workAuth],
      draft: { ...draft, settingsJson: "{not valid json" },
    });

    expect(result.ok).toBe(false);
    expect(result.content).toBeNull();
    expect(result.path).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toEqual(["settings", "authProfileId"]);
    expect(result.issues.map((issue) => issue.message)).toEqual([
      "Settings must be valid JSON.",
      "Choose an available Claude identity before saving basics.",
    ]);
  });

  test("validates unsafe env keys, secret-like labels, and token-like values without echoing them", () => {
    const validation = validateProfileBasicsDraft({
      authProfiles: [workAuth],
      draft: {
        displayName: "Bearer ghp_displaytoken",
        purpose: "Use ${secret:profile-purpose}",
        authProfileId: "work",
        cwd: "/repo/project",
        env: {
          "BAD-KEY": "enabled",
          ANTHROPIC_API_KEY: "Bearer ghp_envtoken",
        },
        settingsJson: JSON.stringify({
          secretRef: "keyring://anthropic/work",
          model: "claude-sonnet",
        }),
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.field)).toEqual([
      "displayName",
      "purpose",
      "env",
      "env",
      "settings",
    ]);
    expect(validation.issues.map((issue) => issue.path)).toEqual([
      "displayName",
      "purpose",
      "env",
      "env.ANTHROPIC_API_KEY",
      "settings",
    ]);

    const serializedIssues = JSON.stringify(validation.issues);
    expect(serializedIssues).not.toContain("ghp_displaytoken");
    expect(serializedIssues).not.toContain("${secret:");
    expect(serializedIssues).not.toContain("ghp_envtoken");
    expect(serializedIssues).not.toContain("keyring://");
    expect(serializedIssues).not.toContain("secretRef");
  });

  test("validates guided form env rows before save so duplicate keys cannot be hidden by object coercion", () => {
    const target = resolveProfileBasicsTarget({
      scopeEntries: [entry()],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const draft = createProfileBasicsDraft(target, {
      role: "backend-api-review",
      authProfileId: "work",
      cwd: "/repo/project",
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
    });

    const rowDraft = buildProfileBasicsDraftFromRows(draft, [
      { id: "one", key: "FEATURE_FLAG", value: "on" },
      { id: "two", key: "FEATURE_FLAG", value: "off" },
      { id: "blank", key: "", value: "" },
    ]);
    const validation = validateProfileBasicsForm({
      target,
      authProfiles: [workAuth],
      draft,
      envRows: [
        { id: "one", key: "FEATURE_FLAG", value: "on" },
        { id: "two", key: "FEATURE_FLAG", value: "off" },
      ],
    });

    expect(rowDraft.draft.env).toEqual({ FEATURE_FLAG: "on" });
    expect(rowDraft.issues).toContainEqual({
      field: "env",
      path: "env.FEATURE_FLAG",
      message: "Each environment variable name can only appear once.",
      severity: "error",
    });
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.message)).toContain(
      "Each environment variable name can only appear once."
    );
  });

  test("guided form blocks empty auth lists, missing selected profiles, and invalid settings JSON", () => {
    const target = resolveProfileBasicsTarget({
      scopeEntries: [entry()],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const draft = createProfileBasicsDraft(target, {
      role: "backend-api-review",
      authProfileId: "work",
      cwd: "/repo/project",
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
    });

    const emptyAuth = validateProfileBasicsForm({
      target,
      authProfiles: [],
      draft,
      envRows: [],
    });
    const missingSelectedProfile = validateProfileBasicsForm({
      target: resolveProfileBasicsTarget({ scopeEntries: [entry()], selectedRole: "" }),
      authProfiles: [workAuth],
      draft,
      envRows: [],
    });
    const invalidJson = validateProfileBasicsForm({
      target,
      authProfiles: [workAuth],
      draft: { ...draft, settingsJson: "{not json" },
      envRows: [],
    });

    expect(emptyAuth.ok).toBe(false);
    expect(emptyAuth.issues.map((issue) => issue.field)).toContain("authProfileId");
    expect(missingSelectedProfile.ok).toBe(false);
    expect(missingSelectedProfile.issues).toContainEqual({
      field: "target",
      path: "target",
      message: "Choose an Agent Profile before editing basics.",
      severity: "error",
    });
    expect(invalidJson.ok).toBe(false);
    expect(invalidJson.issues).toContainEqual({
      field: "settings",
      path: "settings",
      message: "Settings must be valid JSON.",
      severity: "error",
    });
  });

  test("safe preview summaries report impact without token-like values, secret refs, or raw scope paths", () => {
    const before = scopeDoc({
      auth: { profileId: "work" },
      env: {
        ANTHROPIC_API_KEY: "sk-ant-before",
        FEATURE_FLAG: "off",
      },
      settings: {
        model: "claude-opus",
        secretRef: "keyring://anthropic/work",
      },
    });
    const after = scopeDoc({
      auth: { profileId: "personal" },
      env: {
        ANTHROPIC_API_KEY: "sk-ant-after",
        FEATURE_FLAG: "on",
      },
      settings: {
        model: "claude-sonnet",
      },
    });

    const summary = createSafeProfileBasicsPreviewSummary(before, after);
    expect(summary).toEqual(
      expect.arrayContaining([
        { section: "identity", key: "Claude identity", change: "changed" },
        { section: "environment", key: "environment variable", change: "changed" },
        { section: "environment", key: "FEATURE_FLAG", change: "changed" },
        { section: "settings", key: "model", change: "changed" },
        { section: "settings", key: "advanced setting", change: "removed" },
      ])
    );

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("sk-ant-before");
    expect(serialized).not.toContain("sk-ant-after");
    expect(serialized).not.toContain("keyring://");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain(".myclaude");
    expect(serialized).not.toContain("project-role");
  });

  test("dirty close guard only prompts for unsaved editable Basics state", () => {
    expect(shouldGuardProfileBasicsClose({ isDirty: true, isSaving: false })).toBe(true);
    expect(shouldGuardProfileBasicsClose({ isDirty: false, isSaving: false })).toBe(false);
    expect(shouldGuardProfileBasicsClose({ isDirty: true, isSaving: true })).toBe(false);
  });
});
