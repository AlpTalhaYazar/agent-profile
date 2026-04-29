import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLaunch } from "../../src/commands/launch/index.js";
import type { ClaudeChildProcess } from "../../src/commands/launch/spawn.js";
import type { CliTransport } from "../../src/transport/types.js";
import { MockBackend } from "../helpers/mock-backend.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "myclaude-launch-"));
}

function writeFixtureHome(home: string): void {
  const rolesDir = join(home, "config", "global", "roles");
  mkdirSync(rolesDir, { recursive: true });
  writeFileSync(
    join(home, "config", "authProfiles.yml"),
    [
      "version: 1",
      "authProfiles:",
      "  work:",
      "    anthropic:",
      "      mode: apiKey",
      "      secretRef: keyring://anthropic/work",
      "    mcpSecretRefs:",
      "      github.pat: keyring://github/work",
      "      remote.token: keyring://remote/token",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(rolesDir, "backend.yml"),
    [
      "version: 1",
      "env:",
      '  PROFILE_ENV: "${secret:github.pat}"',
      "settings:",
      '  theme: "dark"',
      "mcpServers:",
      "  github:",
      "    type: stdio",
      "    command: github-mcp",
      "    args: []",
      "    env:",
      '      GITHUB_TOKEN: "${secret:github.pat}"',
      "  remote:",
      "    type: http",
      "    url: https://mcp.example.test",
      "    headers:",
      '      Authorization: "Bearer ${secret:remote.token}"',
      "",
    ].join("\n")
  );
}

function writeStubClaude(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "claude");
  writeFileSync(
    scriptPath,
    [
      "#!/bin/sh",
      'session_dir="$(dirname "$CLAUDE_CONFIG_DIR")"',
      "{",
      '  printf "ARGS=%s\\n" "$*"',
      '  printf "CLAUDE_CONFIG_DIR=%s\\n" "$CLAUDE_CONFIG_DIR"',
      '  printf "MYCLAUDE_SESSION_ID=%s\\n" "$MYCLAUDE_SESSION_ID"',
      '  printf "MYCLAUDE_CAPABILITY_TOKEN=%s\\n" "$MYCLAUDE_CAPABILITY_TOKEN"',
      '  printf "MYCLAUDE_SESSIONS_ROOT=%s\\n" "$MYCLAUDE_SESSIONS_ROOT"',
      '  printf "PROFILE_ENV=%s\\n" "$PROFILE_ENV"',
      '  printf "ANTHROPIC_API_KEY=%s\\n" "${ANTHROPIC_API_KEY-unset}"',
      '  printf "ANTHROPIC_AUTH_TOKEN=%s\\n" "${ANTHROPIC_AUTH_TOKEN-unset}"',
      '  printf "SESSION_DIR=%s\\n" "$session_dir"',
      '  test -f "$session_dir/session.json" && printf "SESSION_JSON=present\\n"',
      '  grep -q \'"capabilityToken": "fixed-token"\' "$session_dir/session.json" && printf "TOKEN_IN_MANIFEST=yes\\n"',
      '  grep -q "apiKeyHelper" "$session_dir/settings.json" && printf "API_HELPER=yes\\n"',
      '  grep -q "headersHelper" "$session_dir/mcp.json" && printf "HEADERS_HELPER=yes\\n"',
      '  grep -q \'\\${secret:remote.token}\' "$session_dir/mcp.json" && printf "REMOTE_TEMPLATE=yes\\n"',
      '  if grep -q "remote-secret-value" "$session_dir/mcp.json"; then printf "REMOTE_SECRET=yes\\n"; else printf "REMOTE_SECRET=no\\n"; fi',
      '} > "$MYCLAUDE_STUB_OUT"',
      "exit 7",
      "",
    ].join("\n"),
    { mode: 0o700 }
  );
}

