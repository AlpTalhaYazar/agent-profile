# Phase 2 Sprint 5 — Auth Vault + Session Monitor (plan-as-shipped)

**Status:** Shipped on `feat/phase-2-foundation` (2026-04-29).
**Branch:** `feat/phase-2-foundation` (pre-push, pre-PR).
**Roadmap entry:** [`docs/08-roadmap.md` Phase 2 Milestone 5](../08-roadmap.md).

This document is the as-shipped record of milestone 5. The original plan
(implementation strategy, file inventory, validation gates, and risk register)
was authored at `~/.claude/plans/sen-agent-profile-projesinin-encapsulated-hamster.md`
and landed in 10 focused commits between `f848a29` (ST-0 lint fix) and
`9620787` (Renderer screens + tabs).

## Scope

Milestone 5 surfaces every CLI capability the Auth Vault and Session Monitor
require, behind the existing **Renderer → Main → daemon** path locked by ADR
003. Three concerns:

1. **Auth CRUD with masked inputs.** Hybrid plaintext flow:
   - `auth.add` collects the initial Anthropic key via a Main-owned modal
     child `BrowserWindow` (`apps/desktop/src/main/native-secret-dialog.ts`)
     so the value never crosses the Renderer.
   - `auth.setSecret` / `auth.rotate` use a Renderer modal with the new
     `PasswordInput` primitive. Plaintext lives in component-local
     `useState` and is reset on submit / close.
   - `auth.remove` re-uses Main's native `dialog.showMessageBox` for the
     destructive confirm.
2. **Session list with live updates.** A new push-event channel:
   - Protocol: `Evt` discriminated union (currently only `EvtSessionsEvent`),
     `Frame = Resp ∪ Evt`, `sessions.subscribe` request, encoder accepts
     id-less event frames.
   - Server: `DaemonServer.broadcast(evt, predicate?)`; per-connection
     subscriber Set; `sessions.subscribe` is a framework-owned handler.
   - Client: `DaemonClient extends EventEmitter` with a typed event map and
     `subscribe("sessions")` helper.
   - Main: long-lived event client forwards each frame to every
     BrowserWindow via `webContents.send("myclaude.sessions.event", ...)`,
     plus `connection: up/down` notices for the Renderer's polling
     fallback.
   - CLI: `sessions list --follow` uses the same daemon subscription.
3. **Kill, relaunch, drift.** Three new request kinds backed by daemon
   handlers; CLI subcommands and Renderer Session Monitor actions both
   route through the IPC layer. Drift compares the launch-time hash
   (`computeLaunchHash` in `packages/cli-services`) against a freshly
   resolved cascade.

ADR 003 (Renderer never imports daemon packages) and ADR 002 (one-way
keyring → safeStorage) are honoured; ADR 004 documents the new push
channel.

## Sub-task ledger (plan-as-shipped)

| ST | Subject | Commit |
|----|---------|--------|
| 0 | Baseline repair (cli-services lint + sessions tests `standalone:true`) | `f848a29`, `d0334e9` |
| 1 | `ipc-protocol`: `sessions.kill/relaunch/drift/subscribe`, `EvtSessionsEvent`, `DaemonClient` event emitter, broadcast | `2202da1` |
| Helper | Shared `computeLaunchHash` for daemon + CLI drift | `65ac327` |
| 2 + 3 (cli-svc) | `sessions/{kill,relaunch,drift}` services + atomic writers moved into cli-services | `c32d353` |
| 2 (daemon) | Daemon kill/relaunch/drift handlers + `sessions.list` enrichment + push broadcast wiring | `b9c1a89` |
| 3 (CLI) | Transport methods + CLI subcommands + `sessions list --follow` | `5ce6837` |
| 4 (UI) | `Dialog`, `ConfirmDialog`, `PasswordInput`, `Table`, `Badge` primitives | `8236a9b` |
| 4 (Main) | Auth + sessions Main IPC bridge + native secret dialog + push event forwarding | `a7dc6c2` |
| 5 + 6 | Renderer Auth Vault + Session Monitor screens + App Tabs nav | `9620787` |
| 7 + 8 + 9 | Playwright e2e specs, sprint doc, ADR 004, roadmap status | (this commit) |

