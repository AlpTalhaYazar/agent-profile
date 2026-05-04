#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = process.env.AGENT_PROFILE_DESKTOP_ROOT
  ? resolve(process.env.AGENT_PROFILE_DESKTOP_ROOT)
  : resolve(__dirname, "..");
const makeDir = join(desktopRoot, "out", "make");
const semverTagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function usageError(message) {
  console.error(`verify-package-manager-inputs: ${message}`);
  console.error(
    "Usage: node ./scripts/verify-package-manager-inputs.mjs --tag v1.2.3 --release-base-url https://github.com/OWNER/REPO/releases/download/v1.2.3"
  );
  process.exit(2);
}

function fail(message) {
  console.error(`verify-package-manager-inputs: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    tag: undefined,
    releaseBaseUrl: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      // pnpm forwards arguments after `--`; tolerate an extra marker.
    } else if (arg === "--tag") {
      args.tag = argv[++i];
    } else if (arg === "--release-base-url") {
      args.releaseBaseUrl = argv[++i];
    } else {
      usageError(`unknown argument: ${arg}`);
    }
  }

  if (!args.tag) {
    usageError("--tag is required");
  }
  if (!args.releaseBaseUrl) {
    usageError("--release-base-url is required");
  }

  return args;
}

function readDesktopVersion() {
  const packagePath = join(desktopRoot, "package.json");
  if (!existsSync(packagePath)) {
    fail(`missing desktop package.json at ${packagePath}`);
  }

  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    fail(`missing package.json version in ${packagePath}`);
  }

  return packageJson.version;
}

function validateTag(tag, packageVersion) {
  if (!semverTagPattern.test(tag)) {
    usageError("--tag must be a v-prefixed SemVer value such as v1.2.3");
  }

  const version = tag.slice(1);
  if (version !== packageVersion) {
    fail(`release tag ${tag} does not match desktop package.json version ${packageVersion}`);
  }

  return version;
}

function validateReleaseBaseUrl(input, tag) {
  let url;
  try {
    url = new URL(input);
  } catch {
    usageError("--release-base-url must be a valid HTTPS URL");
  }

  if (url.protocol !== "https:") {
    usageError("--release-base-url must use HTTPS");
  }

  const normalized = input.replace(/\/+$/, "");
  if (!normalized.endsWith(`/${tag}`)) {
    usageError(`--release-base-url must end with /${tag}`);
  }

  return normalized;
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function matchesArch(file, arch) {
  const normalised = file.split(sep).join("/");
  const name = basename(file).toLowerCase();
  return (
    normalised.includes(`/${arch}/`) || name.includes(`-${arch}-`) || name.includes(`-${arch}.`)
  );
}

function findOneArtifact(files, description, predicate) {
  const matches = files.filter(predicate);

  if (matches.length === 0) {
    fail(`missing ${description} artifact under ${makeDir}`);
  }
  if (matches.length > 1) {
    fail(
      `multiple ${description} artifacts under ${makeDir}: ${matches
        .map((file) => relative(makeDir, file))
        .join(", ")}`
    );
  }

  return matches[0];
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function artifactRecord(file, releaseBaseUrl, extra = {}) {
  const fileName = basename(file);
  return {
    ...extra,
    fileName,
    url: `${releaseBaseUrl}/${fileName}`,
    sha256: sha256(file),
    sizeBytes: statSync(file).size,
  };
}

function buildInputs({ tag, version, releaseBaseUrl }) {
  const files = walkFiles(makeDir);
  const macX64 = findOneArtifact(
    files,
    "Homebrew Cask darwin x64",
    (file) => extname(file).toLowerCase() === ".dmg" && matchesArch(file, "x64")
  );
  const macArm64 = findOneArtifact(
    files,
    "Homebrew Cask darwin arm64",
    (file) => extname(file).toLowerCase() === ".dmg" && matchesArch(file, "arm64")
  );
  const windowsX64 = findOneArtifact(
    files,
    "winget win32 x64",
    (file) => /Setup\.exe$/i.test(file) && matchesArch(file, "x64")
  );
  const linuxDeb = findOneArtifact(
    files,
    "linux deb",
    (file) => extname(file).toLowerCase() === ".deb" && matchesArch(file, "x64")
  );
  const linuxRpm = findOneArtifact(
    files,
    "linux rpm",
    (file) => extname(file).toLowerCase() === ".rpm" && matchesArch(file, "x64")
  );

  return {
    schemaVersion: 1,
    tag,
    version,
    releaseBaseUrl,
    homebrewCask: {
      token: "agent-profile",
      name: "Agent Profile",
      app: "AgentProfile.app",
      artifacts: [
        artifactRecord(macX64, releaseBaseUrl, { platform: "darwin", arch: "x64" }),
        artifactRecord(macArm64, releaseBaseUrl, { platform: "darwin", arch: "arm64" }),
      ],
    },
    winget: {
      packageIdentifier: "AgentProfile.AgentProfile",
      packageName: "Agent Profile",
      installerType: "exe",
      artifacts: [artifactRecord(windowsX64, releaseBaseUrl, { platform: "win32", arch: "x64" })],
    },
    linux: {
      packageName: "agent-profile-desktop",
      artifacts: [
        artifactRecord(linuxDeb, releaseBaseUrl, {
          platform: "linux",
          arch: "x64",
          format: "deb",
        }),
        artifactRecord(linuxRpm, releaseBaseUrl, {
          platform: "linux",
          arch: "x64",
          format: "rpm",
        }),
      ],
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageVersion = readDesktopVersion();
  const version = validateTag(args.tag, packageVersion);
  const releaseBaseUrl = validateReleaseBaseUrl(args.releaseBaseUrl, args.tag);
  const output = buildInputs({ tag: args.tag, version, releaseBaseUrl });

  console.log(`${JSON.stringify(output, null, 2)}\n`);
}

main();
