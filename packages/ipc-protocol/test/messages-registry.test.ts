import { describe, expect, it } from "vitest";

import { Evt, Frame, Req, Resp } from "../src/messages.js";
import { eventChannelByKind, responseKindByRequest } from "../src/messages/registry.js";

describe("message registry", () => {
  it("maps request kinds to ok response kinds", () => {
    expect(responseKindByRequest["auth.oauth.start"]).toBe("auth.oauth.start.ok");
    expect(responseKindByRequest["sessions.subscribe"]).toBe("sessions.subscribe.ok");
    expect(responseKindByRequest["persona.render"]).toBe("persona.render.ok");
    expect(responseKindByRequest["system.bootstrap"]).toBe("system.bootstrap.ok");
    expect(responseKindByRequest["setup.markComplete"]).toBe("setup.markComplete.ok");
  });

  it("maps event kinds to subscription channels", () => {
    expect(eventChannelByKind["sessions.event"]).toBe("sessions");
  });

  it("derives request, response, event, and frame unions from registered schemas", () => {
    expect(Req.safeParse({ id: "r-1", kind: "auth.oauth.detect" }).success).toBe(true);
    expect(
      Resp.safeParse({
        id: "r-1",
        kind: "auth.oauth.refresh.ok",
        refreshed: true,
      }).success
    ).toBe(true);
    expect(
      Evt.safeParse({
        kind: "sessions.event",
        sessionId: "s-1",
        event: "started",
        ts: 1,
      }).success
    ).toBe(true);
    expect(
      Frame.safeParse({
        kind: "sessions.event",
        sessionId: "s-1",
        event: "started",
        ts: 1,
      }).success
    ).toBe(true);
  });
});
