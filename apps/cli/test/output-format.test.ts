import type { EffectiveSessionConfig } from "@agent-profile/core";
/**
 * Tests for color and format output utilities.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Clears an env var (biome-safe wrapper around delete). */
function clearEnv(key: string): void {
  delete process.env[key];
}
import {
  bold,
  colorsEnabled,
  cyan,
  dim,
  green,
  magenta,
  red,
  yellow,
} from "../src/output/colors.js";
import {
  formatEffectiveConfig,
  formatListHeader,
  formatListRow,
  formatScopeName,
} from "../src/output/format.js";

/** Creates a minimal EffectiveSessionConfig for testing. */
function makeMinimalResult(): EffectiveSessionConfig {
  return {
    effective: {
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
    },
    provenance: {
      mcpServers: {},
      env: {},
      settings: {},
      persona: [],
    },
    runtimePaths: null,
  };
}

describe("colorsEnabled", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore env
    for (const key of ["NO_COLOR", "FORCE_COLOR", "CI", "TERM"]) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("NO_COLOR=1 suppresses colors", () => {
    clearEnv("FORCE_COLOR");
    process.env.NO_COLOR = "1";
    clearEnv("CI");
    clearEnv("TERM");
    expect(colorsEnabled()).toBe(false);
  });

  it("FORCE_COLOR=1 forces colors even with NO_COLOR absent", () => {
    process.env.FORCE_COLOR = "1";
    clearEnv("NO_COLOR");
    clearEnv("CI");
    expect(colorsEnabled()).toBe(true);
  });

  it("FORCE_COLOR takes precedence over NO_COLOR", () => {
    process.env.FORCE_COLOR = "1";
    process.env.NO_COLOR = "1";
    expect(colorsEnabled()).toBe(true);
  });

  it("CI=1 suppresses colors", () => {
    clearEnv("FORCE_COLOR");
    clearEnv("NO_COLOR");
    clearEnv("TERM");
    process.env.CI = "1";
    expect(colorsEnabled()).toBe(false);
  });

  it("TERM=dumb suppresses colors", () => {
    clearEnv("FORCE_COLOR");
    clearEnv("NO_COLOR");
    clearEnv("CI");
    process.env.TERM = "dumb";
    expect(colorsEnabled()).toBe(false);
  });
});

describe("color functions with colors disabled", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    clearEnv("FORCE_COLOR");
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    for (const key of ["NO_COLOR", "FORCE_COLOR"]) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("green returns plain string when colors disabled", () => {
    expect(green("hello")).toBe("hello");
  });

  it("red returns plain string when colors disabled", () => {
    expect(red("hello")).toBe("hello");
  });

  it("yellow returns plain string when colors disabled", () => {
    expect(yellow("hello")).toBe("hello");
  });

  it("cyan returns plain string when colors disabled", () => {
    expect(cyan("hello")).toBe("hello");
  });

  it("bold returns plain string when colors disabled", () => {
    expect(bold("hello")).toBe("hello");
  });

  it("dim returns plain string when colors disabled", () => {
    expect(dim("hello")).toBe("hello");
  });

  it("magenta returns plain string when colors disabled", () => {
    expect(magenta("hello")).toBe("hello");
  });
});

describe("formatScopeName", () => {
  it("strips :path suffix from project scope names", () => {
    expect(formatScopeName("project-shared:/some/abs/path")).toBe("project-shared");
    expect(formatScopeName("project-role:/my/project")).toBe("project-role");
  });

  it("returns name unchanged when no colon suffix", () => {
    expect(formatScopeName("global-shared")).toBe("global-shared");
    expect(formatScopeName("global-role")).toBe("global-role");
  });
});

describe("formatListHeader", () => {
  it("includes SCOPE, ROLE, FILE columns", () => {
    const header = formatListHeader();
    expect(header).toContain("SCOPE");
    expect(header).toContain("ROLE");
    expect(header).toContain("FILE");
  });
});

describe("formatListRow", () => {
  it("includes scope, role, and file path", () => {
    const row = formatListRow(
      "global-role",
      "backend",
      "/home/user/.myclaude/config/global/roles/backend.yml"
    );
    expect(row).toContain("global-role");
    expect(row).toContain("backend");
    expect(row).toContain("/home/user/.myclaude/config/global/roles/backend.yml");
  });
});