## File inventory

### Wire format
- `packages/ipc-protocol/src/messages.ts` — new schemas, unions, optional
  `launchHash` on `ReqSessionStart`, optional enrichment helper
  `SessionRecordEnrichment`.
- `packages/ipc-protocol/src/server.ts` — `DaemonServer.broadcast`,
  per-channel subscriber Set, framework `sessions.subscribe` handler,
  drain re-ordered to force-destroy lingering subscribers before awaiting
  the listener-close callback.
- `packages/ipc-protocol/src/client.ts` — `DaemonClient extends EventEmitter`,
  typed `DaemonClientEvents`, `subscribe(channel)`, id-less frame
  dispatcher.
- `packages/ipc-protocol/src/codec.ts` — `encodeMessage` accepts `EvtT`.
- `packages/ipc-protocol/src/index.ts` — re-exports.

### Service layer
- `packages/cli-services/src/launch-hash.ts` (NEW) — stable SHA-256 of
  `(effective, provenance, scopeFiles)`.
- `packages/cli-services/src/sessions/{kill,relaunch,drift}.ts` (NEW).
- `packages/cli-services/src/sessions/registry.ts` — atomic
  `writeSessionRecord` / `updateSessionRecord` moved here from
  `apps/cli/src/session/registry.ts`; new optional `launchHash` /
  `relaunchedFrom` fields on `SessionRecord`.
- `apps/cli/src/session/registry.ts` — thin `CliError`-mapping shim around
  the cli-services helpers.

### Daemon
- `apps/desktop/src/main/daemon/handlers-write.ts` — `sessions.kill`,
  `sessions.relaunch`, `sessions.drift` handlers; broadcast hooks on
  `session.start`, `session.end`, `runSessionCleanup`.
- `apps/desktop/src/main/daemon/handlers.ts` — `sessions.list` enrichment
  with `liveCapability` / `capabilityExpiresAtMs` / `processAlive`,
  shared `LiveSessionsMap`.
- `apps/desktop/src/main/daemon/audit.ts` — `event:"killed"` and optional
  `relaunchedFrom` on `LaunchEntry`.
- `apps/desktop/src/main/daemon/lifecycle.ts` — broadcast hook injection,
  features list extension.

### Main / preload / native dialog
- `apps/desktop/src/main/index.ts` — 8 new `ipcMain.handle` blocks
  (auth.add/setSecret/rotate/remove + sessions.list/kill/relaunch/drift),
  plus `startDaemonEventClient` for push-event forwarding.
- `apps/desktop/src/main/native-secret-dialog.ts` (NEW) — modal child
  window with data-URL HTML + dedicated preload.
- `apps/desktop/src/secret-dialog/preload.ts` (NEW) — narrow contextBridge
  exposing only `secretDialog.submit/cancel`.
- `apps/desktop/forge.config.ts` — third Forge `build` entry registers the
  secret-dialog preload.
- `apps/desktop/src/preload/index.ts` — `window.myclaude.auth.{add,…}`,
  `window.myclaude.sessions.{list,kill,relaunch,drift,onUpdate}`.
- `apps/desktop/src/renderer/myclaude.d.ts` — types for the new surface.

### UI primitives
- `packages/ui/src/{dialog,confirm-dialog,password-input,table,badge}.tsx`
  (NEW). `@radix-ui/react-dialog` joins runtime deps.

