/**
 * @module commands/sessions
 *
 * `myclaude sessions` parent command and public exports.
 *
 * Subcommand implementations live under `commands/sessions/` so CLI wiring,
 * daemon-backed session actions, local registry inspection, and guarded GC
 * can evolve independently.
 */
import { defineCommand } from "citty";
import { sessionsDriftCommand } from "./sessions/drift.js";
import { sessionsGcCommand } from "./sessions/gc.js";
import { sessionsKillCommand } from "./sessions/kill.js";
import { sessionsListCommand } from "./sessions/list.js";
import { sessionsRelaunchCommand } from "./sessions/relaunch.js";
import { sessionsShowCommand } from "./sessions/show.js";

export type {
  SessionsBaseOptions,
  SessionsDriftOptions,
  SessionsGcOptions,
  SessionsGcResult,
  SessionsKillOptions,
  SessionsListOptions,
  SessionsRelaunchOptions,
  SessionsShowOptions,
} from "./sessions/types.js";

export { runSessionsDrift } from "./sessions/drift.js";
export { runSessionsGc } from "./sessions/gc.js";
export { runSessionsKill } from "./sessions/kill.js";
export { runSessionsList } from "./sessions/list.js";
export { runSessionsRelaunch } from "./sessions/relaunch.js";
export { runSessionsShow } from "./sessions/show.js";

export const sessionsCommand = defineCommand({
  meta: {
    name: "sessions",
    description: "List, inspect, and garbage-collect Agent Profile sessions",
  },
  subCommands: {
    list: sessionsListCommand,
    kill: sessionsKillCommand,
    relaunch: sessionsRelaunchCommand,
    drift: sessionsDriftCommand,
    show: sessionsShowCommand,
    gc: sessionsGcCommand,
  },
});