function createFakeChild(
  result:
    | { kind: "close"; code: number | null; signal: NodeJS.Signals | null }
    | { kind: "error"; error: Error }
): ClaudeChildProcess {
  class FakeChild implements ClaudeChildProcess {
    private readonly closeListeners: Array<
      (code: number | null, signal: NodeJS.Signals | null) => void
    > = [];
    private readonly errorListeners: Array<(err: Error) => void> = [];
    private settled = false;

    kill(_signal: NodeJS.Signals): boolean {
      return true;
    }

    on(
      event: "close",
      listener: (code: number | null, signal: NodeJS.Signals | null) => void
    ): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(
      event: "close" | "error",
      listener:
        | ((code: number | null, signal: NodeJS.Signals | null) => void)
        | ((err: Error) => void)
    ): this {
      if (event === "close") {
        this.closeListeners.push(
          listener as (code: number | null, signal: NodeJS.Signals | null) => void
        );
      } else {
        this.errorListeners.push(listener as (err: Error) => void);
      }
      this.maybeSettle();
      return this;
    }

    private maybeSettle(): void {
      if (this.settled) return;
      if (result.kind === "close" && this.closeListeners.length > 0) {
        this.settled = true;
        queueMicrotask(() => {
          for (const listener of this.closeListeners) {
            listener(result.code, result.signal);
          }
        });
      } else if (result.kind === "error" && this.errorListeners.length > 0) {
        this.settled = true;
        queueMicrotask(() => {
          for (const listener of this.errorListeners) {
            listener(result.error);
          }
        });
      }
    }
  }

  return new FakeChild();
}

function createTransportStub(overrides: Partial<CliTransport>): CliTransport {
  return {
    transportKind: "standalone",
    authList: async () => {
      throw new Error("Unexpected transport.authList call");
    },
    authGetSecretRef: async () => {
      throw new Error("Unexpected transport.authGetSecretRef call");
    },
    profileShow: async () => {
      throw new Error("Unexpected transport.profileShow call");
    },
    sessionsList: async () => {
      throw new Error("Unexpected transport.sessionsList call");
    },
    daemonStatus: async () => {
      throw new Error("Unexpected transport.daemonStatus call");
    },
    daemonStop: async () => {
      throw new Error("Unexpected transport.daemonStop call");
    },
    authAdd: async () => {
      throw new Error("Unexpected transport.authAdd call");
    },
    authSetSecret: async () => {
      throw new Error("Unexpected transport.authSetSecret call");
    },
    authRotate: async () => {
      throw new Error("Unexpected transport.authRotate call");
    },
    authRemove: async () => {
      throw new Error("Unexpected transport.authRemove call");
    },
    secretsMigrate: async () => {
      throw new Error("Unexpected transport.secretsMigrate call");
    },
    sessionStart: async () => {
      throw new Error("Unexpected transport.sessionStart call");
    },
    sessionEnd: async () => {
      throw new Error("Unexpected transport.sessionEnd call");
    },
    sessionsKill: async () => {
      throw new Error("Unexpected transport.sessionsKill call");
    },
    sessionsRelaunch: async () => {
      throw new Error("Unexpected transport.sessionsRelaunch call");
    },
    sessionsDrift: async () => {
      throw new Error("Unexpected transport.sessionsDrift call");
    },
    sessionsSubscribe: async () => {
      throw new Error("Unexpected transport.sessionsSubscribe call");
    },
    close: async () => {},
    ...overrides,
  };
}

