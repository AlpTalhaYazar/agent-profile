import { describe, expect, test } from "vitest";
import {
  buildProfileMcpToolsPatch,
  createDefaultProfileMcpToolDraft,
  createGitHubProfileMcpToolDraft,
  createProfileMcpToolsDraft,
  createSafeProfileMcpToolsPreviewSummary,
  formatProfileMcpToolsBridgeError,
  resolveProfileMcpToolsTarget,
  shouldGuardProfileMcpToolsClose,
  validateProfileMcpToolsForm,
} from "../src/renderer/lib/profile-mcp-tools.js";
import type { ScopeDoc, ScopeListEntry } from "../src/renderer/lib/types.js";

function scopeDoc(overrides: Partial<ScopeDoc> = {}): ScopeDoc {
  return {
    version: 1,
    profile: {
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
    },
    auth: { profileId: "work" },
    mcpServers: {},
    env: { SAFE_FLAG: "on" },
    settings: { model: "claude-sonnet" },
    persona: {
      claudeMd: ["CLAUDE.md"],
      agents: ["agents/reviewer.md"],
      skills: ["skills/react/SKILL.md"],
      slashCmds: [],
      memory: [],
    },
    use: [],
    disabledServers: [],
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

describe("profile MCP tools draft contract", () => {
  test("creates a GitHub-style MCP server patch using logical secret names only", () => {
    const target = resolveProfileMcpToolsTarget({
      scopeEntries: [entry()],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const draft = {
      tools: [
        createGitHubProfileMcpToolDraft({
          id: "github-row",
          name: "github",
          url: "https://api.githubcopilot.com/mcp/",
          secretName: "github.pat",
        }),
      ],
    };

    const result = buildProfileMcpToolsPatch({ target, draft });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected MCP tools patch");
    expect(result.path).toBe(target.path);
    expect(result.content).toMatchObject({
      profile: target.content.profile,
      auth: target.content.auth,
      env: target.content.env,
      settings: target.content.settings,
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "Bearer ${secret:github.pat}" },
          enabled: true,
          __merge: "replace",
        },
      },
    });

    const summary = createSafeProfileMcpToolsPreviewSummary(target.content, result.content);
    expect(summary).toEqual([
      {
        change: "added",
        name: "github",
        transport: "http",
        detail: "Adds 1 header secret",
      },
    ]);
    const serialized = JSON.stringify(summary);
    expect(JSON.stringify(draft)).toContain("github.pat");
    expect(serialized).not.toContain("${secret:");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("keyring://");
    expect(serialized).not.toContain(".myclaude");
  });

  test("projects existing secret-backed tools without exposing raw secret templates", () => {
    const target = resolveProfileMcpToolsTarget({
      scopeEntries: [
        entry({
          content: scopeDoc({
            mcpServers: {
              github: {
                type: "http",
                url: "https://github.example/mcp",
                headers: { Authorization: "Bearer ${secret:github.pat}" },
                env: { GITHUB_TOKEN: "${secret:github.pat}" },
              },
            },
          }),
        }),
      ],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const draft = createProfileMcpToolsDraft(target);

    expect(draft.tools).toHaveLength(1);
    expect(draft.tools[0]).toMatchObject({
      name: "github",
      transport: "http",
      commandOrUrl: "https://github.example/mcp",
      headerRows: [{ key: "Authorization", secretName: "github.pat" }],
      envRows: [{ key: "GITHUB_TOKEN", secretName: "github.pat" }],
      hiddenAdvancedFieldCount: 0,
    });
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain("${secret:");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("keyring://");
  });

  test("blocks malformed, duplicate, unsupported, and raw credential-bearing drafts before IPC", () => {
    const target = resolveProfileMcpToolsTarget({
      scopeEntries: [entry()],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const validation = validateProfileMcpToolsForm({
      target,
      draft: {
        tools: [
          createDefaultProfileMcpToolDraft({
            id: "empty-command",
            name: "github",
            transport: "stdio",
            commandOrUrl: "",
          }),
          createDefaultProfileMcpToolDraft({
            id: "duplicate",
            name: "github",
            transport: "http",
            commandOrUrl: "not a url",
            headerRows: [
              { id: "raw-header", key: "Authorization", secretName: "ghp_secretvalue" },
            ],
          }),
          createDefaultProfileMcpToolDraft({
            id: "unsupported",
            name: "bad-transport",
            transport: "websocket" as never,
            commandOrUrl: "https://example.test/mcp",
            envRows: [{ id: "raw-env", key: "API_TOKEN", secretName: "keyring://mcp/github" }],
          }),
        ],
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.field)).toEqual([
      "commandOrUrl",
      "name",
      "commandOrUrl",
      "headers",
      "transport",
      "env",
    ]);
    expect(validation.issues.map((issue) => issue.message)).toEqual([
      "Stdio MCP tools need a command before preview or save.",
      "Each MCP server name can only appear once.",
      "Remote MCP tools need a valid http or https URL before preview or save.",
      "Use a logical secret name such as github.pat instead of a raw token or keyring URI.",
      "Choose a supported MCP transport before preview or save.",
      "Use a logical secret name such as github.pat instead of a raw token or keyring URI.",
    ]);

    const serializedIssues = JSON.stringify(validation.issues);
    expect(serializedIssues).not.toContain("ghp_secretvalue");
    expect(serializedIssues).not.toContain("keyring://");
    expect(serializedIssues).not.toContain("Authorization");
    expect(serializedIssues).not.toContain("API_TOKEN");
  });

  test("blocks saving tools with advanced hidden env/header values to avoid data loss", () => {
    const target = resolveProfileMcpToolsTarget({
      scopeEntries: [
        entry({
          content: scopeDoc({
            mcpServers: {
              custom: {
                type: "http",
                url: "https://custom.example/mcp",
                headers: { "X-Workspace": "literal-workspace-header" },
              },
            },
          }),
        }),
      ],
      selectedRole: "backend-api-review",
    });
    expect(target.status).toBe("writable");
    if (target.status !== "writable") throw new Error("expected writable target");

    const draft = createProfileMcpToolsDraft(target);
    expect(draft.tools[0]?.hiddenAdvancedFieldCount).toBe(1);

    const result = buildProfileMcpToolsPatch({ target, draft });

    expect(result.ok).toBe(false);
    expect(result.content).toBeNull();
    expect(result.issues).toContainEqual({
      field: "advanced",
      path: "mcpServers.custom.advanced",
      message:
        "This MCP tool has advanced values hidden from the guided editor. Open Profile Workspace to edit it safely.",
      severity: "error",
    });
    const serialized = JSON.stringify({ draft, result });
    expect(serialized).not.toContain("literal-workspace-header");
    expect(serialized).not.toContain("X-Workspace");
  });

  test("guards dirty guided tool edits and redacts bridge errors", () => {
    expect(shouldGuardProfileMcpToolsClose({ isDirty: true, isSaving: false })).toBe(true);
    expect(shouldGuardProfileMcpToolsClose({ isDirty: false, isSaving: false })).toBe(false);
    expect(shouldGuardProfileMcpToolsClose({ isDirty: true, isSaving: true })).toBe(false);

    const message = formatProfileMcpToolsBridgeError(
      new Error(
        "save failed for /repo/project/.myclaude/roles/backend-api-review.yml project-role keyring://mcp/github Bearer ghp_secretvalue"
      ),
      "Profile Tools could not be saved. Review the fields and try again."
    );

    expect(message).toBe("Profile Tools could not be saved. Review the fields and try again.");
    expect(message).not.toContain(".myclaude");
    expect(message).not.toContain("project-role");
    expect(message).not.toContain("keyring://");
    expect(message).not.toContain("ghp_secretvalue");
  });
});
