import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAutoUpdateChecks } from "../src/main/update/service.js";

const tempRoots: string[] = [];

function makeUserData(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-profile-updates-"));
  tempRoots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

function makeDeps(overrides: Partial<Parameters<typeof startAutoUpdateChecks>[0]> = {}) {
  return {
    appState: {
      getPath: () => makeUserData(),
      getVersion: () => "0.0.1",
      isPackaged: true,
    },
    argv: [],
    env: {},
    fetchJson: vi.fn().mockResolvedValue({
      version: "0.0.2",
      channel: "stable",
      stagingPercentage: 100,
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
    },
    platform: "darwin" as NodeJS.Platform,
    updateElectronApp: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("startAutoUpdateChecks", () => {
  it("does not fetch rollout metadata when policy disables updates", async () => {
    const deps = makeDeps({
      appState: {
        getPath: () => makeUserData(),
        getVersion: () => "0.0.1",
        isPackaged: false,
      },
    });

    const result = await startAutoUpdateChecks(deps);

    expect(result).toEqual({ status: "disabled", reason: "not-packaged" });
    expect(deps.fetchJson).not.toHaveBeenCalled();
    expect(deps.updateElectronApp).not.toHaveBeenCalled();
  });

  it("keeps headless mode offline unless updates are explicitly enabled", async () => {
    const deps = makeDeps({ env: { MYCLAUDE_HEADLESS: "1" } });

    const result = await startAutoUpdateChecks(deps);

    expect(result).toEqual({ status: "disabled", reason: "headless-disabled" });
    expect(deps.fetchJson).not.toHaveBeenCalled();
    expect(deps.updateElectronApp).not.toHaveBeenCalled();
  });

  it("fails closed when rollout metadata cannot be fetched or validated", async () => {
    const deps = makeDeps({
      fetchJson: vi.fn().mockResolvedValue({
        version: "0.0.1",
        channel: "stable",
        stagingPercentage: 100,
      }),
    });

    const result = await startAutoUpdateChecks(deps);

    expect(result).toEqual({ status: "skipped", reason: "not-newer" });
    expect(deps.updateElectronApp).not.toHaveBeenCalled();
  });

  it("starts the updater when policy and staged rollout allow it", async () => {
    const deps = makeDeps();

    const result = await startAutoUpdateChecks(deps);

    expect(result).toEqual({
      status: "started",
      version: "0.0.2",
      stagingPercentage: 100,
    });
    expect(deps.fetchJson).toHaveBeenCalledTimes(1);
    expect(deps.updateElectronApp).toHaveBeenCalledTimes(1);
    expect(deps.updateElectronApp).toHaveBeenCalledWith({
      logger: expect.objectContaining({
        info: expect.any(Function),
        warn: expect.any(Function),
      }),
      notifyUser: true,
      repo: "AlpTalhaYazar/agent-profile",
    });
  });

  it("does not start the updater when the install is outside the staged bucket", async () => {
    const deps = makeDeps({
      getInstallId: vi.fn().mockResolvedValue("install-a"),
      fetchJson: vi.fn().mockResolvedValue({
        version: "0.0.2",
        channel: "stable",
        stagingPercentage: 0,
      }),
    });

    const result = await startAutoUpdateChecks(deps);

    expect(result).toEqual({ status: "skipped", reason: "outside-rollout" });
    expect(deps.updateElectronApp).not.toHaveBeenCalled();
  });
});
