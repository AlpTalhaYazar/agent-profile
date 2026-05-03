import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  RespSessionsDriftOkT,
  RespSessionsKillOkT,
  RespSessionsListOkT,
  RespSessionsRelaunchOkT,
} from "@agent-profile/ipc-protocol";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels.js";
import { withDaemonClient } from "../daemon/client-runner.js";
import { listNativeClaudeHistory } from "../native-claude-history.js";
import {
  closeTerminalSession,
  isTerminalSessionAttachable,
  launchTerminalSession,
  openTerminalSession,
  resizeTerminalSession,
  resumeNativeClaudeSession,
  writeTerminalSession,
} from "../session-terminal.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const NoPayload = z.undefined();
const SessionsListPayload = z
  .object({
    cwd: z.string().min(1).optional(),
    includeNative: z.boolean().optional(),
  })
  .strict()
  .optional();
const SessionsKillPayload = z
  .object({
    sessionId: z.string().min(1),
    signal: z.enum(["SIGTERM", "SIGKILL"]).optional(),
  })
  .strict();
const SessionsRelaunchPayload = z.object({ sessionId: z.string().min(1) }).strict();
const SessionsDriftPayload = z.object({ sessionId: z.string().min(1) }).strict();
const SessionsLaunchPayload = z
  .object({
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
    passthroughArgs: z.array(z.string()).optional(),
    bare: z.boolean().optional(),
    strict: z.boolean().optional(),
  })
  .strict();
const SessionsOpenTerminalPayload = z.object({ sessionId: z.string().min(1) }).strict();
const SessionsResumeNativePayload = z
  .object({ sessionId: z.string().min(1), cwd: z.string().min(1) })
  .strict();
const SessionsWriteTerminalPayload = z
  .object({ sessionId: z.string().min(1), data: z.string() })
  .strict();
const SessionsResizeTerminalPayload = z
  .object({
    sessionId: z.string().min(1),
    cols: z.number().int().min(20).max(400),
    rows: z.number().int().min(5).max(120),
  })
  .strict();

export function registerSessionHandlers(context: RendererIpcBaseContext): void {
  registerSecureHandler({
    channel: CHANNELS.sessions.list,
    schema: SessionsListPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespSessionsListOkT>("sessions.list", {});
        const profileSessions = await normalizeProfileSessions(resp.sessions, parsed?.cwd);
        const nativeSessions =
          parsed?.includeNative !== false && parsed?.cwd
            ? await listNativeClaudeHistory({ cwd: parsed.cwd })
            : [];
        const nativeRows = nativeSessions.map((session) => {
          const attachable = isTerminalSessionAttachable(session.sessionId);
          return {
            ...session,
            attachable,
            resumable: attachable ? false : session.resumable,
          };
        });
        return { sessions: sortSessions([...profileSessions, ...nativeRows]) };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.kill,
    schema: SessionsKillPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const body: Record<string, unknown> = { sessionId: parsed.sessionId };
        if (parsed.signal !== undefined) body.signal = parsed.signal;
        const resp = await client.request<RespSessionsKillOkT>("sessions.kill", body);
        const result: { killed: boolean; exitCode?: number } = { killed: resp.killed };
        if (resp.exitCode !== undefined) result.exitCode = resp.exitCode;
        return result;
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.relaunch,
    schema: SessionsRelaunchPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespSessionsRelaunchOkT>("sessions.relaunch", {
          sessionId: parsed.sessionId,
        });
        return {
          sessionId: resp.sessionId,
          relaunchedFrom: resp.relaunchedFrom,
        };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.drift,
    schema: SessionsDriftPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespSessionsDriftOkT>("sessions.drift", {
          sessionId: parsed.sessionId,
        });
        return {
          drifted: resp.drifted,
          scopesChanged: resp.scopesChanged,
          oldHash: resp.oldHash,
          newHash: resp.newHash,
        };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.launch,
    schema: SessionsLaunchPayload,
    context,
    handle: (parsed) => {
      const input: Parameters<typeof launchTerminalSession>[0] = {
        role: parsed.role,
        authProfileId: parsed.authProfileId,
        cwd: parsed.cwd,
      };
      if (parsed.passthroughArgs !== undefined) input.passthroughArgs = parsed.passthroughArgs;
      if (parsed.bare !== undefined) input.bare = parsed.bare;
      if (parsed.strict !== undefined) input.strict = parsed.strict;
      return launchTerminalSession(input, context);
    },
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.openTerminal,
    schema: SessionsOpenTerminalPayload,
    context,
    handle: (parsed) => openTerminalSession(parsed.sessionId),
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.resumeNative,
    schema: SessionsResumeNativePayload,
    context,
    handle: (parsed) => resumeNativeClaudeSession(parsed, context),
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.writeTerminal,
    schema: SessionsWriteTerminalPayload,
    context,
    handle: (parsed) => {
      writeTerminalSession(parsed.sessionId, parsed.data);
      return undefined;
    },
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.resizeTerminal,
    schema: SessionsResizeTerminalPayload,
    context,
    handle: (parsed) => {
      resizeTerminalSession(parsed.sessionId, parsed.cols, parsed.rows);
      return undefined;
    },
  });

  registerSecureHandler({
    channel: CHANNELS.sessions.closeTerminal,
    schema: SessionsOpenTerminalPayload,
    context,
    handle: (parsed) => {
      closeTerminalSession(parsed.sessionId);
      return undefined;
    },
  });
}

async function normalizeProfileSessions(
  input: unknown[],
  cwd: string | undefined
): Promise<Array<Record<string, unknown>>> {
  const cwdFilter = cwd ? await normalizePath(cwd) : null;
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of input) {
    if (!isRecord(entry)) continue;
    if (cwdFilter) {
      if (typeof entry.cwd !== "string") continue;
      if ((await normalizePath(entry.cwd)) !== cwdFilter) continue;
    }
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
    rows.push({
      ...entry,
      source: "profile",
      attachable: sessionId ? isTerminalSessionAttachable(sessionId) : false,
      resumable: false,
    });
  }
  return rows;
}

function sortSessions(sessions: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return sessions.sort((a, b) => sessionTimeMs(b) - sessionTimeMs(a));
}

function sessionTimeMs(session: Record<string, unknown>): number {
  const value = typeof session.updatedAt === "string" ? session.updatedAt : session.createdAt;
  return typeof value === "string" ? Date.parse(value) || 0 : 0;
}

const pathCache = new Map<string, string>();

async function normalizePath(path: string): Promise<string> {
  const resolved = resolve(path);
  const cached = pathCache.get(resolved);
  if (cached) return cached;
  let normalized: string;
  try {
    normalized = await realpath(resolved);
  } catch {
    normalized = resolved;
  }
  pathCache.set(resolved, normalized);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
