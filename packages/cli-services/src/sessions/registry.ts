/**
 * @module sessions/registry
 *
 * File-backed session registry shared between the CLI and the daemon.
 *
 * Layout:
 *
 * ```
 * <sessionsRoot>/                       — created by persona-deployer
 * <dirname(sessionsRoot)>/session-registry/<sessionId>.json
 * ```
 *
 * Records are JSON, validated by a hand-rolled type-guard rather than Zod so
 * the helper binary keeps zero schema dependencies. The parser, the
 * `SessionRecord` type, and the path helpers (plus the atomic writers used by
 * the daemon's `sessions.kill` / `sessions.relaunch` handlers) all live here
 * so both readers and writers share one source of truth.
 *
 * Phase 2 milestone 5 added two optional fields — `launchHash` (set at
 * `session.start` for drift detection) and `relaunchedFrom` (set at
 * `sessions.relaunch` to keep audit/lineage). Both fields are forward-
 * compatible: the schema version stays `1`, and older readers ignore the
 * extra keys.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionRuntimePaths } from "@agent-profile/session-artifacts";
import { ServiceError } from "../errors.js";

/** File mode applied to every record (records may carry secret-shaped paths). */
const RECORD_MODE = 0o600;
/** Mode applied to the registry directory. */
const REGISTRY_DIR_MODE = 0o700;
/** JSON pretty-print indent — matches the CLI writer. */
const JSON_INDENT = 2;

/** Recognized session lifecycle states. */
export type SessionStatus = "running" | "exited" | "failed" | "dry-run";

/** Spawn metadata persisted alongside the session record. */
export interface SessionSpawnMetadata {
  command: string;
  args: string[];
}

/**
 * The full file-backed session record.
 *
 * Field meanings track `apps/cli/src/session/registry.ts` exactly so that both
 * packages can write, update, and read records interchangeably.
 *
 * `launchHash` and `relaunchedFrom` were added in Phase 2 milestone 5 and are
 * optional — older records simply omit them. The schema `version` is
 * deliberately kept at `1` because both fields are additive metadata; readers
 * that predate them ignore the extra keys.
 */
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
  /**
   * Launch-time hash of `(effective, provenance, scopeFiles)`. Captured by
   * the daemon at `session.start` and consumed by `sessions.drift` to detect
   * cascade drift since the session began. Optional for back-compat.
   */
  launchHash?: string;
  /**
   * When this record was minted by `sessions.relaunch`, the original
   * sessionId it was cloned from. Lets audit/lineage tooling reconstruct the
   * relaunch chain. Optional; absent on first-spawn records.
   */
  relaunchedFrom?: string;
}

/**
 * Strict character set for session ids. Mirrors the CLI's previous validator.
 * Rejects anything that could be used to escape the registry directory or
 * confuse path resolution.
 */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Throw a `ServiceError` if `sessionId` is unsafe to use as a filename. */
export function assertValidSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId) || sessionId.includes("..")) {
    throw new ServiceError("config-invalid", `Invalid session id "${sessionId}".`);
  }
}

/**
 * Return the sibling metadata directory for a configured sessions root.
 *
 * The registry is intentionally a sibling of the data directory so that
 * `cleanupSession` can remove a session's files without ever touching the
 * record (records are pruned/marked separately).
 */
export function sessionRegistryDir(sessionsRoot: string): string {
  return join(dirname(resolve(sessionsRoot)), "session-registry");
}

/** Return the on-disk JSON record path for a given session id. */
export function sessionRecordPath(sessionsRoot: string, sessionId: string): string {
  assertValidSessionId(sessionId);
  return join(sessionRegistryDir(sessionsRoot), `${sessionId}.json`);
}

/** Input for `readSessionRecord`. */
export interface ReadSessionRecordInput {
  sessionsRoot: string;
  sessionId: string;
}

/** Input for `listSessionRecords`. */
export interface ListSessionRecordsInput {
  /** Optional filter — when true, only `status: "running"` records are returned. */
  activeOnly?: boolean;
  sessionsRoot: string;
}

/**
 * Read a single session record, or throw `ServiceError("not-found")` when the
 * record file does not exist.
 *
 * @throws {ServiceError} `code: "not-found"` if the record is absent.
 * @throws {ServiceError} `code: "config-invalid"` if the JSON cannot be parsed
 *   or fails the type guard.
 */
export async function readSessionRecord(input: ReadSessionRecordInput): Promise<SessionRecord> {
  const path = sessionRecordPath(input.sessionsRoot, input.sessionId);
  try {
    const raw = await readFile(path, "utf8");
    return parseSessionRecord(raw, path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ServiceError("not-found", `Session "${input.sessionId}" was not found.`);
    }
    throw err;
  }
}

/**
 * List all readable session records, newest first.
 *
 * Records that fail to parse are silently skipped — a corrupt record on disk
 * should never break `myclaude sessions list`.
 *
 * @returns The records, sorted by `createdAt` descending.
 */
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
    } catch {
      // Silently skip unreadable / malformed records.
    }
  }

  records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (input.activeOnly) {
    return records.filter((r) => r.status === "running");
  }
  return records;
}

/** Parse and validate a raw JSON string into a `SessionRecord`. */
export function parseSessionRecord(raw: string, sourcePath: string): SessionRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new ServiceError(
      "config-invalid",
      `Invalid JSON in session record at ${sourcePath}.`,
      err
    );
  }
  if (!isSessionRecord(value)) {
    throw new ServiceError("config-invalid", `Invalid session record at ${sourcePath}.`);
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

// ─── Atomic writers (Phase 2 milestone 5) ────────────────────────────────────
//
// The CLI used to own these helpers privately because only `myclaude launch`
// wrote records. Phase 2 milestone 5 adds daemon-side `sessions.kill` and
// `sessions.relaunch` handlers that need the same atomic-write semantics, so
// the helpers move here and the CLI re-exports them as a thin shim.

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

/** Write a full session record atomically (temp file + rename). */
export async function writeSessionRecord(input: WriteSessionRecordInput): Promise<void> {
  await writeRecordFile(input.sessionsRoot, input.record);
}

/**
 * Patch an existing record atomically and return the updated value.
 *
 * `version`, `sessionId`, and `createdAt` are held immutable — only the
 * mutable fields can be patched.
 */
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
