import { EventEmitter } from "node:events";
import type { EffectiveConfig } from "@agent-profile/core";
import { describe, expect, it } from "vitest";
import {
  type ClaudeLaunchRuntimePaths,
  type LaunchAuthMode,
  buildClaudeLaunchArgs,
  buildClaudeLaunchEnv,
} from "../../src/commands/launch/env.js";
import {
  type ClaudeChildProcess,
  type ClaudeSpawnFn,
  type ClaudeSpawnOptions,
  type SignalProcess,
  spawnClaude,
} from "../../src/commands/launch/spawn.js";
import { type CliError, EXIT_SPAWN_FAILURE } from "../../src/errors.js";

const runtimePaths: ClaudeLaunchRuntimePaths = {
  sessionDir: "/sessions/session-1",
  claudeConfigDir: "/sessions/session-1/.claude",
  mcpConfig: "/sessions/session-1/mcp.json",
  settings: "/sessions/session-1/settings.json",
};

const effective: Pick<EffectiveConfig, "env"> = {
  env: {
    PATH: "/profile/bin",
    FROM_PROFILE: "yes",
    ANTHROPIC_API_KEY: "profile-key",
  },
};

function launchEnvInput(authMode: LaunchAuthMode) {
  return {
    baseEnv: {
      PATH: "/usr/bin",
      FROM_BASE: "yes",
      ANTHROPIC_API_KEY: "base-key",
      ANTHROPIC_AUTH_TOKEN: "base-token",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
    },
    effective,
    runtimePaths,
    sessionId: "session-1",
    capabilityToken: "cap-token",
    sessionsRoot: "/sessions",
    authMode,
  };
}

class FakeChild extends EventEmitter implements ClaudeChildProcess {
  readonly killedSignals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.killedSignals.push(signal);
    return true;
  }
}

class FakeSignalProcess implements SignalProcess {
  private readonly signalListeners = new Map<NodeJS.Signals, Set<NodeJS.SignalsListener>>();

  on(signal: NodeJS.Signals, listener: NodeJS.SignalsListener): this {
    const listeners = this.signalListeners.get(signal) ?? new Set<NodeJS.SignalsListener>();
    listeners.add(listener);
    this.signalListeners.set(signal, listeners);
    return this;
  }

  off(signal: NodeJS.Signals, listener: NodeJS.SignalsListener): this {
    this.signalListeners.get(signal)?.delete(listener);
    return this;
  }

  emitSignal(signal: NodeJS.Signals): void {
    for (const listener of this.signalListeners.get(signal) ?? []) {
      listener(signal);
    }
  }

  listenerCountFor(signal: NodeJS.Signals): number {
    return this.signalListeners.get(signal)?.size ?? 0;
  }
}

describe("launch env helpers", () => {
  it("builds Claude args with strict MCP config and setting sources by default", () => {
    expect(buildClaudeLaunchArgs(runtimePaths)).toEqual([
      "--strict-mcp-config",
      "--mcp-config",
      runtimePaths.mcpConfig,
      "--settings",
      runtimePaths.settings,
      "--setting-sources",
      "user,project,local",
    ]);
  });

  it("builds Claude args for strict disable, add-dir, bare, and passthrough order", () => {
    expect(
      buildClaudeLaunchArgs(runtimePaths, {
        strict: false,
        addDirs: ["/repo", "/extra"],
        bare: true,
        passthroughArgs: ["--prompt", "Review PR"],
      })
    ).toEqual([
      "--mcp-config",
      runtimePaths.mcpConfig,
      "--settings",
      runtimePaths.settings,
      "--setting-sources",
      "user,project,local",
      "--add-dir",
      "/repo",
      "--add-dir",
      "/extra",
      "--bare",
      "--prompt",
      "Review PR",
    ]);
  });

  it("inherits base env, applies effective env, strips Anthropic credentials, and sets session env", () => {
    const env = buildClaudeLaunchEnv(launchEnvInput("apiKey"));

    expect(env.PATH).toBe("/profile/bin");
    expect(env.FROM_BASE).toBe("yes");
    expect(env.FROM_PROFILE).toBe("yes");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe(runtimePaths.claudeConfigDir);
    expect(env.MYCLAUDE_SESSION_ID).toBe("session-1");
    expect(env.MYCLAUDE_CAPABILITY_TOKEN).toBe("cap-token");
    expect(env.MYCLAUDE_SESSIONS_ROOT).toBe("/sessions");
  });

  it("sets only the Bedrock provider flag for bedrock auth", () => {
    const env = buildClaudeLaunchEnv(launchEnvInput("bedrock"));

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
  });

  it("sets only the Vertex provider flag for vertex auth", () => {
    const env = buildClaudeLaunchEnv(launchEnvInput("vertex"));

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_VERTEX).toBe("1");
  });

  it.each(["apiKey", "gateway"] as const)("sets no provider flag for %s auth", (authMode) => {
    const env = buildClaudeLaunchEnv(launchEnvInput(authMode));

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
  });
});

