import { findWorkspaceCandidates } from "@agent-profile/core";
import type { RespSetupMarkCompleteOkT, RespSystemBootstrapOkT } from "@agent-profile/ipc-protocol";
import { BrowserWindow, dialog } from "electron";
import { z } from "zod";
import type { BootstrapResult } from "../../shared/bridge.js";
import { CHANNELS } from "../../shared/channels.js";
import { withDaemonClient } from "../daemon/client-runner.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const NoPayload = z.undefined();
const WorkspaceCandidatesPayload = z.object({
  cwd: z.string().min(1),
});

export function registerSystemHandlers(context: RendererIpcBaseContext): void {
  registerSecureHandler({
    channel: CHANNELS.system.version,
    schema: NoPayload,
    context,
    handle: () => context.clientVersion,
  });

  registerSecureHandler({
    channel: CHANNELS.system.defaultCwd,
    schema: NoPayload,
    context,
    handle: () => context.startupCwd,
  });

  registerSecureHandler({
    channel: CHANNELS.system.pickDirectory,
    schema: NoPayload,
    context,
    handle: async (_payload, { event }) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions: { properties: Array<"openDirectory"> } = {
        properties: ["openDirectory"],
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });

  registerSecureHandler({
    channel: CHANNELS.system.workspaceCandidates,
    schema: WorkspaceCandidatesPayload,
    context,
    handle: (payload) => findWorkspaceCandidates(payload.cwd),
  });

  registerSecureHandler({
    channel: CHANNELS.system.bootstrap,
    schema: NoPayload,
    context,
    handle: async (): Promise<BootstrapResult> =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        const resp = await client.request<RespSystemBootstrapOkT>("system.bootstrap", {});
        return {
          firstRun: resp.firstRun,
          profileCount: resp.profileCount,
          setupCompleteMarker: resp.setupCompleteMarker,
          serverVersion: context.clientVersion,
          defaultCwd: context.startupCwd,
        };
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.setup.markComplete,
    schema: NoPayload,
    context,
    handle: async (): Promise<void> => {
      await withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        await client.request<RespSetupMarkCompleteOkT>("setup.markComplete", {});
      });
    },
  });
}
