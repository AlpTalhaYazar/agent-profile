# Phase 2 Sprint 6 — Provenance Inspector + Persona Composer (plan-as-shipped)

**Status:** Shipped on `feat/phase-2-foundation` (2026-04-29).
**Branch:** `feat/phase-2-foundation` (pre-push, pre-PR).
**Roadmap entry:** [`docs/08-roadmap.md` Phase 2 Milestone 6](../08-roadmap.md).

This document is the as-shipped record of milestone 6. The original plan
landed at `~/.claude/plans/sen-agent-profile-projesinin-radiant-peach.md`.
Five focused commits between `62aa29e` (ST-1 protocol kind) and `7cf853c`
(Renderer screens + 5-tab nav) make up the milestone.

## Scope

Milestone 6 adds the two remaining Phase 2 GUI screens:

1. **Provenance Inspector.** Per-field cascade chain viewer for `mcpServers`,
   `env`, `settings`, and `persona`. Reads the provenance already loaded
   into `effectiveStateAtom` by the Profile Editor — no new IPC kind. The
   detail panel surfaces `source`, `suppressedBy`, the chain table
   (`{ scope, event }` per step), `overriddenFields`, and the redacted
   final value via the existing `redactText` helper.

2. **Persona Composer / Preview.** In-memory persona render for a
   `(role, auth, cwd)` triple — the rendered `CLAUDE.md` (combined +
   per-section breakdown), agents, skills, slash commands, and memory
   seeds. Disk is never written. A new IPC kind `persona.render` plus a
   new `renderPersonaInMemory` export from `@agent-profile/persona-deployer`
   give the Renderer a non-mutating preview path. The Composer screen
   shows a category catalog + a Monaco read-only preview keyed by file
   extension; collisions and missing-source counts surface as banners.

App-level Tabs grew from three to five (`Profile Editor / Auth Vault /
Session Monitor / Provenance / Persona`). M4 and M5 e2e specs regress
clean; M6 adds two new specs.

ADR 005 ([`adr/005-persona-render-in-memory.md`](../adr/005-persona-render-in-memory.md))
codifies the persona render boundary: `persona.render` is read-only, the
wire carries persona content as utf-8 strings, and the Renderer
untrusted-boundary invariants from ADR 003 (sender-frame validation, Zod
strict payload, no direct daemon socket access) extend to the new
channel.

## Sub-task ledger (plan-as-shipped)

| ST | Subject | Commit |
|----|---------|--------|
| 1 | `ipc-protocol`: `persona.render` request + response Zod schemas + Req/Resp/Frame union members + types | `62aa29e` |
| 2 | `persona-deployer`: `renderPersonaInMemory` + `buildClaudeMdSections` + `readCategoryFiles` (helper extraction); `cli-services` `personaRenderService` | `9420e3c`* |
| 3 | Daemon `persona.render` handler + lifecycle features advertisement; CLI transport (`personaRender` daemon + in-proc); `myclaude render persona` subcommand | `40fbeef` |
| 4 | Main IPC bridge (`persona.render` handler) + preload (`window.myclaude.persona.render`) + Renderer `.d.ts` typing; bridge-main test cases | `3785456` |
| 5+6 | Renderer Provenance Inspector + Persona Composer screens, atoms, types, 5-tab nav extension | `7cf853c` |
| 7 | Playwright `_electron` smoke specs: `provenance-inspector.spec.ts`, `persona-composer.spec.ts` | (this commit) |
| 8 | Sprint plan-as-shipped + roadmap status + open-questions update | (this commit) |
| 9 | ADR 005 — persona render in-memory boundary | (this commit) |

\* ST-2 commit hash was assigned by the focused-commit pass at the end of
Wave 1; the actual SHA may differ depending on rebase order.

## File inventory

### Wire format
- `packages/ipc-protocol/src/messages.ts` — `ReqPersonaRender`,
  `RespPersonaRenderOk`, plus the four supporting wire schemas
  (`PersonaFileWire`, `PersonaClaudeMdSection`, `PersonaCollisionWire`,
  `PersonaMissingWire`). Appended to `Req`, `Resp`, and `Frame`
  discriminated unions.
- `packages/ipc-protocol/src/server.ts` — single-line append to the
  `RESPONSE_KIND` map (`"persona.render": "persona.render.ok"`) so the
  exhaustive map stays exhaustive.
- `packages/ipc-protocol/src/index.ts` — re-exports.

