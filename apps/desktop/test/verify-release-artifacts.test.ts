import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "..", "scripts", "verify-release-artifacts.mjs");
const tempRoots: string[] = [];

function makeDesktopRoot() {
  const root = mkdtempSync(join(tmpdir(), "agent-profile-release-"));
  tempRoots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts", "verify-fuses.mjs"),
    [
      "#!/usr/bin/env node",
      "import { appendFileSync } from 'node:fs';",
      "if (process.env.AGENT_PROFILE_FUSE_LOG) appendFileSync(process.env.AGENT_PROFILE_FUSE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
      "process.exit(0);",
      "",
    ].join("\n")
  );
  chmodSync(join(root, "scripts", "verify-fuses.mjs"), 0o755);
  return root;
}

function runVerifier(
  args: string[],
  desktopRoot = makeDesktopRoot(),
  extraEnv: NodeJS.ProcessEnv = {}
) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
      AGENT_PROFILE_DESKTOP_ROOT: desktopRoot,
    },
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("scripts/verify-release-artifacts.mjs", () => {
  it("rejects missing required platform argument", () => {
    const result = runVerifier(["--arch", "x64", "--unsigned-ok"]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/--platform.*darwin\|win32\|linux/i);
  });

  it("fails with an actionable message when the packaged binary is missing", () => {
    const result = runVerifier(["--platform", "linux", "--arch", "x64", "--unsigned-ok"]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing packaged binary/i);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/pnpm -C apps\/desktop package/i);
  });

  it("requires linux deb, rpm, and zip artifacts and invokes strict fuse verification", () => {
    const desktopRoot = makeDesktopRoot();
    const binary = join(desktopRoot, "out", "AgentProfile-linux-x64", "AgentProfile");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "fake binary");

    mkdirSync(join(desktopRoot, "out", "make", "deb", "x64"), {
      recursive: true,
    });
    mkdirSync(join(desktopRoot, "out", "make", "rpm", "x64"), {
      recursive: true,
    });
    mkdirSync(join(desktopRoot, "out", "make", "zip", "linux", "x64"), {
      recursive: true,
    });
    writeFileSync(join(desktopRoot, "out", "make", "deb", "x64", "agent-profile.deb"), "");
    writeFileSync(join(desktopRoot, "out", "make", "rpm", "x64", "agent-profile.rpm"), "");
    writeFileSync(join(desktopRoot, "out", "make", "zip", "linux", "x64", "agent-profile.zip"), "");

    const fuseLog = join(desktopRoot, "fuses.log");
    const result = runVerifier(
      ["--", "--platform", "linux", "--arch", "x64", "--unsigned-ok"],
      desktopRoot,
      { AGENT_PROFILE_FUSE_LOG: fuseLog }
    );

    expect(result.status).toBe(0);
    expect(readFileSync(fuseLog, "utf8")).toContain(JSON.stringify([binary, "--strict"]));
  });

  it("fails linux verification when a required make artifact is missing", () => {
    const desktopRoot = makeDesktopRoot();
    const binary = join(desktopRoot, "out", "AgentProfile-linux-arm64", "AgentProfile");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "fake binary");
    mkdirSync(join(desktopRoot, "out", "make", "deb", "arm64"), {
      recursive: true,
    });
    mkdirSync(join(desktopRoot, "out", "make", "zip", "linux", "arm64"), {
      recursive: true,
    });
    writeFileSync(join(desktopRoot, "out", "make", "deb", "arm64", "agent-profile.deb"), "");
    writeFileSync(
      join(desktopRoot, "out", "make", "zip", "linux", "arm64", "agent-profile.zip"),
      ""
    );

    const result = runVerifier(
      ["--platform", "linux", "--arch", "arm64", "--unsigned-ok"],
      desktopRoot
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing linux make artifact.*\.rpm/i);
  });

  it("does not accept a stale darwin ZIP as the linux ZIP artifact", () => {
    const desktopRoot = makeDesktopRoot();
    const binary = join(desktopRoot, "out", "AgentProfile-linux-x64", "AgentProfile");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "fake binary");
    mkdirSync(join(desktopRoot, "out", "make", "deb", "x64"), {
      recursive: true,
    });
    mkdirSync(join(desktopRoot, "out", "make", "rpm", "x64"), {
      recursive: true,
    });
    mkdirSync(join(desktopRoot, "out", "make", "zip", "darwin", "x64"), {
      recursive: true,
    });
    writeFileSync(join(desktopRoot, "out", "make", "deb", "x64", "agent-profile.deb"), "");
    writeFileSync(join(desktopRoot, "out", "make", "rpm", "x64", "agent-profile.rpm"), "");
    writeFileSync(
      join(desktopRoot, "out", "make", "zip", "darwin", "x64", "AgentProfile-darwin-x64.zip"),
      ""
    );

    const result = runVerifier(
      ["--platform", "linux", "--arch", "x64", "--unsigned-ok"],
      desktopRoot
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing linux make artifact.*\.zip/i);
  });

  it("fails macOS notarization verification before tool execution when the app is missing", () => {
    const result = runVerifier([
      "--platform",
      "darwin",
      "--arch",
      "arm64",
      "--require-signature",
      "--require-notarization",
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing macOS app/i);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/AgentProfile-darwin-arm64/i);
  });

  it("requires macOS DMG and arch-specific ZIP artifacts before unsigned release verification passes", () => {
    const desktopRoot = makeDesktopRoot();
    const app = join(desktopRoot, "out", "AgentProfile-darwin-arm64", "AgentProfile.app");
    const binary = join(app, "Contents", "MacOS", "AgentProfile");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "fake binary");
    mkdirSync(join(desktopRoot, "out", "make", "zip", "darwin", "x64"), {
      recursive: true,
    });
    writeFileSync(join(desktopRoot, "out", "make", "AgentProfile-0.0.1-x64.dmg"), "");
    writeFileSync(
      join(desktopRoot, "out", "make", "zip", "darwin", "x64", "AgentProfile-darwin-x64.zip"),
      ""
    );

    const missingArm64Artifacts = runVerifier(
      ["--platform", "darwin", "--arch", "arm64", "--unsigned-ok"],
      desktopRoot
    );
    expect(missingArm64Artifacts.status).not.toBe(0);
    expect(`${missingArm64Artifacts.stdout}\n${missingArm64Artifacts.stderr}`).toMatch(
      /missing macOS DMG artifact for arm64/i
    );

    mkdirSync(join(desktopRoot, "out", "make", "zip", "darwin", "arm64"), {
      recursive: true,
    });
    writeFileSync(join(desktopRoot, "out", "make", "AgentProfile-0.0.1-arm64.dmg"), "");
    writeFileSync(
      join(desktopRoot, "out", "make", "zip", "darwin", "arm64", "AgentProfile-darwin-arm64.zip"),
      ""
    );

    const result = runVerifier(
      ["--platform", "darwin", "--arch", "arm64", "--unsigned-ok"],
      desktopRoot
    );
    expect(result.status).toBe(0);
  });

  it("requires a macOS updater ZIP when update artifacts are required", () => {
    const desktopRoot = makeDesktopRoot();
    const app = join(desktopRoot, "out", "AgentProfile-darwin-x64", "AgentProfile.app");
    const binary = join(app, "Contents", "MacOS", "AgentProfile");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "fake binary");
    mkdirSync(join(desktopRoot, "out", "make"), { recursive: true });
    writeFileSync(join(desktopRoot, "out", "make", "AgentProfile-0.0.1-x64.dmg"), "");

    const result = runVerifier(
      ["--platform", "darwin", "--arch", "x64", "--unsigned-ok", "--require-update-artifacts"],
      desktopRoot
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing macOS updater ZIP/i);
  });

  it("requires a Windows Setup.exe artifact even when unsigned artifacts are allowed", () => {
    const desktopRoot = makeDesktopRoot();
    const binary = join(desktopRoot, "out", "AgentProfile-win32-x64", "AgentProfile.exe");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "fake binary");
    mkdirSync(join(desktopRoot, "out", "make"), { recursive: true });

    const result = runVerifier(
      ["--platform", "win32", "--arch", "x64", "--unsigned-ok"],
      desktopRoot
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing Windows installer/i);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/\*Setup\.exe/i);
  });

  it("does not require Windows signatures when unsigned artifacts are explicitly allowed", () => {
    const desktopRoot = makeDesktopRoot();
    const binary = join(desktopRoot, "out", "AgentProfile-win32-arm64", "AgentProfile.exe");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "fake binary");
    mkdirSync(join(desktopRoot, "out", "make", "squirrel.windows", "arm64"), {
      recursive: true,
    });
    writeFileSync(
      join(desktopRoot, "out", "make", "squirrel.windows", "arm64", "AgentProfileSetup.exe"),
      ""
    );

    const result = runVerifier(
      ["--platform", "win32", "--arch", "arm64", "--unsigned-ok"],
      desktopRoot
    );

    expect(result.status).toBe(0);
    expect(existsSync(binary)).toBe(true);
  });

  it("requires Windows Squirrel RELEASES and nupkg when update artifacts are required", () => {
    const desktopRoot = makeDesktopRoot();
    const binary = join(desktopRoot, "out", "AgentProfile-win32-x64", "AgentProfile.exe");
    const makePath = join(desktopRoot, "out", "make", "squirrel.windows", "x64");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "fake binary");
    mkdirSync(makePath, { recursive: true });
    writeFileSync(join(makePath, "AgentProfileSetup.exe"), "");

    const missingUpdateMetadata = runVerifier(
      ["--platform", "win32", "--arch", "x64", "--unsigned-ok", "--require-update-artifacts"],
      desktopRoot
    );
    expect(missingUpdateMetadata.status).not.toBe(0);
    expect(`${missingUpdateMetadata.stdout}\n${missingUpdateMetadata.stderr}`).toMatch(
      /missing Windows Squirrel RELEASES/i
    );

    writeFileSync(join(makePath, "RELEASES"), "");
    writeFileSync(join(makePath, "AgentProfile-0.0.1-full.nupkg"), "");

    const result = runVerifier(
      ["--platform", "win32", "--arch", "x64", "--unsigned-ok", "--require-update-artifacts"],
      desktopRoot
    );
    expect(result.status).toBe(0);
  });

  it("rejects update artifact requirements on Linux until Linux auto-update is supported", () => {
    const result = runVerifier([
      "--platform",
      "linux",
      "--arch",
      "x64",
      "--unsigned-ok",
      "--require-update-artifacts",
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/Linux auto-update artifacts/i);
  });
});
