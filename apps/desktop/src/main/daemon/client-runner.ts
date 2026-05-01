import {
  type DaemonClient,
  connectToSocket,
  defaultSocketPath,
  readCookie,
} from "@agent-profile/ipc-protocol";

export async function withDaemonClient<T>(
  myClaudeHome: string,
  clientVersion: string,
  run: (client: DaemonClient) => Promise<T>
): Promise<T> {
  const client = await connectDaemonClient(myClaudeHome, clientVersion);
  try {
    return await run(client);
  } finally {
    client.close();
  }
}

export async function connectDaemonClient(
  myClaudeHome: string,
  clientVersion: string
): Promise<DaemonClient> {
  const cookie = await readCookie(myClaudeHome);
  const client = await connectToSocket({
    socketPath: defaultSocketPath(),
    clientVersion,
    cookie,
  });
  return client;
}
