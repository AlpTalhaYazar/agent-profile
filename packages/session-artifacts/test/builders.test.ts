import type { EffectiveConfig } from "@agent-profile/core";
import { describe, expect, it } from "vitest";
import {
  apiKeyHelperScript,
  headersHelperScript,
  shellCommand,
  shellQuote,
} from "../src/helpers.js";
import { buildMcpConfig, shouldInjectHeadersHelper } from "../src/mcp-config.js";
import { buildSettings } from "../src/settings.js";

const emptyPersona = { claudeMd: [], agents: [], skills: [], slashCmds: [], memory: [] };

describe("helper script builders", () => {
  it("renders readable default helper commands", () => {
    expect(apiKeyHelperScript("myclaude-helper")).toBe(
      '#!/bin/sh\nexec myclaude-helper anthropic "$MYCLAUDE_SESSION_ID" "$MYCLAUDE_CAPABILITY_TOKEN"\n'
    );
    expect(headersHelperScript("myclaude-helper")).toContain("mcp-headers");
  });

  it("quotes custom helper executables when needed", () => {
    expect(shellCommand("/Applications/My Helper/bin/myclaude-helper")).toBe(
      "'/Applications/My Helper/bin/myclaude-helper'"
    );
    expect(shellQuote("can't")).toBe("'can'\\''t'");
  });
});

describe("mcp config builder", () => {
  it("preserves transport shapes and unresolved refs while stripping resolver-only fields", () => {
    const effective: EffectiveConfig = {
      mcpServers: {
        filesystem: {
          command: "node",
          args: ["server.js", "${env:PWD}"],
          env: { ROOTS: "${env:PWD}", TOKEN: "keyring://fs/work" },
          enabled: true,
          __merge: "deep",
        },
        remote: {
          type: "http",
          url: "https://mcp.example.test",
          headers: { Authorization: "Bearer ${secret:remote.token}" },
          enabled: true,
          __merge: "replace",
        },
      },
      env: { SHOULD_NOT_BE_WRITTEN: "1" },
      settings: {},
      persona: emptyPersona,
    };

    const { config, wroteHeadersHelper } = buildMcpConfig(effective, "/tmp/headersHelper.sh");

    expect(wroteHeadersHelper).toBe(true);
    expect(config.mcpServers.filesystem).toEqual({
      command: "node",
      args: ["server.js", "${env:PWD}"],
      env: { ROOTS: "${env:PWD}", TOKEN: "keyring://fs/work" },
    });
    expect(config.mcpServers.remote).toEqual({
      type: "http",
      url: "https://mcp.example.test",
      headers: { Authorization: "Bearer ${secret:remote.token}" },
      headersHelper: "/tmp/headersHelper.sh",
    });
  });

  it("detects only HTTP transports without explicit headersHelper", () => {
    expect(shouldInjectHeadersHelper({ type: "http" })).toBe(true);
    expect(shouldInjectHeadersHelper({ type: "streamable-http" })).toBe(true);
    expect(shouldInjectHeadersHelper({ type: "http", headersHelper: "/custom" })).toBe(false);
    expect(shouldInjectHeadersHelper({ type: "sse" })).toBe(false);
    expect(shouldInjectHeadersHelper({ command: "node" })).toBe(false);
  });
});

describe("settings builder", () => {
  it("clones settings and injects apiKeyHelper when provided", () => {
    const effective: EffectiveConfig = {
      mcpServers: {},
      env: {},
      settings: { theme: "dark", nested: { keep: true } },
      persona: emptyPersona,
    };

    const settings = buildSettings(effective, "/tmp/apiKeyHelper.sh");

    expect(settings).toEqual({
      theme: "dark",
      nested: { keep: true },
      apiKeyHelper: "/tmp/apiKeyHelper.sh",
    });
    expect(effective.settings).toEqual({ theme: "dark", nested: { keep: true } });
  });
});
