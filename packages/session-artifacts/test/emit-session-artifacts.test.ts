import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffectiveConfig } from "@agent-profile/core";
import { createSessionDir } from "@agent-profile/persona-deployer";
import { afterEach, describe, expect, it } from "vitest";
import { emitSessionArtifacts } from "../src/emit.js";

let tmpRoot = "";

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = "";
});

function makeTmpRoot(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), "session-artifacts-"));
  return tmpRoot;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function baseEffective(partial: Partial<EffectiveConfig> = {}): EffectiveConfig {
  return {
    mcpServers: {},
    env: {},
    settings: {},
    persona: { claudeMd: [], agents: [], skills: [], slashCmds: [], memory: [] },
    ...partial,
  };
}

describe("emitSessionArtifacts", () => {
  it("writes mcp.json, settings.json, helper wrappers, persona files, and runtime paths", async () => {
    const root = makeTmpRoot();
    const personaDir = join(root, "persona");
    await mkdir(personaDir, { recursive: true });
    const claudeMd = join(personaDir, "CLAUDE.md");
    await writeFile(claudeMd, "# Backend persona\n", "utf8");

    const session = await createSessionDir({ root: join(root, "sessions") });
    const effective = baseEffective({
      mcpServers: {
        postgres: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-postgres"],
          env: { DATABASE_URL: "${secret:postgres.url}" },
          enabled: true,
          __merge: "replace",
        },
        github: {
          type: "http",
          url: "https://mcp.example.test/github",
          headers: { Authorization: "Bearer ${secret:github.pat}" },
          enabled: true,
          __merge: "replace",
        },
        legacy: {
          type: "sse",
          url: "https://mcp.example.test/legacy",
          headers: { Authorization: "Bearer keyring://legacy/token" },
          enabled: true,
          __merge: "replace",
        },
      },
      settings: {
        theme: "dark",
        apiKeyHelper: "/stale/helper",
        nested: { keep: true },
      },
      persona: { claudeMd: [claudeMd], agents: [], skills: [], slashCmds: [], memory: [] },
    });

    const result = await emitSessionArtifacts({
      effective,
      session,
      authMode: "apiKey",
    });

    expect(result.runtimePaths).toEqual({
      sessionDir: session.sessionDir,
      claudeConfigDir: session.claudeConfigDir,
      mcpConfig: join(session.sessionDir, "mcp.json"),
      settings: join(session.sessionDir, "settings.json"),
      apiKeyHelper: join(session.sessionDir, "apiKeyHelper.sh"),
      headersHelper: join(session.sessionDir, "headersHelper.sh"),
      claudeMd: join(session.sessionDir, "CLAUDE.md"),
    });

    const mcp = await readJson<{
      mcpServers: Record<string, Record<string, unknown>>;
    }>(result.runtimePaths.mcpConfig);

    expect(mcp.mcpServers.postgres?.command).toBe("npx");
    expect(mcp.mcpServers.postgres?.env).toEqual({ DATABASE_URL: "${secret:postgres.url}" });
    expect(mcp.mcpServers.postgres?.enabled).toBeUndefined();
    expect(mcp.mcpServers.postgres?.__merge).toBeUndefined();
    expect(mcp.mcpServers.github?.headersHelper).toBe(result.runtimePaths.headersHelper);
    expect(mcp.mcpServers.github?.headers).toEqual({
      Authorization: "Bearer ${secret:github.pat}",
    });
    expect(mcp.mcpServers.legacy?.headersHelper).toBeUndefined();
    expect(mcp.mcpServers.legacy?.headers).toEqual({
      Authorization: "Bearer keyring://legacy/token",
    });

    const settings = await readJson<Record<string, unknown>>(result.runtimePaths.settings);
    expect(settings.theme).toBe("dark");
    expect(settings.nested).toEqual({ keep: true });
    expect(settings.apiKeyHelper).toBe(result.runtimePaths.apiKeyHelper);

    const apiHelper = await readFile(result.runtimePaths.apiKeyHelper as string, "utf8");
    expect(apiHelper).toBe(
      '#!/bin/sh\nexec myclaude-helper anthropic "$MYCLAUDE_SESSION_ID" "$MYCLAUDE_CAPABILITY_TOKEN"\n'
    );

    const headersHelper = await readFile(result.runtimePaths.headersHelper as string, "utf8");
    expect(headersHelper).toBe(
      '#!/bin/sh\nexec myclaude-helper mcp-headers "$MYCLAUDE_SESSION_ID" "$MYCLAUDE_CAPABILITY_TOKEN" "$1"\n'
    );

    if (process.platform !== "win32") {
      expect(statSync(result.runtimePaths.apiKeyHelper as string).mode & 0o777).toBe(0o700);
      expect(statSync(result.runtimePaths.headersHelper as string).mode & 0o777).toBe(0o700);
    }

    const renderedClaudeMd = await readFile(result.runtimePaths.claudeMd as string, "utf8");
    expect(renderedClaudeMd).toContain("# Backend persona");
  });

  it("does not write apiKeyHelper when authMode is not apiKey", async () => {
    const root = makeTmpRoot();
    const session = await createSessionDir({ root });
    const effective = baseEffective({
      settings: { theme: "dark" },
    });

    const result = await emitSessionArtifacts({
      effective,
      session,
      authMode: "bedrock",
    });

    expect(result.runtimePaths.apiKeyHelper).toBeNull();
    expect(existsSync(join(session.sessionDir, "apiKeyHelper.sh"))).toBe(false);

    const settings = await readJson<Record<string, unknown>>(result.runtimePaths.settings);
    expect(settings).toEqual({ theme: "dark" });
  });

  it("does not override explicit headersHelper values", async () => {
    const root = makeTmpRoot();
    const session = await createSessionDir({ root });
    const effective = baseEffective({
      mcpServers: {
        figma: {
          type: "streamable-http",
          url: "https://mcp.example.test/figma",
          headers: {},
          headersHelper: "/custom/headers-helper.sh",
          enabled: true,
          __merge: "replace",
        },
      },
    });

    const result = await emitSessionArtifacts({ effective, session });

    expect(result.runtimePaths.headersHelper).toBeNull();
    expect(existsSync(join(session.sessionDir, "headersHelper.sh"))).toBe(false);

    const mcp = await readJson<{
      mcpServers: Record<string, Record<string, unknown>>;
    }>(result.runtimePaths.mcpConfig);
    expect(mcp.mcpServers.figma?.headersHelper).toBe("/custom/headers-helper.sh");
  });

  it("passes missing source handling and collisions through from persona-deployer", async () => {
    const root = makeTmpRoot();
    const fixtureDir = join(root, "fixtures");
    const scopeDir = join(fixtureDir, "scope");
    await mkdir(scopeDir, { recursive: true });

    const first = join(fixtureDir, "reviewer.md");
    const second = join(scopeDir, "reviewer.md");
    const missing = join(fixtureDir, "missing.md");
    await writeFile(first, "# First\n", "utf8");
    await writeFile(second, "# Second\n", "utf8");

    const session = await createSessionDir({ root: join(root, "sessions") });
    const effective = baseEffective({
      persona: {
        claudeMd: [],
        agents: [first, second, missing],
        skills: [],
        slashCmds: [],
        memory: [],
      },
    });

    const result = await emitSessionArtifacts({
      effective,
      session,
      onMissingSource: "skip",
    });

    expect(result.persona.collisions).toHaveLength(1);
    expect(result.persona.collisions[0]?.overriddenSource).toBe(first);
    expect(result.persona.collisions[0]?.winningSource).toBe(second);
    expect(result.persona.missingSources).toHaveLength(1);
    expect(result.persona.missingSources[0]?.sourcePath).toBe(missing);

    const deployed = await readFile(join(session.claudeConfigDir, "agents", "reviewer.md"), "utf8");
    expect(deployed).toBe("# Second\n");
  });
});
