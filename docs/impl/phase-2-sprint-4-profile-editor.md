# Phase 2 Sprint 4 — Profile Editor (as shipped)

## Goal

Close the Sprint 3 deferrals that the first real Renderer screen depends on,
then ship the Profile Explorer + Profile Editor through the secure
Renderer → Main → Daemon path.

Branch: `feat/phase-2-foundation`. No push, no PR. Day: 2026-04-28.

## Sub-tasks (as shipped)

| ST | Commit | Scope | Outcome |
|----|--------|-------|---------|
| **ST-1** | `d52639b` | CLI auth writes | `auth add/set/rotate/remove` now route through `getTransport()`. Daemon path calls write-side transport methods; standalone path delegates through in-proc transport to the existing cores. |
| **ST-2** | `3f7acf5` | Session auth binding | `session.start` accepts optional `authProfileId`; live sessions retain it; `secret.get` requires a bound profile and resolves only that profile's `anthropic`/`mcpSecretRefs`. |
| **ST-3** | `1fdd412` | Launch daemon integration | `myclaude launch` starts daemon sessions when available, uses the daemon-issued signed token in `MYCLAUDE_CAPABILITY_TOKEN`, and calls `session.end` on cleanup. Standalone launch keeps the Phase 1 opaque-token path. |
| **ST-4** | `2157c85` | `packages/ui` | Added shared UI primitives, Tailwind/PostCSS scaffold, and a lazy Monaco `CodeEditor` wrapper. |
| **ST-5** | `27da7ca` | Protocol + profile services | Added `profile.{list,validate,preview,save}` to `packages/ipc-protocol`, profile services in `packages/cli-services`, and daemon handlers including allowlisted canonical YAML save. |
| **ST-6** | `8009ea8` | Main/preload bridge | Exposed the narrow `window.myclaude` bridge; Main validates sender frame + Zod payloads and delegates via short-lived daemon clients. |
| **ST-7** | `36d9af8` | Renderer + e2e | Added Profile Explorer, effective preview, form/JSON editor, live validation, diff preview, explicit save, and Playwright `_electron` smoke. |
| **Aux** | `6c8b215` | CLI test isolation | Made `daemon-start` tests independent of `.vite` artifacts left by Electron e2e packaging. |
| **Aux** | `f394f61` | Native packaging | Lazy-loaded `@napi-rs/keyring` and kept it external in the desktop main bundle so Forge packaging does not inline native `.node` artifacts. |

## DAG (as run)

```
Wave 1  ST-1, ST-2, ST-3  →  full build/test/lint gate
Wave 2  ST-4, ST-5, ST-6, ST-7  →  scoped gates + Electron smoke
Wave 3  ST-8, ST-9, ST-10 docs
```

Wave 1 closed the M3 deferrals before UI work. Wave 2 depended on those
contracts: the editor can preview and save safely only because `profile.save`
is daemon-owned and launch/session secret lookup is bound to an auth profile.

## Renderer trust model

Decision recorded in
[ADR 003 — Renderer reaches the daemon only through Main](../adr/003-renderer-main-daemon-path.md).

Renderer receives this surface only:

```ts
window.myclaude = {
  system: { version(), defaultCwd(), pickDirectory() },
  auth: { list() },
  profile: {
    list({ cwd, roleFilter? }),
    show({ role, authProfileId, cwd }),
    validate({ content }),
    preview({ role, authProfileId, cwd, draft: { path, content } }),
    save({ path, content }),
  },
};
```

Main owns sender-frame validation, payload validation, socket/cookie access,
and daemon delegation. Renderer never imports the daemon client and never sees
secret values.

## Form-spec strategy

M4 uses a manual, schema-backed form model for `ScopeDoc` fields that the
editor exposes today: version, auth binding, env, settings JSON, MCP server
entries, persona refs, fragments, and disabled servers. Live validation still
uses `ScopeDoc.safeParse` through `profile.validate`.

Automatic `zod-to-json-schema` control generation was not used. The schema is
excellent as a validation source, but it does not carry enough product intent
for control choice, grouping, or transport-specific MCP editing. Monaco is
lazy-loaded through `@agent-profile/ui` and remains the escape hatch for full
document edits.

## Validation gates (green)

```
pnpm -r typecheck                              ✓
pnpm -r test                                   ✓  955 tests
pnpm -r lint                                   ✓
PLAYWRIGHT_HEADLESS=1 pnpm -C apps/desktop test:e2e  ✓
```

Scoped gates also passed for:

```
packages/ipc-protocol  typecheck/test/lint
packages/cli-services  typecheck/test/lint
packages/secrets       typecheck/test/lint
apps/cli               typecheck + daemon-start focused test + lint
apps/desktop           typecheck/test/lint
```

The Playwright smoke opens the packaged Electron app, renders the scope tree,
edits `EDITOR`, saves through Main → daemon `profile.save`, verifies the YAML
write, reloads, and observes the saved value in the editor/effective preview.

## Known limitations / deferred

- `profile.save` writes canonical YAML. Comments and original formatting are
  not preserved in M4.
- `profile.preview` previews one unsaved draft as a highest-precedence launch
  override. Multi-file unsaved draft overlays are deferred.
- Renderer auth is metadata-only in M4. Auth Vault secret entry/edit flows are
  still milestone 5.
- `sessions.event` remains deferred to Session Monitor.
- The editor is feature-complete enough for the first real screen, but further
  UX polish belongs to the Phase 2 polish milestone.

## Files modified / created

```
apps/cli/src/commands/auth/{add,set,rotate,remove}.ts              ST-1
apps/cli/src/transport/{types,daemon,in-proc}.ts                   ST-1/ST-3
apps/cli/src/commands/launch/**                                    ST-3
packages/ipc-protocol/src/{messages,server,index}.ts               ST-2/ST-5
packages/cli-services/src/profile/{list,preview,save,shared,validate}.ts ST-5
apps/desktop/src/main/daemon/{handlers,handlers-write,lifecycle}.ts ST-2/ST-5
apps/desktop/src/main/{index,security}.ts                           ST-6
apps/desktop/src/preload/index.ts                                   ST-6
packages/ui/**                                                      ST-4
apps/desktop/src/renderer/**                                        ST-7
apps/desktop/test/e2e/**                                            ST-7
docs/adr/003-renderer-main-daemon-path.md                           ST-8
docs/impl/phase-2-sprint-4-profile-editor.md                        ST-9
docs/{08-roadmap,09-open-questions}.md                              ST-10
```

## Related documents

- [`docs/02-architecture.md`](../02-architecture.md)
- [`docs/03-profile-schema.md`](../03-profile-schema.md)
- [`docs/05-gui-spec.md`](../05-gui-spec.md)
- [`docs/06-security.md`](../06-security.md)
- [`docs/07-tech-stack.md`](../07-tech-stack.md)
- [`docs/adr/003-renderer-main-daemon-path.md`](../adr/003-renderer-main-daemon-path.md)
