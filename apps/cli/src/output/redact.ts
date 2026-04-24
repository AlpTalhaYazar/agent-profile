/**
 * @module output/redact
 *
 * Redaction helpers for `render --resolve-secrets` output.
 *
 * A field is considered "sensitive" if any of the following are true:
 * - The pre-resolution value contained at least one `keyring://` ref.
 * - The pre-resolution value contained at least one `${secret:...}` ref.
 *
 * `${env:...}` substitutions are NOT automatically redacted — env vars may
 * carry non-secret values. Users opt into revealing them via `--show-values`.
 *
 * Redacted output: sensitive fields → `«redacted»`
 * Unresolved refs: shown as `«unresolved: <ref>»` (not redacted, no value)
 */

/** Sentinel string used when a sensitive field is redacted. */
export const REDACTED = "«redacted»";

/** Prefix used for unresolved ref markers. */
export const UNRESOLVED_PREFIX = "«unresolved:";

/**
 * Returns `true` if the original (pre-resolution) value contains a
 * `keyring://` or `${secret:...}` reference, making it sensitive.
 *
 * `${env:...}` references are not considered sensitive.
 *
 * @param originalValue - The string value before secret resolution.
 */
export function isSensitiveField(originalValue: string): boolean {
  if (/keyring:\/\/[^\s"']+/.test(originalValue)) return true;
  if (/\$\{secret:[^}]+\}/.test(originalValue)) return true;
  return false;
}

/**
 * Applies redaction to a resolved field value.
 *
 * - If `showValues` is `true`, returns the value unchanged.
 * - If the field is sensitive (had a `keyring://` or `${secret:}` ref),
 *   returns `«redacted»`.
 * - Otherwise (e.g. `${env:}` substitutions), returns the value unchanged.
 *
 * @param originalValue - The pre-resolution string value.
 * @param resolvedValue - The post-resolution string value.
 * @param showValues - If `true`, skip redaction.
 * @returns The display-safe value.
 */
export function applyRedaction(
  originalValue: string,
  resolvedValue: string,
  showValues: boolean
): string {
  if (showValues) return resolvedValue;
  if (isSensitiveField(originalValue)) return REDACTED;
  return resolvedValue;
}

/**
 * Formats an unresolved ref as a display string.
 *
 * Example: `${secret:github.pat}` → `«unresolved: ${secret:github.pat}»`
 *
 * @param ref - The raw ref token (e.g. `${secret:github.pat}`).
 */
export function unresolvedMarker(ref: string): string {
  return `${UNRESOLVED_PREFIX} ${ref}»`;
}

/**
 * Redacts a whole record (e.g. `env`) by applying field-level redaction
 * against each value that was substituted.
 *
 * @param original - The original record (pre-resolution).
 * @param resolved - The resolved record (post-resolution).
 * @param showValues - If `true`, skip redaction.
 * @returns A new record with sensitive values redacted.
 */
export function redactRecord(
  original: Record<string, string>,
  resolved: Record<string, string>,
  showValues: boolean
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(resolved)) {
    const origVal = original[key] ?? "";
    const resolvedVal = resolved[key] ?? "";
    result[key] = applyRedaction(origVal, resolvedVal, showValues);
  }
  return result;
}
