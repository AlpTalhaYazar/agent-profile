import { describe, expect, it } from "vitest";
import {
  evaluateUpdatePolicy,
  getRolloutBucket,
  parseRolloutManifest,
  shouldApplyRollout,
} from "../src/main/update/policy.js";

const basePolicyInput = {
  argv: [],
  env: {},
  isPackaged: true,
  platform: "darwin" as NodeJS.Platform,
};

describe("update policy", () => {
  it("disables checks when MYCLAUDE_UPDATES=0", () => {
    const result = evaluateUpdatePolicy({
      ...basePolicyInput,
      env: { MYCLAUDE_UPDATES: "0" },
    });

    expect(result).toEqual({ enabled: false, reason: "disabled-by-env" });
  });

  it("never enables checks in test or Vitest environments", () => {
    expect(
      evaluateUpdatePolicy({
        ...basePolicyInput,
        env: { MYCLAUDE_UPDATES: "1", NODE_ENV: "test" },
      })
    ).toEqual({ enabled: false, reason: "test-environment" });

    expect(
      evaluateUpdatePolicy({
        ...basePolicyInput,
        env: { MYCLAUDE_UPDATES: "1", VITEST: "true" },
      })
    ).toEqual({ enabled: false, reason: "test-environment" });
  });

  it("disables checks for unpackaged builds and Linux", () => {
    expect(evaluateUpdatePolicy({ ...basePolicyInput, isPackaged: false })).toEqual({
      enabled: false,
      reason: "not-packaged",
    });

    expect(
      evaluateUpdatePolicy({
        ...basePolicyInput,
        platform: "linux",
      })
    ).toEqual({ enabled: false, reason: "unsupported-platform" });
  });

  it("disables headless checks by default but allows an explicit enable", () => {
    expect(
      evaluateUpdatePolicy({
        ...basePolicyInput,
        env: { MYCLAUDE_HEADLESS: "1" },
      })
    ).toEqual({ enabled: false, reason: "headless-disabled" });

    expect(
      evaluateUpdatePolicy({
        ...basePolicyInput,
        env: { MYCLAUDE_HEADLESS: "1", MYCLAUDE_UPDATES: "1" },
      })
    ).toEqual({ enabled: true });
  });

  it("skips the Windows Squirrel first-run lock window", () => {
    expect(
      evaluateUpdatePolicy({
        ...basePolicyInput,
        argv: ["--squirrel-firstrun"],
        platform: "win32",
      })
    ).toEqual({ enabled: false, reason: "squirrel-first-run" });
  });
});

describe("rollout manifest policy", () => {
  it("accepts a newer stable rollout manifest", () => {
    const parsed = parseRolloutManifest(
      { version: "0.0.2", channel: "stable", stagingPercentage: 25 },
      "0.0.1"
    );

    expect(parsed).toEqual({
      ok: true,
      manifest: { version: "0.0.2", channel: "stable", stagingPercentage: 25 },
    });
  });

  it("rejects invalid, same-version, and downgrade manifests", () => {
    expect(parseRolloutManifest({}, "0.0.1")).toEqual({
      ok: false,
      reason: "invalid-manifest",
    });
    expect(
      parseRolloutManifest({ version: "0.0.2", channel: "beta", stagingPercentage: 25 }, "0.0.1")
    ).toEqual({ ok: false, reason: "invalid-channel" });
    expect(
      parseRolloutManifest({ version: "0.0.2", channel: "stable", stagingPercentage: 101 }, "0.0.1")
    ).toEqual({ ok: false, reason: "invalid-percentage" });
    expect(
      parseRolloutManifest({ version: "0.0.1", channel: "stable", stagingPercentage: 100 }, "0.0.1")
    ).toEqual({ ok: false, reason: "not-newer" });
    expect(
      parseRolloutManifest({ version: "0.0.0", channel: "stable", stagingPercentage: 100 }, "0.0.1")
    ).toEqual({ ok: false, reason: "not-newer" });
  });

  it("uses a deterministic privacy-preserving local bucket", () => {
    expect(getRolloutBucket("0.0.2", "install-a")).toBe(getRolloutBucket("0.0.2", "install-a"));
    expect(getRolloutBucket("0.0.2", "install-a")).toBeGreaterThanOrEqual(1);
    expect(getRolloutBucket("0.0.2", "install-a")).toBeLessThanOrEqual(100);
  });

  it("applies 5, 25, and 100 percent staged rollout decisions deterministically", () => {
    const bucket = getRolloutBucket("0.0.2", "install-a");

    expect(shouldApplyRollout({ version: "0.0.2", stagingPercentage: 5 }, "install-a")).toBe(
      bucket <= 5
    );
    expect(shouldApplyRollout({ version: "0.0.2", stagingPercentage: 25 }, "install-a")).toBe(
      bucket <= 25
    );
    expect(shouldApplyRollout({ version: "0.0.2", stagingPercentage: 100 }, "install-a")).toBe(
      true
    );
  });
});
