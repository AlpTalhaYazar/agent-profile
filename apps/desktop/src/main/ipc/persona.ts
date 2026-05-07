import type { RespPersonaPreviewOkT, RespPersonaRenderOkT } from "@agent-profile/ipc-protocol";
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

const PersonaPreviewPayload = z
  .object({
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
    draft: z
      .object({
        path: z.string().min(1),
        content: z.unknown(),
      })
      .strict(),
  })
  .strict();

const PERSONA_PREVIEW_FAILURE = {
  code: "preview-failed",
  message:
    "Skills & Persona preview could not be prepared. Review the selected assets and try again.",
  retryable: true,
} as const;

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

  registerSecureHandler({
    channel: CHANNELS.persona.preview,
    schema: PersonaPreviewPayload,
    context,
    handle: async (parsed) => {
      try {
        return await withDaemonClient(
          context.myClaudeHome,
          context.clientVersion,
          async (client) => {
            const resp = await client.request<RespPersonaPreviewOkT>("persona.preview", parsed);
            return {
              issues: resp.issues,
              preview: resp.preview,
              failure: resp.failure,
            };
          }
        );
      } catch {
        return {
          issues: [],
          preview: null,
          failure: PERSONA_PREVIEW_FAILURE,
        };
      }
    },
  });
}
