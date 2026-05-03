import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listNativeClaudeHistory } from "../src/main/native-claude-history.js";

describe("native Claude history", () => {
  it("lists workspace sessions from JSONL metadata without requiring message bodies", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-claude-history-"));
    const workspace = join(root, "workspace");
    const otherWorkspace = join(root, "other");
    const projectsRoot = join(root, ".claude", "projects");
    const projectDir = join(projectsRoot, "-workspace");
    await mkdir(workspace, { recursive: true });
    await mkdir(otherWorkspace, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    await writeFile(
      join(projectDir, "session-a.jsonl"),
      [
        JSON.stringify({ type: "custom-title", sessionId: "session-a", customTitle: "Build UI" }),
        JSON.stringify({
          type: "user",
          sessionId: "session-a",
          cwd: workspace,
          timestamp: "2026-05-01T10:00:00.000Z",
          message: { role: "user", content: "hidden" },
        }),
        "{not-json",
        JSON.stringify({
          type: "assistant",
          sessionId: "session-a",
          cwd: workspace,
          timestamp: "2026-05-01T10:05:00.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "hidden" }] },
        }),
        JSON.stringify({
          type: "user",
          sessionId: "session-b",
          cwd: otherWorkspace,
          timestamp: "2026-05-01T11:00:00.000Z",
        }),
      ].join("\n")
    );

    const sessions = await listNativeClaudeHistory({ cwd: workspace, projectsRoot });

    expect(sessions).toEqual([
      {
        source: "claude-native",
        sessionId: "session-a",
        title: "Build UI",
        cwd: workspace,
        status: "history",
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:05:00.000Z",
        attachable: false,
        resumable: true,
      },
    ]);
  });
});
