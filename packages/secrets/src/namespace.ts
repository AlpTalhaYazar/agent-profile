/**
 * Key namespacing utilities for the agent-profile keychain.
 *
 * All entries are stored under the `agent-profile.` prefix to prevent
 * collisions with other applications sharing the same flat keyspace.
 */

import { InvalidSecretRefError } from "./errors.js";

/** Prefix applied to all keys stored in the keychain. */
export const KEY_PREFIX = "agent-profile";

/**
 * Regex for validating service and account names.
 * Allows alphanumeric characters, hyphens, and underscores.
 * Must start with an alphanumeric character.
 */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Regex for parsing keyring:// URIs.
 * Format: `keyring://service/account`
 * Service and account must match `NAME_RE`.
 */
const KEYRING_URI_RE = /^keyring:\/\/([^/]+)\/([^/]+)$/;

/**
 * Converts a service and account pair into a namespaced keychain key.
 *
 * @param service - The service name (e.g. `"anthropic"`, `"github"`).
 * @param account - The account name (e.g. `"work"`, `"acme-org"`).
 * @returns The fully-qualified key `"agent-profile.<service>.<account>"`.
 * @throws {InvalidSecretRefError} If service or account contains invalid characters.
 */
export function toKeyringKey(service: string, account: string): string {
  if (!NAME_RE.test(service)) {
    throw new InvalidSecretRefError(
      `${service}/${account}`,
      `service name "${service}" contains invalid characters (allowed: [a-z0-9][a-z0-9_-]*)`
    );
  }
  if (!NAME_RE.test(account)) {
    throw new InvalidSecretRefError(
      `${service}/${account}`,
      `account name "${account}" contains invalid characters (allowed: [a-z0-9][a-z0-9_-]*)`
    );
  }
  return `${KEY_PREFIX}.${service}.${account}`;
}

/**
 * Parses a `keyring://service/account` URI into its component parts.
 *
 * @param uri - The URI to parse (e.g. `"keyring://anthropic/work"`).
 * @returns An object with `service` and `account` string properties.
 * @throws {InvalidSecretRefError} If the URI is malformed or the components are invalid.
 */
export function parseKeyringUri(uri: string): { service: string; account: string } {
  const match = KEYRING_URI_RE.exec(uri);
  if (!match) {
    throw new InvalidSecretRefError(
      uri,
      `expected format keyring://service/account (got "${uri}")`
    );
  }

  const service = match[1];
  const account = match[2];

  if (!service || !account) {
    throw new InvalidSecretRefError(uri, "service and account must not be empty");
  }

  if (!NAME_RE.test(service)) {
    throw new InvalidSecretRefError(
      uri,
      `service name "${service}" contains invalid characters (allowed: [a-z0-9][a-z0-9_-]*)`
    );
  }

  if (!NAME_RE.test(account)) {
    throw new InvalidSecretRefError(
      uri,
      `account name "${account}" contains invalid characters (allowed: [a-z0-9][a-z0-9_-]*)`
    );
  }

  return { service, account };
}
