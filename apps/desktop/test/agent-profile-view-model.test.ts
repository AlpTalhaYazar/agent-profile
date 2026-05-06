import { describe, expect, test } from "vitest";
import {
  deriveAgentProfileLibraryViewModel,
  deriveAgentProfileViewModel,
  type AgentProfileViewModelInput,
} from "../src/renderer/lib/agent-profile-view-model.js";
import { normalizeAuthProfiles } from "../src/renderer/lib/normalize.js";
import type { AuthProfileOption, EffectiveConfig } from "../src/renderer/lib/types.js";

const workAuth: AuthProfileOption = {
  id: "work-oauth",
  displayName: "Work Claude",
  mode: "oauth",
  secretCount: 2,
  secretNames: ["github.pat", "browser.token"],
};

const secretLikeAuth: AuthProfileOption = {
  id: "keyring://anthropic/work",
  displayName: "Bearer ${secret:github.pat}",
  mode: "apiKey",
  secretCount: 0,
  secretNames: [],
};

function effective(overrides: Partial<EffectiveConfig> = {}): EffectiveConfig {
  return {
    mcpServers: {},
    env: {},
    settings: {},
    persona: {
      claudeMd: [],
      agents: [],
      skills: [],
      slashCmds: [],
      memory: [],
    },
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<AgentProfileViewModelInput> = {}
): AgentProfileViewModelInput {
  return {
    selectedRole: "frontend-ui",
    selectedAuthId: "work-oauth",
    cwd: "/Users/alptalhayazarwork/personal/agent-profile",
    authProfiles: [workAuth],
    scopeEntries: [
      {
        scope: "project-role",
        role: "frontend-ui",
        path: "/repo/.myclaude/roles/frontend-ui.yml",
        content: null,
      },
    ],
    selectedScopePath: "/repo/.myclaude/roles/frontend-ui.yml",
    effectiveState: {
      effective: effective({
        mcpServers: {
          browser: { type: "stdio", command: "npx" },
          linear: { type: "http", url: "https://linear.example/mcp" },
        },
        env: { FEATURE_FLAG: "on" },
        settings: { model: "sonnet" },
        persona: {
          claudeMd: ["CLAUDE.md"],
          agents: ["agents/reviewer.md"],
          skills: ["skills/react/SKILL.md", "skills/a11y/SKILL.md"],
          slashCmds: ["commands/ship.md"],
          memory: ["memory/project.md"],
        },
      }),
      provenance: null,
    },
    previewState: { status: "idle", effective: null, diff: [], errorMessage: null },
    validationState: { status: "ready", issues: [], errorMessage: null },
    isBootstrapping: false,
    isRefreshing: false,
    ...overrides,
  };
}

describe("deriveAgentProfileViewModel", () => {
  test("normalizes safe logical MCP secret names without exposing refs", () => {
    expect(
      normalizeAuthProfiles([
        {
          id: "work-oauth",
          displayName: "Work Claude",
          mode: "oauth",
          secrets: [
            "linear.token",
            "github.pat",
            "keyring://invalid",
            "${secret:raw}",
            "ghp_realToken123",
            "refresh_token",
          ],
        },
      ])
    ).toEqual([
      {
        id: "work-oauth",
        displayName: "Work Claude",
        mode: "oauth",
        secretCount: 6,
        secretNames: ["github.pat", "linear.token"],
      },
    ]);
  });

  test("redacts unsafe auth profile display names during normalization", () => {
    expect(
      normalizeAuthProfiles([
        {
          id: "keyring://anthropic/work",
          displayName: "Bearer ${secret:github.pat}",
          mode: "oauth",
          secrets: [],
        },
      ])
    ).toEqual([
      {
        id: "keyring://anthropic/work",
        displayName: "Claude identity",
        mode: "oauth",
        secretCount: 0,
        secretNames: [],
      },
    ]);
  });

  test("derives a launchable profile card from selected role, auth, cwd, and effective config", () => {
    const vm = deriveAgentProfileViewModel(baseInput());

    expect(vm.name).toBe("Frontend Ui Agent");
    expect(vm.purposeLabel).toBe("Frontend Ui Claude profile");
    expect(vm.auth).toEqual({
      profileId: "work-oauth",
      label: "Work Claude",
      modeLabel: "OAuth",
      secretSummary: "2 stored secrets",
      state: "selected",
    });
    expect(vm.workspace.label).toBe("agent-profile");
    expect(vm.toolSkillCounts).toMatchObject({
      tools: 2,
      envVars: 1,
      settings: 1,
      skills: 2,
      agents: 1,
      commands: 1,
      memory: 1,
      claudeMd: 1,
      personaAssets: 6,
      validationIssues: 0,
    });
    expect(vm.readiness).toMatchObject({ status: "ready", canLaunch: true, label: "Ready" });
    expect(vm.launch.payload).toEqual({
      role: "frontend-ui",
      authProfileId: "work-oauth",
      cwd: "/Users/alptalhayazarwork/personal/agent-profile",
    });
    expect(vm.card.metadata).toEqual(["Work Claude", "agent-profile", "2 tools · 2 skills"]);
  });

  test.each([
    ["cwd", { cwd: "" }, "Needs workspace", "missing-workspace"],
    ["role", { selectedRole: "" }, "Needs role", "missing-role"],
    ["auth", { selectedAuthId: "" }, "Needs identity", "missing-auth"],
  ])("blocks launch when %s is missing", (_name, override, label, code) => {
    const vm = deriveAgentProfileViewModel(baseInput(override));

    expect(vm.readiness.label).toBe(label);
    expect(vm.readiness.blockingReason?.code).toBe(code);
    expect(vm.readiness.canLaunch).toBe(false);
    expect(vm.launch).toMatchObject({ canLaunch: false, payload: null });
  });

  test("blocks launch when the selected auth id is not in the known auth profiles", () => {
    const vm = deriveAgentProfileViewModel(baseInput({ selectedAuthId: "missing-auth" }));

    expect(vm.auth).toMatchObject({
      profileId: "missing-auth",
      label: "Unknown Claude identity",
      state: "unknown",
    });
    expect(vm.readiness.blockingReason?.code).toBe("auth-not-found");
    expect(vm.launch.payload).toBeNull();
  });

  test("keeps loading profiles non-launchable", () => {
    const vm = deriveAgentProfileViewModel(baseInput({ isRefreshing: true }));

    expect(vm.readiness).toMatchObject({ status: "loading", canLaunch: false, label: "Loading" });
    expect(vm.launch.disabledReason).toBe("Profile is still loading");
  });

  test("treats validation issues as a warning without losing launch payload", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        validationState: {
          status: "ready",
          issues: [{ path: "settings.model", message: "Unsupported model", severity: "warning" }],
          errorMessage: null,
        },
      })
    );

    expect(vm.readiness).toMatchObject({
      status: "warning",
      label: "Needs review",
      canLaunch: true,
    });
    expect(vm.readiness.warnings[0]).toMatchObject({
      code: "validation-issues",
      message: "1 profile issue need review",
      fixTarget: "inspect",
    });
    expect(vm.launch.payload).toEqual({
      role: "frontend-ui",
      authProfileId: "work-oauth",
      cwd: "/Users/alptalhayazarwork/personal/agent-profile",
    });
  });

  test("uses preview effective config before saved effective config for counts", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        previewState: {
          status: "ready",
          effective: effective({
            mcpServers: { previewOnly: { type: "stdio" } },
            persona: {
              claudeMd: [],
              agents: [],
              skills: ["skills/preview/SKILL.md"],
              slashCmds: [],
              memory: [],
            },
          }),
          diff: [],
          errorMessage: null,
        },
      })
    );

    expect(vm.toolSkillCounts.tools).toBe(1);
    expect(vm.toolSkillCounts.skills).toBe(1);
    expect(vm.card.metadata[2]).toBe("1 tool · 1 skill");
  });

  test("handles malformed effective config defensively with zero counts", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        effectiveState: { effective: {} as EffectiveConfig, provenance: null },
      })
    );

    expect(vm.toolSkillCounts).toMatchObject({
      tools: 0,
      envVars: 0,
      settings: 0,
      skills: 0,
      agents: 0,
      commands: 0,
      memory: 0,
      claudeMd: 0,
      personaAssets: 0,
    });
    expect(vm.card.metadata[2]).toBe("No tools or skills");
  });

  test("derives present and missing MCP secret status from safe logical names only", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        effectiveState: {
          effective: effective({
            mcpServers: {
              github: {
                type: "http",
                url: "https://github.example/mcp?token=${secret:github.pat}",
                headers: { Authorization: "Bearer ${secret:linear.token}" },
              },
              browser: {
                type: "stdio",
                command: "npx",
                args: ["browser-mcp", "--token=${secret:browser.token}"],
                env: {
                  MCP_TOKEN: "${secret:keyring://unsafe}",
                  RAW_TOKEN_NAME: "${secret:ghp_realToken123}",
                  OAUTH_INTERNAL: "${secret:refresh_token}",
                },
              },
            },
          }),
          provenance: null,
        },
      })
    );

    expect(vm.capabilities.tools.serverNames).toEqual(["browser", "github"]);
    expect(vm.capabilities.tools.referencedSecretNames).toEqual([
      "browser.token",
      "github.pat",
      "linear.token",
    ]);
    expect(vm.capabilities.tools.presentSecretNames).toEqual(["browser.token", "github.pat"]);
    expect(vm.capabilities.tools.missingSecretNames).toEqual(["linear.token"]);
    expect(vm.capabilities.tools.secretStatuses).toEqual([
      { name: "browser.token", state: "present" },
      { name: "github.pat", state: "present" },
      { name: "linear.token", state: "missing" },
    ]);
    expect(vm.readiness).toMatchObject({ status: "warning", canLaunch: true });
    expect(vm.readiness.warnings).toContainEqual({
      code: "missing-tool-secrets",
      message: "1 tool secret needs attention",
      fixLabel: "Review tools",
      fixTarget: "tools",
    });

    const capabilityJson = JSON.stringify(vm.capabilities);
    expect(capabilityJson).not.toContain("${secret:");
    expect(capabilityJson).not.toContain("keyring://");
    expect(capabilityJson).not.toContain("ghp_realToken123");
    expect(capabilityJson).not.toContain("refresh_token");
    expect(capabilityJson).not.toContain("Authorization");
    expect(capabilityJson).not.toContain("MCP_TOKEN");
    expect(capabilityJson).not.toContain("Bearer");
  });

  test("marks referenced secrets missing when no Claude identity is selected", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        selectedAuthId: "",
        effectiveState: {
          effective: effective({
            mcpServers: {
              linear: { type: "http", headers: { Authorization: "Bearer ${secret:linear.token}" } },
            },
          }),
          provenance: null,
        },
      })
    );

    expect(vm.auth.state).toBe("missing");
    expect(vm.capabilities.tools.referencedSecretNames).toEqual(["linear.token"]);
    expect(vm.capabilities.tools.presentSecretNames).toEqual([]);
    expect(vm.capabilities.tools.missingSecretNames).toEqual(["linear.token"]);
  });

  test("mirrors validation issue counts into profile-owned tool capability status", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        validationState: {
          status: "ready",
          issues: [
            { path: "mcpServers.github", message: "Missing command", severity: "error" },
            { path: "settings.model", message: "Unsupported model", severity: "warning" },
          ],
          errorMessage: null,
        },
      })
    );

    expect(vm.toolSkillCounts.validationIssues).toBe(2);
    expect(vm.capabilities.tools.validationIssueCount).toBe(2);
  });

  test("redacts unsafe auth display names from home-facing current card output", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        selectedAuthId: "keyring://anthropic/work",
        authProfiles: [secretLikeAuth],
      })
    );

    expect(vm.auth.label).toBe("Claude identity");
    expect(vm.card.metadata).toContain("Claude identity");
    const homeFacing = JSON.stringify({ authLabel: vm.auth.label, card: vm.card });
    expect(homeFacing).not.toContain("keyring://");
    expect(homeFacing).not.toContain("${secret:");
    expect(homeFacing).not.toContain("Bearer");
  });

  test("uses selected scope profile metadata for the current card headline", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        selectedRole: "backend-api-review",
        selectedScopePath: "/repo/.myclaude/roles/backend-api-review.yml",
        scopeEntries: [
          {
            scope: "project-role",
            role: "backend-api-review",
            path: "/repo/.myclaude/roles/backend-api-review.yml",
            content: {
              version: 1,
              profile: {
                displayName: "Backend API Review",
                purpose: "Review backend API changes before launch",
              },
              mcpServers: {},
              env: {},
              settings: {},
              use: [],
              disabledServers: [],
            },
          },
        ],
      })
    );

    expect(vm.name).toBe("Backend API Review");
    expect(vm.purposeLabel).toBe("Review backend API changes before launch");
    expect(vm.card.title).toBe("Backend API Review");
    expect(vm.card.eyebrow).toBe("Review backend API changes before launch");
  });

  test("does not expose env values, MCP headers, secret refs, or token-like values in home-facing output", () => {
    const vm = deriveAgentProfileViewModel(
      baseInput({
        effectiveState: {
          effective: effective({
            env: {
              ANTHROPIC_API_KEY: "sk-ant-secret-token",
              INTERNAL_TOKEN: "token-like-value",
            },
            mcpServers: {
              privateTool: {
                type: "http",
                url: "https://tool.example/mcp",
                headers: { Authorization: "Bearer secret-header" },
                env: { API_TOKEN: "secret-env" },
              },
            },
          }),
          provenance: null,
        },
      })
    );

    const homeFacing = JSON.stringify({
      auth: vm.auth,
      workspace: vm.workspace,
      counts: vm.toolSkillCounts,
      readiness: vm.readiness,
      launch: vm.launch,
      card: vm.card,
    });

    expect(homeFacing).not.toContain("sk-ant-secret-token");
    expect(homeFacing).not.toContain("token-like-value");
    expect(homeFacing).not.toContain("secret-header");
    expect(homeFacing).not.toContain("secret-env");
    expect(homeFacing).not.toContain("Authorization");
    expect(homeFacing).not.toContain("API_TOKEN");
    expect(homeFacing).not.toContain("ANTHROPIC_API_KEY");
    expect(homeFacing).not.toContain("INTERNAL_TOKEN");
    expect(homeFacing).not.toContain("privateTool");
  });

  test("projects a purpose-first Agent Profiles library from scope entries without per-profile show data", () => {
    const library = deriveAgentProfileLibraryViewModel(
      baseInput({
        selectedRole: "backend-api-review",
        selectedAuthId: "work-oauth",
        scopeEntries: [
          {
            scope: "project-shared",
            role: "—",
            path: "/repo/.myclaude/shared.yml",
            content: null,
          },
          {
            scope: "project-role",
            role: "backend-api-review",
            path: "/repo/.myclaude/roles/backend-api-review.yml",
            content: {
              version: 1,
              profile: {
                displayName: "Backend API Review",
                purpose: "Review backend API changes before launch",
              },
              auth: { profileId: "work-oauth" },
              mcpServers: { github: { type: "http", url: "https://github.example/mcp" } },
              env: {},
              settings: {},
              persona: {
                claudeMd: [],
                agents: ["agents/reviewer.md"],
                skills: ["skills/react/SKILL.md"],
                slashCmds: [],
                memory: [],
              },
              use: [],
              disabledServers: [],
            },
          },
          {
            scope: "project-role",
            role: "legacy-audit",
            path: "/repo/.myclaude/roles/legacy-audit.yml",
            content: {
              version: 1,
              profile: {
                displayName: "keyring://anthropic/work",
                purpose: "Bearer ${secret:github.pat}",
              },
              mcpServers: {},
              env: {},
              settings: {},
              use: [],
              disabledServers: [],
            },
          },
          {
            scope: "project-role",
            role: "stale-review",
            path: "/repo/.myclaude/roles/stale-review.yml",
            content: {
              version: 1,
              auth: { profileId: "missing-auth" },
              mcpServers: {},
              env: {},
              settings: {},
              use: [],
              disabledServers: [],
            },
          },
        ],
      })
    );

    expect(library.items).toHaveLength(3);
    expect(library.selectedId).toBe(library.items[0]?.id);
    expect(library.items[0]).toMatchObject({
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
      role: "backend-api-review",
      authLabel: "Work Claude",
      authState: "bound",
      workspaceLabel: "agent-profile",
      capabilitySummary: "2 MCP servers · 6 skill/persona assets",
      isSelected: true,
      isSwitchable: false,
      statusLabel: "Ready",
      statusTone: "success",
    });
    expect(library.items[1]).toMatchObject({
      displayName: "Legacy Audit Agent",
      purpose: "Legacy Audit Claude profile",
      authLabel: "No Claude identity",
      authState: "missing",
      isSelected: false,
      isSwitchable: false,
      statusLabel: "Needs identity",
    });
    expect(library.items[2]).toMatchObject({
      displayName: "Stale Review Agent",
      authLabel: "Unknown Claude identity",
      authState: "stale",
      isSwitchable: false,
      statusLabel: "Identity unavailable",
    });

    const displaySurface = JSON.stringify(
      library.items.map(({ selection: _selection, ...displayFields }) => displayFields)
    );
    expect(displaySurface).not.toContain("keyring://");
    expect(displaySurface).not.toContain("${secret:");
    expect(displaySurface).not.toContain("Bearer");
    expect(displaySurface).not.toContain("project-role");
    expect(displaySurface).not.toContain("/repo/.myclaude");
  });

  test("keeps large library projection bounded and switchable profiles explicit", () => {
    const scopeEntries = Array.from({ length: 20 }, (_value, index) => ({
      scope: "project-role",
      role: `review-${index}`,
      path: `/repo/.myclaude/roles/review-${index}.yml`,
      content: {
        version: 1 as const,
        profile: { displayName: `Review ${index}`, purpose: `Review queue ${index}` },
        auth: { profileId: "work-oauth" },
        mcpServers: {},
        env: {},
        settings: {},
        use: [],
        disabledServers: [],
      },
    }));

    const library = deriveAgentProfileLibraryViewModel(
      baseInput({
        selectedRole: "review-0",
        selectedAuthId: "work-oauth",
        scopeEntries,
      })
    );

    expect(library.items).toHaveLength(20);
    expect(library.items.filter((item) => item.isSelected)).toHaveLength(1);
    expect(library.items.filter((item) => item.isSwitchable)).toHaveLength(19);
    expect(library.items.every((item) => item.selection.authProfileId === "work-oauth")).toBe(
      true
    );
  });

  test("keeps the profile id opaque instead of embedding raw role, auth, or cwd", () => {
    const vm = deriveAgentProfileViewModel(baseInput());

    expect(vm.id).toMatch(/^profile-[a-z0-9]+$/);
    expect(vm.id).not.toContain("frontend-ui");
    expect(vm.id).not.toContain("work-oauth");
    expect(vm.id).not.toContain("agent-profile");
  });
});
