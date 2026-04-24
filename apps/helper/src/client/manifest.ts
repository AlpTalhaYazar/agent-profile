/**
 * @module client/manifest
 *
 * Zod schema and loader for the per-session `session.json` manifest.
 *
 * The manifest is written by the session manager at launch and read by the
 * helper binary on every invocation. It maps `(sessionId, capabilityToken)` to
 * the minimum information required to satisfy `apiKeyHelper`/`headersHelper`
 * lookups without re-reading the cascaded config:
 *
 *  - the keyring URI for the Anthropic API key,
 *  - the declared MCP header templates with their `${secret:...}` refs, and
 *  - the auth-profile-level `mcpSecretRefs` used to resolve those refs.
 *
 * The manifest never contains secret values — only identifiers.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EXIT_SESSION_UNKNOWN, HelperError } from "../errors.js";

/**
 * The versioned, validated shape of `<sessionDir>/session.json`.
 *
 * Any backwards-incompatible change must bump the `version` literal and keep
 * older versions parseable behind a migration shim.
 */
export const SessionManifest = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  capabilityToken: z.string().min(1),
  authProfileId: z.string().min(1),
  anthropic: z.object({
    mode: z.enum(["apiKey", "bedrock", "vertex", "gateway"]),
    secretRef: z.string().regex(/^keyring:\/\//, "Must be a keyring:// URI"),
  }),
  mcpHeaders: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  mcpSecretRefs: z.record(z.string(), z.string()).default({}),
});

/** Static type for a successfully parsed `SessionManifest`. */
export type SessionManifestT = z.infer<typeof SessionManifest>;

/**
 * Load and validate `<sessionDir>/session.json`.
 *
 * Failure modes all map to `EXIT_SESSION_UNKNOWN` because, from the caller's
 * perspective, any of them means "this session is not addressable": either the
 * directory does not exist, the file does not exist, the file is not valid
 * JSON, or the JSON does not match the schema.
 *
 * @param sessionDir - Absolute path to the session directory.
 * @returns The parsed manifest.
 * @throws {HelperError} `EXIT_SESSION_UNKNOWN` when the session cannot be
 *   resolved for any of the reasons above. The thrown message includes only
 *   identifiers (session directory, first Zod issue path) — never raw file
 *   contents beyond what Zod emits about the schema failure itself.
 */
export async function loadSessionManifest(sessionDir: string): Promise<SessionManifestT> {
  const manifestPath = join(sessionDir, "session.json");

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HelperError(`unknown session: ${sessionDir}`, EXIT_SESSION_UNKNOWN);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HelperError(`invalid session manifest: ${message}`, EXIT_SESSION_UNKNOWN);
  }

  const result = SessionManifest.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const issuePath = issue?.path.join(".") ?? "";
    const issueMsg = issue?.message ?? "schema mismatch";
    throw new HelperError(
      `invalid session manifest at ${issuePath}: ${issueMsg}`,
      EXIT_SESSION_UNKNOWN
    );
  }

  return result.data;
}
