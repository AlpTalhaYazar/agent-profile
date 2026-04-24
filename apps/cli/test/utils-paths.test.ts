/**
 * Tests for path utility functions.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  globalConfigDir,
  globalFragmentsDir,
  globalRolePath,
  globalRolesDir,
  globalSharedPath,
  myClaudeHome,
} from "../src/utils/paths.js";

describe("myClaudeHome", () => {
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.MYCLAUDE_HOME;
  });

  afterEach(() => {
    if (savedHome !== undefined) {
      process.env.MYCLAUDE_HOME = savedHome;
    } else {
      // biome-ignore lint/performance/noDelete: must fully unset env vars
      delete process.env.MYCLAUDE_HOME;
    }
  });

  it("returns ~/.myclaude when MYCLAUDE_HOME is not set", () => {
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.MYCLAUDE_HOME;
    const result = myClaudeHome();
    expect(result).toBe(join(homedir(), ".myclaude"));
  });

  it("returns MYCLAUDE_HOME when set", () => {
    process.env.MYCLAUDE_HOME = "/custom/home";
    const result = myClaudeHome();
    expect(result).toBe("/custom/home");
  });
});

describe("globalConfigDir", () => {
  it("returns <home>/config", () => {
    const result = globalConfigDir("/my/home");
    expect(result).toBe("/my/home/config");
  });

  it("uses myClaudeHome() when no argument provided", () => {
    const result = globalConfigDir();
    expect(result).toContain("config");
  });
});

describe("globalSharedPath", () => {
  it("returns correct path with explicit home", () => {
    const result = globalSharedPath("/my/home");
    expect(result).toBe("/my/home/config/global/shared.yml");
  });

  it("includes shared.yml", () => {
    const result = globalSharedPath("/test");
    expect(result.endsWith("shared.yml")).toBe(true);
  });
});

describe("globalRolePath", () => {
  it("returns correct path for a role", () => {
    const result = globalRolePath("backend", "/my/home");
    expect(result).toBe("/my/home/config/global/roles/backend.yml");
  });

  it("appends .yml to role name", () => {
    const result = globalRolePath("frontend", "/test");
    expect(result.endsWith("frontend.yml")).toBe(true);
  });

  it("uses myClaudeHome() when no home argument provided", () => {
    const result = globalRolePath("backend");
    expect(result).toContain("backend.yml");
  });
});

describe("globalFragmentsDir", () => {
  it("returns <home>/config/fragments with explicit home", () => {
    const result = globalFragmentsDir("/my/home");
    expect(result).toBe("/my/home/config/fragments");
  });

  it("uses myClaudeHome() when no argument provided", () => {
    const result = globalFragmentsDir();
    expect(result).toContain("fragments");
  });
});

describe("globalRolesDir", () => {
  it("returns <home>/config/global/roles with explicit home", () => {
    const result = globalRolesDir("/my/home");
    expect(result).toBe("/my/home/config/global/roles");
  });

  it("uses myClaudeHome() when no argument provided", () => {
    const result = globalRolesDir();
    expect(result).toContain("roles");
  });
});
