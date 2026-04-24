/**
 * Tests for the `walkConfig` utility.
 *
 * Verifies that all string fields containing secret refs are visited
 * and that the mutable setter updates the document in place.
 */

import { ScopeDoc } from "@agent-profile/core";
import { describe, expect, it } from "vitest";
import { walkConfig } from "../src/utils/walk-config.js";

describe("walkConfig — field discovery", () => {
  it("yields all top-level env fields", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: { FOO: "bar", BAZ: "qux" },
      mcpServers: {},
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    const paths = fields.map((f) => f.jsonPath);

    expect(paths).toContain("env.FOO");
    expect(paths).toContain("env.BAZ");
  });

  it("yields env fields from MCP servers", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: {},
      mcpServers: {
        github: {
          type: "stdio",
          command: "npx",
          args: [],
          env: { TOKEN: "secret-value" },
        },
      },
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    const paths = fields.map((f) => f.jsonPath);

    expect(paths).toContain("mcpServers.github.env.TOKEN");
  });

  it("yields args fields from stdio MCP servers", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: {},
      mcpServers: {
        tool: {
          type: "stdio",
          command: "node",
          args: ["${env:SCRIPT_PATH}", "--verbose"],
          env: {},
        },
      },
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    const paths = fields.map((f) => f.jsonPath);

    expect(paths).toContain("mcpServers.tool.args[0]");
    expect(paths).toContain("mcpServers.tool.args[1]");
  });

  it("yields headers fields from HTTP servers", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: {},
      mcpServers: {
        remote: {
          type: "http",
          url: "https://api.example.com",
          headers: { Authorization: "Bearer ${secret:api.key}" },
        },
      },
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    const paths = fields.map((f) => f.jsonPath);

    expect(paths).toContain("mcpServers.remote.headers.Authorization");
  });

  it("skips null server tombstones", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: {},
      mcpServers: {
        deleted: null,
      },
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    // No fields from the null server should appear
    expect(fields.every((f) => !f.jsonPath.startsWith("mcpServers.deleted"))).toBe(true);
  });
});

describe("walkConfig — mutable setters", () => {
  it("set() updates the env field in the document", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: { SECRET_VAR: "${env:HOME}" },
      mcpServers: {},
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    const field = fields.find((f) => f.jsonPath === "env.SECRET_VAR");
    expect(field).toBeDefined();

    field?.set("/resolved/path");
    expect(doc.env.SECRET_VAR).toBe("/resolved/path");
  });

  it("set() updates a server env field", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: {},
      mcpServers: {
        gh: {
          type: "stdio",
          command: "npx",
          args: [],
          env: { TOKEN: "${secret:github.pat}" },
        },
      },
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    const field = fields.find((f) => f.jsonPath === "mcpServers.gh.env.TOKEN");
    expect(field).toBeDefined();

    field?.set("ghp_resolved_token");
    const server = doc.mcpServers.gh as { env: Record<string, string> };
    expect(server.env.TOKEN).toBe("ghp_resolved_token");
  });

  it("set() updates a server header field", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: {},
      mcpServers: {
        api: {
          type: "http",
          url: "https://api.example.com",
          headers: { Authorization: "Bearer ${secret:api.key}" },
        },
      },
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    const field = fields.find((f) => f.jsonPath === "mcpServers.api.headers.Authorization");
    expect(field).toBeDefined();

    field?.set("Bearer resolved-token");
    const server = doc.mcpServers.api as { headers: Record<string, string> };
    expect(server.headers.Authorization).toBe("Bearer resolved-token");
  });

  it("set() updates an arg in a server", () => {
    const doc = ScopeDoc.parse({
      version: 1,
      env: {},
      mcpServers: {
        script: {
          type: "stdio",
          command: "node",
          args: ["${env:SCRIPT}", "--flag"],
          env: {},
        },
      },
      settings: {},
    });

    const fields = Array.from(walkConfig(doc));
    const field = fields.find((f) => f.jsonPath === "mcpServers.script.args[0]");
    expect(field).toBeDefined();

    field?.set("/resolved/script.js");
    const server = doc.mcpServers.script as { args: string[] };
    expect(server.args[0]).toBe("/resolved/script.js");
  });
});
