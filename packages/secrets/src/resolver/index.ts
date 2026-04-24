/**
 * Secret resolver module.
 *
 * Exports the main `resolveSecrets` function and its associated types.
 */

export {
  resolveSecrets,
  type ResolveSecretsInput,
  type ResolveSecretsResult,
  type MissingRef,
} from "./resolve-secrets.js";

export type { ResolutionLogEntry, ResolutionSource } from "./resolution-log.js";
