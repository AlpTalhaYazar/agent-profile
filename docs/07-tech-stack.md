# 07 — Tech Stack

## TL;DR

Citty for the CLI, Zod v4 for schemas, defu for merging, Electron Forge + plugin-vite + plugin-fuses for packaging, React 19 + shadcn/ui + Jotai/Zustand for the GUI, `safeStorage` (Main) + `@napi-rs/keyring` (CLI standalone) for credentials, `node-pty` + `execa` for spawning, Vitest + Playwright for tests, chokidar v5 for file watching. Node ≥ 22 LTS, Electron ≥ 35, Claude Code ≥ v2.1.61. Every choice below has a single-sentence rationale and a named alternative that was considered.

## Master decision table

| Concern | Choice | Alternatives considered | Why |
|---|---|---|---|
| CLI framework | **Citty** | oclif, commander, yargs | Lazy-loading subcommands, native TypeScript, sub-10ms cold start, UnJS ecosystem. Fast perceived UX on Electron-dependent invocations |
| Schema validation | **Zod v4** | Valibot, Yup, ArkType | `z.toJSONSchema` for IDE `$schema` autocomplete; discriminated unions; wide community familiarity |
| Config merge | **defu** + `createDefu` | deepmerge-ts, @cross/deepmerge, lodash.merge | No prototype pollution; per-key custom policies via `createDefu`; small (<1 kB); no recursion bombs |
| Config discovery | **cosmiconfig** + **find-up** | rc, app-root-path, pkg-up | Standard, supports YAML/JSON/JS, upward-walk semantics for monorepo |
| YAML parsing | **yaml** (eemeli/yaml) | js-yaml | Preserves comments, source maps for error reporting, schema-aware |
| Credential store (Main) | **Electron `safeStorage`** | keytar (deprecated), `@napi-rs/keyring` directly | Native Electron; pattern VS Code uses; OSCrypt-backed per platform |
| Credential store (CLI standalone) | **`@napi-rs/keyring`** | keytar, cross-keychain, node-keytar | Rust N-API with prebuilt binaries for aarch64/musl; keytar is archived |
| Process spawn (one-shot) | **execa** | native `child_process`, `zx` | Ergonomic errors, reliable kill trees, promise-first |
| Process spawn (interactive) | **node-pty** | native PTY, `@lydell/node-pty` | The maintained fork/current-origin lineage; PTY required for `claude`'s interactive UX |
| Electron packaging | **Electron Forge** + `plugin-vite` + `plugin-fuses` | electron-builder | Forge ships first-class Fuses + Vite integration; builder is an acceptable fallback for heavy auto-update matrices |
| Auto-update | **update-electron-app** + deterministic rollout manifest | electron-updater, update servers | Matches the current Forge + Squirrel maker path for public GitHub releases; electron-updater would require a larger metadata/packaging migration |
| React | **React 19** | Vue, Svelte, SolidJS | Team familiarity, shadcn component library coverage |
| UI kit | **shadcn/ui** + **Radix** | MUI, Mantine, Chakra | Tree/editor components, form primitives, accessibility by default |
| State | **Jotai** (atomic) + **Zustand** (stores) | Redux Toolkit, MobX | Jotai for scope-tree atoms; Zustand for session/auth stores; small, typed, no boilerplate |
| Monaco | **@monaco-editor/react** | CodeMirror 6 | Schema support, diff view, familiar to devs |
| File watch | **chokidar v5** | `fs.watch`, parcel-watcher | `awaitWriteFinish`, `atomic:true`, cross-platform |
| Monorepo detect | **identify-monorepo-root** + `find-up` | manual walk, rush-lib | Turbo/nx/pnpm-workspace/lerna covered in one lib |
| IPC transport | **Node `net`** (UDS / Named Pipe) | nanomsg, ZeroMQ, grpc | Zero extra deps, OS-level perms give us auth for free |
| HTTP (MCP remote) | **undici** | axios, got, node-fetch | First-party HTTP client for Node 22; streaming for SSE |
| Test runner | **Vitest** | Jest, node:test | Fast, ESM-first, typed, compatible with Vite plugin chain |
| Electron E2E | **Playwright** (`_electron`) | Spectron (dead) | Maintained, Chromium + Main both scriptable |
| Secret redaction (logs) | **pino** + redact paths | winston, bunyan | Structured logs; built-in redact for known field names |
| Lint / format | **Biome** | eslint + prettier | One tool, fast, typed rules |
| Build (TS) | **tsc** (types) + **tsup** (bundles) | swc, esbuild direct | tsup wraps esbuild; tsc for `.d.ts` emission |
| Code signing | `@electron/osx-sign`, `@electron/notarize`, Windows Authenticode | hand-rolled | Vendor-maintained macOS flow; Forge Windows signing supports PFX or HSM/custom `signtool` parameters |

