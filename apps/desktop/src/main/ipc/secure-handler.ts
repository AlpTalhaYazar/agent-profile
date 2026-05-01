import { type IpcMainInvokeEvent, ipcMain } from "electron";
import type { ZodType } from "zod";
import { assertValidSenderFrame, parseRendererPayload } from "../security.js";

export interface RendererIpcContext {
  event: IpcMainInvokeEvent;
  expectedFrameUrl: string;
  myClaudeHome: string;
  startupCwd: string;
  clientVersion: string;
}

export interface RendererIpcBaseContext {
  expectedFrameUrl: string;
  myClaudeHome: string;
  startupCwd: string;
  clientVersion: string;
}

export function registerSecureHandler<T>(opts: {
  channel: string;
  schema: ZodType<T>;
  context: RendererIpcBaseContext;
  handle: (payload: T, context: RendererIpcContext) => Promise<unknown> | unknown;
}): void {
  ipcMain.handle(opts.channel, async (event, payload) => {
    assertValidSenderFrame(event, opts.context.expectedFrameUrl, opts.channel);
    const parsed = parseRendererPayload(opts.schema, payload, opts.channel);
    return opts.handle(parsed, { ...opts.context, event });
  });
}
