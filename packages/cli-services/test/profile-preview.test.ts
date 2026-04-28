import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { profilePreviewService } from "../src/profile/preview.js";

const FIXTURES_HOME = resolve(new URL("./fixtures/home/.myclaude", import.meta.url).pathname);
const FIXTURES_PROJECT = resolve(new URL("./fixtures/project", import.meta.url).pathname);

describe("profilePreviewService", () => {
  it("returns a compact diff against the current effective config", () => {
    const result = profilePreviewService({
      home: FIXTURES_HOME,
      role: "backend",
      authProfileId: "work",
      cwd: FIXTURES_PROJECT,
      draft: {
        path: resolve(FIXTURES_PROJECT, ".myclaude", "roles", "backend.yml"),
        content: `
version: 1
env:
  PROJECT_DB_POOL: "30"
settings:
  profileMode: preview
`,
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.preview).not.toBeNull();
    expect(result.diff).toEqual(
      expect.arrayContaining([
        {
          path: "env.PROJECT_DB_POOL",
          change: "changed",
          before: "20",
          after: "30",
        },
        {
          path: "settings.profileMode",
          change: "added",
          after: "preview",
        },
      ])
    );
  });

  it("surfaces validation issues and skips preview resolution for invalid drafts", () => {
    const result = profilePreviewService({
      home: FIXTURES_HOME,
      role: "backend",
      authProfileId: "work",
      cwd: FIXTURES_PROJECT,
      draft: {
        path: resolve(FIXTURES_PROJECT, ".myclaude", "roles", "backend.yml"),
        content: { version: 2 },
      },
    });

    expect(result.issues).toHaveLength(1);
    expect(result.preview).toBeNull();
    expect(result.diff).toEqual([]);
    expect(result.current.effective).toBeTruthy();
  });
});
