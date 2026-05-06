import { describe, expect, it } from "vitest";
import {
  AuthProfilesDoc,
  FragmentDoc,
  McpHttpServer,
  McpServer,
  McpSseServer,
  McpStdioServer,
  ScopeDoc,
} from "../src/schema/index.js";

describe("McpStdioServer", () => {
  it("parses a valid stdio server with all fields", () => {
    const result = McpStdioServer.safeParse({
      type: "stdio",
      command: "npx",
      args: ["-y", "some-pkg"],
      env: { FOO: "bar" },
      enabled: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe("npx");
      expect(result.data.args).toEqual(["-y", "some-pkg"]);
    }
  });

  it("parses a stdio server without explicit type (type is optional)", () => {
    const result = McpStdioServer.safeParse({ command: "node", args: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a stdio server missing required command", () => {
    const result = McpStdioServer.safeParse({ args: ["foo"] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty command string", () => {
    const result = McpStdioServer.safeParse({ command: "" });
    expect(result.success).toBe(false);
  });

  it("applies default empty arrays for args and env", () => {
    const result = McpStdioServer.safeParse({ command: "node" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toEqual([]);
      expect(result.data.env).toEqual({});
    }
  });
});

describe("McpHttpServer", () => {
  it("parses a valid http server", () => {
    const result = McpHttpServer.safeParse({
      type: "http",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer token" },
    });
    expect(result.success).toBe(true);
  });

  it("parses a streamable-http server", () => {
    const result = McpHttpServer.safeParse({
      type: "streamable-http",
      url: "https://mcp.example.com/stream",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid URL", () => {
    const result = McpHttpServer.safeParse({
      type: "http",
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("parses an http server with oauth config", () => {
    const result = McpHttpServer.safeParse({
      type: "http",
      url: "https://mcp.example.com",
      oauth: {
        clientId: "my-client",
        callbackPort: 8765,
        scopes: "read write",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.oauth?.clientId).toBe("my-client");
    }
  });
});

describe("McpSseServer", () => {
  it("parses a valid sse server", () => {
    const result = McpSseServer.safeParse({
      type: "sse",
      url: "https://sse.example.com/events",
    });
    expect(result.success).toBe(true);
  });

  it("rejects sse server without url", () => {
    const result = McpSseServer.safeParse({ type: "sse" });
    expect(result.success).toBe(false);
  });
});

describe("McpServer (union)", () => {
  it("parses a stdio server via the union", () => {
    const result = McpServer.safeParse({ command: "node", args: ["index.js"] });
    expect(result.success).toBe(true);
  });

  it("parses an http server via the union", () => {
    const result = McpServer.safeParse({ type: "http", url: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("parses an sse server via the union", () => {
    const result = McpServer.safeParse({ type: "sse", url: "https://example.com/sse" });
    expect(result.success).toBe(true);
  });

  it("parses enabled:false as a valid server field (tombstone is at ScopeDoc level)", () => {
    const result = McpServer.safeParse({ command: "node", enabled: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it("parses __extends field on a server", () => {
    const result = McpServer.safeParse({
      command: "npx",
      args: [],
      __extends: "global-role",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.__extends).toBe("global-role");
    }
  });

  it("parses __merge:'deep' on a server", () => {
    const result = McpServer.safeParse({ command: "node", __merge: "deep" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.__merge).toBe("deep");
    }
  });
});

describe("ScopeDoc", () => {
  it("parses a minimal valid scope doc with version:1", () => {
    const result = ScopeDoc.safeParse({ version: 1 });
    expect(result.success).toBe(true);
  });

  it("rejects a scope doc with wrong version", () => {
    const result = ScopeDoc.safeParse({ version: 2 });
    expect(result.success).toBe(false);
  });

  it("parses mcpServers with null tombstone values", () => {
    const result = ScopeDoc.safeParse({
      version: 1,
      mcpServers: { figma: null },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers.figma).toBeNull();
    }
  });

  it("rejects mcpServer names with invalid characters (uppercase)", () => {
    const result = ScopeDoc.safeParse({
      version: 1,
      mcpServers: { InvalidName: { command: "node" } },
    });
    expect(result.success).toBe(false);
  });

  it("accepts mcpServer names with hyphens and underscores", () => {
    const result = ScopeDoc.safeParse({
      version: 1,
      mcpServers: {
        "my-server": { command: "node" },
        my_server2: { command: "node" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("parses __extends directive at scope doc level (on a server)", () => {
    const result = ScopeDoc.safeParse({
      version: 1,
      mcpServers: {
        postgres: {
          command: "npx",
          __extends: "global-role",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults: empty mcpServers, env, settings, use, disabledServers", () => {
    const result = ScopeDoc.safeParse({ version: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toEqual({});
      expect(result.data.env).toEqual({});
      expect(result.data.settings).toEqual({});
      expect(result.data.use).toEqual([]);
      expect(result.data.disabledServers).toEqual([]);
    }
  });

  it("preserves optional Agent Profile identity metadata", () => {
    const result = ScopeDoc.safeParse({
      version: 1,
      profile: {
        displayName: "Backend API Review",
        purpose: "Review backend API changes before launch",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profile).toEqual({
        displayName: "Backend API Review",
        purpose: "Review backend API changes before launch",
      });
    }
  });
});

describe("AuthProfilesDoc", () => {
  it("parses a valid auth profiles doc", () => {
    const result = AuthProfilesDoc.safeParse({
      version: 1,
      authProfiles: {
        work: {
          displayName: "Work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts keyring:// URI in secretRef", () => {
    const result = AuthProfilesDoc.safeParse({
      version: 1,
      authProfiles: {
        personal: {
          anthropic: {
            mode: "apiKey",
            secretRef: "keyring://anthropic/personal",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-keyring secretRef", () => {
    const result = AuthProfilesDoc.safeParse({
      version: 1,
      authProfiles: {
        work: {
          anthropic: {
            mode: "apiKey",
            secretRef: "sk-ant-my-plain-api-key",
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects all keyring:// forms that don't have service/account", () => {
    const result = AuthProfilesDoc.safeParse({
      version: 1,
      authProfiles: {
        bad: {
          anthropic: {
            mode: "apiKey",
            secretRef: "https://not-keyring.example.com",
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("FragmentDoc", () => {
  it("parses a valid fragment doc", () => {
    const result = FragmentDoc.safeParse({
      name: "postgres-core",
      mcpServer: {
        postgres: {
          type: "stdio",
          command: "npx",
          args: ["-y", "server-postgres"],
          env: { DATABASE_URL: "${secret:postgres.default}" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a fragment with invalid name characters (uppercase)", () => {
    const result = FragmentDoc.safeParse({ name: "PostgresCore" });
    expect(result.success).toBe(false);
  });

  it("rejects a fragment name with spaces", () => {
    const result = FragmentDoc.safeParse({ name: "postgres core" });
    expect(result.success).toBe(false);
  });
});
