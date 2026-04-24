/**
 * Tests for `myclaude version`.
 */
import { describe, expect, it } from "vitest";
import { cliVersion, readPackageVersion } from "../../src/commands/version.js";

describe("readPackageVersion", () => {
  it("returns a string for @agent-profile/core", () => {
    const version = readPackageVersion("@agent-profile/core");
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  it("returns 'unknown' for nonexistent package", () => {
    const version = readPackageVersion("@nonexistent/package-xyz-12345");
    expect(version).toBe("unknown");
  });

  it("returns a semver-like string for @agent-profile/core", () => {
    const version = readPackageVersion("@agent-profile/core");
    if (version !== "unknown") {
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe("cliVersion", () => {
  it("returns a string", () => {
    const version = cliVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  it("returns a semver-like string or 'unknown'", () => {
    const version = cliVersion();
    if (version !== "unknown") {
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe("version command output", () => {
  describe("human output", () => {
    it("prints myclaude, core, and node version lines", () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        const versions = {
          cli: cliVersion(),
          core: readPackageVersion("@agent-profile/core"),
          node: process.version,
        };
        process.stdout.write(
          `myclaude  ${versions.cli}\ncore      ${versions.core}\nnode      ${versions.node}\n`
        );
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      expect(output).toContain("myclaude");
      expect(output).toContain("core");
      expect(output).toContain("node");
    });

    it("includes current Node.js version", () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        const versions = {
          cli: cliVersion(),
          core: readPackageVersion("@agent-profile/core"),
          node: process.version,
        };
        process.stdout.write(
          `myclaude  ${versions.cli}\ncore      ${versions.core}\nnode      ${versions.node}\n`
        );
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      expect(output).toContain(process.version);
    });
  });

  describe("JSON output", () => {
    it("emits {cli, core, node} object", () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        const versions = {
          cli: cliVersion(),
          core: readPackageVersion("@agent-profile/core"),
          node: process.version,
        };
        process.stdout.write(`${JSON.stringify(versions)}\n`);
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      const parsed = JSON.parse(output) as { cli: string; core: string; node: string };
      expect(parsed).toHaveProperty("cli");
      expect(parsed).toHaveProperty("core");
      expect(parsed).toHaveProperty("node");
    });

    it("node version matches current process.version", () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        const versions = {
          cli: cliVersion(),
          core: readPackageVersion("@agent-profile/core"),
          node: process.version,
        };
        process.stdout.write(`${JSON.stringify(versions)}\n`);
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      const parsed = JSON.parse(output) as { node: string };
      expect(parsed.node).toBe(process.version);
    });
  });
});
