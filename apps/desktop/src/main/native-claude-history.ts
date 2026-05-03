import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface NativeClaudeSessionRecord {
  source: "claude-native";
  sessionId: string;
  title?: string;
  cwd: string;
  status: "history";
  createdAt: string;
  updatedAt: string;
  attachable: false;
  resumable: true;
}

export interface ListNativeClaudeHistoryInput {
  cwd: string;
  projectsRoot?: string;
  env?: NodeJS.ProcessEnv;
  limit?: number;
}

interface NativeAccumulator {
  sessionId: string;
  cwd: string;
  title?: string;
  firstMs: number;
  lastMs: number;
}

const JSONL_EXTENSION = ".jsonl";
const DEFAULT_LIMIT = 250;

export async function listNativeClaudeHistory(
  input: ListNativeClaudeHistoryInput
): Promise<NativeClaudeSessionRecord[]> {
  const targetCwd = await canonicalPath(input.cwd);
  const projectsRoot = input.projectsRoot ?? defaultClaudeProjectsRoot(input.env ?? process.env);
  const files = await listJsonlFiles(projectsRoot, input.cwd);
  const sessions = new Map<string, NativeAccumulator>();
  const titles = new Map<string, string>();

  for (const file of files) {
    let fallbackMs = Date.now();
    try {
      fallbackMs = (await stat(file)).mtimeMs;
    } catch {
      // Keep the parser resilient if a history file disappears mid-scan.
    }

    const raw = await readFile(file, "utf8").catch(() => "");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = parseJsonObject(line);
      if (!event) continue;

      const sessionId = typeof event.sessionId === "string" ? event.sessionId : null;
      if (!sessionId) continue;

      const title = extractTitle(event);
      if (title) titles.set(sessionId, title);

      if (typeof event.cwd !== "string") continue;
      const eventCwd = await canonicalPath(event.cwd);
      if (eventCwd !== targetCwd) continue;

      const timestampMs =
        typeof event.timestamp === "string" ? Date.parse(event.timestamp) : Number.NaN;
      const eventMs = Number.isFinite(timestampMs) ? timestampMs : fallbackMs;
      const existing = sessions.get(sessionId);
      if (existing) {
        existing.firstMs = Math.min(existing.firstMs, eventMs);
        existing.lastMs = Math.max(existing.lastMs, eventMs);
      } else {
        sessions.set(sessionId, {
          sessionId,
          cwd: event.cwd,
          firstMs: eventMs,
          lastMs: eventMs,
        });
      }
    }
  }

  return [...sessions.values()]
    .map((session) => {
      const title = titles.get(session.sessionId);
      const record: NativeClaudeSessionRecord = {
        source: "claude-native",
        sessionId: session.sessionId,
        cwd: session.cwd,
        status: "history",
        createdAt: new Date(session.firstMs).toISOString(),
        updatedAt: new Date(session.lastMs).toISOString(),
        attachable: false,
        resumable: true,
      };
      if (title) record.title = title;
      return record;
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, input.limit ?? DEFAULT_LIMIT);
}

function defaultClaudeProjectsRoot(env: NodeJS.ProcessEnv): string {
  return join(env.HOME || homedir(), ".claude", "projects");
}

async function listJsonlFiles(projectsRoot: string, cwd: string): Promise<string[]> {
  const candidateDir = join(projectsRoot, encodeClaudeProjectDir(cwd));
  const candidateFiles = await listJsonlFilesInDir(candidateDir);
  if (candidateFiles.length > 0) return candidateFiles;
  return listJsonlFilesInDir(projectsRoot, true);
}

async function listJsonlFilesInDir(dir: string, recursive = false): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(JSONL_EXTENSION)) {
      files.push(path);
    } else if (recursive && entry.isDirectory()) {
      files.push(...(await listJsonlFilesInDir(path, true)));
    }
  }
  return files;
}

function encodeClaudeProjectDir(cwd: string): string {
  return resolve(cwd).replace(/[\\/]/g, "-");
}

const canonicalCache = new Map<string, string>();

async function canonicalPath(path: string): Promise<string> {
  const key = resolve(path);
  const cached = canonicalCache.get(key);
  if (cached) return cached;
  let value: string;
  try {
    value = await realpath(key);
  } catch {
    value = key;
  }
  canonicalCache.set(key, value);
  return value;
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractTitle(event: Record<string, unknown>): string | null {
  const type = event.type;
  const value =
    type === "custom-title"
      ? event.customTitle
      : type === "ai-title"
        ? event.aiTitle
        : type === "agent-name"
          ? event.agentName
          : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
