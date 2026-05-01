import type { RespPersonaRenderOkT } from "@agent-profile/ipc-protocol";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels.js";
import { withDaemonClient } from "../daemon/client-runner.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const PersonaRenderPayload = z
  .object({
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();

export function registerPersonaHandlers(context: RendererIpcBaseContext): void {
  registerSecureHandler({
    channel: CHANNELS.persona.render,
    schema: PersonaRenderPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespPersonaRenderOkT>("persona.render", parsed);
        return {
          claudeMd: resp.claudeMd,
          files: resp.files,
          collisions: resp.collisions,
          missingSources: resp.missingSources,
        };
      }),
  });
}
