import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IUpdateElectronAppOptions } from "update-electron-app";
import {
  type RolloutManifestFailureReason,
  evaluateUpdatePolicy,
  parseRolloutManifest,
  shouldApplyRollout,
} from "./policy.js";

export const UPDATE_REPO = "AlpTalhaYazar/agent-profile";
export const ROLLOUT_MANIFEST_URL =
  "https://github.com/AlpTalhaYazar/agent-profile/releases/latest/download/agent-profile-rollout.json";

export interface UpdateAppState {
  getPath(name: "userData"): string;
  getVersion(): string;
  isPackaged: boolean;
}

export interface AutoUpdateLogger {
  info(message: string): void;
  warn(message: string): void;
}

export type UpdateElectronAppFn = (
  opts: IUpdateElectronAppOptions<AutoUpdateElectronLogger> & { repo: string }
) => void;

export interface AutoUpdateElectronLogger extends AutoUpdateLogger {
  log(message: string, ...args: unknown[]): void;
  error(message: string): void;
}

export type AutoUpdateStartResult =
  | { status: "disabled"; reason: string }
  | {
      status: "skipped";
      reason: RolloutManifestFailureReason | "fetch-failed" | "outside-rollout" | "updater-failed";
    }
  | { status: "started"; version: string; stagingPercentage: number };

export interface AutoUpdateOptions {
  appState: UpdateAppState;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  fetchJson?: (url: string) => Promise<unknown>;
  getInstallId?: () => Promise<string>;
  logger?: AutoUpdateLogger;
  platform?: NodeJS.Platform;
  updateElectronApp?: UpdateElectronAppFn;
}

const defaultLogger: AutoUpdateLogger = {
  info: (message) => {
    process.stderr.write(`[agent-profile/desktop] ${message}\n`);
  },
  warn: (message) => {
    process.stderr.write(`[agent-profile/desktop] ${message}\n`);
  },
};

export async function startAutoUpdateChecks(
  opts: AutoUpdateOptions
): Promise<AutoUpdateStartResult> {
  const logger = opts.logger ?? defaultLogger;
  const policy = evaluateUpdatePolicy({
    argv: opts.argv ?? process.argv,
    env: opts.env ?? process.env,
    isPackaged: opts.appState.isPackaged,
    platform: opts.platform ?? process.platform,
  });

  if (!policy.enabled) {
    logger.info(`auto-update disabled: ${policy.reason}`);
    return { status: "disabled", reason: policy.reason };
  }

  let manifestInput: unknown;
  try {
    manifestInput = await (opts.fetchJson ?? fetchJson)(ROLLOUT_MANIFEST_URL);
  } catch {
    logger.warn("auto-update skipped: rollout manifest fetch failed");
    return { status: "skipped", reason: "fetch-failed" };
  }

  const parsed = parseRolloutManifest(manifestInput, opts.appState.getVersion());
  if (!parsed.ok) {
    logger.warn(`auto-update skipped: ${parsed.reason}`);
    return { status: "skipped", reason: parsed.reason };
  }

  const installId = await (opts.getInstallId ?? (() => getOrCreateInstallId(opts.appState)))();
  if (!shouldApplyRollout(parsed.manifest, installId)) {
    logger.info("auto-update skipped: install is outside staged rollout");
    return { status: "skipped", reason: "outside-rollout" };
  }

  try {
    const updater = opts.updateElectronApp ?? (await loadUpdateElectronApp());
    updater({
      logger: toElectronLogger(logger),
      notifyUser: true,
      repo: UPDATE_REPO,
    });
  } catch {
    logger.warn("auto-update skipped: updater initialization failed");
    return { status: "skipped", reason: "updater-failed" };
  }

  logger.info("auto-update checks started");
  return {
    status: "started",
    version: parsed.manifest.version,
    stagingPercentage: parsed.manifest.stagingPercentage,
  };
}

export async function getOrCreateInstallId(appState: UpdateAppState): Promise<string> {
  const filePath = join(appState.getPath("userData"), "auto-update-install-id");

  try {
    const existing = (await readFile(filePath, "utf8")).trim();
    if (existing.length >= 16) return existing;
  } catch {
    // Missing or unreadable files fall through to a fresh local identifier.
  }

  const next = randomUUID();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${next}\n`, { mode: 0o600 });
  return next;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function loadUpdateElectronApp(): Promise<UpdateElectronAppFn> {
  const mod = await import("update-electron-app");
  return mod.updateElectronApp as UpdateElectronAppFn;
}

function toElectronLogger(logger: AutoUpdateLogger): AutoUpdateElectronLogger {
  return {
    log: (message: string) => logger.info(message),
    info: (message: string) => logger.info(message),
    warn: (message: string) => logger.warn(message),
    error: (message: string) => logger.warn(message),
  };
}