describe("runLaunch integration with a stub claude binary", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
    vi.restoreAllMocks();
  });

  it("falls back to the standalone token when no daemon transport is available", async () => {
    tempDir = makeTempDir();
    const home = join(tempDir, "home", ".myclaude");
    const cwd = join(tempDir, "repo");
    const sessionsRoot = join(tempDir, "sessions");
    const binDir = join(tempDir, "bin");
    const extraDir = join(tempDir, "extra");
    const stubOut = join(tempDir, "stub-output.txt");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(extraDir, { recursive: true });
    writeFixtureHome(home);
    writeStubClaude(binDir);

    const backend = new MockBackend("keychain-macos")
      .seed("agent-profile.github.work", "ghp-work-value")
      .seed("agent-profile.remote.token", "remote-secret-value");

    const exitCode = await runLaunch({
      role: "backend",
      auth: "work",
      home,
      cwd,
      sessionsRoot,
      backend,
      tokenGenerator: () => "fixed-token",
      addDirs: [extraDir],
      bare: true,
      passthroughArgs: ["--prompt", "Review PR"],
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        MYCLAUDE_STUB_OUT: stubOut,
        ANTHROPIC_API_KEY: "must-not-spawn",
        ANTHROPIC_AUTH_TOKEN: "must-not-spawn",
      },
    });

    expect(exitCode).toBe(7);
    const output = readFileSync(stubOut, "utf8");
    expect(output).toContain("ARGS=--strict-mcp-config --mcp-config ");
    expect(output).toContain(" --settings ");
    expect(output).toContain(" --setting-sources user,project,local ");
    expect(output).toContain(` --add-dir ${cwd} --add-dir ${extraDir} `);
    expect(output).toContain(" --bare --prompt Review PR");
    expect(output).toContain(`MYCLAUDE_SESSIONS_ROOT=${sessionsRoot}`);
    expect(output).toContain("MYCLAUDE_CAPABILITY_TOKEN=fixed-token");
    expect(output).toContain("PROFILE_ENV=ghp-work-value");
    expect(output).toContain("ANTHROPIC_API_KEY=unset");
    expect(output).toContain("ANTHROPIC_AUTH_TOKEN=unset");
    expect(output).toContain("SESSION_JSON=present");
    expect(output).toContain("TOKEN_IN_MANIFEST=yes");
    expect(output).toContain("API_HELPER=yes");
    expect(output).toContain("HEADERS_HELPER=yes");
    expect(output).toContain("REMOTE_TEMPLATE=yes");
    expect(output).toContain("REMOTE_SECRET=no");

    const sessionDir = output
      .split("\n")
      .find((line) => line.startsWith("SESSION_DIR="))
      ?.slice("SESSION_DIR=".length);
    expect(sessionDir).toBeDefined();
    expect(existsSync(sessionDir as string)).toBe(false);

    const sessionId = basename(sessionDir as string);
    const record = JSON.parse(
      readFileSync(join(tempDir, "session-registry", `${sessionId}.json`), "utf8")
    ) as { status: string; cleaned: boolean; spawn: { args: string[] } };
    expect(record.status).toBe("exited");
    expect(record.cleaned).toBe(true);
    expect(record.spawn.args).toContain("--bare");
    expect(JSON.stringify(record)).not.toContain("fixed-token");
    expect(JSON.stringify(record)).not.toContain("remote-secret-value");
  });

  it("uses the daemon-issued token for spawn env and session manifest, then ends the session once", async () => {
    tempDir = makeTempDir();
    const home = join(tempDir, "home", ".myclaude");
    const cwd = join(tempDir, "repo");
    const sessionsRoot = join(tempDir, "sessions");
    mkdirSync(cwd, { recursive: true });
    writeFixtureHome(home);

    const backend = new MockBackend("keychain-macos")
      .seed("agent-profile.github.work", "ghp-work-value")
      .seed("agent-profile.remote.token", "remote-secret-value");

    const sessionStart = vi.fn(
      async (input: { sessionId: string; pid: number; authProfileId?: string }) => ({
        capabilityToken: "daemon-signed-token",
        expiresAtMs: 123,
      })
    );
    const sessionEnd = vi.fn(async (_input: { sessionId: string }) => {});
    const transport = createTransportStub({
      transportKind: "daemon",
      sessionStart,
      sessionEnd,
    });

    let spawnedToken: string | undefined;
    let manifestToken: string | undefined;

    const exitCode = await runLaunch({
      role: "backend",
      auth: "work",
      home,
      cwd,
      sessionsRoot,
      backend,
      tokenGenerator: () => "fixed-token",
      transport,
      callerPid: 4242,
      spawnFn: (_command, _args, options) => {
        spawnedToken = options.env.MYCLAUDE_CAPABILITY_TOKEN;
        const sessionDir = dirname(String(options.env.CLAUDE_CONFIG_DIR));
        manifestToken = JSON.parse(readFileSync(join(sessionDir, "session.json"), "utf8"))
          .capabilityToken as string;
        return createFakeChild({ kind: "close", code: 0, signal: null });
      },
    });

    expect(exitCode).toBe(0);
    expect(spawnedToken).toBe("daemon-signed-token");
    expect(manifestToken).toBe("daemon-signed-token");
    expect(sessionStart).toHaveBeenCalledTimes(1);
    expect(sessionStart).toHaveBeenCalledWith({
      sessionId: expect.any(String),
      pid: 4242,
      authProfileId: "work",
    });
    expect(sessionEnd).toHaveBeenCalledTimes(1);
    expect(sessionEnd).toHaveBeenCalledWith({
      sessionId: sessionStart.mock.calls[0]?.[0].sessionId,
    });
  });

  it("ends a daemon-started session when spawn fails before claude launches", async () => {
    tempDir = makeTempDir();
    const home = join(tempDir, "home", ".myclaude");
    const cwd = join(tempDir, "repo");
    const sessionsRoot = join(tempDir, "sessions");
    mkdirSync(cwd, { recursive: true });
    writeFixtureHome(home);

    const backend = new MockBackend("keychain-macos")
      .seed("agent-profile.github.work", "ghp-work-value")
      .seed("agent-profile.remote.token", "remote-secret-value");

    const sessionStart = vi.fn(
      async (input: { sessionId: string; pid: number; authProfileId?: string }) => ({
        capabilityToken: "daemon-signed-token",
        expiresAtMs: 123,
      })
    );
    const sessionEnd = vi.fn(async (_input: { sessionId: string }) => {});
    const transport = createTransportStub({
      transportKind: "daemon",
      sessionStart,
      sessionEnd,
    });

    await expect(
      runLaunch({
        role: "backend",
        auth: "work",
        home,
        cwd,
        sessionsRoot,
        backend,
        transport,
        spawnFn: () => {
          throw new Error("spawn boom");
        },
      })
    ).rejects.toMatchObject({
      message: "Failed to launch claude: spawn boom",
    });

    expect(sessionStart).toHaveBeenCalledTimes(1);
    expect(sessionEnd).toHaveBeenCalledTimes(1);
    expect(sessionEnd).toHaveBeenCalledWith({
      sessionId: sessionStart.mock.calls[0]?.[0].sessionId,
    });
  });

  it("dry-run emits secret-safe JSON and does not spawn claude", async () => {
    tempDir = makeTempDir();
    const home = join(tempDir, "home", ".myclaude");
    const cwd = join(tempDir, "repo");
    const sessionsRoot = join(tempDir, "sessions");
    mkdirSync(cwd, { recursive: true });
    writeFixtureHome(home);

    let stdout = "";
    let stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += chunk.toString();
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += chunk.toString();
      return true;
    });

    const backend = new MockBackend("keychain-macos")
      .seed("agent-profile.github.work", "ghp-work-value")
      .seed("agent-profile.remote.token", "remote-secret-value");

    const exitCode = await runLaunch({
      role: "backend",
      auth: "work",
      home,
      cwd,
      sessionsRoot,
      backend,
      tokenGenerator: () => "fixed-token",
      dryRun: true,
      json: true,
      passthroughArgs: ["--api-key", "secret-arg"],
      spawnFn: () => {
        throw new Error("should not spawn");
      },
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "must-not-output",
      },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      launch: {
        sessionId: string;
        status: string;
        retained: boolean;
        runtimePaths: { sessionDir: string };
        spawn: { args: string[] };
      };
    };
    expect(parsed.launch.status).toBe("dry-run");
    expect(parsed.launch.retained).toBe(true);
    expect(parsed.launch.spawn.args).toContain("--api-key");
    expect(parsed.launch.spawn.args).toContain("<redacted>");
    expect(existsSync(parsed.launch.runtimePaths.sessionDir)).toBe(true);
    expect(stderr).toContain("Dry-run session kept at ");
    expect(stdout).not.toContain("fixed-token");
    expect(stdout).not.toContain("secret-arg");
    expect(stdout).not.toContain("ghp-work-value");
    expect(stdout).not.toContain("remote-secret-value");
    expect(stdout).not.toContain("must-not-output");
  });
});
