import { describe, expect, test } from "vitest";
import {
  createAgentProfileId,
  deriveProfileIdentityLibrary,
  deriveRoleDisplayName,
  sanitizeProfileLabel,
} from "../src/renderer/lib/profile-identity.js";
import { normalizeScopeList } from "../src/renderer/lib/normalize.js";
import type { AuthProfileOption, ScopeListEntry } from "../src/renderer/lib/types.js";

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

function entry(overrides: Partial<ScopeListEntry> = {}): ScopeListEntry {
  return {
    scope: "project-role",
    role: "backend-api-review",
    path: "/repo/project/.myclaude/roles/backend-api-review.yml",
    content: {
      version: 1,
      profile: {
        displayName: "Backend API Review",
        purpose: "Review backend API changes before launch",
      },
      auth: { profileId: "work" },
      mcpServers: {},
      env: {},
      settings: {},
      use: [],
      disabledServers: [],
    },
    ...overrides,
  };
}

function scopeContent(): NonNullable<ScopeListEntry["content"]> {
  const content = entry().content;
  if (!content) throw new Error("expected profile identity test fixture content");
  return content;
}

describe("scope-backed Agent Profile identity metadata", () => {
  test("normalizes optional profile metadata on scope docs", () => {
    const [normalized] = normalizeScopeList({
      entries: [
        {
          scope: "project-role",
          role: "backend-api-review",
          path: "/repo/project/.myclaude/roles/backend-api-review.yml",
          content: {
            version: 1,
            profile: {
              displayName: "  Backend API Review  ",
              purpose: "Review backend API changes\n before launch",
            },
          },
        },
      ],
    });

    expect(normalized?.content?.profile).toEqual({
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
    });
  });

  test("derives safe purpose-first labels with Claude identity binding", () => {
    const [profile] = deriveProfileIdentityLibrary({
      scopeEntries: [entry()],
      authProfiles: [workAuth, personalAuth],
      cwd: "/repo/project",
    });

    expect(profile).toMatchObject({
      role: "backend-api-review",
      displayName: "Backend API Review",
      purpose: "Review backend API changes before launch",
      metadataSource: "profile",
      auth: {
        profileId: "work",
        label: "Work Claude",
        state: "bound",
      },
      chips: ["backend-api-review", "Work Claude"],
    });
    expect(profile?.id).toBe(createAgentProfileId(entry()));
  });

  test("falls back to deterministic role-derived labels for legacy role-only scopes", () => {
    const { profile: _profile, auth: _auth, ...legacyContent } = scopeContent();
    const [profile] = deriveProfileIdentityLibrary({
      scopeEntries: [entry({ content: legacyContent })],
      authProfiles: [workAuth],
      cwd: "/repo/project",
    });

    expect(profile).toMatchObject({
      displayName: "Backend Api Review Agent",
      purpose: "Backend Api Review Claude profile",
      metadataSource: "legacy-role",
      auth: {
        profileId: null,
        label: "No Claude identity",
        state: "missing",
      },
      chips: ["backend-api-review", "No Claude identity"],
    });
  });

  test("falls back when metadata is malformed or secret-like", () => {
    const [profile] = deriveProfileIdentityLibrary({
      scopeEntries: [
        entry({
          content: {
            ...scopeContent(),
            profile: {
              displayName: "keyring://anthropic/work",
              purpose: "Bearer ${secret:github.pat}",
            },
          },
        }),
      ],
      authProfiles: [workAuth],
      cwd: "/repo/project",
    });

    expect(profile?.displayName).toBe("Backend Api Review Agent");
    expect(profile?.purpose).toBe("Backend Api Review Claude profile");
    expect(profile?.metadataSource).toBe("legacy-role");
    expect(JSON.stringify(profile)).not.toContain("keyring://");
    expect(JSON.stringify(profile)).not.toContain("${secret:");
    expect(JSON.stringify(profile)).not.toContain("Bearer");
  });

  test("uses a calm stale identity fallback for deleted auth bindings", () => {
    const [profile] = deriveProfileIdentityLibrary({
      scopeEntries: [entry({ content: { ...scopeContent(), auth: { profileId: "deleted" } } })],
      authProfiles: [workAuth],
      cwd: "/repo/project",
    });

    expect(profile?.auth).toEqual({
      profileId: "deleted",
      label: "Unknown Claude identity",
      state: "stale",
    });
    expect(profile?.chips).toContain("Unknown Claude identity");
  });

  test("ignores non-role scopes and never throws for malformed content", () => {
    expect(() =>
      deriveProfileIdentityLibrary({
        scopeEntries: [
          entry({ scope: "project-shared", role: "—", content: null }),
          entry({ role: "broken", content: null }),
        ],
        authProfiles: [workAuth],
        cwd: "/repo/project",
      })
    ).not.toThrow();

    expect(
      deriveProfileIdentityLibrary({
        scopeEntries: [
          entry({ scope: "project-shared", role: "—", content: null }),
          entry({ role: "broken", content: null }),
        ],
        authProfiles: [workAuth],
        cwd: "/repo/project",
      })
    ).toHaveLength(1);
  });

  test("projects one effective library row when global and project role layers share a role", () => {
    const globalLayer = entry({
      scope: "global-role",
      path: "/home/.myclaude/config/global/roles/backend-api-review.yml",
      content: {
        ...scopeContent(),
        profile: {
          displayName: "Global Backend Review",
          purpose: "Global backend defaults",
        },
        auth: { profileId: "personal" },
      },
    });
    const projectLayer = entry({
      scope: "project-role",
      path: "/repo/project/.myclaude/roles/backend-api-review.yml",
      content: {
        ...scopeContent(),
        profile: {
          displayName: "Project Backend Review",
          purpose: "Project-specific backend checks",
        },
        auth: { profileId: "work" },
      },
    });

    const library = deriveProfileIdentityLibrary({
      scopeEntries: [globalLayer, projectLayer],
      authProfiles: [workAuth, personalAuth],
      cwd: "/repo/project",
    });

    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({
      role: "backend-api-review",
      displayName: "Project Backend Review",
      purpose: "Project-specific backend checks",
      auth: { profileId: "work", label: "Work Claude", state: "bound" },
    });
  });

  test("creates stable IDs without exposing raw file paths", () => {
    const first = createAgentProfileId(entry());
    const second = createAgentProfileId(entry());
    const different = createAgentProfileId(
      entry({ path: "/repo/project/.myclaude/roles/frontend-polish.yml", role: "frontend-polish" })
    );

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).not.toContain("/repo/project");
    expect(first).toMatch(/^profile:backend-api-review:[a-z0-9]+$/);
  });
});

describe("profile identity label helpers", () => {
  test.each([
    ["backend-api-review", "Backend Api Review Agent"],
    ["frontend_ui", "Frontend Ui Agent"],
    ["", "Untitled Agent Profile"],
  ])("derives legacy display name for %s", (role, expected) => {
    expect(deriveRoleDisplayName(role)).toBe(expected);
  });

  test.each(["keyring://anthropic/work", "${secret:github.pat}", "Bearer ghp_testtoken"])(
    "redacts unsafe metadata label %s",
    (value) => {
      expect(sanitizeProfileLabel(value)).toBeNull();
    }
  );
});
