/**
 * Tests for `profileShowService` — wraps the core cascade resolver.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { profileShowService } from "../src/profile/show.js";

const FIXTURES_HOME = resolve(new URL("./fixtures/home/.myclaude", import.meta.url).pathname);
const FIXTURES_PROJECT = resolve(new URL("./fixtures/project", import.meta.url).pathname);

describe("profileShowService", () => {
  it("resolves the global cascade for a known role", () => {
    const result = profileShowService({
      role: "backend",
      cwd: FIXTURES_HOME,
      home: FIXTURES_HOME,
    });

    expect(result).toHaveProperty("effective");
    expect(result).toHaveProperty("provenance");
    expect(result.runtimePaths).toBeNull();
    expect(Object.keys(result.effective.mcpServers)).toEqual(
      expect.arrayContaining(["github", "postgres", "filesystem", "figma"])
    );
  });

  it("merges env vars across global-shared and global-role layers", () => {
    const result = profileShowService({
      role: "backend",
      cwd: FIXTURES_HOME,
      home: FIXTURES_HOME,
    });

    expect(result.effective.env).toHaveProperty("EDITOR", "nvim");
    expect(result.effective.env).toHaveProperty("NODE_ENV", "development");
  });

  it("merges project-level scopes when cwd is inside the project", () => {
    const result = profileShowService({
      role: "backend",
      cwd: FIXTURES_PROJECT,
      home: FIXTURES_HOME,
    });

    expect(result.effective.env).toHaveProperty("PROJECT_NAME", "acme-api");
  });

  it("binds the requested authProfileId into effective.auth", () => {
    const result = profileShowService({
      role: "backend",
      cwd: FIXTURES_HOME,
      home: FIXTURES_HOME,
      authProfileId: "work",
    });

    expect(result.effective.auth).toEqual({ profileId: "work" });
  });

  it("returns an empty cascade for a role that has no scope files", () => {
    const result = profileShowService({
      role: "nonexistent-role",
      cwd: FIXTURES_HOME,
      home: FIXTURES_HOME,
    });

    // global-shared still contributes — only the role-specific layers are absent.
    expect(result.effective.env).toHaveProperty("EDITOR");
    expect(result.effective.env).not.toHaveProperty("NODE_ENV");
  });
});
