import type { SafeStorageStore } from "@agent-profile/secrets";
import { app } from "electron";
import { STARTUP_CWD } from "../app/environment.js";
import { registerAuthHandlers } from "./auth.js";
import { registerOAuthHandlers } from "./oauth.js";
import { registerPersonaHandlers } from "./persona.js";
import { registerProfileHandlers } from "./profile.js";
import type { RendererIpcBaseContext } from "./secure-handler.js";
import { registerSessionHandlers } from "./sessions.js";
import { registerSkillsHandlers } from "./skills.js";
import { registerSystemHandlers } from "./system.js";

export interface RegisterRendererIpcHandlersOpts {
  expectedFrameUrl: string;
  myClaudeHome: string;
  startupCwd?: string;
  clientVersion?: string;
  store?: SafeStorageStore;
}

export function registerRendererIpcHandlers(opts: RegisterRendererIpcHandlersOpts): void {
  const context: RendererIpcBaseContext = {
    expectedFrameUrl: opts.expectedFrameUrl,
    myClaudeHome: opts.myClaudeHome,
    startupCwd: opts.startupCwd ?? STARTUP_CWD,
    clientVersion: opts.clientVersion ?? app.getVersion(),
  };

  registerSystemHandlers(context);
  registerAuthHandlers(context);
  registerOAuthHandlers(context, { store: opts.store });
  registerProfileHandlers(context);
  registerPersonaHandlers(context);
  registerSessionHandlers(context);
  registerSkillsHandlers(context);
}
