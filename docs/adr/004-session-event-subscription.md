# ADR 004 — Session event subscription model

**Status:** Accepted (2026-04-29, Phase 2 milestone 5).
**Owners:** Phase 2 IPC working group.
**Related:** [`adr/003-renderer-main-daemon-path.md`](003-renderer-main-daemon-path.md),
[`docs/05-gui-spec.md`](../05-gui-spec.md),
[`docs/09-open-questions.md` #19](../09-open-questions.md).

## Context

[`docs/05-gui-spec.md` § "Unsolicited events"](../05-gui-spec.md) commits the
Session Monitor and `myclaude sessions list --follow` to a daemon-pushed
event stream. The Phase 2 sprint-2 IPC ([ADR
003](003-renderer-main-daemon-path.md)) shipped only request/response
pairs; open question #19 deferred the schematization to milestone 5.

Three consumers need real-time session state:

1. **Renderer Session Monitor.** Tab-switchable screen that lists every
   session, displays live status, and offers Kill / Relaunch / Drift
   actions. Polling produces visible lag and burns the daemon socket.
2. **CLI `sessions list --follow`.** Operator wants to watch a sequence
   of session events (e.g. "killed", "drifted", "exited") interleaved with
   their other terminal output. Polling at 1 Hz mis-orders concurrent
   events and is wasteful when sessions are quiet.
3. **Future: capability rotation hooks.** Out of M5 scope, but the same
   channel could in principle deliver `auth.rotate` invalidations to live
   sessions.

The questions:

- What protocol envelope do push frames use?
- Where does subscription state live?
- How does Main fan out events to Renderer windows that cannot speak
  daemon directly (per ADR 003)?

## Decision

Adopt a **third envelope type** in the IPC protocol — alongside `Req` and
`Resp` — and carry session lifecycle frames on it.

### Wire format

`packages/ipc-protocol/src/messages.ts`:

- `EvtSessionsEvent` (Zod): `{ kind: "sessions.event", sessionId, event:
  "started" | "idle" | "exited" | "killed" | "drifted", exitCode?, ts }`.
  No `id` field (events are unsolicited; there is no matching request).
- `Evt = z.discriminatedUnion("kind", [EvtSessionsEvent])` — extensible for
  future channels.
- `Frame = z.discriminatedUnion("kind", [...all Resp variants, EvtSessionsEvent])`
  so a peer can parse any inbound frame.
- `ReqSessionsSubscribe` / `RespSessionsSubscribeOk` — idempotent ack;
  no body beyond the literal kind.

### Server (`packages/ipc-protocol/src/server.ts`)

- Per-channel subscriber Set on `DaemonServer`. Today only one channel
  exists (`"sessions"`); the channel-routing helper is exhaustive over
  `EvtT.kind` so a future event kind that adds another channel forces the
  router update.
- `sessions.subscribe` is **framework-owned** (mirrors how `hello` is
  handled). The handler attaches the connection to `subscribers
  .get("sessions")` and acks. On socket `close`, the server-side cleanup
  removes the connection from every channel.
- `DaemonServer.broadcast(evt, predicate?)` walks the subscriber set,
  applies the optional predicate, encodes the event with the existing
  `encodeMessage` codec (no `id`), and writes to each socket. Encoder
  errors and per-peer write failures are swallowed so a single bad
  subscriber cannot block the broadcast loop.
- `drainAndClose` was reordered: the server stops accepting connections,
  drains in-flight handlers, then **force-destroys** lingering
  subscribers, and finally awaits the listener-close callback. The
  previous order deadlocked when an idle subscriber held the connection
  open.

### Client (`packages/ipc-protocol/src/client.ts`)

- `DaemonClient` extends Node's `EventEmitter` with a typed
  `DaemonClientEvents` map: `"sessions.event"` carries the validated
  `EvtSessionsEventT`.
- The inbound dispatcher checks for an `id` field first. Frames with `id`
  go through the existing pending-request resolver; id-less frames are
  parsed via `Evt.safeParse` and emitted on the matching event name.
  Unknown event shapes are silently dropped (forward-compat).
- `subscribe(channel: "sessions"): Promise<void>` is a typed helper that
  exchanges the `sessions.subscribe` request and awaits the ack.
- `close()` calls `removeAllListeners()` so a leaked listener cannot
  outlive the socket.

### Daemon write-side (`apps/desktop/src/main/daemon`)

- `WriteHandlerDeps` accepts an optional `broadcast(evt: EvtT)` callback.
  `lifecycle.ts` injects `evt => server.broadcast(evt)` lazily so the
  closure captures the (still-null) server before `start()` runs.
- Every session lifecycle handler that produces an audit row also
  broadcasts: `session.start` → `started`, `session.end` → `exited`,
  `runSessionCleanup` → `exited`, `sessions.kill` → `killed`,
  `sessions.relaunch` → `started` (new id), `sessions.drift` →
  `drifted` (only when actually drifted).
- The same `LiveSessionsMap` is shared between the read-side
  `sessions.list` enricher and the write-side state mutators so liveness
  fields stay coherent.

### Main → Renderer fan-out (`apps/desktop/src/main/index.ts`)

- ADR 003 forbids direct Renderer ↔ daemon connections. We keep that
  invariant.
- `startDaemonEventClient(myClaudeHome, version)` opens **one** long-lived
  `DaemonClient` at app startup. It calls `subscribe("sessions")` and
  forwards each `sessions.event` frame to every `BrowserWindow` via
  `webContents.send("myclaude.sessions.event", { kind: "event", event })`.
- On disconnect, exponential-backoff reconnect (1s → 30s cap). The Main
  process emits `{ kind: "connection", state: "down" }` while
  disconnected and `{ kind: "connection", state: "up" }` once a fresh
  subscription is established. Renderer hooks switch to a 5-second
  polling loop on `down` and resnapshot on `up`.

### CLI (`apps/cli/src/commands/sessions.ts`)

- `sessions list --follow` opens a daemon-required transport, calls
  `transport.sessionsSubscribe({ onEvent })`, and prints each event as a
  formatted line (or one JSON object per line in `--json` mode). A
  one-shot SIGINT handler disposes the subscription and closes the
  transport before exiting cleanly.

## Considered alternatives

1. **Polling only.** Renderer would `sessions.list` every 1–2 seconds.
   Simpler, but: visible UX lag, mis-orders concurrent state changes,
   wastes the daemon socket for idle sessions, and doesn't satisfy the
   spec language on `sessions.onUpdate`. Rejected.
2. **Side-channel filesystem notifications.** Daemon writes to a marker
   file under `~/.myclaude/`, clients use `chokidar`. Possible, but adds
   another moving part subject to the same atomicity / permissions
   pitfalls as the audit log; would not unify CLI and Renderer. Rejected.
3. **Per-event direct daemon socket from the Renderer.** Violates ADR 003
   and would require a separate Renderer-side cookie + socket-path
   resolver. Hard rejection.
4. **Promise-stream subscriptions.** A `subscribe()` that returns an async
   iterable from the same `request()` slot. Tempting, but conflates two
   protocol primitives and complicates the request/response state
   machine. The `id`-less push frame is the simpler factoring.

## Trade-offs

- **Protocol complexity:** the codec now ships three envelope shapes
  instead of two. Mitigated by the symmetric `Frame = Resp ∪ Evt` helper
  and the discriminated-union router in the client.
- **Long-lived daemon client in Main:** diverges from the otherwise
  short-lived `withDaemonClient` pattern. The reconnect logic is the
  one place where Main owns transport state; we keep it small (a single
  module) and surface up/down notices to the Renderer so failures are
  visible.
- **Single channel today.** The framework supports multiple channels and
  the channel-routing helper is exhaustive, but only `"sessions"` exists.
  Future channels (e.g. `auth.rotate`-driven invalidations, watcher
  events) follow the same recipe.

## Consequences

- **Renderer Session Monitor** updates in real time without polling under
  normal conditions; falls back to a 5-second poll only when the daemon
  connection is down.
- **CLI `--follow`** lets operators tail session events for monitoring
  and debugging; clean SIGINT teardown matches the ergonomics of
  `tail -f`.
- **Future event channels** (Phase 3) reuse the same envelope, the same
  `subscribe`/`broadcast` plumbing, and the same Renderer
  `connection: up/down` semantics.

## References

- [`packages/ipc-protocol/src/messages.ts`](../../packages/ipc-protocol/src/messages.ts) — `EvtSessionsEvent`, `Evt`, `Frame`, `ReqSessionsSubscribe`.
- [`packages/ipc-protocol/src/server.ts`](../../packages/ipc-protocol/src/server.ts) — broadcast + drain.
- [`packages/ipc-protocol/src/client.ts`](../../packages/ipc-protocol/src/client.ts) — typed event emitter + subscribe.
- [`apps/desktop/src/main/index.ts`](../../apps/desktop/src/main/index.ts) — `startDaemonEventClient`.
- [`apps/cli/src/commands/sessions.ts`](../../apps/cli/src/commands/sessions.ts) — `list --follow`.
- [`docs/impl/phase-2-sprint-5-auth-vault-session-monitor.md`](../impl/phase-2-sprint-5-auth-vault-session-monitor.md) — plan-as-shipped.
