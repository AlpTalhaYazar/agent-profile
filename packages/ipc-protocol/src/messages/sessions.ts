import { z } from "zod";

import { NonEmptyId, NonEmptyString, strictObject } from "./common.js";

export const ReqSessionsList = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.list"),
  activeOnly: z.boolean().optional(),
});

export const ReqSessionStart = strictObject({
  id: NonEmptyId,
  kind: z.literal("session.start"),
  sessionId: NonEmptyString,
  pid: z.number().int().nonnegative(),
  authProfileId: NonEmptyString.optional(),
  ttlMs: z.number().int().positive().optional(),
  launchHash: NonEmptyString.optional(),
});

export const ReqSessionEnd = strictObject({
  id: NonEmptyId,
  kind: z.literal("session.end"),
  sessionId: NonEmptyString,
});

export const ReqSessionsKill = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.kill"),
  sessionId: NonEmptyString,
  signal: z.enum(["SIGTERM", "SIGKILL"]).optional(),
});

export const ReqSessionsRelaunch = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.relaunch"),
  sessionId: NonEmptyString,
});

export const ReqSessionsDrift = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.drift"),
  sessionId: NonEmptyString,
});

export const ReqSessionsSubscribe = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.subscribe"),
});

export const SessionRecordEnrichment = z
  .object({
    liveCapability: z.boolean().optional(),
    capabilityExpiresAtMs: z.number().int().nonnegative().optional(),
    processAlive: z.boolean().optional(),
  })
  .passthrough();

export const RespSessionsListOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.list.ok"),
  sessions: z.array(z.unknown()),
});

export const RespSessionStartOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("session.start.ok"),
  capabilityToken: NonEmptyString,
  expiresAtMs: z.number().int().nonnegative(),
});

export const RespSessionEndOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("session.end.ok"),
});

export const RespSessionsKillOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.kill.ok"),
  killed: z.boolean(),
  exitCode: z.number().int().optional(),
});

export const RespSessionsRelaunchOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.relaunch.ok"),
  sessionId: NonEmptyString,
  capabilityToken: NonEmptyString,
  expiresAtMs: z.number().int().nonnegative(),
  relaunchedFrom: NonEmptyString,
});

export const RespSessionsDriftOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.drift.ok"),
  drifted: z.boolean(),
  scopesChanged: z.array(z.string()),
  oldHash: z.string(),
  newHash: z.string(),
});

export const RespSessionsSubscribeOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("sessions.subscribe.ok"),
  subscribed: z.literal(true),
});

export const EvtSessionsEvent = strictObject({
  kind: z.literal("sessions.event"),
  sessionId: NonEmptyString,
  event: z.enum(["started", "idle", "exited", "killed", "drifted"]),
  exitCode: z.number().int().optional(),
  ts: z.number(),
});

export type ReqSessionsListT = z.infer<typeof ReqSessionsList>;
export type ReqSessionStartT = z.infer<typeof ReqSessionStart>;
export type ReqSessionEndT = z.infer<typeof ReqSessionEnd>;
export type ReqSessionsKillT = z.infer<typeof ReqSessionsKill>;
export type ReqSessionsRelaunchT = z.infer<typeof ReqSessionsRelaunch>;
export type ReqSessionsDriftT = z.infer<typeof ReqSessionsDrift>;
export type ReqSessionsSubscribeT = z.infer<typeof ReqSessionsSubscribe>;
export type SessionRecordEnrichmentT = z.infer<typeof SessionRecordEnrichment>;
export type RespSessionsListOkT = z.infer<typeof RespSessionsListOk>;
export type RespSessionStartOkT = z.infer<typeof RespSessionStartOk>;
export type RespSessionEndOkT = z.infer<typeof RespSessionEndOk>;
export type RespSessionsKillOkT = z.infer<typeof RespSessionsKillOk>;
export type RespSessionsRelaunchOkT = z.infer<typeof RespSessionsRelaunchOk>;
export type RespSessionsDriftOkT = z.infer<typeof RespSessionsDriftOk>;
export type RespSessionsSubscribeOkT = z.infer<typeof RespSessionsSubscribeOk>;
export type EvtSessionsEventT = z.infer<typeof EvtSessionsEvent>;
