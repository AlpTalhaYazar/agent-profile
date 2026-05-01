import type {
  RespSessionsDriftOkT,
  RespSessionsKillOkT,
  RespSessionsListOkT,
  RespSessionsRelaunchOkT,
} from "@agent-profile/ipc-protocol";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels.js";
import { withDaemonClient } from "../daemon/client-runner.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const NoPayload = z.undefined();
const SessionsKillPayload = z
  .object({
    sessionId: z.string().min(1),
    signal: z.enum(["SIGTERM", "SIGKILL"]).optional(),
  })
  .strict();
const SessionsRelaunchPayload = z.object({ sessionId: z.string().min(1) }).strict();
const SessionsDriftPayload = z.object({ sessionId: z.string().min(1) }).strict();

export function registerSessionHandlers(context: RendererIpcBaseContext): void {
  registerSecureHandler({
    channel: CHANNELS.sessions.list,
    schema: NoPayload,
    context,
    handle: () =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespSessionsListOkT>("sessions.list", {});
        return { sessions: resp.sessions };
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
}