### Renderer
- `apps/desktop/src/renderer/screens/auth-vault.tsx` (NEW).
- `apps/desktop/src/renderer/screens/session-monitor.tsx` (NEW).
- `apps/desktop/src/renderer/lib/atoms.ts` — `currentScreenAtom`.
- `apps/desktop/src/renderer/index.tsx` — App-level Tabs nav with
  display-toggled grids so the Profile Editor's existing layout doesn't
  have to nest under `TabsContent`.

### CLI
- `apps/cli/src/transport/{types,daemon,in-proc}.ts` — `sessionsKill`,
  `sessionsRelaunch`, `sessionsDrift`, `sessionsSubscribe`. In-proc throws
  `daemonRequired()` for kill/relaunch/subscribe; drift forwards to
  `driftService` directly.
- `apps/cli/src/commands/sessions.ts` — `kill`, `relaunch`, `drift`
  subcommands; `list --follow` long-poll-style stream with SIGINT teardown.

### Tests added
- `packages/ipc-protocol/test/{messages,codec,client-server}.test.ts`:
  +41 cases (push frame round-trip, subscribe lifecycle, broadcast,
  drain-with-subscriber).
- `packages/cli-services/test/{launch-hash,sessions-kill,sessions-relaunch,sessions-drift}.test.ts`:
  +18 cases.
- `apps/desktop/test/daemon-handlers-write.test.ts`: +5 cases for
  kill/relaunch/drift + broadcast spy.
- `apps/cli/test/commands/sessions-monitor.test.ts`: +5 cases for the
  CLI subcommands and the follow loop.
- `apps/desktop/test/e2e/{auth-vault,session-monitor}.spec.ts`: smoke
  coverage of tab navigation, seeded data display, dialog wiring, and
  Refresh.

## Validation matrix

```
pnpm -r typecheck
pnpm -r test
pnpm -r lint
PLAYWRIGHT_HEADLESS=1 pnpm -C apps/desktop test:e2e
```

All green at the head of `feat/phase-2-foundation`. Test counts (new
deltas vs M4 baseline):

| package         | tests | Δ |
|-----------------|------:|--:|
| ipc-protocol    |   154 | +43 |
| cli-services    |    63 | +18 |
| apps/desktop    |    57 |  +5 |
| apps/cli        |   364 |  +5 |
| e2e (desktop)   |     3 |  +2 |

## Known limitations / follow-ups

- **Native secret dialog packaging:** the dialog HTML is built-in via a
  data-URL plus a dedicated Forge preload entry. Smoke coverage in
  Playwright currently exercises the Renderer modal path; an automated
  test that drives the Main child window is a follow-up.
- **Drift `scopesChanged` approximation:** the daemon does not persist the
  launch-time provenance, only the hash. The drift service surfaces the
  current scope file list when drifted; a richer scope-level diff would
  require persisting more launch-time metadata.
- **`sessions.relaunch` placeholder pid:** the new SessionRecord is
  written with `pid: 0`; the caller (Renderer or CLI) is expected to call
  `session.start(newSessionId, realPid, …)` after spawning to populate the
  in-memory map with the live PID. M5 does not yet wire that follow-up
  call from Renderer (Session Monitor relaunch returns the new id and
  re-renders); CLI does not auto-spawn either. Phase 3 picks this up if
  the Renderer needs a literal "spawn from GUI" flow.
- **Audit log rotation:** still JSONL at `~/.myclaude/audit.log`. Phase 3
  open-question #24 covers the SQLite migration.

## Related documents

- [`docs/05-gui-spec.md`](../05-gui-spec.md) — Auth Vault and Session
  Monitor UX.
- [`docs/06-security.md`](../06-security.md) — capability tokens, audit
  schema, plaintext invariants.
- [`docs/adr/003-renderer-main-daemon-path.md`](../adr/003-renderer-main-daemon-path.md).
- [`docs/adr/004-session-event-subscription.md`](../adr/004-session-event-subscription.md).
- [`docs/09-open-questions.md`](../09-open-questions.md) — #19 and #28
  resolved here.
