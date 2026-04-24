/**
 * Builders for Claude Code `settings.json` content.
 */

import type { EffectiveConfig } from "@agent-profile/core";

/**
 * Build the settings object written to `settings.json`.
 *
 * Existing settings are cloned before adding runtime helper paths.
 */
export function buildSettings(
  effective: EffectiveConfig,
  apiKeyHelperPath: string | null
): Record<string, unknown> {
  const settings = structuredClone(effective.settings) as Record<string, unknown>;

  if (apiKeyHelperPath) {
    settings.apiKeyHelper = apiKeyHelperPath;
  }

  return settings;
}
