import type { EvtSessionsEventT } from "@agent-profile/ipc-protocol";
import { writeJson } from "../../output/json.js";
import type { CliTransport } from "../../transport/types.js";
import { formatSessionEvent } from "./format.js";

/** Long-poll-style session event stream (used by `sessions list --follow`). */
export async function streamSessionsEvents(
  transport: CliTransport,
  jsonMode: boolean
): Promise<void> {
  const events: EvtSessionsEventT[] = [];
  let pendingResolve: ((value: undefined) => void) | null = null;
  let stopped = false;

  const handle = await transport.sessionsSubscribe({
    onEvent: (event) => {
      events.push(event);
      pendingResolve?.(undefined);
      pendingResolve = null;
    },
  });

  const onSigint = (): void => {
    stopped = true;
    pendingResolve?.(undefined);
    pendingResolve = null;
  };
  process.once("SIGINT", onSigint);

  try {
    while (!stopped) {
      while (events.length > 0) {
        const event = events.shift();
        if (!event) break;
        if (jsonMode) {
          writeJson(event, false);
        } else {
          process.stdout.write(`${formatSessionEvent(event)}\n`);
        }
      }
      if (stopped) break;
      await new Promise<undefined>((resolve) => {
        pendingResolve = resolve;
      });
    }
  } finally {
    handle.unsubscribe();
    process.removeListener("SIGINT", onSigint);
  }
}
