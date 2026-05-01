import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ReqAuthOAuthStart, type ReqAuthOAuthStartT } from "../src/messages/auth.js";
import { ReqPersonaRender, type ReqPersonaRenderT } from "../src/messages/persona.js";
import { ReqProfileShow, type ReqProfileShowT } from "../src/messages/profile.js";
import { ReqSecretGet, type ReqSecretGetT } from "../src/messages/secrets.js";
import { ReqSessionsSubscribe, type ReqSessionsSubscribeT } from "../src/messages/sessions.js";
import { ReqHello, type ReqHelloT } from "../src/messages/system.js";

describe("message subpath modules", () => {
  it("export representative schemas and inferred types from every domain", () => {
    const hello: ReqHelloT = {
      id: "c-1",
      kind: "hello",
      clientVersion: "0.1.0",
      pid: 1,
      cookie: "cookie",
    };
    const auth: ReqAuthOAuthStartT = {
      id: "c-2",
      kind: "auth.oauth.start",
      profileId: "default",
    };
    const profile: ReqProfileShowT = {
      id: "c-3",
      kind: "profile.show",
      role: "backend",
      authProfileId: "default",
      cwd: "/repo",
    };
    const sessions: ReqSessionsSubscribeT = { id: "c-4", kind: "sessions.subscribe" };
    const secret: ReqSecretGetT = {
      id: "c-5",
      kind: "secret.get",
      capabilityToken: "cap",
      name: "anthropic",
    };
    const persona: ReqPersonaRenderT = {
      id: "c-6",
      kind: "persona.render",
      role: "backend",
      authProfileId: "default",
      cwd: "/repo",
    };

    expect(ReqHello.safeParse(hello).success).toBe(true);
    expect(ReqAuthOAuthStart.safeParse(auth).success).toBe(true);
    expect(ReqProfileShow.safeParse(profile).success).toBe(true);
    expect(ReqSessionsSubscribe.safeParse(sessions).success).toBe(true);
    expect(ReqSecretGet.safeParse(secret).success).toBe(true);
    expect(ReqPersonaRender.safeParse(persona).success).toBe(true);
  });

  it("declares public package export entries for message subpaths", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, { types: string; import: string }>;
    };

    for (const subpath of [
      "./messages",
      "./messages/system",
      "./messages/auth",
      "./messages/profile",
      "./messages/sessions",
      "./messages/secrets",
      "./messages/persona",
    ]) {
      expect(pkg.exports[subpath]?.types).toMatch(/^\.\/dist\/messages/);
      expect(pkg.exports[subpath]?.import).toMatch(/^\.\/dist\/messages/);
    }
  });
});
