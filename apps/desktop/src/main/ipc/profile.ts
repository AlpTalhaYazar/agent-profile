import type {
  RespProfileCreateScopeOkT,
  RespProfileListOkT,
  RespProfilePreviewOkT,
  RespProfileSaveOkT,
  RespProfileShowOkT,
  RespProfileValidateOkT,
} from "@agent-profile/ipc-protocol";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels.js";
import { withDaemonClient } from "../daemon/client-runner.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const ProfileListPayload = z
  .object({
    cwd: z.string().min(1),
    roleFilter: z.string().min(1).optional(),
  })
  .strict();

const ProfileShowPayload = z
  .object({
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();

const ProfileValidatePayload = z.object({ content: z.unknown() }).strict();

const ProfilePreviewPayload = z
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

const ProfileSavePayload = z
  .object({
    path: z.string().min(1),
    content: z.unknown(),
  })
  .strict();

const ProfileCreateScopeMetadataPayload = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    purpose: z.string().min(1).max(280).optional(),
  })
  .strict();

const ProfileCreateScopePayload = z
  .object({
    location: z.enum(["global", "project"]),
    layerType: z.enum(["shared", "role"]),
    role: z.string().min(1).optional(),
    cwd: z.string().min(1),
    force: z.boolean().optional(),
    profile: ProfileCreateScopeMetadataPayload.optional(),
    authProfileId: z.string().min(1).optional(),
  })
  .strict();

export function registerProfileHandlers(context: RendererIpcBaseContext): void {
  registerSecureHandler({
    channel: CHANNELS.profile.list,
    schema: ProfileListPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespProfileListOkT>("profile.list", parsed);
        return { scopes: resp.scopes };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.profile.show,
    schema: ProfileShowPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespProfileShowOkT>("profile.show", parsed);
        return { effective: resp.effective, provenance: resp.provenance };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.profile.validate,
    schema: ProfileValidatePayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespProfileValidateOkT>("profile.validate", parsed);
        return { issues: resp.issues };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.profile.preview,
    schema: ProfilePreviewPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespProfilePreviewOkT>("profile.preview", parsed);
        return {
          issues: resp.issues,
          current: resp.current,
          preview: resp.preview,
          diff: resp.diff,
        };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.profile.save,
    schema: ProfileSavePayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespProfileSaveOkT>("profile.save", parsed);
        return { saved: resp.saved, path: resp.path };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.profile.createScope,
    schema: ProfileCreateScopePayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespProfileCreateScopeOkT>("profile.createScope", parsed);
        return {
          created: resp.created,
          path: resp.path,
          scope: resp.scope,
          role: resp.role,
          content: resp.content,
        };
      }),
  });
}
