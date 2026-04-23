import { describe, expect, it } from "vitest";
import type { ScopeDocT } from "../src/schema/index.js";
import { extractSecretRefs, parseSecretRef } from "../src/secret-refs/parser.js";

describe("parseSecretRef", () => {
  it("parses keyring:// URI correctly", () => {
    const ref = parseSecretRef("keyring://anthropic/work");
    expect(ref).toEqual({
      kind: "keyring",
      service: "anthropic",
      account: "work",
      raw: "keyring://anthropic/work",
    });
  });

  it("parses keyring:// with complex service and account names", () => {
    const ref = parseSecretRef("keyring://my-service/my-account-123");
    expect(ref).not.toBeNull();
    expect(ref?.kind).toBe("keyring");
    if (ref?.kind === "keyring") {
      expect(ref.service).toBe("my-service");
      expect(ref.account).toBe("my-account-123");
    }
  });

  it("parses ${secret:name} form", () => {
    const ref = parseSecretRef("${secret:github.pat}");
    expect(ref).toEqual({
      kind: "secret",
      name: "github.pat",
      raw: "${secret:github.pat}",
    });
  });

  it("parses ${secret:name} with dotted path", () => {
    const ref = parseSecretRef("${secret:postgres.acme-prod}");
    expect(ref).not.toBeNull();
    expect(ref?.kind).toBe("secret");
    if (ref?.kind === "secret") {
      expect(ref.name).toBe("postgres.acme-prod");
    }
  });

  it("parses ${env:VAR} form", () => {
    const ref = parseSecretRef("${env:HOME}");
    expect(ref).toEqual({
      kind: "env",
      name: "HOME",
      raw: "${env:HOME}",
    });
  });

  it("parses ${env:VAR} with underscore variable name", () => {
    const ref = parseSecretRef("${env:MY_ENV_VAR}");
    expect(ref).not.toBeNull();
    expect(ref?.kind).toBe("env");
    if (ref?.kind === "env") {
      expect(ref.name).toBe("MY_ENV_VAR");
    }
  });

  it("returns null for a plain string (no ref form)", () => {
    const ref = parseSecretRef("plain string");
    expect(ref).toBeNull();
  });

  it("returns null for an empty string", () => {
    const ref = parseSecretRef("");
    expect(ref).toBeNull();
  });

  it("returns null for a URL that is not a keyring URI", () => {
    const ref = parseSecretRef("https://example.com");
    expect(ref).toBeNull();
  });

  it("returns null for a partial ${secret} without name", () => {
    const ref = parseSecretRef("${secret:}");
    expect(ref).toBeNull();
  });

  it("returns null for malformed ${env:} without name", () => {
    const ref = parseSecretRef("${env:}");
    expect(ref).toBeNull();
  });
});

describe("extractSecretRefs", () => {
  it("extracts refs from top-level env", () => {
    const doc: ScopeDocT = {
      version: 1,
      mcpServers: {},
      env: {
        API_KEY: "${secret:my.key}",
        PLAIN: "plain-value",
      },
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
    };
    const refs = extractSecretRefs(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.jsonPath).toBe("env.API_KEY");
    expect(refs[0]?.ref.kind).toBe("secret");
  });

  it("extracts refs from mcpServer env", () => {
    const doc: ScopeDocT = {
      version: 1,
      mcpServers: {
        postgres: {
          type: "stdio",
          command: "npx",
          args: [],
          env: {
            DATABASE_URL: "${secret:postgres.prod}",
            PLAIN: "not-a-ref",
          },
          enabled: true,
          __merge: "replace",
        },
      },
      env: {},
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
    };
    const refs = extractSecretRefs(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.jsonPath).toBe("mcpServers.postgres.env.DATABASE_URL");
    expect(refs[0]?.ref.kind).toBe("secret");
  });

  it("extracts refs from mcpServer headers", () => {
    const doc: ScopeDocT = {
      version: 1,
      mcpServers: {
        figma: {
          type: "http",
          url: "https://figma.example.com",
          headers: {
            Authorization: "${secret:figma.token}",
          },
          enabled: true,
          __merge: "replace",
        },
      },
      env: {},
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
    };
    const refs = extractSecretRefs(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.jsonPath).toBe("mcpServers.figma.headers.Authorization");
  });

  it("returns empty array when no refs are found", () => {
    const doc: ScopeDocT = {
      version: 1,
      mcpServers: {},
      env: { PLAIN: "value" },
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
    };
    const refs = extractSecretRefs(doc);
    expect(refs).toHaveLength(0);
  });

  it("extracts ${env:VAR} refs from mcpServer env", () => {
    const doc: ScopeDocT = {
      version: 1,
      mcpServers: {
        filesystem: {
          type: "stdio",
          command: "npx",
          args: [],
          env: {
            ROOTS: "${env:PWD}/src",
          },
          enabled: true,
          __merge: "replace",
        },
      },
      env: {},
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
    };
    const refs = extractSecretRefs(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.ref.kind).toBe("env");
    expect(refs[0]?.jsonPath).toBe("mcpServers.filesystem.env.ROOTS");
  });

  it("extracts multiple refs from a complex document", () => {
    const doc: ScopeDocT = {
      version: 1,
      mcpServers: {
        github: {
          type: "stdio",
          command: "npx",
          args: [],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "${secret:github.pat}",
          },
          enabled: true,
          __merge: "replace",
        },
        figma: {
          type: "http",
          url: "https://figma.example.com",
          headers: {
            Authorization: "${secret:figma.token}",
          },
          enabled: true,
          __merge: "replace",
        },
      },
      env: {
        API_SECRET: "${secret:global.api}",
      },
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
    };
    const refs = extractSecretRefs(doc);
    expect(refs).toHaveLength(3);
    const paths = refs.map((r) => r.jsonPath);
    expect(paths).toContain("mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(paths).toContain("mcpServers.figma.headers.Authorization");
    expect(paths).toContain("env.API_SECRET");
  });

  it("extracts refs from server args", () => {
    const doc: ScopeDocT = {
      version: 1,
      mcpServers: {
        tool: {
          type: "stdio",
          command: "npx",
          args: ["${secret:tool.token}", "plain-arg"],
          env: {},
          enabled: true,
          __merge: "replace",
        },
      },
      env: {},
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
    };
    const refs = extractSecretRefs(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.jsonPath).toBe("mcpServers.tool.args[0]");
    expect(refs[0]?.ref.kind).toBe("secret");
  });

  it("extracts refs from server url (embedded env ref)", () => {
    const doc: ScopeDocT = {
      version: 1,
      mcpServers: {
        remote: {
          type: "sse",
          url: "https://example.com",
          headers: {},
          enabled: true,
          __merge: "replace",
        },
        "remote-with-ref": {
          type: "http",
          url: "https://example.com",
          headers: {
            Authorization: "${secret:remote.token}",
          },
          enabled: true,
          __merge: "replace",
        },
      },
      env: {},
      settings: {},
      persona: undefined,
      use: [],
      disabledServers: [],
    };
    const refs = extractSecretRefs(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.jsonPath).toBe("mcpServers.remote-with-ref.headers.Authorization");
  });
});
