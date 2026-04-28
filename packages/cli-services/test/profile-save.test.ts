import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors.js";
import { profileSaveService } from "../src/profile/save.js";

describe("profileSaveService", () => {
  it("writes canonical YAML to an allowlisted project scope path", () => {
    const root = mkdtempSync(join(tmpdir(), "profile-save-"));
    const home = join(root, ".myclaude");
    const targetPath = join(root, "repo", ".myclaude", "roles", "backend.yml");

    const result = profileSaveService({
      home,
      path: targetPath,
      content: {
        version: 1,
        settings: { beta: true, alpha: true },
        env: { ZED: "1", APPLE: "2" },
      },
    });

    const saved = readFileSync(targetPath, "utf8");
    expect(result).toEqual({ saved: true, path: targetPath });
    expect(saved).toContain("version: 1");
    expect(saved).toMatch(/env:\s+APPLE:/m);
    expect(saved.indexOf("APPLE:")).toBeLessThan(saved.indexOf("ZED:"));
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects paths outside the scope allowlist", () => {
    const root = mkdtempSync(join(tmpdir(), "profile-save-"));
    const home = join(root, ".myclaude");

    expect(() =>
      profileSaveService({
        home,
        path: join(root, "repo", ".myclaude", "persona", "backend.md"),
        content: { version: 1 },
      })
    ).toThrow(ServiceError);

    rmSync(root, { recursive: true, force: true });
  });
});
