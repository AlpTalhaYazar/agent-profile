import { describe, expect, test } from "vitest";
import {
  buildProfileCreateScopePayload,
  buildProfileSelection,
  chooseRestoredProfileSelection,
  deriveProfileRoleSlug,
  readProfileSelection,
  validateProfileCreationDraft,
  writeProfileSelection,
  type ProfileCreationDraft,
  type ProfileCreationValidationContext,
} from "../src/renderer/lib/profile-creation.js";
import type { AuthProfileOption } from "../src/renderer/lib/types.js";

const workAuth: AuthProfileOption = {
  id: "work",
  displayName: "Work Claude",
  mode: "oauth",
  secretCount: 1,
  secretNames: ["github.pat"],
};

function context(
  overrides: Partial<ProfileCreationValidationContext> = {}
): ProfileCreationValidationContext {
  return {
    existingRoles: [],
    authProfiles: [workAuth],
    ...overrides,
  };
}

function draft(overrides: Partial<ProfileCreationDraft> = {}): ProfileCreationDraft {
  return {
    purpose: "Backend API Review",
    cwd: "/repo/project",
    authProfileId: "work",
    ...overrides,
  };
}

describe("deriveProfileRoleSlug", () => {
  test.each([
    ["Backend API Review", "backend-api-review"],
    ["  Frontend UI + Accessibility  ", "frontend-ui-accessibility"],
    ["Çağrı Agent", "cagri-agent"],
    ["agent___tools", "agent___tools"],
  ])("derives service-compatible role slug for %s", (input, expected) => {
    expect(deriveProfileRoleSlug(input)).toBe(expected);
  });
});

describe("persisted profile selection", () => {
  test("round-trips selected Agent Profile context through storage", () => {
    const storage = createMemoryStorage();
    const selection = {
      role: "frontend-polish",
      authProfileId: "work",
      cwd: "/repo/project",
    };

    writeProfileSelection(storage, selection);

    expect(readProfileSelection(storage)).toEqual(selection);
  });

  test("ignores malformed stored selection values", () => {
    const storage = createMemoryStorage();
    storage.setItem("agent-profile.selectedProfile", JSON.stringify({ role: "backend" }));

    expect(readProfileSelection(storage)).toBeNull();
  });

  test("restores stored selection only while role and Claude identity are still available", () => {
    const stored = {
      role: "frontend-polish",
      authProfileId: "work",
      cwd: "/repo/project",
    };

    expect(
      chooseRestoredProfileSelection({
        stored,
        roles: ["backend", "frontend-polish"],
        authProfiles: [workAuth],
        fallbackCwd: "/repo/project",
      })
    ).toEqual(stored);

    expect(
      chooseRestoredProfileSelection({
        stored,
        roles: ["backend"],
        authProfiles: [workAuth],
        fallbackCwd: "/repo/project",
      })
    ).toEqual({ role: "backend", authProfileId: "work", cwd: "/repo/project" });
  });
});

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("validateProfileCreationDraft", () => {
  test("builds a project role createScope payload from purpose-first input", () => {
    const result = validateProfileCreationDraft(draft(), context());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid creation draft");
    expect(result.value).toMatchObject({
      purpose: "Backend API Review",
      roleSlug: "backend-api-review",
      cwd: "/repo/project",
      authProfileId: "work",
    });
    expect(buildProfileCreateScopePayload(result.value)).toEqual({
      location: "project",
      layerType: "role",
      role: "backend-api-review",
      cwd: "/repo/project",
    });
    expect(buildProfileSelection(result.value)).toEqual({
      role: "backend-api-review",
      authProfileId: "work",
      cwd: "/repo/project",
    });
  });

  test("blocks duplicate generated role names without layer jargon", () => {
    const result = validateProfileCreationDraft(
      draft(),
      context({ existingRoles: ["backend-api-review"] })
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      field: "role",
      message: "A profile role named “backend-api-review” already exists. Choose a different purpose.",
    });
    expect(JSON.stringify(result.issues)).not.toMatch(/scope|layer/i);
  });

  test.each([
    ["empty purpose", { purpose: "   " }, "purpose", "Describe what this Agent Profile is for."],
    ["symbols-only purpose", { purpose: "✨✨✨" }, "role", "Use letters or numbers so a safe profile role can be generated."],
    ["invalid role override", { roleSlug: "Backend API!" }, "role", "Profile role can use lowercase letters, numbers, hyphens, and underscores only."],
    ["empty workspace", { cwd: "" }, "workspace", "Choose a workspace before creating this Agent Profile."],
    ["missing identity", { authProfileId: "" }, "identity", "Choose a Claude identity before creating this Agent Profile."],
  ] as const)("reports %s with a plain-language validation issue", (_name, overrides, field, message) => {
    const result = validateProfileCreationDraft(draft(overrides), context());

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ field, message });
  });

  test("blocks unknown Claude identity without leaking auth metadata", () => {
    const result = validateProfileCreationDraft(
      draft({ authProfileId: "personal" }),
      context({
        authProfiles: [
          {
            id: "work",
            displayName: "keyring://anthropic/work ${secret:raw}",
            mode: "apiKey",
            secretCount: 2,
            secretNames: ["keyring://anthropic/work", "${secret:raw}"],
          },
        ],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      field: "identity",
      message: "Choose an available Claude identity before creating this Agent Profile.",
    });
    expect(JSON.stringify(result)).not.toContain("keyring://");
    expect(JSON.stringify(result)).not.toContain("${secret:");
  });
});
