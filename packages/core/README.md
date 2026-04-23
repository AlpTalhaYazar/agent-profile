# @agent-profile/core

Pure TypeScript engine for Agent Profile configuration cascade. Owns Zod schemas, the cascade resolver, fragment expansion, provenance emission, and secret-reference parsing.

**No runtime dependency on Electron, keychain, node-pty, or any I/O beyond reading YAML files from disk.**

## Installation

```bash
pnpm add @agent-profile/core
```

## Quick Start

```ts
import { resolve } from "@agent-profile/core";

const result = resolve({
  role: "backend",
  authProfileId: "work",
  cwd: process.cwd(),
});

console.log(result.effective.mcpServers);
// { postgres: { type: "stdio", command: "npx", ... }, github: {...} }

console.log(result.provenance.mcpServers.postgres);
// { source: "project-role", chain: [{ scope: "global-role", event: "introduced" }, ...] }

console.log(result.runtimePaths);
// null — populated by the CLI/GUI emitter in a later sprint
```

## Public API

### Schemas

```ts
import { McpServer, ScopeDoc, AuthProfilesDoc, FragmentDoc } from "@agent-profile/core";

// Validate a scope YAML document
const doc = ScopeDoc.parse(rawObject);

// Validate an individual server entry
const server = McpServer.parse(rawServer);
```

### Cascade Resolution

```ts
import { resolve } from "@agent-profile/core";
import type { ResolveInput, EffectiveSessionConfig } from "@agent-profile/core";

const input: ResolveInput = {
  role: "backend",          // selects global/project role files
  authProfileId: "work",    // carried into effective.auth (not resolved here)
  cwd: "/path/to/project",  // used to find .myclaude-bearing ancestor dirs
  launchOverrides: {        // highest-precedence layer (CLI flags, etc.)
    env: { DEBUG: "1" },
  },
  fragmentDirs: [            // where to find fragment YAMLs
    "/path/to/fragments",
  ],
  globalConfigDir: "/path/to/.myclaude/config",
};

const { effective, provenance, runtimePaths } = resolve(input);
```

### Fragment Expansion

Fragment expansion is called automatically by `resolve()`, but you can call it directly:

```ts
import { expandFragments } from "@agent-profile/core";

const expanded = expandFragments(scopeDoc, ["/path/to/fragments"]);
```

### Secret Reference Parsing

```ts
import { parseSecretRef, extractSecretRefs } from "@agent-profile/core";

parseSecretRef("keyring://anthropic/work");
// { kind: "keyring", service: "anthropic", account: "work", raw: "..." }

parseSecretRef("${secret:github.pat}");
// { kind: "secret", name: "github.pat", raw: "..." }

parseSecretRef("${env:HOME}");
// { kind: "env", name: "HOME", raw: "..." }

parseSecretRef("plain string");
// null

// Walk a full document and collect all refs with their JSON paths
const refs = extractSecretRefs(scopeDoc);
// [{ ref: { kind: "secret", ... }, jsonPath: "mcpServers.github.env.GITHUB_TOKEN" }, ...]
```

### Error Types

```ts
import { SchemaError, FragmentNotFoundError, CascadeError } from "@agent-profile/core";

try {
  resolve({ cwd: "/bad/path" });
} catch (e) {
  if (e instanceof SchemaError) {
    console.error(e.sourceFile);   // path that failed
    console.error(e.fieldPath);    // JSON path of failing field
  }
  if (e instanceof FragmentNotFoundError) {
    console.error(e.fragmentName);   // name that wasn't found
    console.error(e.searchedPaths);  // dirs that were searched
  }
  if (e instanceof CascadeError) {
    console.error(e.scopeName);   // scope where error occurred
    console.error(e.fieldPath);   // JSON path of problematic field
  }
}
```

## Cascade Algorithm

`resolve()` implements a deterministic 7-step cascade:

1. **Collect layers**: `global-shared` → `global-role` → `project-shared` → `project-shared-local` → `project-role` → `launch-overrides`
2. **Validate**: each layer is Zod-parsed independently; errors include source file + field path
3. **Expand fragments**: `use: [name]` is inlined before inter-layer merge
4. **Reduce**: per-key merge policies:
   - `mcpServers`: merge-by-name; null/enabled:false = tombstone; `disabledServers` suppresses
   - `env`/`settings`: last-wins (higher precedence overrides)
   - `persona`: arrays concatenated and deduped in order
   - `__extends`: textual inheritance from named lower-scope server
   - `__merge: "deep"`: opt-in deep merge within a server
5. **Parse secret refs**: detected but NOT resolved (resolution = future `packages/secrets`)
6. **Final validation**: merged result re-validated against `ScopeDoc`
7. **Return**: `{ effective, provenance, runtimePaths: null }`

## Constraints

- **No secret resolution**: `parseSecretRef()` and `extractSecretRefs()` parse refs only. Actual keychain/env lookup is done by `packages/secrets` (future sprint).
- **`runtimePaths` is always `null`**: populated by the emitter (CLI/GUI) after writing ephemeral session dirs.
- **No network, no process spawn**: pure I/O = YAML reads from disk.
- **Schema-first**: all types are `z.infer<typeof Schema>`; no hand-written duplicates.
