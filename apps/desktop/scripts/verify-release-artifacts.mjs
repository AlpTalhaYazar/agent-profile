#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = process.env.AGENT_PROFILE_DESKTOP_ROOT
  ? resolve(process.env.AGENT_PROFILE_DESKTOP_ROOT)
  : resolve(__dirname, "..");
const outDir = join(desktopRoot, "out");
const makeDir = join(outDir, "make");

function usageError(message) {
  console.error(`verify-release: ${message}`);
  console.error(
    "Usage: node ./scripts/verify-release-artifacts.mjs --platform darwin|win32|linux --arch x64|arm64 [--require-signature] [--require-notarization] [--unsigned-ok]"
  );
  process.exit(2);
}

function fail(message) {
  console.error(`verify-release: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    platform: undefined,
    arch: undefined,
    requireSignature: false,
    requireNotarization: false,
    unsignedOk: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      // pnpm forwards arguments after `--`; tolerate an extra marker.
    } else if (arg === "--platform") {
      args.platform = argv[++i];
    } else if (arg === "--arch") {
      args.arch = argv[++i];
    } else if (arg === "--require-signature") {
      args.requireSignature = true;
    } else if (arg === "--require-notarization") {
      args.requireNotarization = true;
    } else if (arg === "--unsigned-ok") {
      args.unsignedOk = true;
    } else {
      usageError(`unknown argument: ${arg}`);
    }
  }

  if (!["darwin", "win32", "linux"].includes(args.platform ?? "")) {
    usageError("--platform is required and must be one of darwin|win32|linux");
  }
  if (!["x64", "arm64"].includes(args.arch ?? "")) {
    usageError("--arch is required and must be one of x64|arm64");
  }
  if (args.unsignedOk && (args.requireSignature || args.requireNotarization)) {
    usageError("--unsigned-ok cannot be combined with required signing or notarization flags");
  }
  if (args.platform !== "darwin" && args.requireNotarization) {
    usageError("--require-notarization is only supported for --platform darwin");
  }
  if (args.platform === "linux" && args.requireSignature) {
    usageError("Linux signing is not supported yet; use --unsigned-ok for Linux release artifacts");
  }

  return args;
}

function packagedPaths({ platform, arch }) {
  const packagedDir = join(outDir, `AgentProfile-${platform}-${arch}`);
  if (platform === "darwin") {
    const app = join(packagedDir, "AgentProfile.app");
    return {
      packagedDir,
      app,
      binary: join(app, "Contents", "MacOS", "AgentProfile"),
    };
  }
  if (platform === "win32") {
    return { packagedDir, binary: join(packagedDir, "AgentProfile.exe") };
  }
  return { packagedDir, binary: join(packagedDir, "AgentProfile") };
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
  return files;
}

function run(command, args, description) {
  console.log(`verify-release: ${description}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    fail(`${description} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${description} failed with exit code ${result.status}`);
  }
}

function runFuses(binary) {
  const verifyFuses = join(desktopRoot, "scripts", "verify-fuses.mjs");
  run(
    process.execPath,
    [verifyFuses, binary, "--strict"],
    `verifying Electron fuses for ${binary}`
  );
}

function makeFilesForArch(arch) {
  return walkFiles(makeDir).filter((file) => matchesArch(file, arch));
}

function matchesArch(file, arch) {
  const normalised = file.split(sep).join("/");
  const name = basename(file).toLowerCase();
  return (
    normalised.includes(`/${arch}/`) || name.includes(`-${arch}-`) || name.includes(`-${arch}.`)
  );
}

function verifyMac({ app, requireSignature, requireNotarization }) {
  if (!existsSync(app)) {
    fail(`missing macOS app at ${app}. Run \`pnpm -C apps/desktop package\` first.`);
  }
  if (!requireSignature && !requireNotarization) return;

  run(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
    "verifying macOS code signature"
  );
  if (requireSignature) {
    run("spctl", ["-a", "-vvv", app], "assessing macOS Gatekeeper signature");
  }
  if (requireNotarization) {
    run("xcrun", ["stapler", "validate", app], "validating macOS notarization staple");
  }
}

function verifyMacArtifacts(arch) {
  const files = makeFilesForArch(arch);
  if (!files.some((file) => file.toLowerCase().endsWith(".dmg"))) {
    fail(`missing macOS DMG artifact for ${arch} under ${makeDir}`);
  }
  if (
    !files.some(
      (file) =>
        file.toLowerCase().endsWith(".zip") &&
        file.split(sep).join("/").includes(`/darwin/${arch}/`)
    )
  ) {
    fail(`missing macOS ZIP artifact for ${arch} under ${makeDir}`);
  }
}

function verifyLinuxArtifacts(arch) {
  const files = makeFilesForArch(arch);
  for (const extension of [".deb", ".rpm"]) {
    if (!files.some((file) => file.toLowerCase().endsWith(extension))) {
      fail(`missing linux make artifact ${extension} for ${arch} under ${makeDir}`);
    }
  }
  if (
    !files.some(
      (file) =>
        file.toLowerCase().endsWith(".zip") && file.split(sep).join("/").includes(`/linux/${arch}/`)
    )
  ) {
    fail(`missing linux make artifact .zip for ${arch} under ${makeDir}`);
  }
}

function verifyWindowsArtifacts(arch) {
  const installers = makeFilesForArch(arch).filter((file) => /Setup\.exe$/i.test(file));

  if (installers.length === 0) {
    fail(`missing Windows installer matching *Setup.exe for ${arch} under ${makeDir}`);
  }

  return installers;
}

function verifyWindowsSignatures(packagedDir, installers) {
  const files = walkFiles(packagedDir).filter((file) =>
    [".exe", ".dll", ".node"].includes(extname(file).toLowerCase())
  );

  for (const file of [...files, ...installers]) {
    verifyWindowsSignature(file);
  }
}

function verifyWindowsSignature(file) {
  const escaped = file.replace(/'/g, "''");
  const command = [
    `$s=(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status;`,
    `if ($s -ne 'Valid') { Write-Error "invalid or missing Windows signature for ${escaped}: $s"; exit 1 }`,
  ].join(" ");

  run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    `verifying Windows Authenticode signature for ${file}`
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = packagedPaths(args);

  if (args.platform === "darwin" && !existsSync(paths.app)) {
    fail(`missing macOS app at ${paths.app}. Run \`pnpm -C apps/desktop package\` first.`);
  }
  if (!existsSync(paths.binary)) {
    fail(`missing packaged binary at ${paths.binary}. Run \`pnpm -C apps/desktop package\` first.`);
  }

  runFuses(paths.binary);

  if (args.platform === "darwin") {
    verifyMacArtifacts(args.arch);
    verifyMac({ ...paths, ...args });
  } else if (args.platform === "linux") {
    verifyLinuxArtifacts(args.arch);
  } else if (args.platform === "win32") {
    const installers = verifyWindowsArtifacts(args.arch);
    if (args.requireSignature) {
      verifyWindowsSignatures(paths.packagedDir, installers);
    }
  }

  console.log("verify-release: release artifacts passed verification");
}

main();
