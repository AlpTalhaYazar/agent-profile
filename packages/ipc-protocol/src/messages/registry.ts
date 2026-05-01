import { z } from "zod";

import {
  ReqAuthAdd,
  ReqAuthGetSecretRef,
  ReqAuthList,
  ReqAuthOAuthDetect,
  ReqAuthOAuthRefresh,
  ReqAuthOAuthStart,
  ReqAuthRemove,
  ReqAuthRotate,
  ReqAuthSetSecret,
  ReqAuthUpdateMeta,
  RespAuthAddOk,
  RespAuthGetSecretRefOk,
  RespAuthListOk,
  RespAuthOAuthDetectOk,
  RespAuthOAuthRefreshOk,
  RespAuthOAuthStartOk,
  RespAuthRemoveOk,
  RespAuthRotateOk,
  RespAuthSetSecretOk,
  RespAuthUpdateMetaOk,
} from "./auth.js";
import { ReqPersonaRender, RespPersonaRenderOk } from "./persona.js";
import {
  ReqProfileList,
  ReqProfilePreview,
  ReqProfileSave,
  ReqProfileShow,
  ReqProfileValidate,
  RespProfileListOk,
  RespProfilePreviewOk,
  RespProfileSaveOk,
  RespProfileShowOk,
  RespProfileValidateOk,
} from "./profile.js";
import {
  ReqSecretGet,
  ReqSecretsMigrate,
  RespSecretGetOk,
  RespSecretsMigrateOk,
} from "./secrets.js";
import {
  EvtSessionsEvent,
  ReqSessionEnd,
  ReqSessionStart,
  ReqSessionsDrift,
  ReqSessionsKill,
  ReqSessionsList,
  ReqSessionsRelaunch,
  ReqSessionsSubscribe,
  RespSessionEndOk,
  RespSessionStartOk,
  RespSessionsDriftOk,
  RespSessionsKillOk,
  RespSessionsListOk,
  RespSessionsRelaunchOk,
  RespSessionsSubscribeOk,
} from "./sessions.js";
import {
  ReqDaemonStatus,
  ReqDaemonStop,
  ReqHello,
  RespDaemonStatusOk,
  RespDaemonStopOk,
  RespError,
  type RespErrorT,
  RespHelloOk,
} from "./system.js";

const endpoint = <
  const TRequestKind extends string,
  const TResponseKind extends string,
  TRequest extends z.ZodType,
  TResponse extends z.ZodType,
>(entry: {
  requestKind: TRequestKind;
  request: TRequest;
  responseKind: TResponseKind;
  response: TResponse;
}) => entry;

