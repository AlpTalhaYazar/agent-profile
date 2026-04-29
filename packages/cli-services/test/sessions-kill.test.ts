import { describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors.js";
import { sessionsKillService } from "../src/sessions/kill.js";

describe("sessionsKillService", () => {
  it("returns the validated payload for a minimal request", () => {
    const result = sessionsKillService({ sessionsRoot: "/tmp/sessions", sessionId: "01HX-AAAA" });
    expect(result).toEqual({ sessionId: "01HX-AAAA" });
  });

  it("preserves an explicit signal selection", () => {
    const result = sessionsKillService({
      sessionsRoot: "/tmp/sessions",
      sessionId: "01HX-AAAA",
      signal: "SIGKILL",
    });
    expect(result.signal).toBe("SIGKILL");
  });

  it("rejects an empty sessionId", () => {
    expect(() => sessionsKillService({ sessionsRoot: "/tmp/sessions", sessionId: "" })).toThrow(
      ServiceError
    );
  });

  it("rejects a sessionId with disallowed characters", () => {
    expect(() =>
      sessionsKillService({ sessionsRoot: "/tmp/sessions", sessionId: "../escape" })
    ).toThrow(ServiceError);
  });
});
