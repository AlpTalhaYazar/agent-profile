import type { RespAuthListOkT, RespAuthRemoveOkT } from "@agent-profile/ipc-protocol";
import { BrowserWindow, dialog } from "electron";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels.js";
import { withDaemonClient } from "../daemon/client-runner.js";
import { requestSecretInputViaMain } from "../native-secret-dialog.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const NoPayload = z.undefined();

const AuthAddPayload = z
  .object({
    spec: z
      .object({
        id: z.string().min(1),
        displayName: z.string().min(1).optional(),
        anthropic: z
          .object({
            mode: z.enum(["apiKey", "bedrock", "vertex", "gateway"]),
            secretRef: z.string().min(1),
          })
          .strict(),
        mcpSecretRefs: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    force: z.boolean().optional(),
  })
  .strict();

const AuthSetSecretPayload = z
  .object({
    profileId: z.string().min(1),
    name: z.string().min(1),
    value: z.string().min(1).max(8192),
    register: z.boolean().optional(),
  })
  .strict();

const AuthRotatePayload = z
  .object({
    profileId: z.string().min(1),
    name: z.string().min(1).optional(),
    value: z.string().min(1).max(8192),
  })
  .strict();

const AuthRemovePayload = z
  .object({
    profileId: z.string().min(1),
    yes: z.boolean().optional(),
  })
  .strict();

const AuthUpdateMetaPayload = z
  .object({
    profileId: z.string().min(1),
    displayName: z.string().optional(),
    oauth: z
      .object({
        email: z.string().optional(),
        orgName: z.string().optional(),
        planType: z.string().optional(),
        accessTokenExpiresAt: z.string().optional(),
        refreshTokenRef: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function registerAuthHandlers(context: RendererIpcBaseContext): void {
  registerSecureHandler({
    channel: CHANNELS.auth.list,
    schema: NoPayload,
    context,
    handle: () =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespAuthListOkT>("auth.list", {});
        return { profiles: resp.profiles };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.auth.add,
    schema: AuthAddPayload,
    context,
    handle: async (parsed, { event }) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const plaintext = await requestSecretInputViaMain({
        parent: parentWindow,
        title: `Add Claude credential "${parsed.spec.id}"`,
        label: "Anthropic API key",
      });
      if (plaintext === null) {
        throw new Error("auth.add: cancelled");
      }
      return withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const anthropicSecretB64 = Buffer.from(plaintext, "utf8").toString("base64");
        await client.request("auth.add", {
          spec: parsed.spec,
          anthropicSecretB64,
          ...(parsed.force !== undefined ? { force: parsed.force } : {}),
        });
        return { ok: true };
      });
    },
  });

  registerSecureHandler({
    channel: CHANNELS.auth.setSecret,
    schema: AuthSetSecretPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const valueB64 = Buffer.from(parsed.value, "utf8").toString("base64");
        await client.request("auth.setSecret", {
          authId: parsed.profileId,
          name: parsed.name,
          valueB64,
          ...(parsed.register !== undefined ? { register: parsed.register } : {}),
        });
        return { ok: true };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.auth.updateMeta,
    schema: AuthUpdateMetaPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const body: Record<string, unknown> = { authId: parsed.profileId };
        if (parsed.displayName !== undefined) body.displayName = parsed.displayName;
        if (parsed.oauth !== undefined) body.oauth = parsed.oauth;
        await client.request("auth.update-meta", body);
        return { ok: true };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.auth.rotate,
    schema: AuthRotatePayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const anthropicSecretB64 = Buffer.from(parsed.value, "utf8").toString("base64");
        await client.request("auth.rotate", {
          authId: parsed.profileId,
          anthropicSecretB64,
        });
        return { ok: true };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.auth.remove,
    schema: AuthRemovePayload,
    context,
    handle: async (parsed, { event }) => {
      if (!parsed.yes) {
        const parentWindow = BrowserWindow.fromWebContents(event.sender);
        const dialogOptions: Electron.MessageBoxOptions = {
          type: "warning",
          buttons: ["Cancel", "Remove"],
          defaultId: 0,
          cancelId: 0,
          title: "Remove auth profile",
          message: `Remove auth profile "${parsed.profileId}"?`,
          detail: "All keychain entries for this profile will be deleted. This cannot be undone.",
        };
        const choice = parentWindow
          ? await dialog.showMessageBox(parentWindow, dialogOptions)
          : await dialog.showMessageBox(dialogOptions);
        if (choice.response !== 1) {
          throw new Error("auth.remove: cancelled");
        }
      }
      return withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespAuthRemoveOkT>("auth.remove", {
          authId: parsed.profileId,
          ...(parsed.yes !== undefined ? { yes: parsed.yes } : {}),
        });
        return { failed: resp.failed };
      });
    },
  });
}