## Why Citty (not oclif)

oclif is the industry default for large CLIs (Heroku, Salesforce). It's mature, supports plugins, and has excellent docs. We chose Citty because:

- **Cold-start latency matters.** Every `myclaude` invocation connects to the daemon. The CLI's own startup must be invisible. Citty's lazy command loading is ~5× faster than oclif's at baseline.
- **UnJS ecosystem fit.** We already use `defu` (UnJS) and `consola` pairs well with Citty for consistent terminal UX.
- **No plugin discovery needed in v1.** The Phase 3 Plugin SDK gate is closed as deferred; current agent-builder support comes through persona assets and Claude Code skills, not a `myclaude` plugin runtime. Citty remains the simpler fit.

If concrete SDK or third-party adapter demand later opens the gate, reassess the CLI framework as part of the SDK design; migration to oclif remains mechanical (both use exported command objects; both generate help).

## Why defu (not deepmerge-ts)

Both libraries are fine. defu wins on:

- **Per-key policies via `createDefu`**. Essential for the cascade algorithm where `mcpServers` merges by name, `env` deep-merges, `args` arrays replace-not-concatenate.
- **No prototype pollution**. lodash.merge has a storied history here; defu disallows `__proto__`, `constructor`, `prototype` keys.
- **Small + dependency-free**.

@cross/deepmerge was a near-miss; its `arrayMergeStrategy: "unique"` is elegant. We preferred defu's per-key approach because the merge logic for `mcpServers` is domain-specific and we don't want a generic array-dedup to silently miss it.

## Why `safeStorage` + `@napi-rs/keyring` (not keytar)

`atom/node-keytar` is archived (2022-12-15, last release 2022-02). VS Code, Azure Storage Explorer, Element, Joplin, and many more have migrated off it. (claude-research §2.1.)

The Main-vs-CLI-standalone split:

- **Main**: `safeStorage` is the Electron-native path. Encryption key comes from the OS keychain; ciphertext stored in a file we control. This is the same pattern VS Code's `SecretStorageService` uses.
- **CLI standalone**: When the user runs `myclaude auth list` without the daemon, we need to read keychain entries. `@napi-rs/keyring` is a Rust binding to `keyring-rs` (same crate that backs `cross-keychain`). Prebuilt binaries for macOS/Windows/Linux x64/arm64/musl mean no `node-gyp` pain.

Writes always go through Main when available, so the two stores stay in sync.

## Why Electron Forge (over electron-builder)

electron-builder is the historical market leader with the biggest feature surface (multiple channels, deltas, complex installer recipes). Electron Forge has caught up and exceeds it on:

- **First-class Fuses plugin.** `@electron-forge/plugin-fuses` flips the security fuses declaratively in `forge.config.ts`.
- **Vite plugin.** `@electron-forge/plugin-vite` scaffolds Renderer + Main + preload with HMR. Faster dev loop than builder's webpack config.
- **Maintained by the Electron team.** Feature alignment with Electron releases is tighter.

Auto-update uses `update-electron-app` with `update.electronjs.org` for the
current public GitHub release path. `electron-updater` remains a future option
only if the project migrates the packaging metadata story; the current
Squirrel.Windows maker path does not produce signed `latest.yml` metadata.

## Version constraints