### Persona deployer
- `packages/persona-deployer/src/render.ts` (NEW) — `renderPersonaInMemory`.
- `packages/persona-deployer/src/claude-md.ts` — added
  `buildClaudeMdSections` (per-section + combined output). Existing
  `buildClaudeMd` refactored to call the new helper; external signature
  unchanged.
- `packages/persona-deployer/src/copy-files.ts` — added
  `readCategoryFiles` (read-only, no disk write). Existing `copyFiles`
  refactored to call it; external signature unchanged.
- `packages/persona-deployer/src/utils/types.ts` — `PersonaRenderInput`,
  `PersonaRenderFile`, `PersonaRenderClaudeMd`, `PersonaRenderResult`.
- `packages/persona-deployer/src/index.ts` — re-exports.

### Service layer
- `packages/cli-services/src/persona/render.ts` (NEW) —
  `personaRenderService`: composes `resolveCurrentProfile` with
  `renderPersonaInMemory`, builds the per-file provenance map from
  cascade output.
- `packages/cli-services/src/persona/index.ts` (NEW) — re-export.
- `packages/cli-services/src/index.ts` — public re-export.

### Daemon
- `apps/desktop/src/main/daemon/handlers.ts` — `persona.render` read-side
  handler + `projectPersonaRender` projection (collision groupBy, drop
  `targetPath` on `missingSources`).
- `apps/desktop/src/main/daemon/lifecycle.ts` — `persona.render` added to
  the read-side `features` list advertised in `hello.ok`.

### Main / preload / Renderer typing
- `apps/desktop/src/main/index.ts` — `ipcMain.handle("persona.render", …)`
  block: sender-frame guard, Zod-strict payload, daemon delegation via
  `withDaemonClient`. New `PersonaRenderPayload` schema.
- `apps/desktop/src/preload/index.ts` — `window.myclaude.persona.render`.
- `apps/desktop/src/renderer/myclaude.d.ts` — typing for the new bridge
  surface.

### CLI
- `apps/cli/src/transport/types.ts` — `personaRender` method on
  `CliTransport` plus the input/result types.
- `apps/cli/src/transport/daemon.ts` — daemon implementation; reconstructs
  the cli-services result shape from the wire response.
- `apps/cli/src/transport/in-proc.ts` — in-proc implementation; calls
  `personaRenderService` directly.
- `apps/cli/src/commands/render.ts` — adds `subCommands: { persona: … }`.
  Default `myclaude render` behavior (cascade dump alias of
  `profile show`) is unchanged.
- `apps/cli/src/commands/render-persona.ts` (NEW) —
  `myclaude render persona [--role <r>] [--auth <a>] [--json] [--pretty]`.
  Text mode emits a tree-style listing; JSON mode dumps the full
  `PersonaRenderResult`.

### Renderer
- `apps/desktop/src/renderer/lib/types.ts` — `PersonaRenderResult` mirror
  types, `SelectedPersonaFile`, `PersonaState`,
  `SelectedProvenanceField`, `ProvenanceSection`.
- `apps/desktop/src/renderer/lib/atoms.ts` — `AppScreen` union extended
  with `"provenance" | "persona"`; new atoms
  `selectedProvenanceFieldAtom`, `personaStateAtom`,
  `selectedPersonaFileAtom`.
- `apps/desktop/src/renderer/screens/provenance-inspector.tsx` (NEW).
- `apps/desktop/src/renderer/screens/persona-composer.tsx` (NEW).
- `apps/desktop/src/renderer/index.tsx` — `ScreenTabs` upgraded to five
  tabs; tab routing routes `provenance` and `persona` to the new screens.

### Tests added
- `packages/ipc-protocol/test/messages.test.ts`: +17 cases (request +
  response round-trip, strict-mode rejections, malformed-enum negative
  tests, Req/Resp/Frame discriminator routing).
- `packages/ipc-protocol/test/codec.test.ts`: +1 case
  (`RespPersonaRenderOk` NDJSON round-trip).
- `packages/persona-deployer/test/render.test.ts` (NEW): +12 cases
  covering the in-memory render across single-scope, multi-scope,
  collision, missing-source, and empty-array paths.
- `packages/cli-services/test/persona-render.test.ts` (NEW): +5 cases for
  the service-layer composition.
- `apps/desktop/test/daemon-handlers.test.ts`: +2 cases (`persona.render`
  empty render + missing-cascade BAD_REQUEST/INTERNAL).
