/**
 * @module client/types
 *
 * `HelperClient` is the stable seam between the helper CLI entrypoint and the
 * concrete source of values (in-process lookup today, IPC/daemon in a future
 * sprint).
 *
 * Implementations MUST:
 *  - Never write to stdout/stderr directly — they return values or throw.
 *  - Throw `HelperError` with an appropriate exit code for operational failures
 *    (unknown session → EXIT_SESSION_UNKNOWN, bad capability → EXIT_CAPABILITY_DENIED,
 *    keychain failure → EXIT_AUTH, etc.).
 *  - Never include secret values in thrown error messages.
 */

/** Input to `HelperClient.anthropic`. */
export interface AnthropicRequest {
  /** The session identifier (UUID string by convention). */
  readonly sessionId: string;
  /** The per-session capability token supplied by Claude Code's env var. */
  readonly capabilityToken: string;
}

/** Input to `HelperClient.mcpHeaders`. */
export interface McpHeadersRequest {
  /** The session identifier. */
  readonly sessionId: string;
  /** The per-session capability token. */
  readonly capabilityToken: string;
  /** The MCP server name that Claude Code passed as the positional arg. */
  readonly serverName: string;
}

/**
 * Abstract source of helper values.
 *
 * The default implementation (`createInProcessHelperClient`) reads the session
 * manifest and keychain in-process. A future IPC implementation will connect
 * to a local daemon over a UNIX socket and satisfy the same contract.
 */
export interface HelperClient {
  /**
   * Return the Anthropic API key value for the session.
   *
   * The returned string is written verbatim to stdout and delivered to Claude
   * Code via its `apiKeyHelper` script. Do not include trailing whitespace.
   */
  anthropic(request: AnthropicRequest): Promise<string>;

  /**
   * Return the resolved header map for the given MCP server.
   *
   * The returned object is JSON-serialized to stdout and delivered to Claude
   * Code via its `headersHelper` script. All `${secret:...}`, `keyring://...`,
   * and `${env:...}` references MUST already be materialized before return.
   */
  mcpHeaders(request: McpHeadersRequest): Promise<Record<string, string>>;
}