describe("formatEffectiveConfig", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    clearEnv("NO_COLOR");
  });

  it("includes role in header", () => {
    const result = makeMinimalResult();
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("backend");
  });

  it("includes auth in header when provided", () => {
    const result = makeMinimalResult();
    const output = formatEffectiveConfig(result, "backend", "work");
    expect(output).toContain("work");
  });

  it("includes MCP server names", () => {
    const result = makeMinimalResult();
    result.effective.mcpServers = {
      postgres: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        env: {},
        enabled: true,
        __merge: "replace",
      },
    };
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("postgres");
    expect(output).toContain("stdio");
  });

  it("includes env vars", () => {
    const result = makeMinimalResult();
    result.effective.env = { EDITOR: "nvim", NODE_ENV: "development" };
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("EDITOR");
    expect(output).toContain("nvim");
  });

  it("includes settings", () => {
    const result = makeMinimalResult();
    result.effective.settings = { theme: "dark" };
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("theme");
    expect(output).toContain("dark");
  });

  it("includes persona claudeMd when present", () => {
    const result = makeMinimalResult();
    result.effective.persona.claudeMd = ["/some/path/CLAUDE.md"];
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("CLAUDE.md");
  });

  it("includes provenance when option is enabled", () => {
    const result = makeMinimalResult();
    result.effective.mcpServers = {
      postgres: {
        type: "stdio",
        command: "npx",
        args: [],
        env: {},
        enabled: true,
        __merge: "replace",
      },
    };
    result.provenance.mcpServers = {
      postgres: {
        source: "global-role",
        chain: [{ scope: "global-role", event: "introduced" }],
      },
    };
    const output = formatEffectiveConfig(result, "backend", undefined, { provenance: true });
    expect(output).toContain("global-role");
  });

  it("handles empty config gracefully", () => {
    const result = makeMinimalResult();
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("backend");
    // Should not throw; minimal output just has header
  });

  it("includes persona agents when present", () => {
    const result = makeMinimalResult();
    result.effective.persona.agents = ["/path/to/agent.js"];
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("agents");
  });

  it("includes persona skills when present", () => {
    const result = makeMinimalResult();
    result.effective.persona.skills = ["/path/to/skill.js"];
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("skills");
  });

  it("includes persona slashCmds when present", () => {
    const result = makeMinimalResult();
    result.effective.persona.slashCmds = ["/path/to/cmd.js"];
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("slashCmds");
  });

  it("includes persona memory when present", () => {
    const result = makeMinimalResult();
    result.effective.persona.memory = ["/path/to/memory.md"];
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("memory");
  });

  it("includes cwd in header when option is set", () => {
    const result = makeMinimalResult();
    const output = formatEffectiveConfig(result, "backend", undefined, { cwd: "/my/project" });
    expect(output).toContain("/my/project");
  });

  it("includes provenance for env vars when option is enabled", () => {
    const result = makeMinimalResult();
    result.effective.env = { NODE_ENV: "production" };
    result.provenance.env = {
      NODE_ENV: { source: "global-role", chain: ["global-role"] },
    };
    const output = formatEffectiveConfig(result, "backend", undefined, { provenance: true });
    expect(output).toContain("NODE_ENV");
  });

  it("includes provenance for settings when option is enabled", () => {
    const result = makeMinimalResult();
    result.effective.settings = { theme: "dark" };
    result.provenance.settings = {
      theme: { source: "global-shared", chain: ["global-shared"] },
    };
    const output = formatEffectiveConfig(result, "backend", undefined, { provenance: true });
    expect(output).toContain("theme");
  });

  it("renders http server type", () => {
    const result = makeMinimalResult();
    result.effective.mcpServers = {
      remote: {
        type: "http",
        url: "https://example.com/mcp",
        headers: {},
        enabled: true,
        __merge: "replace",
      },
    };
    const output = formatEffectiveConfig(result, "backend");
    expect(output).toContain("http");
  });

  it("renders suppressedBy in provenance when present", () => {
    const result = makeMinimalResult();
    result.effective.mcpServers = {
      postgres: {
        type: "stdio",
        command: "npx",
        args: [],
        env: {},
        enabled: false,
        __merge: "replace",
      },
    };
    result.provenance.mcpServers = {
      postgres: {
        source: "global-role",
        chain: [{ scope: "global-role", event: "introduced" }],
        suppressedBy: "project-role",
      },
    };
    const output = formatEffectiveConfig(result, "backend", undefined, { provenance: true });
    expect(output).toContain("suppressed");
  });
});
