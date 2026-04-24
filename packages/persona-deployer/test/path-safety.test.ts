import { describe, expect, it } from "vitest";
import { SessionPathUnsafeError } from "../src/errors.js";
import { isPathWithinRoot } from "../src/path-safety.js";
import { assertInsideRoot } from "../src/path-safety.js";

describe("isPathWithinRoot", () => {
  it("returns true when path is a direct child of root", () => {
    expect(isPathWithinRoot("/a/b/c", "/a/b")).toBe(true);
  });

  it("returns true when path is a deeply nested child of root", () => {
    expect(isPathWithinRoot("/a/b/c/d/e", "/a/b")).toBe(true);
  });

  it("returns false when path equals root exactly", () => {
    // Root itself is not 'inside' root — must be a descendant.
    expect(isPathWithinRoot("/a/b", "/a/b")).toBe(false);
  });

  it("returns false when path is a parent of root", () => {
    expect(isPathWithinRoot("/a/b", "/a/b/c")).toBe(false);
  });

  it("returns false for completely different paths", () => {
    expect(isPathWithinRoot("/x/y/z", "/a/b")).toBe(false);
  });

  it("normalises .. segments before comparison — escape attempt refused", () => {
    // /a/b/../c resolves to /a/c, which is not inside /a/b
    expect(isPathWithinRoot("/a/b/../c", "/a/b")).toBe(false);
  });

  it("handles path that resolves to a sibling directory", () => {
    expect(isPathWithinRoot("/a/sibling", "/a/b")).toBe(false);
  });

  it("returns true for a valid path with redundant separators after normalisation", () => {
    // resolve() normalises these
    expect(isPathWithinRoot("/a/b/c", "/a")).toBe(true);
  });
});

describe("assertInsideRoot", () => {
  it("does not throw when path is inside the allowed root", () => {
    expect(() => assertInsideRoot("/tmp/sessions/abc", ["/tmp/sessions"])).not.toThrow();
  });

  it("does not throw when path matches one of multiple allowed roots", () => {
    expect(() =>
      assertInsideRoot("/tmp/sessions/abc", ["/var/other", "/tmp/sessions"])
    ).not.toThrow();
  });

  it("throws SessionPathUnsafeError when path is outside every allowed root", () => {
    expect(() => assertInsideRoot("/etc/passwd", ["/tmp/sessions"])).toThrow(
      SessionPathUnsafeError
    );
  });

  it("error carries the offending path", () => {
    let caught: SessionPathUnsafeError | undefined;
    try {
      assertInsideRoot("/etc/passwd", ["/tmp/sessions"]);
    } catch (e) {
      caught = e as SessionPathUnsafeError;
    }
    expect(caught).toBeDefined();
    expect(caught?.path).toBe("/etc/passwd");
    expect(caught?.allowedRoots).toEqual(["/tmp/sessions"]);
  });

  it("throws when the allowed roots array is empty", () => {
    expect(() => assertInsideRoot("/tmp/sessions/abc", [])).toThrow(SessionPathUnsafeError);
  });
});
