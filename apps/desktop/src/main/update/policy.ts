import { createHash } from "node:crypto";
import semver from "semver";
import { isHeadless, isTestEnvironment } from "../app/environment.js";

export type UpdatePolicyDisabledReason =
  | "disabled-by-env"
  | "test-environment"
  | "not-packaged"
  | "unsupported-platform"
  | "squirrel-first-run"
  | "headless-disabled";

export type UpdatePolicyResult =
  | { enabled: true }
  | { enabled: false; reason: UpdatePolicyDisabledReason };

export interface UpdatePolicyInput {
  argv: string[];
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}

export interface RolloutManifest {
  version: string;
  channel: "stable";
  stagingPercentage: number;
}

export type RolloutManifestFailureReason =
  | "invalid-manifest"
  | "invalid-channel"
  | "invalid-version"
  | "invalid-percentage"
  | "not-newer";

export type RolloutManifestParseResult =
  | { ok: true; manifest: RolloutManifest }
  | { ok: false; reason: RolloutManifestFailureReason };

export interface RolloutDecisionInput {
  version: string;
  stagingPercentage: number;
}

export function evaluateUpdatePolicy(input: UpdatePolicyInput): UpdatePolicyResult {
  const { argv, env, isPackaged, platform } = input;

  if (env.MYCLAUDE_UPDATES === "0") {
    return { enabled: false, reason: "disabled-by-env" };
  }
  if (isTestEnvironment(env)) {
    return { enabled: false, reason: "test-environment" };
  }
  if (!isPackaged) {
    return { enabled: false, reason: "not-packaged" };
  }
  if (platform !== "darwin" && platform !== "win32") {
    return { enabled: false, reason: "unsupported-platform" };
  }
  if (platform === "win32" && argv.includes("--squirrel-firstrun")) {
    return { enabled: false, reason: "squirrel-first-run" };
  }
  if (isHeadless(argv, env) && env.MYCLAUDE_UPDATES !== "1") {
    return { enabled: false, reason: "headless-disabled" };
  }

  return { enabled: true };
}

export function parseRolloutManifest(
  input: unknown,
  currentVersion: string
): RolloutManifestParseResult {
  if (!isRecord(input)) {
    return { ok: false, reason: "invalid-manifest" };
  }

  const { version, channel, stagingPercentage } = input;
  if (
    typeof version !== "string" ||
    typeof channel !== "string" ||
    typeof stagingPercentage !== "number"
  ) {
    return { ok: false, reason: "invalid-manifest" };
  }
  if (channel !== "stable") {
    return { ok: false, reason: "invalid-channel" };
  }
  if (!semver.valid(version)) {
    return { ok: false, reason: "invalid-version" };
  }
  if (!Number.isInteger(stagingPercentage) || stagingPercentage < 0 || stagingPercentage > 100) {
    return { ok: false, reason: "invalid-percentage" };
  }
  if (!semver.valid(currentVersion) || !semver.gt(version, currentVersion)) {
    return { ok: false, reason: "not-newer" };
  }

  return {
    ok: true,
    manifest: { version, channel, stagingPercentage },
  };
}

export function getRolloutBucket(version: string, installId: string): number {
  const digest = createHash("sha256").update(`${version}:${installId}`).digest();
  return (digest.readUInt32BE(0) % 100) + 1;
}

export function shouldApplyRollout(input: RolloutDecisionInput, installId: string): boolean {
  return getRolloutBucket(input.version, installId) <= input.stagingPercentage;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
