import { z } from "zod";

/**
 * Base schema for stdio-transport MCP servers.
 * The `type` field is optional for backward compatibility; absence implies stdio.
 */
export const McpStdioServer = z
  .object({
    type: z.literal("stdio").optional(),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    enabled: z.boolean().default(true),
    /** Name of a lower-scope server to inherit from (textual inheritance). */
    __extends: z.string().optional(),
    /** Merge strategy for this server entry. Default is 'replace'. */
    __merge: z.enum(["replace", "deep"]).default("replace"),
  })
  .strict();

/** Inferred type for a stdio MCP server. */
export type McpStdioServerT = z.infer<typeof McpStdioServer>;

/**
 * Base schema for HTTP/streamable-HTTP transport MCP servers.
 */
export const McpHttpServer = z
  .object({
    type: z.enum(["http", "streamable-http"]),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    /** Path to a helper script that supplies dynamic headers. */
    headersHelper: z.string().optional(),
    oauth: z
      .object({
        clientId: z.string(),
        callbackPort: z.number().int().positive().optional(),
        scopes: z.string().optional(),
        authServerMetadataUrl: z.string().url().optional(),
      })
      .optional(),
    enabled: z.boolean().default(true),
    /** Name of a lower-scope server to inherit from (textual inheritance). */
    __extends: z.string().optional(),
    /** Merge strategy for this server entry. Default is 'replace'. */
    __merge: z.enum(["replace", "deep"]).default("replace"),
  })
  .strict();

/** Inferred type for an HTTP MCP server. */
export type McpHttpServerT = z.infer<typeof McpHttpServer>;

/**
 * Base schema for SSE-transport MCP servers.
 */
export const McpSseServer = z
  .object({
    type: z.literal("sse"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    enabled: z.boolean().default(true),
    /** Name of a lower-scope server to inherit from (textual inheritance). */
    __extends: z.string().optional(),
    /** Merge strategy for this server entry. Default is 'replace'. */
    __merge: z.enum(["replace", "deep"]).default("replace"),
  })
  .strict();

/** Inferred type for an SSE MCP server. */
export type McpSseServerT = z.infer<typeof McpSseServer>;

/**
 * Discriminated union of all MCP server transport types.
 *
 * Note: stdio servers may omit the `type` field. The discriminator works on
 * presence of required fields rather than purely the `type` field for stdio.
 * We use a manual union here since Zod's discriminatedUnion requires a
 * literal value to be present in all members.
 */
export const McpServer = z.union([McpStdioServer, McpHttpServer, McpSseServer]);

/** Inferred type for any MCP server. */
export type McpServerT = z.infer<typeof McpServer>;