- `apps/desktop/test/bridge-main.test.ts`: +2 cases (handler delegation
  with mock wire response + invalid-payload guard).
- `apps/cli/test/commands/render-persona.test.ts` (NEW): +6 cases
  (no-role, no-auth, empty render shape, JSON output, text output, Citty
  wrapper).
- `apps/desktop/test/e2e/provenance-inspector.spec.ts` (NEW): tab
  navigation, section selector entries, chain detail render.
- `apps/desktop/test/e2e/persona-composer.spec.ts` (NEW): tab
  navigation, catalog with combined CLAUDE.md + agent file, preview pane
  render.

## Validation matrix

```
pnpm -r typecheck
pnpm -r test
pnpm -r lint
PLAYWRIGHT_HEADLESS=1 pnpm -C apps/desktop test:e2e
```

All green at the head of `feat/phase-2-foundation`. Test counts (deltas
vs M5 baseline):

| package         | tests | Δ |
|-----------------|------:|--:|
| ipc-protocol    |   172 | +18 |
| persona-deployer|    72 | +12 |
| cli-services    |    68 |  +5 |
| apps/desktop    |    61 |  +4 |
| apps/cli        |   370 |  +6 |
| e2e (desktop)   |     5 |  +2 |

## Renderer trust model recap

Inherits ADR 003 (Renderer → Main → Daemon) and adds one new bridge
surface:

```ts
window.myclaude.persona = {
  render: (opts: { role: string; authProfileId: string; cwd: string }) =>
    Promise<PersonaRenderResult>,
};
```

- Sender frame guard: every `ipcMain.handle("persona.render", …)` call
  validates `event.senderFrame.url`.
- Payload validation: Zod-strict schema rejects unknown / missing fields
  before `connectToSocket` fires.
- Persona content (markdown / yaml / json text) crosses the channel as
  utf-8 strings. ADR 005 records why this is acceptable
  (open-question #28 invariant: secret refs metadata-only; persona
  content is non-secret).
- The Inspector reads provenance from `effectiveStateAtom` populated by
  the existing `profile.show` call — no extra IPC.

## Known limitations / follow-ups

- **Inspector does not enrich provenance.** `chain[].event` covers
  `introduced`, `extended`, `replaced`, `suppressed`, `deep-merged`. The
  inspector surfaces these verbatim. Future enrichment (per-server
  merge-mode tracking, fragment-expansion provenance, launch-override
  flag origin distinction) would extend the cascade engine — out of
  scope for M6.
- **Composer disk-vs-render parity.** `renderPersonaInMemory` and
  `deployPersona` share `buildClaudeMdSections` + `readCategoryFiles`
  helpers, so the rendered CLAUDE.md is byte-for-byte identical to what
  the launch path would deploy. There is no automated regression test
  for that invariant beyond the existing per-helper unit tests.
- **Persona render content size.** `persona.render` returns full file
  contents in a single response. Today persona libraries are small
  (handful of files); for large libraries the wire payload could grow
  to MBs. Phase 3 may revisit with streaming or pagination.
- **Provenance Inspector requires Profile Editor first.** The Inspector
  reads `effectiveStateAtom` but does not trigger its own `profile.show`
  call. Users hitting the Provenance tab cold see an empty-state hint
  pointing them to Profile Editor.
- **CLI `render persona` requires an auth profile.** Unlike `profile show`
  which can dry-run without auth in some cases, `personaRenderService`
  always passes through `resolveCurrentProfile` and the cascade requires
  an auth id. Documented in the subcommand error output.

## Related documents

- [`docs/05-gui-spec.md`](../05-gui-spec.md) — Provenance Inspector and
  Persona Composer UX.
- [`docs/02-architecture.md`](../02-architecture.md) — cascade resolution
  + persona deployment.
- [`docs/03-profile-schema.md`](../03-profile-schema.md) — persona refs
  and provenance shape.
- [`docs/06-security.md`](../06-security.md) — Renderer untrusted
  boundary, redaction invariants.
- [`docs/adr/003-renderer-main-daemon-path.md`](../adr/003-renderer-main-daemon-path.md).
- [`docs/adr/004-session-event-subscription.md`](../adr/004-session-event-subscription.md).
- [`docs/adr/005-persona-render-in-memory.md`](../adr/005-persona-render-in-memory.md).
- [`docs/09-open-questions.md`](../09-open-questions.md) — provenance
  enrichment + persona size questions remain open.
