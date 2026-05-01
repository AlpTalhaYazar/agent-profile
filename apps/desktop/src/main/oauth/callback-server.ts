import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authentication Complete</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#09090f;color:#fafafa}
.card{text-align:center;padding:2rem;border-radius:12px;border:1px solid #3f3f46;background:#18181b}
h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#a1a1aa;margin:0}</style></head>
<body><div class="card"><h1>Authentication complete</h1><p>You can close this tab.</p></div></body></html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authentication Failed</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#09090f;color:#fafafa}
.card{text-align:center;padding:2rem;border-radius:12px;border:1px solid #7f1d1d;background:#18181b}
h1{font-size:1.25rem;margin:0 0 .5rem;color:#f87171}p{color:#a1a1aa;margin:0}</style></head>
<body><div class="card"><h1>Authentication failed</h1><p>Please try again.</p></div></body></html>`;

const TIMEOUT_MS = 5 * 60 * 1000;

export interface CallbackResult {
  code: string;
  state: string;
}

export async function startCallbackServer(): Promise<{
  port: number;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
}> {
  let resolveCallback: ((result: CallbackResult) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;
  let server: Server | null = null;

  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(ERROR_HTML);
      rejectCallback?.(new Error(`OAuth error: ${error}`));
      return;
    }

    if (code && state && resolveCallback) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SUCCESS_HTML);
      resolveCallback({ code, state });
      resolveCallback = null;
    } else {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(ERROR_HTML);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server!.listen(0, "127.0.0.1", () => resolve());
    server!.on("error", reject);
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const timer = setTimeout(() => {
    rejectCallback?.(new Error("OAuth callback timed out"));
    server?.close();
  }, TIMEOUT_MS);

  return {
    port,
    waitForCallback: () => callbackPromise,
    close: () => {
      clearTimeout(timer);
      server?.close();
    },
  };
}
