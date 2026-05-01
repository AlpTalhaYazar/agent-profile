import { z } from "zod";

import { NonEmptyId, NonEmptyString, strictObject } from "./common.js";

export const ReqHello = strictObject({
  id: NonEmptyId,
  kind: z.literal("hello"),
  clientVersion: NonEmptyString,
  pid: z.number().int().nonnegative(),
  cookie: NonEmptyString,
});

export const ReqDaemonStatus = strictObject({
  id: NonEmptyId,
  kind: z.literal("daemon.status"),
});

export const ReqDaemonStop = strictObject({
  id: NonEmptyId,
  kind: z.literal("daemon.stop"),
  force: z.boolean().optional(),
});

export const RespHelloOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("hello.ok"),
  serverVersion: NonEmptyString,
  accepted: z.boolean(),
  features: z.array(z.string()),
});

export const RespDaemonStatusOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("daemon.status.ok"),
  pid: z.number().int().nonnegative(),
  socketPath: NonEmptyString,
  uptimeMs: z.number().nonnegative(),
  sessionCounts: strictObject({
    active: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

export const RespDaemonStopOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("daemon.stop.ok"),
});

export const RespError = strictObject({
  id: NonEmptyId,
  kind: z.literal("error"),
  code: z.enum(["AUTH", "AUTH_VERSION", "BAD_COOKIE", "NOT_FOUND", "BAD_REQUEST", "INTERNAL"]),
  reason: z.string(),
  requestKind: z.string().optional(),
});

export type ReqHelloT = z.infer<typeof ReqHello>;
export type ReqDaemonStatusT = z.infer<typeof ReqDaemonStatus>;
export type ReqDaemonStopT = z.infer<typeof ReqDaemonStop>;
export type RespHelloOkT = z.infer<typeof RespHelloOk>;
export type RespDaemonStatusOkT = z.infer<typeof RespDaemonStatusOk>;
export type RespDaemonStopOkT = z.infer<typeof RespDaemonStopOk>;
export type RespErrorT = z.infer<typeof RespError>;
export type IpcErrorCode = RespErrorT["code"];
