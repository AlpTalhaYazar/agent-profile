/**
 * Backend module — OS keychain adapters.
 *
 * Exports the `Backend` interface, `KeychainBackend` union type,
 * the `@napi-rs/keyring` implementation, and auto-detection helpers.
 */

export { getBackend, isBackendSecure } from "./detect.js";
export { KeyringBackend } from "./keyring.js";
export type { Backend, KeychainBackend } from "./types.js";
