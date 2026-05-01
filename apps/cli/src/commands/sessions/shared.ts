import { sessionsRootDefault } from "@agent-profile/persona-deployer";
import { CliError, EXIT_GENERIC } from "../../errors.js";
import type { getTransport } from "../../transport/index.js";
import type { SessionsBaseOptions } from "./types.js";

export interface TransportSelectionOptions {
  home?: string;
  requireDaemon?: boolean;
  standalone?: boolean;
}

export function resolveSessionsRoot(opts: SessionsBaseOptions): string {
  return opts.sessionsRoot ?? opts.env?.MYCLAUDE_SESSIONS_ROOT ?? sessionsRootDefault();
}

export function isJsonMode(opts: Pick<SessionsBaseOptions, "json" | "pretty">): boolean {
  return Boolean(opts.json) || Boolean(opts.pretty);
}

export function requireSessionId(sessionId: string | undefined): string {
  if (!sessionId) {
    throw new CliError("Session id is required.", EXIT_GENERIC);
  }
  return sessionId;
}

export function buildTransportOptions(
  opts: TransportSelectionOptions
): Parameters<typeof getTransport>[0] {
  const transportOpts: Parameters<typeof getTransport>[0] = {};
  if (opts.home !== undefined) transportOpts.home = opts.home;
  if (opts.requireDaemon !== undefined) transportOpts.requireDaemon = opts.requireDaemon;
  if (opts.standalone !== undefined) transportOpts.standalone = opts.standalone;
  return transportOpts;
}
