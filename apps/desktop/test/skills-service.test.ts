import { describe, expect, it, vi } from "vitest";
import {
  findInstalledSkill,
  normalizeInstalledSkills,
  normalizeSkillsPayload,
  skillsInstall,
} from "../src/main/skills-service.js";

describe("skills-service", () => {
  it("normalizes skills.sh search payload variants", () => {
    expect(
      normalizeSkillsPayload({
        skills: [
          {
            id: "postgres",
            slug: "postgres",
            name: "Postgres",
            source: "org/repo",
            description: "Database workflow",
            installs: 42,
            duplicate: false,
            audit: { status: "passed" },
          },
        ],
      })
    ).toEqual([
      {
        id: "postgres",
        slug: "postgres",
        name: "Postgres",
        source: "org/repo",
        description: "Database workflow",
        installs: 42,
        duplicate: false,
        auditStatus: "passed",
      },
    ]);
  });

  it("normalizes installed skills list output", () => {
    const installed = normalizeInstalledSkills(
      JSON.stringify({
        skills: [
          {
            name: "graphify",
            path: "/Users/dev/.claude/skills/graphify",
            agent: "Claude Code",
          },
        ],
      })
    );

    expect(installed).toEqual([
      {
        id: "graphify",
        slug: "graphify",
        name: "graphify",
        source: "/Users/dev/.claude/skills/graphify",
      },
    ]);
    expect(findInstalledSkill(installed, { id: "graphify", slug: "graphify" })?.source).toBe(
      "/Users/dev/.claude/skills/graphify"
    );
  });

  it("installs with argument arrays and resolves the installed path from skills list", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "installed", stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          skills: [{ name: "postgres", path: "/Users/dev/.claude/skills/postgres" }],
        }),
        stderr: "",
      });

    await expect(
      skillsInstall(
        {
          id: "postgres",
          slug: "postgres",
          source: "org/repo",
          installUrl: "https://github.com/org/repo",
        },
        runner
      )
    ).resolves.toEqual({
      installed: true,
      name: "postgres",
      path: "/Users/dev/.claude/skills/postgres",
      output: "installed",
    });

    expect(runner).toHaveBeenNthCalledWith(1, "npx", [
      "-y",
      "skills",
      "add",
      "https://github.com/org/repo",
      "--skill",
      "postgres",
      "--agent",
      "claude-code",
      "-g",
      "-y",
    ]);
    expect(runner).toHaveBeenNthCalledWith(2, "npx", [
      "-y",
      "skills",
      "list",
      "--json",
      "-g",
      "-a",
      "claude-code",
    ]);
  });

  it("rejects install inputs that could be parsed as CLI flags", async () => {
    const runner = vi.fn();

    await expect(
      skillsInstall(
        {
          id: "postgres",
          slug: "postgres",
          source: "-g",
        },
        runner
      )
    ).rejects.toThrow(/must not start with "-"/);

    await expect(
      skillsInstall(
        {
          id: "postgres",
          slug: "--skill",
          source: "org/repo",
        },
        runner
      )
    ).rejects.toThrow(/must not start with "-"/);

    await expect(
      skillsInstall(
        {
          id: "postgres",
          slug: "postgres\n--skill",
          source: "org/repo",
        },
        runner
      )
    ).rejects.toThrow(/must not contain control characters/);

    expect(runner).not.toHaveBeenCalled();
  });
});
