import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLaunch } from "../../src/commands/launch/index.js";
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

describe("runLaunch integration with a stub claude binary", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("emits a session, spawns stub claude with env/args, and cleans up", async () => {
    tempDir = makeTempDir();
    const home = join(tempDir, "home", ".myclaude");
    const cwd = join(tempDir, "repo");
    const sessionsRoot = join(tempDir, "sessions");
    const binDir = join(tempDir, "bin");
    const stubOut = join(tempDir, "stub-output.txt");
    mkdirSync(cwd, { recursive: true });
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
    expect(output).toContain("ARGS=--mcp-config ");
    expect(output).toContain(" --settings ");
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
  });
});
