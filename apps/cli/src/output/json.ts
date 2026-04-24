/**
 * @module output/json
 *
 * JSON output helpers for `--json` mode.
 * All structured output goes to stdout; errors go to stderr.
 */

/**
 * Serialises a value to JSON and writes it to stdout.
 * Uses compact JSON (no indentation) unless `pretty` is true.
 *
 * @param value - Any JSON-serialisable value.
 * @param pretty - If true, output is pretty-printed with 2-space indent.
 */
export function writeJson(value: unknown, pretty = false): void {
  const output = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  process.stdout.write(`${output}\n`);
}

/**
 * Serialises an error to JSON and writes it to stderr.
 * Shape: `{ error: string, code?: number }`.
 */
export function writeJsonError(message: string, code?: number): void {
  const obj: { error: string; code?: number } = { error: message };
  if (code !== undefined) obj.code = code;
  process.stderr.write(`${JSON.stringify(obj)}\n`);
}
