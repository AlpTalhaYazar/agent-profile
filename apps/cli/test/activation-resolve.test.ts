/**
 * Tests for the activation resolver.
 * All four resolution layers are exercised in isolation.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_ROLE_HELP, resolveActivation } from "../src/activation/resolve.js";

/** Creates a temp directory and returns its path. */
function makeTempDir(): string {
  const dir = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("resolveActivation", () => {
  let tempDir: string;
  let savedEnv: NodeJS.ProcessEnv;

  /** Clears an env var without setting it to the string "undefined". */
  function clearEnv(key: string): void {
    delete process.env[key];
  }

  beforeEach(() => {
    tempDir = makeTempDir();
    // Save and clear relevant env vars
    savedEnv = { ...process.env };
    clearEnv("MYCLAUDE_ROLE");
    clearEnv("MYCLAUDE_AUTH_PROFILE");
  });

  afterEach(() => {
    // Restore env
    for (const key of ["MYCLAUDE_ROLE", "MYCLAUDE_AUTH_PROFILE"]) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Layer 1: explicit flags", () => {
    it("returns flag values when provided", () => {
      const result = resolveActivation({ flagRole: "backend", flagAuth: "work" });
      expect(result.role).toBe("backend");
      expect(result.auth).toBe("work");
      expect(result.roleSource).toBe("flag");
      expect(result.authSource).toBe("flag");
    });

    it("flag beats env variable", () => {
      process.env.MYCLAUDE_ROLE = "frontend";
      process.env.MYCLAUDE_AUTH_PROFILE = "personal";
      const result = resolveActivation({ flagRole: "backend", flagAuth: "work" });
      expect(result.role).toBe("backend");
      expect(result.auth).toBe("work");
      expect(result.roleSource).toBe("flag");
    });

    it("flag beats file-based activation", () => {
      const myClaudeDir = join(tempDir, ".myclaude");
      mkdirSync(myClaudeDir);
      writeFileSync(join(myClaudeDir, "role"), "frontend");
      const result = resolveActivation({
        flagRole: "backend",
        cwd: tempDir,
        home: tempDir,
      });
      expect(result.role).toBe("backend");
      expect(result.roleSource).toBe("flag");
    });
  });

  describe("Layer 2: environment variables", () => {
    it("returns env role when set", () => {
      process.env.MYCLAUDE_ROLE = "backend";
      const result = resolveActivation({ home: tempDir, cwd: tempDir });
      expect(result.role).toBe("backend");
      expect(result.roleSource).toBe("env");
    });

    it("returns env auth when set", () => {
      process.env.MYCLAUDE_AUTH_PROFILE = "work";
      const result = resolveActivation({ home: tempDir, cwd: tempDir });
      expect(result.auth).toBe("work");
      expect(result.authSource).toBe("env");
    });

    it("env beats file activation", () => {
      process.env.MYCLAUDE_ROLE = "backend";
      const myClaudeDir = join(tempDir, ".myclaude");
      mkdirSync(myClaudeDir);
      writeFileSync(join(myClaudeDir, "role"), "frontend");
      const result = resolveActivation({ cwd: tempDir, home: tempDir });
      expect(result.role).toBe("backend");
      expect(result.roleSource).toBe("env");
    });

    it("missing MYCLAUDE_ROLE env falls through to next layer", () => {
      clearEnv("MYCLAUDE_ROLE"); // beforeEach already cleared it, this is explicit
      const result = resolveActivation({ home: tempDir, cwd: tempDir });
      expect(result.role).toBeNull();
      expect(result.roleSource).toBeNull();
    });
  });

  describe("Layer 3: find-up files", () => {
    it("reads .myclaude/role from cwd", () => {
      const myClaudeDir = join(tempDir, ".myclaude");
      mkdirSync(myClaudeDir);
      writeFileSync(join(myClaudeDir, "role"), "backend\n");
      const result = resolveActivation({ cwd: tempDir, home: tempDir });
      expect(result.role).toBe("backend");
      expect(result.roleSource).toBe("file");
    });

    it("reads .myclaude/auth from cwd", () => {
      const myClaudeDir = join(tempDir, ".myclaude");
      mkdirSync(myClaudeDir);
      writeFileSync(join(myClaudeDir, "auth"), "work");
      const result = resolveActivation({ cwd: tempDir, home: tempDir });
      expect(result.auth).toBe("work");
      expect(result.authSource).toBe("file");
    });

    it("walks up from cwd until .myclaude/role found", () => {
      // Create parent/.myclaude/role but not child/.myclaude/role
      const parentDir = join(tempDir, "parent");
      const childDir = join(parentDir, "child");
      mkdirSync(join(parentDir, ".myclaude"), { recursive: true });
      mkdirSync(childDir);
      writeFileSync(join(parentDir, ".myclaude", "role"), "backend");

      const result = resolveActivation({ cwd: childDir, home: tempDir });
      expect(result.role).toBe("backend");
      expect(result.roleSource).toBe("file");
    });

    it("returns null when no .myclaude/role found", () => {
      const result = resolveActivation({ cwd: tempDir, home: tempDir });
      expect(result.role).toBeNull();
      expect(result.roleSource).toBeNull();
    });
  });

  describe("Layer 4: user defaults", () => {
    it("reads ~/.myclaude/default-role", () => {
      writeFileSync(join(tempDir, "default-role"), "backend");
      const result = resolveActivation({ home: tempDir, cwd: tempDir });
      expect(result.role).toBe("backend");
      expect(result.roleSource).toBe("default");
    });

    it("reads ~/.myclaude/default-auth", () => {
      writeFileSync(join(tempDir, "default-auth"), "work");
      const result = resolveActivation({ home: tempDir, cwd: tempDir });
      expect(result.auth).toBe("work");
      expect(result.authSource).toBe("default");
    });

    it("returns null when default-role does not exist", () => {
      const result = resolveActivation({ home: tempDir, cwd: tempDir });
      expect(result.role).toBeNull();
    });
  });

  describe("resolution precedence", () => {
    it("all sources missing → role is null", () => {
      const result = resolveActivation({ home: tempDir, cwd: tempDir });
      expect(result.role).toBeNull();
      expect(result.auth).toBeNull();
    });

    it("MYCLAUDE_ROLE set but no auth → partial result", () => {
      process.env.MYCLAUDE_ROLE = "backend";
      const result = resolveActivation({ home: tempDir, cwd: tempDir });
      expect(result.role).toBe("backend");
      expect(result.auth).toBeNull();
    });
  });

  describe("NO_ROLE_HELP constant", () => {
    it("contains the expected help text", () => {
      expect(NO_ROLE_HELP).toContain("No role selected");
      expect(NO_ROLE_HELP).toContain("myclaude use backend");
      expect(NO_ROLE_HELP).toContain("myclaude launch --role backend");
      expect(NO_ROLE_HELP).toContain("~/.myclaude/default-role");
    });
  });
});
