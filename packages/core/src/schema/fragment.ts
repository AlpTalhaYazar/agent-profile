import { z } from "zod";
import { McpServer } from "./mcp-server.js";

/**
 * A fragment document — a named, reusable bundle of MCP server definitions.
 *
 * Fragments live at `~/.myclaude/config/fragments/<name>.yml` and are
 * referenced by `use: [name]` in scope documents. Expansion happens
 * **before** inter-layer merge (step 3 of the cascade algorithm).
 *
 * Fragments cannot reference other fragments in v1 (no recursion).
 */
export const FragmentDoc = z.object({
  /**
   * Canonical name, must match the filename (without extension).
   * Must match `[a-z0-9_-]+`.
   */
  name: z.string().regex(/^[a-z0-9_-]+$/, "Fragment name must match [a-z0-9_-]+"),
  /**
   * MCP server definitions contributed by this fragment.
   * Note: the key in the spec doc is `mcpServer` (singular) per the schema doc.
   */
  mcpServer: z.record(z.string(), McpServer).optional(),
  /** Environment variables contributed by this fragment. */
  env: z.record(z.string(), z.string()).default({}),
});

/** Inferred type for a fragment document. */
export type FragmentDocT = z.infer<typeof FragmentDoc>;
