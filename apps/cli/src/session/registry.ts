/**
 * @module session/registry
 *
 * File-backed launch/session metadata registry.
 *
 * This registry intentionally does not share the helper-facing `session.json`
 * file. Helper manifests contain capability/auth data; registry records contain
 * only operational metadata that is safe to show in `myclaude sessions`.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionRuntimePaths } from "@agent-profile/session-artifacts";
import { CliError, EXIT_CONFIG_INVALID } from "../errors.js";

const JSON_INDENT = 2;
const RECORD_MODE = 0o600;
const REGISTRY_DIR_MODE = 0o700;
const REDACTED_ARG = "<redacted>";
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SENSITIVE_ARG_RE = /(api[-_]?key|token|secret|password|credential|auth)/i;

export type SessionStatus = "running" | "exited" | "failed" | "dry-run";

export interface SessionSpawnMetadata {
  command: string;
  args: string[];
}

export interface SessionRecord {
  version: 1;
  sessionId: string;
  role: string;
  authProfileId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  retained: boolean;
  cleaned: boolean;
  runtimePaths: SessionRuntimePaths;
  spawn: SessionSpawnMetadata;
  status: SessionStatus;
  dryRun?: boolean;
  exitCode?: number;
  wallMs?: number;
  startedAt?: string;
  endedAt?: string;
}

export interface WriteSessionRecordInput {
  sessionsRoot: string;
  record: SessionRecord;
}

export interface UpdateSessionRecordInput {
  sessionsRoot: string;
  sessionId: string;
  patch: Partial<Omit<SessionRecord, "version" | "sessionId" | "createdAt">>;
}

export interface ListSessionRecordsInput {
  sessionsRoot: string;
}

export interface ReadSessionRecordInput {
  sessionsRoot: string;
  sessionId: string;
}

/** Return the sibling metadata directory for a configured sessions root. */
export function sessionRegistryDir(sessionsRoot: string): string {
  return join(dirname(resolve(sessionsRoot)), "session-registry");
}

/** Return the JSON record path for a session id. */
export function sessionRecordPath(sessionsRoot: string, sessionId: string): string {
  assertValidSessionId(sessionId);
  return join(sessionRegistryDir(sessionsRoot), `${sessionId}.json`);
}

/** Redact likely secret-bearing CLI argument values before persisting metadata. */
export function redactCommandArgs(args: string[]): string[] {
  const result: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      result.push(REDACTED_ARG);
      redactNext = false;
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex > 0 && SENSITIVE_ARG_RE.test(arg.slice(0, eqIndex))) {
      result.push(`${arg.slice(0, eqIndex + 1)}${REDACTED_ARG}`);
      continue;
    }

    if (SENSITIVE_ARG_RE.test(arg)) {
      result.push(arg);
      redactNext = true;
      continue;
    }

    result.push(arg);
  }

  return result;
}

/** Write a full session record atomically. */
export async function writeSessionRecord(input: WriteSessionRecordInput): Promise<void> {
  await writeRecordFile(input.sessionsRoot, input.record);
}

/** Read a single session record, or throw a `CliError` when it is absent/invalid. */
export async function readSessionRecord(input: ReadSessionRecordInput): Promise<SessionRecord> {
  const path = sessionRecordPath(input.sessionsRoot, input.sessionId);
  try {
    const raw = await readFile(path, "utf8");
    return parseSessionRecord(raw, path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(`Session "${input.sessionId}" was not found.`, EXIT_CONFIG_INVALID);
    }
    throw err;
  }
}

/** List all readable session records, newest first. */
export async function listSessionRecords(input: ListSessionRecordsInput): Promise<SessionRecord[]> {
  const dir = sessionRegistryDir(input.sessionsRoot);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const records: SessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, entry), "utf8");
      records.push(parseSessionRecord(raw, join(dir, entry)));
    } catch {}
  }

  records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return records;
}

/** Patch an existing record atomically and return the updated value. */
export async function updateSessionRecord(input: UpdateSessionRecordInput): Promise<SessionRecord> {
  const current = await readSessionRecord({
    sessionsRoot: input.sessionsRoot,
    sessionId: input.sessionId,
  });
  const updated: SessionRecord = {
    ...current,
    ...input.patch,
    sessionId: current.sessionId,
    version: 1,
    createdAt: current.createdAt,
  };
  await writeRecordFile(input.sessionsRoot, updated);
  return updated;
}

export function assertValidSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId) || sessionId.includes("..")) {
    throw new CliError(`Invalid session id "${sessionId}".`, EXIT_CONFIG_INVALID);
  }
}

function parseSessionRecord(raw: string, sourcePath: string): SessionRecord {
  const value: unknown = JSON.parse(raw);
  if (!isSessionRecord(value)) {
    throw new CliError(`Invalid session record at ${sourcePath}.`, EXIT_CONFIG_INVALID);
  }
  return value;
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    typeof value.sessionId === "string" &&
    typeof value.role === "string" &&
    typeof value.authProfileId === "string" &&
    typeof value.cwd === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.retained === "boolean" &&
    typeof value.cleaned === "boolean" &&
    isRuntimePaths(value.runtimePaths) &&
    isSpawnMetadata(value.spawn) &&
    isSessionStatus(value.status)
  );
}

function isRuntimePaths(value: unknown): value is SessionRuntimePaths {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionDir === "string" &&
    typeof value.claudeConfigDir === "string" &&
    typeof value.mcpConfig === "string" &&
    typeof value.settings === "string" &&
    isNullableString(value.apiKeyHelper) &&
    isNullableString(value.headersHelper) &&
    isNullableString(value.claudeMd)
  );
}

function isSpawnMetadata(value: unknown): value is SessionSpawnMetadata {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    Array.isArray(value.args) &&
    value.args.every((entry) => typeof entry === "string")
  );
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return value === "running" || value === "exited" || value === "failed" || value === "dry-run";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeRecordFile(sessionsRoot: string, record: SessionRecord): Promise<void> {
  assertValidSessionId(record.sessionId);
  const targetPath = sessionRecordPath(sessionsRoot, record.sessionId);
  await mkdir(dirname(targetPath), { recursive: true, mode: REGISTRY_DIR_MODE });
  await atomicWriteJson(targetPath, record);
}

async function atomicWriteJson(targetPath: string, value: SessionRecord): Promise<void> {
  const tmpPath = join(
    dirname(targetPath),
    `${basename(targetPath)}.tmp-${randomBytes(4).toString("hex")}`
  );
  const content = `${JSON.stringify(value, null, JSON_INDENT)}\n`;

  try {
    await writeFile(tmpPath, content, { encoding: "utf8", mode: RECORD_MODE });
    await rename(tmpPath, targetPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {
      // Preserve the original write/rename error.
    });
    throw err;
  }
}
