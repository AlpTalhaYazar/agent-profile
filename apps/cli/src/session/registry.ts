/**
 * @module session/registry
 *
 * File-backed launch/session metadata registry.
 *
 * The parser, the path helpers, and the `SessionRecord` type live in
 * `@agent-profile/cli-services` so the desktop daemon can use the exact same
 * code. This module wraps the read services with thin CLI-flavoured shims
 * that translate `ServiceError` into `CliError` (preserving the existing
 * exit-code contract and `instanceof CliError` assertions used by tests).
 *
 * Writes (`writeSessionRecord`, `updateSessionRecord`) stay local to the CLI:
 * the daemon only reads sessions in this round.
 *
 * This registry intentionally does not share the helper-facing `session.json`
 * file. Helper manifests contain capability/auth data; registry records
 * contain only operational metadata that is safe to show in
 * `myclaude sessions`.
 */
import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type ListSessionRecordsInput,
  type ReadSessionRecordInput,
  ServiceError,
  type SessionRecord,
  assertValidSessionId,
  listSessionRecords as listSessionRecordsService,
  readSessionRecord as readSessionRecordService,
  sessionRecordPath,
} from "@agent-profile/cli-services";
import { CliError } from "../errors.js";

export {
  type ListSessionRecordsInput,
  type ReadSessionRecordInput,
  type SessionRecord,
  type SessionSpawnMetadata,
  type SessionStatus,
  assertValidSessionId,
  parseSessionRecord,
  sessionRecordPath,
  sessionRegistryDir,
} from "@agent-profile/cli-services";

const JSON_INDENT = 2;
const RECORD_MODE = 0o600;
const REGISTRY_DIR_MODE = 0o700;
const REDACTED_ARG = "<redacted>";
const SENSITIVE_ARG_RE = /(api[-_]?key|token|secret|password|credential|auth)/i;

/** Input for `writeSessionRecord`. */
export interface WriteSessionRecordInput {
  sessionsRoot: string;
  record: SessionRecord;
}

/** Input for `updateSessionRecord`. */
export interface UpdateSessionRecordInput {
  sessionsRoot: string;
  sessionId: string;
  patch: Partial<Omit<SessionRecord, "version" | "sessionId" | "createdAt">>;
}

/**
 * Translate a thrown `ServiceError` into the matching `CliError`. Other errors
 * are rethrown as-is so unexpected failures (permission denied, etc.) still
 * propagate with their original stack.
 */
function rethrowAsCli(err: unknown): never {
  if (err instanceof ServiceError) {
    throw new CliError(err.message, err.exitCode);
  }
  throw err;
}

/** Read a session record, mapping service errors to `CliError`. */
export async function readSessionRecord(input: ReadSessionRecordInput): Promise<SessionRecord> {
  try {
    return await readSessionRecordService(input);
  } catch (err) {
    rethrowAsCli(err);
  }
}

/** List session records, mapping service errors to `CliError`. */
export async function listSessionRecords(input: ListSessionRecordsInput): Promise<SessionRecord[]> {
  try {
    return await listSessionRecordsService(input);
  } catch (err) {
    rethrowAsCli(err);
  }
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

async function writeRecordFile(sessionsRoot: string, record: SessionRecord): Promise<void> {
  try {
    assertValidSessionId(record.sessionId);
  } catch (err) {
    rethrowAsCli(err);
  }
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
