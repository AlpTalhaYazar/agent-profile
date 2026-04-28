/**
 * @module commands/daemon
 *
 * `myclaude daemon` Citty subcommand group.
 *
 * Wires `start`, `stop`, and `status` into one parent. The parent itself
 * doesn't run anything — Citty surfaces the help summary when invoked
 * without a subcommand.
 */
import { defineCommand } from "citty";
import { daemonStartCommand } from "./start.js";
import { daemonStatusCommand } from "./status.js";
import { daemonStopCommand } from "./stop.js";

/** `myclaude daemon` parent command. */
export const daemonCommand = defineCommand({
  meta: {
    name: "daemon",
    description: "Manage the Electron Main daemon (start, stop, status)",
  },
  subCommands: {
    start: daemonStartCommand,
    stop: daemonStopCommand,
    status: daemonStatusCommand,
  },
});
