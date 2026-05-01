import type { EvtSessionsEventT } from "@agent-profile/ipc-protocol";
import type { SessionRecord } from "../../session/registry.js";
import type { SessionsGcResult } from "./types.js";

export function formatSessionEvent(event: EvtSessionsEventT): string {
  const ts = new Date(event.ts).toISOString();
  const exitCode = event.exitCode !== undefined ? ` exitCode=${event.exitCode}` : "";
  return `[${ts}] ${event.sessionId} ${event.event}${exitCode}`;
}

export function formatSessionList(records: SessionRecord[], nowMs: number): string {
  if (records.length === 0) {
    return "No sessions found.";
  }

  const lines = [
    `${"ID".padEnd(38)}${"ROLE".padEnd(14)}${"AUTH".padEnd(14)}${"STARTED".padEnd(12)}${"STATUS".padEnd(10)}DIR`,
  ];
  for (const record of records) {
    const dir = record.cleaned ? "(cleaned)" : record.runtimePaths.sessionDir;
    lines.push(
      `${record.sessionId.padEnd(38)}${record.role.padEnd(14)}${record.authProfileId.padEnd(14)}${formatAge(
        nowMs - Date.parse(record.createdAt)
      ).padEnd(12)}${record.status.padEnd(10)}${dir}`
    );
  }
  return lines.join("\n");
}

export function formatSessionShow(record: SessionRecord): string {
  const args = record.spawn.args.length > 0 ? record.spawn.args.join(" ") : "(none)";
  const lines = [
    `ID:       ${record.sessionId}`,
    `Role:     ${record.role}`,
    `Auth:     ${record.authProfileId}`,
    `Cwd:      ${record.cwd}`,
    `Created:  ${record.createdAt}`,
    `Updated:  ${record.updatedAt}`,
    `Status:   ${record.status}`,
    `Retained: ${record.retained ? "yes" : "no"}`,
    `Cleaned:  ${record.cleaned ? "yes" : "no"}`,
    `Dir:      ${record.cleaned ? "(cleaned)" : record.runtimePaths.sessionDir}`,
    `Command:  ${record.spawn.command} ${args}`,
  ];
  if (record.exitCode !== undefined) lines.push(`Exit:     ${record.exitCode}`);
  if (record.wallMs !== undefined) lines.push(`Wall ms:  ${record.wallMs}`);
  lines.push(`mcp.json: ${record.runtimePaths.mcpConfig}`);
  lines.push(`settings: ${record.runtimePaths.settings}`);
  return lines.join("\n");
}

export function formatGcResult(result: SessionsGcResult): string {
  const lines: string[] = [];
  const retainedCount = result.cleaned.filter((e) => e.retained).length;
  const summary =
    retainedCount > 0
      ? `Cleaned ${result.cleaned.length} session dir(s) (${retainedCount} retained).`
      : `Cleaned ${result.cleaned.length} session dir(s).`;
  lines.push(summary);
  for (const entry of result.cleaned) {
    const tag = entry.retained ? " [retained]" : "";
    lines.push(`  ${entry.sessionId}${tag} ${entry.sessionDir}`);
  }
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${result.skipped.length} session dir(s).`);
    for (const entry of result.skipped) {
      lines.push(`  ${entry.sessionId} ${entry.reason} ${entry.sessionDir}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "now";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
