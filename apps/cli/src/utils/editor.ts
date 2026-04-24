/**
 * @module utils/editor
 *
 * Opens a file in the user's `$EDITOR`.
 * The editor is spawned synchronously (via `spawnSync`) so the CLI waits for it.
 */
import { spawnSync } from "node:child_process";
import { CliError, EXIT_GENERIC } from "../errors.js";

/**
 * Opens a file in the user's preferred editor.
 *
 * Respects `$EDITOR` environment variable; falls back to `vi` if not set.
 *
 * @param filePath - Absolute path to the file to open.
 * @throws {CliError} If the editor exits with a non-zero status.
 */
export function openInEditor(filePath: string): void {
  const editor = process.env.EDITOR ?? "vi";
  // Split on spaces so "code --wait" works correctly
  const [cmd, ...args] = editor.split(/\s+/);
  if (!cmd) throw new CliError("EDITOR is empty", EXIT_GENERIC);

  const result = spawnSync(cmd, [...args, filePath], {
    stdio: "inherit",
  });

  if (result.error) {
    throw new CliError(
      `Failed to launch editor "${editor}": ${result.error.message}`,
      EXIT_GENERIC
    );
  }

  if (result.status !== 0) {
    throw new CliError(
      `Editor "${editor}" exited with status ${result.status ?? "unknown"}`,
      EXIT_GENERIC
    );
  }
}
