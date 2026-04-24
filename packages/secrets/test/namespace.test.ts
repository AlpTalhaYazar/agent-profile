import { describe, expect, it } from "vitest";
import { InvalidSecretRefError } from "../src/errors.js";
import { parseKeyringUri, toKeyringKey } from "../src/namespace.js";

describe("toKeyringKey", () => {
  it("formats a service+account pair under the agent-profile prefix", () => {
    expect(toKeyringKey("anthropic", "work")).toBe("agent-profile.anthropic.work");
  });

  it("handles hyphens in service and account names", () => {
    expect(toKeyringKey("github", "acme-org")).toBe("agent-profile.github.acme-org");
  });

  it("handles underscores in names", () => {
    expect(toKeyringKey("my_service", "my_account")).toBe("agent-profile.my_service.my_account");
  });

  it("handles mixed-case names", () => {
    expect(toKeyringKey("GitHub", "MyOrg")).toBe("agent-profile.GitHub.MyOrg");
  });

  it("throws InvalidSecretRefError when service name contains a slash", () => {
    expect(() => toKeyringKey("svc/invalid", "acct")).toThrow(InvalidSecretRefError);
  });

  it("throws InvalidSecretRefError when account name contains a slash", () => {
    expect(() => toKeyringKey("svc", "acct/invalid")).toThrow(InvalidSecretRefError);
  });

  it("throws InvalidSecretRefError when service starts with a non-alphanumeric character", () => {
    expect(() => toKeyringKey("-bad", "acct")).toThrow(InvalidSecretRefError);
  });

  it("throws InvalidSecretRefError when service is empty", () => {
    expect(() => toKeyringKey("", "acct")).toThrow(InvalidSecretRefError);
  });
});

describe("parseKeyringUri", () => {
  it("parses a valid keyring URI", () => {
    expect(parseKeyringUri("keyring://anthropic/work")).toEqual({
      service: "anthropic",
      account: "work",
    });
  });

  it("parses a URI with hyphens", () => {
    expect(parseKeyringUri("keyring://github/acme-org")).toEqual({
      service: "github",
      account: "acme-org",
    });
  });

  it("roundtrips with toKeyringKey", () => {
    const uri = "keyring://postgres/acme-prod";
    const { service, account } = parseKeyringUri(uri);
    expect(toKeyringKey(service, account)).toBe("agent-profile.postgres.acme-prod");
  });

  it("throws InvalidSecretRefError for bare keyring:// with no service", () => {
    expect(() => parseKeyringUri("keyring://")).toThrow(InvalidSecretRefError);
  });

  it("throws InvalidSecretRefError for missing account part", () => {
    expect(() => parseKeyringUri("keyring://svc")).toThrow(InvalidSecretRefError);
  });

  it("throws InvalidSecretRefError for wrong scheme", () => {
    expect(() => parseKeyringUri("keyring:anthropic/work")).toThrow(InvalidSecretRefError);
  });

  it("throws InvalidSecretRefError for http:// URI", () => {
    expect(() => parseKeyringUri("http://svc/acct")).toThrow(InvalidSecretRefError);
  });

  it("throws InvalidSecretRefError when account has invalid characters", () => {
    expect(() => parseKeyringUri("keyring://svc/acct/extra")).toThrow(InvalidSecretRefError);
  });
});