describe("spawnClaude", () => {
  it("spawns claude with exact args, inherited stdio, and launch env", async () => {
    const child = new FakeChild();
    let captured: { command: string; args: string[]; options: ClaudeSpawnOptions } | undefined;
    const spawnFn: ClaudeSpawnFn = (command, args, options) => {
      captured = { command, args, options };
      return child;
    };

    const result = spawnClaude({ ...launchEnvInput("apiKey"), spawnFn });
    child.emit("close", 0, null);

    await expect(result).resolves.toBe(0);
    expect(captured).toEqual({
      command: "claude",
      args: [
        "--strict-mcp-config",
        "--mcp-config",
        runtimePaths.mcpConfig,
        "--settings",
        runtimePaths.settings,
        "--setting-sources",
        "user,project,local",
      ],
      options: expect.objectContaining({
        stdio: "inherit",
        env: expect.objectContaining({
          CLAUDE_CONFIG_DIR: runtimePaths.claudeConfigDir,
          MYCLAUDE_SESSION_ID: "session-1",
        }),
      }),
    });
  });

  it("forwards parent signals to the child, waits for close, and maps signal exits", async () => {
    const child = new FakeChild();
    const signalProcess = new FakeSignalProcess();
    const spawnFn: ClaudeSpawnFn = () => child;

    const result = spawnClaude({ ...launchEnvInput("apiKey"), spawnFn, signalProcess });

    signalProcess.emitSignal("SIGTERM");
    expect(child.killedSignals).toEqual(["SIGTERM"]);
    expect(signalProcess.listenerCountFor("SIGTERM")).toBe(1);

    child.emit("close", null, "SIGTERM");

    await expect(result).resolves.toBe(143);
    expect(signalProcess.listenerCountFor("SIGTERM")).toBe(0);
  });

  it("maps child signal exits to 128 plus the signal number", async () => {
    const child = new FakeChild();
    const signalProcess = new FakeSignalProcess();
    const spawnFn: ClaudeSpawnFn = () => child;

    const result = spawnClaude({ ...launchEnvInput("apiKey"), spawnFn, signalProcess });
    child.emit("close", null, "SIGHUP");

    await expect(result).resolves.toBe(129);
  });

  it("maps spawn errors to CliError exit code 5", async () => {
    const child = new FakeChild();
    const spawnFn: ClaudeSpawnFn = () => child;

    const result = spawnClaude({ ...launchEnvInput("apiKey"), spawnFn });
    child.emit("error", new Error("ENOENT"));

    await expect(result).rejects.toMatchObject({
      name: "CliError",
      exitCode: EXIT_SPAWN_FAILURE,
      message: "Failed to launch claude: ENOENT",
    } satisfies Partial<CliError>);
  });
});
