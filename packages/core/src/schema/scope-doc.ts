import { z } from "zod";
import { McpServer } from "./mcp-server.js";

/**
 * A partial server "patch" used for inheritance-based overlays.
 * Two cases trigger a patch rather than a full server definition:
 *
 * 1. `__merge: "deep"` — overlay only certain fields onto the lower-scope server.
 * 2. `__extends: '<scope>'` — inherit a server from a named lower scope, then overlay.
 *
 * In both cases, the partial entry does NOT need to provide `command` or `url`
 * since those are inherited from the base server.
 *
 * This is distinct from a full `McpServer` which requires `command` (stdio)
 * or `type`+`url` (http/sse).
 */
export const McpServerPatch = z
  .object({
    __merge: z.enum(["replace", "deep"]).optional(),
    __extends: z.string().optional(),
    enabled: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    args: z.array(z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    command: z.string().optional(),
    url: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough() // allow any additional fields for forward compatibility
  .refine(
    (data) => data.__merge === "deep" || data.__extends !== undefined,
    "A server patch must have either __merge:'deep' or __extends set"
  );

/** Inferred type for an MCP server patch. */
export type McpServerPatchT = z.infer<typeof McpServerPatch>;

/**
 * A value in the `mcpServers` record. Can be:
 * - A full `McpServer` definition (normal case)
 * - A `McpServerPatch` (deep-merge or __extends case)
 * - `null` (tombstone — server is suppressed)
 */
export const McpServerEntry = z.union([McpServer, McpServerPatch]);

/** Inferred type for an MCP server entry (full or patch). */
export type McpServerEntryT = z.infer<typeof McpServerEntry>;

/**
 * Persona references within a scope document.
 * All arrays contain file paths (relative to the scope file or absolute).
 */
export const PersonaRefs = z
  .object({
    /** Paths to CLAUDE.md fragments concatenated in scope order. */
    claudeMd: z.array(z.string()).default([]),
    /** Agent definition files deployed into .claude/agents/. */
    agents: z.array(z.string()).default([]),
    /** Skill definition files deployed into .claude/skills/. */
    skills: z.array(z.string()).default([]),
    /** Slash command files deployed into .claude/commands/. */
    slashCmds: z.array(z.string()).default([]),
    /** Memory seed files deployed into .claude/memory/. */
    memory: z.array(z.string()).default([]),
  })
  .partial()
  .optional();

/** Inferred type for persona refs. */
export type PersonaRefsT = z.infer<typeof PersonaRefs>;

/**
 * Product-facing Agent Profile identity metadata stored on a scope file.
 *
 * This is deliberately display metadata only. Runtime execution still derives
 * from role/auth/cwd plus the effective cascade.
 */
export const ProfileMetadata = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    purpose: z.string().trim().min(1).max(280).optional(),
  })
  .partial()
  .optional();

/** Inferred type for product-facing Agent Profile identity metadata. */
export type ProfileMetadataT = z.infer<typeof ProfileMetadata>;

/**
 * A single scope document — the canonical shape of one YAML config file.
 *
 * Version must be `1` for this schema version.
 * - `profile`: optional product-facing Agent Profile identity metadata.
 * - `mcpServers`: named MCP server definitions; null value = tombstone.
 * - `env`: environment variables; values may contain secret refs.
 * - `settings`: arbitrary `settings.json` overlay keys.
 * - `persona`: persona file references.
 * - `use`: fragment names to expand before inter-layer merge.
 * - `disabledServers`: server names to tombstone (equiv to `enabled: false`).
 * - `auth`: optional auth profile binding.
 */
export const ScopeDoc = z.object({
  version: z.literal(1),
  profile: ProfileMetadata,
  mcpServers: z
    .record(
      z.string().regex(/^[a-z0-9_-]+$/, "Server name must match [a-z0-9_-]+"),
      McpServerEntry.nullable()
    )
    .default({}),
  auth: z.object({ profileId: z.string() }).optional(),
  env: z.record(z.string(), z.string()).default({}),
  settings: z.record(z.string(), z.unknown()).default({}),
  persona: PersonaRefs,
  use: z.array(z.string()).default([]),
  disabledServers: z.array(z.string()).default([]),
});

/** Inferred type for a scope document. */
export type ScopeDocT = z.infer<typeof ScopeDoc>;
