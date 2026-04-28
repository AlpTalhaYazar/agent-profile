import { describe, expect, it } from "vitest";
import { profileValidateService } from "../src/profile/validate.js";

describe("profileValidateService", () => {
  it("returns no issues for valid YAML content", () => {
    const result = profileValidateService({
      content: `
version: 1
env:
  EDITOR: nvim
`,
    });

    expect(result.issues).toEqual([]);
  });

  it("reports YAML parse issues", () => {
    const result = profileValidateService({
      content: "version: [",
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("yaml.parse");
  });

  it("reports schema issues for invalid objects", () => {
    const result = profileValidateService({
      content: { version: 2 },
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      path: "version",
      code: "invalid_value",
    });
  });
});
