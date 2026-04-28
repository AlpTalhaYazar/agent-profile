/**
 * Pure value-shaping helpers used by the editor: structural clone, ordered
 * stringification, JSON object parsing, redaction. No React or Jotai imports
 * — these can be unit-tested directly.
 */

export function cloneDoc<T>(doc: T): T {
  return structuredClone(doc);
}

export function stringifyDoc(doc: unknown): string {
  return JSON.stringify(doc, null, 2);
}

export function stringifyValue(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)])
    );
  }
  return value;
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isPlainObject(parsed)) throw new Error("Expected a JSON object");
  return parsed;
}

export function flattenObject(
  value: Record<string, unknown>,
  prefix = ""
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(nested)) {
      entries.push(...flattenObject(nested, path));
    } else {
      entries.push([path, nested]);
    }
  }
  return entries;
}

export function sortedUnion(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right])).sort();
}

export function stringifyInline(value: unknown): string {
  if (typeof value === "string") return redactText(value);
  return JSON.stringify(value);
}

export function redactText(value: string): string {
  return /secret:|keyring:\/\//i.test(value) ? "•••• redacted ref ••••" : value;
}

export function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