export const endpoints = [
  endpoint({
    requestKind: "hello",
    request: ReqHello,
    responseKind: "hello.ok",
    response: RespHelloOk,
  }),
  endpoint({
    requestKind: "auth.list",
    request: ReqAuthList,
    responseKind: "auth.list.ok",
    response: RespAuthListOk,
  }),
  endpoint({
    requestKind: "auth.get-secret-ref",
    request: ReqAuthGetSecretRef,
    responseKind: "auth.get-secret-ref.ok",
    response: RespAuthGetSecretRefOk,
  }),
  endpoint({
    requestKind: "profile.show",
    request: ReqProfileShow,
    responseKind: "profile.show.ok",
    response: RespProfileShowOk,
  }),
  endpoint({
    requestKind: "profile.list",
    request: ReqProfileList,
    responseKind: "profile.list.ok",
    response: RespProfileListOk,
  }),
  endpoint({
    requestKind: "profile.validate",
    request: ReqProfileValidate,
    responseKind: "profile.validate.ok",
    response: RespProfileValidateOk,
  }),
  endpoint({
    requestKind: "profile.preview",
    request: ReqProfilePreview,
    responseKind: "profile.preview.ok",
    response: RespProfilePreviewOk,
  }),
  endpoint({
    requestKind: "sessions.list",
    request: ReqSessionsList,
    responseKind: "sessions.list.ok",
    response: RespSessionsListOk,
  }),
  endpoint({
    requestKind: "daemon.status",
    request: ReqDaemonStatus,
    responseKind: "daemon.status.ok",
    response: RespDaemonStatusOk,
  }),
  endpoint({
    requestKind: "daemon.stop",
    request: ReqDaemonStop,
    responseKind: "daemon.stop.ok",
    response: RespDaemonStopOk,
  }),
  endpoint({
    requestKind: "profile.save",
    request: ReqProfileSave,
    responseKind: "profile.save.ok",
    response: RespProfileSaveOk,
  }),
  endpoint({
    requestKind: "auth.add",
    request: ReqAuthAdd,
    responseKind: "auth.add.ok",
    response: RespAuthAddOk,
  }),
  endpoint({
    requestKind: "auth.setSecret",
    request: ReqAuthSetSecret,
    responseKind: "auth.setSecret.ok",
    response: RespAuthSetSecretOk,
  }),
  endpoint({
    requestKind: "auth.rotate",
    request: ReqAuthRotate,
    responseKind: "auth.rotate.ok",
    response: RespAuthRotateOk,
  }),
  endpoint({
    requestKind: "auth.remove",
    request: ReqAuthRemove,
    responseKind: "auth.remove.ok",
    response: RespAuthRemoveOk,
  }),
  endpoint({
    requestKind: "auth.update-meta",
    request: ReqAuthUpdateMeta,
    responseKind: "auth.update-meta.ok",
    response: RespAuthUpdateMetaOk,
  }),
  endpoint({
    requestKind: "auth.oauth.start",
    request: ReqAuthOAuthStart,
    responseKind: "auth.oauth.start.ok",
    response: RespAuthOAuthStartOk,
  }),
  endpoint({
    requestKind: "auth.oauth.refresh",
    request: ReqAuthOAuthRefresh,
    responseKind: "auth.oauth.refresh.ok",
    response: RespAuthOAuthRefreshOk,
  }),
  endpoint({
    requestKind: "auth.oauth.detect",
    request: ReqAuthOAuthDetect,
    responseKind: "auth.oauth.detect.ok",
    response: RespAuthOAuthDetectOk,
  }),
  endpoint({
    requestKind: "session.start",
    request: ReqSessionStart,
    responseKind: "session.start.ok",
    response: RespSessionStartOk,
  }),
  endpoint({
    requestKind: "session.end",
    request: ReqSessionEnd,
    responseKind: "session.end.ok",
    response: RespSessionEndOk,
  }),
  endpoint({
    requestKind: "secret.get",
    request: ReqSecretGet,
    responseKind: "secret.get.ok",
    response: RespSecretGetOk,
  }),
  endpoint({
    requestKind: "secrets.migrate",
    request: ReqSecretsMigrate,
    responseKind: "secrets.migrate.ok",
    response: RespSecretsMigrateOk,
  }),
  endpoint({
    requestKind: "sessions.kill",
    request: ReqSessionsKill,
    responseKind: "sessions.kill.ok",
    response: RespSessionsKillOk,
  }),
  endpoint({
    requestKind: "sessions.relaunch",
    request: ReqSessionsRelaunch,
    responseKind: "sessions.relaunch.ok",
    response: RespSessionsRelaunchOk,
  }),
  endpoint({
    requestKind: "sessions.drift",
    request: ReqSessionsDrift,
    responseKind: "sessions.drift.ok",
    response: RespSessionsDriftOk,
  }),
  endpoint({
    requestKind: "sessions.subscribe",
    request: ReqSessionsSubscribe,
    responseKind: "sessions.subscribe.ok",
    response: RespSessionsSubscribeOk,
  }),
  endpoint({
    requestKind: "persona.render",
    request: ReqPersonaRender,
    responseKind: "persona.render.ok",
    response: RespPersonaRenderOk,
  }),
] as const;

type Endpoint = (typeof endpoints)[number];

export type ReqT = z.infer<Endpoint["request"]>;
type RespOkT = z.infer<Endpoint["response"]>;
export type RespT = RespOkT | RespErrorT;

type ResponseKindByRequest = {
  [TEndpoint in Endpoint as TEndpoint["requestKind"]]: TEndpoint["responseKind"];
};

export const responseKindByRequest = Object.fromEntries(
  endpoints.map((entry) => [entry.requestKind, entry.responseKind])
) as ResponseKindByRequest;

const event = <
  const TEventKind extends string,
  const TChannel extends string,
  TEvent extends z.ZodType,
>(entry: {
  eventKind: TEventKind;
  event: TEvent;
  channel: TChannel;
}) => entry;

export const events = [
  event({
    eventKind: "sessions.event",
    event: EvtSessionsEvent,
    channel: "sessions",
  }),
] as const;

type EventRegistration = (typeof events)[number];

export type EvtT = z.infer<EventRegistration["event"]>;
export type SubscriptionChannel = EventRegistration["channel"];
export type FrameT = RespT | EvtT;

type EventChannelByKind = {
  [TEvent in EventRegistration as TEvent["eventKind"]]: TEvent["channel"];
};

export const eventChannelByKind = Object.fromEntries(
  events.map((entry) => [entry.eventKind, entry.channel])
) as EventChannelByKind;

const requestSchemas = endpoints.map((entry) => entry.request) as [
  Endpoint["request"],
  ...Endpoint["request"][],
];
const responseSchemas = [...endpoints.map((entry) => entry.response), RespError] as unknown as [
  Endpoint["response"],
  ...Array<Endpoint["response"] | typeof RespError>,
];
const eventSchemas = events.map((entry) => entry.event) as [
  EventRegistration["event"],
  ...EventRegistration["event"][],
];
const frameSchemas = [
  ...endpoints.map((entry) => entry.response),
  RespError,
  ...events.map((entry) => entry.event),
] as [
  Endpoint["response"],
  ...Array<Endpoint["response"] | typeof RespError | EventRegistration["event"]>,
];

export const Req = z.discriminatedUnion("kind", requestSchemas) as z.ZodType<ReqT>;
export const Resp = z.discriminatedUnion("kind", responseSchemas) as z.ZodType<RespT>;
export const Evt = z.discriminatedUnion("kind", eventSchemas) as z.ZodType<EvtT>;
export const Frame = z.discriminatedUnion("kind", frameSchemas) as z.ZodType<FrameT>;
