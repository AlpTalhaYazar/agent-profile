/**
 * @file security-defaults.test.ts
 *
 * Verifies that {@link createSecureWindow} always passes the four hardening
 * invariants to BrowserWindow's constructor and that {@link assertHardening}
 * detects a stub whose `webPreferences` violate any of them.
 *
 * Avoids the real Electron runtime by injecting a stub `BrowserWindow`
 * constructor — we only care about the options we send through.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  type HardenedWebPreferences,
  assertHardening,
  assertValidSenderFrame,
  createSecureWindow,
  parseRendererPayload,
} from "../src/main/security.js";

interface StubWindow {
  __ctorOpts: { webPreferences?: HardenedWebPreferences } | undefined;
}

function makeStubCtor(): {
  // biome-ignore lint/suspicious/noExplicitAny: stub constructor for the test.
  Ctor: any;
  ctorSpy: ReturnType<typeof vi.fn>;
} {
  const ctorSpy = vi.fn();
  const Ctor = function (
    this: StubWindow,
    opts?: { webPreferences?: HardenedWebPreferences }
  ): void {
    ctorSpy(opts);
    this.__ctorOpts = opts;
  } as unknown as new (opts?: { webPreferences?: HardenedWebPreferences }) => StubWindow;
  return { Ctor, ctorSpy };
}

describe("createSecureWindow", () => {
  it("passes all four hardening invariants + the supplied preload to BrowserWindow", () => {
    const { Ctor, ctorSpy } = makeStubCtor();
    createSecureWindow({ preloadPath: "/tmp/preload.js" }, Ctor);

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    const call = ctorSpy.mock.calls[0]?.[0] as { webPreferences: HardenedWebPreferences };
    expect(call.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: "/tmp/preload.js",
    });
  });

  it("forwards width/height/show overrides through to the constructor", () => {
    const { Ctor, ctorSpy } = makeStubCtor();
    createSecureWindow({ preloadPath: "/p", width: 100, height: 200, show: true }, Ctor);
    const opts = ctorSpy.mock.calls[0]?.[0] as { width: number; height: number; show: boolean };
    expect(opts).toMatchObject({ width: 100, height: 200, show: true });
  });
});

describe("assertHardening", () => {
  it("accepts a window with all four invariants set", () => {
    expect(() =>
      assertHardening({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          preload: "/p",
        },
      })
    ).not.toThrow();
  });

  it("rejects a window with nodeIntegration: true", () => {
    expect(() =>
      assertHardening({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: true,
          sandbox: true,
          webSecurity: true,
          preload: "/p",
        },
      })
    ).toThrow(/nodeIntegration must be false/);
  });

  it("rejects a window with sandbox: false", () => {
    expect(() =>
      assertHardening({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: true,
          preload: "/p",
        },
      })
    ).toThrow(/sandbox must be true/);
  });

  it("rejects a window with contextIsolation: false", () => {
    expect(() =>
      assertHardening({
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          preload: "/p",
        },
      })
    ).toThrow(/contextIsolation must be true/);
  });

  it("rejects a window with webSecurity: false", () => {
    expect(() =>
      assertHardening({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: false,
          preload: "/p",
        },
      })
    ).toThrow(/webSecurity must be true/);
  });

  it("rejects a window missing preload", () => {
    expect(() =>
      assertHardening({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          preload: "",
        },
      })
    ).toThrow(/preload path must be set/);
  });

  it("rejects a window with undefined webPreferences", () => {
    expect(() => assertHardening({ webPreferences: undefined })).toThrow(/is undefined/);
  });
});

describe("renderer IPC security helpers", () => {
  it("accepts a matching sender frame", () => {
    expect(() =>
      assertValidSenderFrame(
        { senderFrame: { url: "file:///trusted/index.html" } } as never,
        "file:///trusted/index.html",
        "profile.show"
      )
    ).not.toThrow();
  });

  it("rejects a mismatched sender frame", () => {
    expect(() =>
      assertValidSenderFrame(
        { senderFrame: { url: "https://evil.example" } } as never,
        "file:///trusted/index.html",
        "profile.show"
      )
    ).toThrow(/sender frame mismatch/);
  });

  it("parses valid renderer payloads", () => {
    const parsed = parseRendererPayload(
      z.object({ role: z.string() }).strict(),
      { role: "backend" },
      "profile.show"
    );
    expect(parsed).toEqual({ role: "backend" });
  });
});
