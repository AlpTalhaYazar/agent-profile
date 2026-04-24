/**
 * @module colors
 *
 * Thin wrapper around picocolors that respects NO_COLOR, FORCE_COLOR,
 * CI=1, and TERM=dumb conventions for color suppression.
 *
 * Import this module instead of picocolors directly so all color decisions
 * are centralised and testable.
 */
import pc from "picocolors";

/**
 * Returns true when colors should be suppressed for this invocation.
 *
 * Logic (in precedence order):
 * 1. `FORCE_COLOR` → always enable colors.
 * 2. `NO_COLOR` → always disable colors.
 * 3. `TERM=dumb` → disable colors.
 * 4. `CI=1` → disable colors (unless FORCE_COLOR).
 * 5. Default: picocolors decides via TTY detection.
 */
export function colorsEnabled(): boolean {
  if (process.env.FORCE_COLOR) return true;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === "dumb") return false;
  if (process.env.CI) return false;
  return true;
}

/**
 * Conditionally apply a picocolors transform.
 * If colors are disabled, the plain string is returned unchanged.
 */
function maybe(transform: (s: string) => string, str: string): string {
  return colorsEnabled() ? transform(str) : str;
}

/** Green text — used for success markers `[✓]`. */
export const green = (s: string): string => maybe(pc.green, s);

/** Red text — used for failure markers `[✗]`. */
export const red = (s: string): string => maybe(pc.red, s);

/** Yellow text — used for warning markers `[!]`. */
export const yellow = (s: string): string => maybe(pc.yellow, s);

/** Cyan text — used for scope names and highlights. */
export const cyan = (s: string): string => maybe(pc.cyan, s);

/** Bold text — used for section headers. */
export const bold = (s: string): string => maybe(pc.bold, s);

/** Dim text — used for secondary information. */
export const dim = (s: string): string => maybe(pc.dim, s);

/** Magenta text — used for role names. */
export const magenta = (s: string): string => maybe(pc.magenta, s);
