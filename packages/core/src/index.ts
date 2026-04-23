/**
 * @module @agent-profile/core
 *
 * Pure TypeScript engine for Agent Profile configuration cascade.
 * Exports Zod schemas, the cascade resolver, fragment expansion,
 * provenance emission, and secret-reference parsing.
 *
 * No runtime dependency on Electron, keychain, node-pty, or any I/O
 * beyond reading YAML files from disk.
 */

// ─── Schemas (Zod) ────────────────────────────────────────────────────────────

export {
  McpServer,
  McpStdioServer,
  McpHttpServer,
  McpSseServer,
  McpServerEntry,
  McpServerPatch,
  ScopeDoc,
  PersonaRefs,
  AuthProfilesDoc,
  FragmentDoc,
  type McpServerT,
  type McpStdioServerT,
  type McpHttpServerT,
  type McpSseServerT,
  type McpServerEntryT,
  type McpServerPatchT,
  type ScopeDocT,
  type PersonaRefsT,
  type AuthProfilesDocT,
  type FragmentDocT,
} from "./schema/index.js";

// ─── Cascade ──────────────────────────────────────────────────────────────────

export { resolve, type ResolveInput } from "./cascade/resolve.js";
export { expandFragments } from "./cascade/fragment-expander.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
  EffectiveSessionConfig,
  EffectiveConfig,
  Provenance,
  LayerSource,
  McpServerProvenance,
  FieldProvenance,
  PersonaProvenance,
  ScopeName,
} from "./utils/types.js";

// ─── Secret refs (parse only, no resolution) ─────────────────────────────────

export {
  parseSecretRef,
  extractSecretRefs,
  type SecretRef,
  type LocatedSecretRef,
} from "./secret-refs/index.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export { CascadeError, SchemaError, FragmentNotFoundError, CoreError } from "./errors.js";

// ─── Utilities ────────────────────────────────────────────────────────────────

export { loadScopeFile, loadYamlAs, readYamlFile } from "./utils/load-yaml.js";
export { findProjectChain } from "./utils/project-chain.js";
