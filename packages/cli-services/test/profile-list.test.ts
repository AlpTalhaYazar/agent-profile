import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { profileListService } from "../src/profile/list.js";

const FIXTURES_HOME = resolve(new URL("./fixtures/home/.myclaude", import.meta.url).pathname);
const FIXTURES_PROJECT = resolve(new URL("./fixtures/project", import.meta.url).pathname);

describe("profileListService", () => {
  it("lists scopes in deterministic cascade order", () => {
    const result = profileListService({
      home: FIXTURES_HOME,
      cwd: FIXTURES_PROJECT,
    });

    expect(result.scopes.map((entry) => [entry.scope, entry.role])).toEqual([
      ["global-shared", null],
      ["global-role", "backend"],
      ["global-role", "frontend"],
      ["project-shared", null],
      ["project-role", "backend"],
    ]);
    expect(result.scopes[0]?.content?.version).toBe(1);
    expect(result.scopes[0]?.content?.env.EDITOR).toBe("nvim");
  });

  it("keeps shared scopes while filtering role-scoped entries", () => {
    const result = profileListService({
      home: FIXTURES_HOME,
      cwd: FIXTURES_PROJECT,
      roleFilter: "backend",
    });

    expect(result.scopes.map((entry) => [entry.scope, entry.role])).toEqual([
      ["global-shared", null],
      ["global-role", "backend"],
      ["project-shared", null],
      ["project-role", "backend"],
    ]);
  });
});
