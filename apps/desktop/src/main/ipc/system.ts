import { BrowserWindow, dialog } from "electron";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const NoPayload = z.undefined();

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
}
