import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "..", "scripts", "verify-package-manager-inputs.mjs");
const tempRoots: string[] = [];
const releaseBaseUrl = "https://github.com/AlpTalhaYazar/agent-profile/releases/download/v0.0.1";

function makeDesktopRoot(version = "0.0.1") {
  const root = mkdtempSync(join(tmpdir(), "agent-profile-package-manager-"));
  tempRoots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }, null, 2));
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string) {
  const fullPath = join(root, "out", "make", relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

function writeRequiredArtifacts(root: string) {
  return {
    macX64: writeArtifact(root, "AgentProfile-0.0.1-x64.dmg", "mac-x64"),
    macArm64: writeArtifact(root, "AgentProfile-0.0.1-arm64.dmg", "mac-arm64"),
    windows: writeArtifact(
      root,
      "squirrel.windows/x64/AgentProfile-0.0.1-x64-Setup.exe",
      "windows-x64"
    ),
    deb: writeArtifact(root, "deb/x64/agent-profile-desktop_0.0.1_amd64.deb", "linux-deb"),
    rpm: writeArtifact(root, "rpm/x64/agent-profile-desktop-0.0.1.x86_64.rpm", "linux-rpm"),
  };
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

describe("scripts/verify-package-manager-inputs.mjs", () => {
  it("rejects tags without a v-prefixed SemVer version", () => {
    const result = runVerifier(["--tag", "0.0.1", "--release-base-url", releaseBaseUrl]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/tag.*v-prefixed SemVer/i);
  });

  it("rejects tags that do not match the desktop package version", () => {
    const root = makeDesktopRoot("0.0.2");
    writeRequiredArtifacts(root);
    const result = runVerifier(["--tag", "v0.0.1", "--release-base-url", releaseBaseUrl], root);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/does not match.*package\.json version/i);
  });

  it("rejects non-HTTPS release base URLs", () => {
    const root = makeDesktopRoot();
    writeRequiredArtifacts(root);
    const result = runVerifier(
      [
        "--tag",
        "v0.0.1",
        "--release-base-url",
        "http://github.com/AlpTalhaYazar/agent-profile/releases/download/v0.0.1",
      ],
      root
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/release-base-url.*HTTPS/i);
  });

  it("rejects release base URLs that do not end with the release tag", () => {
    const root = makeDesktopRoot();
    writeRequiredArtifacts(root);
    const result = runVerifier(
      [
        "--tag",
        "v0.0.1",
        "--release-base-url",
        "https://github.com/AlpTalhaYazar/agent-profile/releases/download/v0.0.2",
      ],
      root
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/must end with.*v0\.0\.1/i);
  });

  it("fails when a required package-manager artifact is missing", () => {
    const root = makeDesktopRoot();
    writeArtifact(root, "AgentProfile-0.0.1-x64.dmg", "mac-x64");
    writeArtifact(root, "AgentProfile-0.0.1-arm64.dmg", "mac-arm64");
    writeArtifact(root, "squirrel.windows/x64/AgentProfile-0.0.1-x64-Setup.exe", "windows-x64");
    writeArtifact(root, "deb/x64/agent-profile-desktop_0.0.1_amd64.deb", "linux-deb");

    const result = runVerifier(["--tag", "v0.0.1", "--release-base-url", releaseBaseUrl], root);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing linux rpm artifact/i);
  });

  it("fails when more than one artifact matches the same package-manager input", () => {
    const root = makeDesktopRoot();
    writeRequiredArtifacts(root);
    writeArtifact(root, "dmg/darwin/x64/AgentProfile-duplicate-x64.dmg", "duplicate");

    const result = runVerifier(["--tag", "v0.0.1", "--release-base-url", releaseBaseUrl], root);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/multiple Homebrew Cask darwin x64/i);
  });

  it("emits deterministic package-manager inputs with SHA-256 checksums", () => {
    const root = makeDesktopRoot();
    const artifacts = writeRequiredArtifacts(root);

    const result = runVerifier(
      ["--", "--tag", "v0.0.1", "--release-base-url", releaseBaseUrl],
      root
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      schemaVersion: 1,
      tag: "v0.0.1",
      version: "0.0.1",
      releaseBaseUrl,
      homebrewCask: {
        token: "agent-profile",
        app: "AgentProfile.app",
        artifacts: [
          {
            platform: "darwin",
            arch: "x64",
            fileName: basename(artifacts.macX64),
            url: `${releaseBaseUrl}/${basename(artifacts.macX64)}`,
            sha256: sha256(artifacts.macX64),
          },
          {
            platform: "darwin",
            arch: "arm64",
            fileName: basename(artifacts.macArm64),
            url: `${releaseBaseUrl}/${basename(artifacts.macArm64)}`,
            sha256: sha256(artifacts.macArm64),
          },
        ],
      },
      winget: {
        packageIdentifier: "AgentProfile.AgentProfile",
        installerType: "exe",
        artifacts: [
          {
            platform: "win32",
            arch: "x64",
            fileName: basename(artifacts.windows),
            url: `${releaseBaseUrl}/${basename(artifacts.windows)}`,
            sha256: sha256(artifacts.windows),
          },
        ],
      },
      linux: {
        packageName: "agent-profile-desktop",
        artifacts: [
          {
            platform: "linux",
            arch: "x64",
            format: "deb",
            fileName: basename(artifacts.deb),
            url: `${releaseBaseUrl}/${basename(artifacts.deb)}`,
            sha256: sha256(artifacts.deb),
          },
          {
            platform: "linux",
            arch: "x64",
            format: "rpm",
            fileName: basename(artifacts.rpm),
            url: `${releaseBaseUrl}/${basename(artifacts.rpm)}`,
            sha256: sha256(artifacts.rpm),
          },
        ],
      },
    });
  });

  it("does not require Linux GPG, AppImage, or repository metadata files", () => {
    const root = makeDesktopRoot();
    writeRequiredArtifacts(root);

    const result = runVerifier(["--tag", "v0.0.1", "--release-base-url", releaseBaseUrl], root);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/gpg|appimage|repomd|packages\.gz/i);
  });
});
