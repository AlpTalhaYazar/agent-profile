import { describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors.js";
import { sessionsRelaunchService } from "../src/sessions/relaunch.js";

describe("sessionsRelaunchService", () => {
  it("returns the validated payload for a valid sessionId", () => {
    const result = sessionsRelaunchService({
      sessionsRoot: "/tmp/sessions",
      sessionId: "01HX-AAAA",
    });
    expect(result).toEqual({ sessionId: "01HX-AAAA" });
  });

  it("rejects an empty sessionId", () => {
    expect(() => sessionsRelaunchService({ sessionsRoot: "/tmp/sessions", sessionId: "" })).toThrow(
      ServiceError
    );
  });

  it("rejects a sessionId with disallowed characters", () => {
    expect(() =>
      sessionsRelaunchService({ sessionsRoot: "/tmp/sessions", sessionId: "with/slash" })
    ).toThrow(ServiceError);
  });
});
