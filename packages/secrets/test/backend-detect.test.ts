/**
 * Tests for backend detection and `isBackendSecure` classification.
 *
 * We test the classification logic in isolation by constructing `KeyringBackend`
 * instances directly with known kinds — no real keychain is accessed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyLinuxError, detectLinuxDesktop, isBackendSecure } from "../src/backend/detect.js";
import { KeyringBackend } from "../src/backend/keyring.js";
import type { KeychainBackend } from "../src/backend/types.js";
import { MockBackend } from "./helpers/mock-backend.js";

describe("isBackendSecure", () => {
  const securePlatforms: KeychainBackend[] = [
    "keychain-macos",
    "credential-manager",
    "libsecret",
    "kwallet",
  ];
  const insecurePlatforms: KeychainBackend[] = ["basic-text", "unavailable"];

  for (const kind of securePlatforms) {
    it(`returns true for ${kind}`, () => {
      const backend = new MockBackend(kind);
      expect(isBackendSecure(backend)).toBe(true);
    });
  }

  for (const kind of insecurePlatforms) {
    it(`returns false for ${kind}`, () => {
      const backend = new MockBackend(kind);
      expect(isBackendSecure(backend)).toBe(false);
    });
  }
});

describe("KeyringBackend.isSecure()", () => {
  it("returns true for keychain-macos", () => {
    const b = new KeyringBackend("keychain-macos");
    expect(b.isSecure()).toBe(true);
  });

  it("returns true for credential-manager", () => {
    const b = new KeyringBackend("credential-manager");
    expect(b.isSecure()).toBe(true);
  });

  it("returns true for libsecret", () => {
    const b = new KeyringBackend("libsecret");
    expect(b.isSecure()).toBe(true);
  });

  it("returns true for kwallet", () => {
    const b = new KeyringBackend("kwallet");
    expect(b.isSecure()).toBe(true);
  });

  it("returns false for basic-text", () => {
    const b = new KeyringBackend("basic-text");
    expect(b.isSecure()).toBe(false);
  });

  it("returns false for unavailable", () => {
    const b = new KeyringBackend("unavailable");
    expect(b.isSecure()).toBe(false);
  });
});

describe("MockBackend kinds", () => {
  it("defaults to keychain-macos kind", () => {
    const b = new MockBackend();
    expect(b.kind).toBe("keychain-macos");
  });

  it("accepts any KeychainBackend kind", () => {
    const kinds: KeychainBackend[] = [
      "keychain-macos",
      "credential-manager",
      "libsecret",
      "kwallet",
      "basic-text",
      "unavailable",
    ];
    for (const kind of kinds) {
      const b = new MockBackend(kind);
      expect(b.kind).toBe(kind);
    }
  });
});

describe("classifyLinuxError", () => {
  it("returns unavailable for non-Error values", () => {
    expect(classifyLinuxError("not an error")).toBe("unavailable");
    expect(classifyLinuxError(null)).toBe("unavailable");
    expect(classifyLinuxError(42)).toBe("unavailable");
  });

  it("detects kwallet errors", () => {
    expect(classifyLinuxError(new Error("kwallet error occurred"))).toBe("kwallet");
    expect(classifyLinuxError(new Error("org.kde.kwalletd service error"))).toBe("kwallet");
  });

  it("detects libsecret errors", () => {
    expect(classifyLinuxError(new Error("secret service error"))).toBe("libsecret");
    expect(classifyLinuxError(new Error("org.freedesktop.secrets not available"))).toBe(
      "libsecret"
    );
    // "gnome-keyring" matches the libsecret check first (before "locked" is checked)
    expect(classifyLinuxError(new Error("gnome-keyring daemon error"))).toBe("libsecret");
    expect(classifyLinuxError(new Error("libsecret not found"))).toBe("libsecret");
  });

  it("detects basic-text errors", () => {
    expect(classifyLinuxError(new Error("basic backend in use"))).toBe("basic-text");
    expect(classifyLinuxError(new Error("using plaintext storage"))).toBe("basic-text");
  });

  it("detects unavailable from no entry (delegates to desktop detection)", () => {
    // "no entry" means the daemon is running but the key doesn't exist
    // Result depends on XDG_CURRENT_DESKTOP — we just verify it's one of the two
    const result = classifyLinuxError(new Error("no entry found"));
    expect(["libsecret", "kwallet"]).toContain(result);
  });

  it("returns unavailable for connection refused", () => {
    expect(classifyLinuxError(new Error("connection refused"))).toBe("unavailable");
  });

  it("returns unavailable for locked state", () => {
    expect(classifyLinuxError(new Error("keychain is locked"))).toBe("unavailable");
  });

  it("returns unavailable for unknown errors", () => {
    expect(classifyLinuxError(new Error("completely unknown error xyz123"))).toBe("unavailable");
  });
});

describe("detectLinuxDesktop", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.XDG_CURRENT_DESKTOP = process.env.XDG_CURRENT_DESKTOP;
    savedEnv.DESKTOP_SESSION = process.env.DESKTOP_SESSION;
  });

  afterEach(() => {
    if (savedEnv.XDG_CURRENT_DESKTOP === undefined) {
      process.env.XDG_CURRENT_DESKTOP = undefined;
    } else {
      process.env.XDG_CURRENT_DESKTOP = savedEnv.XDG_CURRENT_DESKTOP;
    }
    if (savedEnv.DESKTOP_SESSION === undefined) {
      process.env.DESKTOP_SESSION = undefined;
    } else {
      process.env.DESKTOP_SESSION = savedEnv.DESKTOP_SESSION;
    }
  });

  it("returns kwallet when XDG_CURRENT_DESKTOP=KDE", () => {
    process.env.XDG_CURRENT_DESKTOP = "KDE";
    process.env.DESKTOP_SESSION = undefined;
    expect(detectLinuxDesktop()).toBe("kwallet");
  });

  it("returns kwallet when DESKTOP_SESSION=plasma", () => {
    process.env.XDG_CURRENT_DESKTOP = undefined;
    process.env.DESKTOP_SESSION = "plasma";
    expect(detectLinuxDesktop()).toBe("kwallet");
  });

  it("returns libsecret for GNOME desktop", () => {
    process.env.XDG_CURRENT_DESKTOP = "GNOME";
    process.env.DESKTOP_SESSION = undefined;
    expect(detectLinuxDesktop()).toBe("libsecret");
  });

  it("returns libsecret when no desktop env is set", () => {
    process.env.XDG_CURRENT_DESKTOP = undefined;
    process.env.DESKTOP_SESSION = undefined;
    expect(detectLinuxDesktop()).toBe("libsecret");
  });
});