| Component | Minimum | Rationale |
|---|---|---|
| Node | **22 LTS** | `node:util/types.isProxy`, structuredClone, stable `--watch` for dev; matches Electron 35's Node runtime |
| Electron | **35** | Newer `safeStorage` backends, performance improvements, current fuses API |
| Claude Code | **v2.1.61** | First release with the partial `.claude.json` corruption fix (issue #28847). Older versions still hit the race even with `CLAUDE_CONFIG_DIR` isolation |
| macOS | 12 Monterey+ | Signed notarization flow |
| Windows | 10 1809+ | Named Pipe ACL support |
| Linux | kernel 5.10+, glibc 2.31+ | Supports modern `safeStorage` backends |

Older runtimes are not gated technically but are unsupported — the doctor command warns.

## Dependency hygiene rules

- **No `keytar`** in any lockfile. CI fails if it's pulled transitively.
- **No deprecated `request`** and no `node-fetch` (use `undici`).
- **No `lodash.merge`** or `merge-deep` (use `defu`).
- **Pinned versions for native modules** (`@napi-rs/keyring`, `node-pty`) with checksum verification in CI.
- **SBOM emitted per release** via `@cyclonedx/cyclonedx-npm` is future release
  hardening work, not part of Phase 3 Milestone 1.

## Project layout (planned)

```
agent-profile/
├── apps/
│   ├── cli/               # myclaude (citty, execa, node-pty)
│   │   ├── src/
│   │   └── package.json
│   ├── helper/            # myclaude-helper (tiny binary for apiKeyHelper)
│   │   └── src/
│   └── desktop/           # Electron Main + Renderer
│       ├── forge.config.ts
│       ├── src/main/
│       ├── src/preload/
│       └── src/renderer/
├── packages/
│   ├── core/              # schemas, cascade engine, provenance
│   ├── ipc-protocol/      # shared types + framing
│   ├── secrets/           # safeStorage + @napi-rs/keyring adapters
│   └── persona-deployer/  # CLAUDE.md concat, file copy, cleanup
├── docs/                  # this directory
├── research/
└── package.json           # pnpm workspace root
```

pnpm workspaces. Each `packages/*` is pure TypeScript and testable in isolation. `apps/*` wire them together.

## CI pipeline

The repository currently has two desktop delivery workflows:

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pull
  requests and pushes to `main`. It installs with pnpm, runs recursive
  typecheck, test, and lint, packages the desktop app on Ubuntu, then verifies
  Electron Fuses with `pnpm -C apps/desktop verify-fuses -- --strict`.
- [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml)
  runs on `v*` tag pushes and manual dispatch. It builds macOS `x64`, macOS
  `arm64`, Windows `x64`, and Linux `x64` release artifacts, runs the release
  verifier for each matrix entry, uploads workflow artifacts, and can create a
  draft GitHub Release from an existing tag.

The release workflow uses Electron Forge makers for macOS ZIP + DMG, Windows
Squirrel, and Linux deb + rpm + ZIP. There is no AppImage maker in Phase 3
Milestone 1.

Forge signing is gated by `AGENT_PROFILE_RELEASE=1`. macOS release jobs import
the Apple certificate/API key, set `APPLE_CODESIGN_IDENTITY`,
`APPLE_KEYCHAIN`, `APPLE_API_KEY_PATH`, `APPLE_API_KEY_ID`, and
`APPLE_API_ISSUER`, then require both signature and notarization verification.
Windows release jobs support either PFX signing or HSM/custom `signtool`
parameters and require Authenticode verification. Linux M1 artifacts are
unsigned and verified with `--unsigned-ok`.

The release verifier is
[`apps/desktop/scripts/verify-release-artifacts.mjs`](../apps/desktop/scripts/verify-release-artifacts.mjs):

```sh
pnpm -C apps/desktop verify-release -- --platform darwin --arch x64 --require-signature --require-notarization --require-update-artifacts
pnpm -C apps/desktop verify-release -- --platform darwin --arch arm64 --require-signature --require-notarization --require-update-artifacts
pnpm -C apps/desktop verify-release -- --platform win32 --arch x64 --require-signature --require-update-artifacts
pnpm -C apps/desktop verify-release -- --platform linux --arch x64 --unsigned-ok
```

Manual publish runs validate that `publish_release=true` includes an existing
`v*` tag. Publish jobs create draft releases with
`gh release create "$TAG" ... --draft --generate-notes --verify-tag`.
Auto-update rollout metadata is published as `agent-profile-rollout.json` on
draft release publish runs. SBOM generation remains future release-hardening
work.

## Related documents

- How these libraries slot into the architecture: [`02-architecture.md`](02-architecture.md)
- The Zod schema these libraries validate: [`03-profile-schema.md`](03-profile-schema.md)
- Security constraints that shape some choices: [`06-security.md`](06-security.md)
- Delivery / release plan: [`08-roadmap.md`](08-roadmap.md)
