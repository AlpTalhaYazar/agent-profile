/**
 * @module sessions/list
 *
 * Pure data service for `sessions list`.
 *
 * Reads the file-backed registry, optionally filters down to running sessions,
 * and returns the resulting `SessionRecord[]` newest-first.
 */
import { type SessionRecord, listSessionRecords } from "./registry.js";

/**
 * Input options for `sessionsListService`.
 */
export interface SessionsListInput {
  /** Absolute path to the configured sessions root (e.g. `~/.myclaude/sessions`). */
  sessionsRoot: string;
  /** When true, return only sessions whose status is `running`. */
  activeOnly?: boolean;
}

/**
 * List session records from the file-backed registry.
 *
 * @returns Records sorted by `createdAt` descending. Returns an empty array
 *   when the registry directory does not exist (treated as "no sessions
 *   recorded yet").
 */
export async function sessionsListService(input: SessionsListInput): Promise<SessionRecord[]> {
  const listInput: Parameters<typeof listSessionRecords>[0] = {
    sessionsRoot: input.sessionsRoot,
  };
  if (input.activeOnly !== undefined) listInput.activeOnly = input.activeOnly;
  return listSessionRecords(listInput);
}
