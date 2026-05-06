import { describe, expect, test } from "vitest";
import { createDiffSummary } from "../src/renderer/components/preview-panel.js";
import {
  mergeValidationIssues,
  normalizeProfilePreviewResponse,
} from "../src/renderer/lib/profile-preview.js";
import type { EffectiveConfig } from "../src/renderer/lib/types.js";

function effective(overrides: Partial<EffectiveConfig> = {}): EffectiveConfig {
  return {
    mcpServers: {},
    env: {},
    settings: {},
    persona: {
      claudeMd: [],
      agents: [],
      skills: [],
      slashCmds: [],
      memory: [],
    },
    ...overrides,
  };
}

describe("normalizeProfilePreviewResponse", () => {
  test("normalizes wrapper-shaped preview payloads using the nested preview effective config", () => {
    const current = effective({ mcpServers: { base: { type: "stdio" } } });
    const preview = effective({
      mcpServers: {
        base: { type: "stdio" },
        browser: { type: "stdio", command: "npx" },
      },
      persona: {
        claudeMd: [],
        agents: [],
        skills: ["skills/react/SKILL.md"],
        slashCmds: [],
        memory: [],
      },
    });

    const result = normalizeProfilePreviewResponse(
      {
        issues: [],
        current: { effective: current, provenance: null },
        preview: { effective: preview, provenance: null },
        diff: [{ path: "ignored", change: "added", after: "ignored" }],
      },
      { currentEffective: current, createDiffSummary }
    );

    expect(result.status).toBe("ready");
    expect(result.effective?.mcpServers).toHaveProperty("browser");
    expect(result.effective?.persona.skills).toEqual(["skills/react/SKILL.md"]);
    expect(result.diff).toEqual([
      {
        section: "mcpServers",
        key: "browser",
        change: "added",
        after: "stdio npx",
      },
      {
        section: "persona",
        key: "skills",
        change: "added",
        before: "",
        after: "skills/react/SKILL.md",
      },
    ]);
  });

  test("returns wrapper issues without losing a resolved preview config", () => {
    const preview = effective({ settings: { model: "claude-sonnet" } });

    const result = normalizeProfilePreviewResponse(
      {
        issues: [{ path: "settings.model", message: "Check model", code: "MODEL_WARNING" }],
        current: { effective: effective(), provenance: null },
        preview: { effective: preview, provenance: null },
        diff: [],
      },
      { currentEffective: effective(), createDiffSummary }
    );

    expect(result.status).toBe("ready");
    expect(result.effective?.settings).toEqual({ model: "claude-sonnet" });
    expect(result.issues).toEqual([
      { path: "settings.model", message: "Check model", severity: "error" },
    ]);
  });

  test("treats preview null with validation issues as a valid non-previewable draft result", () => {
    const result = normalizeProfilePreviewResponse(
      {
        issues: [{ path: "mcpServers.browser", message: "Invalid server", severity: "error" }],
        current: { effective: effective(), provenance: null },
        preview: null,
        diff: [],
      },
      { currentEffective: effective(), createDiffSummary }
    );

    expect(result).toEqual({
      status: "ready",
      effective: null,
      diff: [],
      issues: [{ path: "mcpServers.browser", message: "Invalid server", severity: "error" }],
      errorMessage: null,
    });
  });

  test("supports legacy direct effective-state-shaped preview payloads", () => {
    const preview = effective({ env: { FEATURE_FLAG: "on" } });

    const result = normalizeProfilePreviewResponse(
      { effective: preview, provenance: null },
      { currentEffective: effective(), createDiffSummary }
    );

    expect(result.status).toBe("ready");
    expect(result.effective?.env).toEqual({ FEATURE_FLAG: "on" });
    expect(result.diff).toEqual([
      { section: "env", key: "FEATURE_FLAG", change: "added", after: "on" },
    ]);
  });

  test("returns a safe error for null or malformed preview responses", () => {
    const nullResult = normalizeProfilePreviewResponse(null, {
      currentEffective: effective(),
      createDiffSummary,
    });
    const malformedResult = normalizeProfilePreviewResponse({ ok: true }, {
      currentEffective: effective(),
      createDiffSummary,
    });

    expect(nullResult).toEqual({
      status: "error",
      effective: null,
      diff: [],
      issues: [],
      errorMessage: "Profile preview returned an invalid response.",
    });
    expect(malformedResult).toEqual({
      status: "error",
      effective: null,
      diff: [],
      issues: [],
      errorMessage: "Profile preview response did not include a preview config.",
    });
  });

  test("uses renderer diff summaries so secret refs are redacted in diff output", () => {
    const result = normalizeProfilePreviewResponse(
      {
        issues: [],
        current: {
          effective: effective({ env: { ANTHROPIC_API_KEY: "secret:old-key" } }),
          provenance: null,
        },
        preview: {
          effective: effective({ env: { ANTHROPIC_API_KEY: "keyring://new-key" } }),
          provenance: null,
        },
        diff: [],
      },
      {
        currentEffective: effective({ env: { ANTHROPIC_API_KEY: "secret:old-key" } }),
        createDiffSummary,
      }
    );

    const serialized = JSON.stringify(result.diff);
    expect(serialized).toContain("•••• redacted ref ••••");
    expect(serialized).not.toContain("secret:old-key");
    expect(serialized).not.toContain("keyring://new-key");
  });
});

describe("mergeValidationIssues", () => {
  test("deduplicates validation and preview issues by path, message, and severity", () => {
    const issue = { path: "document", message: "Invalid", severity: "error" };

    expect(mergeValidationIssues([issue], [issue], [{ ...issue, severity: "warning" }])).toEqual([
      issue,
      { ...issue, severity: "warning" },
    ]);
  });
});
