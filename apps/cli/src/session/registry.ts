/**
 * @module session/registry
 *
 * Thin CLI-side shim around `@agent-profile/cli-services` session helpers.
 *
 * The parser, type definitions, path helpers, and atomic writers all live in
 * cli-services so the desktop daemon (which now also writes via
 * `sessions.kill` / `sessions.relaunch`) shares one source of truth. This
 * module re-exports the helpers and wraps the read paths to translate
 * `ServiceError` into `CliError` so the existing exit-code contract and
 * `instanceof CliError` assertions in CLI tests keep working.
 */
import {
  type ListSessionRecordsInput,
  type ReadSessionRecordInput,
  ServiceError,
  type SessionRecord,
  type UpdateSessionRecordInput,
  type WriteSessionRecordInput,
  listSessionRecords as listSessionRecordsService,
  readSessionRecord as readSessionRecordService,
  updateSessionRecord as updateSessionRecordService,
  writeSessionRecord as writeSessionRecordService,
} from "@agent-profile/cli-services";
import { CliError } from "../errors.js";

export {
  type ListSessionRecordsInput,
  type ReadSessionRecordInput,
  type SessionRecord,
  type SessionSpawnMetadata,
  type SessionStatus,
  type WriteSessionRecordInput,
  type UpdateSessionRecordInput,
  assertValidSessionId,
  parseSessionRecord,
  sessionRecordPath,
  sessionRegistryDir,
} from "@agent-profile/cli-services";

const REDACTED_ARG = "<redacted>";
const SENSITIVE_ARG_RE = /(api[-_]?key|token|secret|password|credential|auth)/i;

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

/** Write a full session record atomically (delegates to cli-services). */
export async function writeSessionRecord(input: WriteSessionRecordInput): Promise<void> {
  try {
    await writeSessionRecordService(input);
  } catch (err) {
    rethrowAsCli(err);
  }
}

/** Patch an existing record atomically and return the updated value. */
export async function updateSessionRecord(input: UpdateSessionRecordInput): Promise<SessionRecord> {
  try {
    return await updateSessionRecordService(input);
  } catch (err) {
    rethrowAsCli(err);
  }
}
