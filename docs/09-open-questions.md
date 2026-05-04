# 09 — Open Questions

## TL;DR

Ten trade-offs that are deliberately unresolved in the baseline design. Each one has a working assumption for Phase 1 plus a clear signal that would cause us to revisit it. Owners for each are assigned during Phase 0; decisions get recorded here and then promoted into the relevant document. Don't treat any of the defaults below as permanent.

---

### 1. How sophisticated should merge directives be?

**The question:** Do we need both `__extends` (textual inheritance from a specific named scope) *and* `__merge: "deep"` (local deep-merge flag)? Claude-research (§1.3) argues yes — they cover different ergonomics. ChatGPT-research (§1) argues for a pure-functional approach with fewer directives.

**Working assumption (Phase 1):** Ship both. Reconsider after three months using local config review, user reports, or a future opt-in aggregate allowed by [`open-source-health-metrics.md`](open-source-health-metrics.md).

**Revisit signal:** If local evidence, user reports, or future opt-in telemetry shows < 5% of real profiles use `__extends`, remove it and simplify the docs.

---

### 2. Persona cascade semantics

**The question:** How do multiple `CLAUDE.md` layers merge? Three candidates:

- **Concat with source markers** (working assumption): Each source concatenated with `<!-- source: scope-name -->` comments. Simple, preserves all content, human-readable. Risk: contradictory instructions pile up.
- **Template render (Jinja / mustache)**: Each layer is a partial; an outer template composes them. More control, steeper learning curve.
- **Replace (last-wins per section)**: Split on `##` headers, later scopes replace matching section titles. Predictable but loses content unless the user reformats.

Similarly for agents/skills/commands: **copy (working)** vs symlink (Windows-hostile) vs "virtual file layer."

**Working assumption (Phase 1):** Concat for `CLAUDE.md`; copy for agents/skills/commands; seed-only for memory.

**Revisit signal:** First real-world bug report that CLAUDE.md sections conflict badly; or ≥ 10 GitHub issues requesting Jinja-style templating.

---

### 3. Monorepo detection fallback order

**The question:** What is the walk order for monorepo marker files?

**Decision (2026-05-04):** Phase 3 Milestone 3 ships manual marker detection
without adding `identify-monorepo-root`. The detection order is:

```
pnpm-workspace.yaml → nx.json → turbo.json → lerna.json →
rush.json → package.json with "workspaces" field → git root
```

Only the current root-to-`cwd` chain is surfaced as workspace candidates in
v1. Marker-only directories do not become cascade scopes unless they contain
`.myclaude/`, and lockfiles are not treated as workspace markers.

**Risk:** Custom monorepos (yarn v1 workspaces, hand-rolled setups) may not hit any marker.

**Revisit signal:** User-reported doctor output, issues, or future opt-in aggregate data shows "cwd not recognized as monorepo" is a recurring setup blocker.

---

### 4. Telemetry opt-in policy

**The question:** Do we ever report crashes and anonymous usage metrics to Sentry / PostHog, and if so, is consent opt-out or explicit opt-in?

**Working assumption:** **Opt-in only, and not implemented yet.** Respect `DO_NOT_TRACK=1` as a hard refusal. Any future first-run dialog asks with the default unchecked. `MYCLAUDE_TELEMETRY=0` is the app-level kill switch.

**Revisit signal:** If Phase 3 beta feedback shows maintainers cannot diagnose crashes without uploaded diagnostics, first complete the event taxonomy, privacy review, consent copy, redaction tests, and kill-switch tests in [`open-source-health-metrics.md`](open-source-health-metrics.md). Only then reconsider telemetry scope and consent model.

**Constraints:**

- Never report secret values, sensitive secret names, keychain contents, profile contents, repo paths, usernames, raw command args, or MCP config bodies.
- Only report schema-validated error codes, status buckets, and stack frames from our own code after the taxonomy gates pass.
- All telemetry has a kill-switch via `MYCLAUDE_TELEMETRY=0`; `DO_NOT_TRACK=1` remains a hard refusal.

---

### 5. Auto-update channel model

**The question:** Offer `stable` / `beta` / `nightly`?

**Decision (2026-05-04):** Phase 3 Milestone 2 ships `stable` only. Packaged
macOS and Windows release builds use the public GitHub update path and a
release asset named `agent-profile-rollout.json` for deterministic staged
rollout. There is no `myclaude update --channel beta` command in this slice.

**Working assumption for future channels:**

- `stable` — default, signed releases, weekly cadence.
- `beta` — deferred until there is clear demand; it needs an explicit channel
  design before implementation.
- No `nightly` in v1 — reduces CI cost and attack surface.

**Revisit signal:** Community requests for rapid iteration on MCP client adapters.

---

### 6. When to revisit the MCP proxy gateway

**The question:** Gemini-research's proxy architecture is architecturally compelling but more complex. Under what conditions do we pick it up as v2?

**Signals that would warrant it:**

- Per-session startup cost (ephemeral-dir render + spawn) exceeds 500 ms on a representative workload and profiles complain.
- Namespace collisions between MCP servers from different scopes become a real source of bugs.
- MCP spec adds hot-reload; the "same-process swap" advantage becomes real.
- A user-facing need for cross-session MCP state (shared connection pool, shared cache) emerges.

**If none of these fire in the first 6 months post-GA, the proxy stays deferred indefinitely.**

---

### 7. Team / org profile registry

**The question:** Should there be a cloud-hosted or git-hosted "profile hub" where teams publish role definitions for others to pull?

**Working assumption:** Not in v1. Teams share via `<repo>/.myclaude/` committed to their repo.

**Revisit signal:** ≥ 3 design-partner orgs request it concretely. When we build it: almost certainly git-tracked (a public `myclaude-profiles` npm-like registry) rather than a hosted service, to avoid running identity + billing.

---

### 8. Session resumption

**The question:** Should the ephemeral session dir be retained after `claude` exits so `claude --resume` works cross-launch?

**Working assumption:** Default: GC on exit. Opt-in via `myclaude launch --retain-session` which keeps the dir for 24 h.

**Complication:** Claude Code's own session-resume feature may conflict with our per-session `CLAUDE_CONFIG_DIR`. The two systems need a defined interaction rule.

**Revisit signal:** User reports of "my session history is gone" or "Claude can't find my recent work." Phase 0 spike on resume should flag blockers.

---

### 9. Multi-account Claude.ai OAuth

**The question:** Anthropic currently says third-party tools shouldn't handle Claude.ai OAuth. If that policy changes, do we add it?

**Working assumption:** Non-goal for v1–v2. If Anthropic publishes a supported third-party OAuth flow, evaluate for v3.

**Constraint even if supported:** We would still treat OAuth-authenticated profiles as `authProfile`s with a new `mode: oauth-claudeai`, not as a parallel concept.

---

### 10. UI i18n (CLI + GUI messages)

**The question:** Docs are in English (decided). What about runtime messages in the CLI and GUI?

**Working assumption:** English-only in v1. Message catalog (`@formatjs/intl`) is scaffolded but ships with only `en`.

**Revisit signal:** GitHub traffic, download data, user reports, or future opt-in aggregate locale buckets show sustained demand from a non-English locale. Likely order: Turkish (requester), Spanish, Japanese.

---

### 11. `runtimePaths` ownership (resolved by Sprint 6)

**The question:** `EffectiveSessionConfig.runtimePaths` is typed `null` inside `packages/core`. When the Electron/session emitter fills it in, should the populated shape be:

- A **branded type exported from core** (so all layers share one canonical definition), or
- **Defined only in the session emitter package** (core sees an opaque placeholder)?

**Decision (Sprint 6):** The populated shape is owned by `packages/session-artifacts` for now as `SessionRuntimePaths`. Core remains pure and still returns `runtimePaths: null`; launch/daemon layers consume the artifact emitter result when they need concrete paths.

Current canonical fields:

```ts
{
  sessionDir: string;
  claudeConfigDir: string;
  mcpConfig: string;
  settings: string;
  apiKeyHelper: string | null;
  headersHelper: string | null;
  claudeMd: string | null;
}
```

**Revisit signal:** If we find runtimePaths fields that are meaningfully client-specific (CLI vs GUI), we split into `CoreRuntimePaths` + per-client extensions.

---

### 12. `__extends` same-precedence tie-breaking

**The question:** When a server named in `__extends: "<scope>"` exists in two lower-precedence layers at the same abstract scope level (e.g., two sibling `project-shared` nodes in a nested monorepo), which wins?

**Working assumption (Phase 1):** First-match-wins, searched in reverse-precedence order (highest-precedence lower layer first). This is what Sprint 1 implemented; it's implicit in the spec.

**Revisit signal:** First bug report where a user expected deeper-nested-project to win but shallower did, or vice versa. Needs to be made explicit in [`03-profile-schema.md`](03-profile-schema.md) regardless of the chosen semantics.

---

### 13. Fragment recursion guard location

**The question:** v1 says fragments cannot reference other fragments. The constraint is currently enforced structurally (the `FragmentDoc` schema has no `use:` field). If v2 adds fragment composition, cycle detection must go somewhere.

**Working assumption:** Leave a code comment at the fragment expander marking where a cycle check will need to live. No runtime check in v1.

**Revisit signal:** Any v2 RFC that proposes `use:` on fragments. Cycle detection becomes mandatory at that point.

---

### 14. Auth profile → cascade integration point

**The question:** `packages/core` parses and exports `AuthProfilesDoc` but `resolve()` doesn't read it. The integration point — where auth profile secret references are substituted into server `env` and `headers` — is not yet designed. It could live in:

- `packages/core` (pure secret-ref substitution using a pluggable resolver interface), or
- `packages/secrets` (owning the resolver), with core staying pure-parse.

**Working assumption:** Keep core pure. `packages/secrets` (future sprint) provides a `resolveSecrets(effective, authProfileDoc, keychain)` function that takes the core output and returns a materialized config.

**Revisit signal:** If CLI `render --resolve-secrets` or GUI "preview with secrets" ends up in two code paths with subtle drift, consolidate the logic into core behind an adapter.

---

### 15. `listOrphanedSessions` clock: `mtime` vs `birthtime` vs sentinel file (raised by Sprint 5)

**The question:** `packages/persona-deployer`'s `listOrphanedSessions` currently uses the session dir's `mtimeMs` as the age anchor. On Linux, `birthtime` is often unreliable (filesystem-dependent). But `mtime` advances every time a file inside the session is touched — including normal `claude` memory writes — making active sessions look young and potentially skewing GC.

**Working assumption (Phase 1):** `mtime` is acceptable for the 24h default threshold; actively-used sessions that should not be GC'd will naturally have recent `mtime`.

**Revisit signal:** When Sprint 7's session manager ships, write a `session.json` sentinel on `createSessionDir` containing `{ createdAt: <ISO>, sessionId }`. Switch `listOrphanedSessions` to use that timestamp and keep `mtime` only as a tiebreaker.

---

### 16. `atomicWrite` across filesystem mounts (raised by Sprint 5)

**The question:** `atomicWrite` in `packages/persona-deployer` uses `<path>.tmp-<random>` as a sibling of the target, then renames. `rename()` fails across filesystem mount boundaries. If session dirs are ever placed on a different filesystem from their target mount (e.g., tmpfs vs ext4), atomicity breaks.

**Working assumption (Phase 1):** We always create session dirs and write within them, so sibling temp files live on the same filesystem as the target. Document this invariant in the atomic-write helper's TSDoc and rely on the session-dir convention.

**Revisit signal:** User reports atomic-write failures with an `EXDEV` errno. Remediation: fall back to copy+unlink with a warning, or require callers to pass a temp-dir option co-located with the target.

---

### 17. `createSessionDir` should write a `session.json` sentinel (raised by Sprint 5)

**The question:** Currently `createSessionDir` returns `{ sessionId, sessionDir, claudeConfigDir }` but writes no metadata to disk. A `session.json` at the session root would carry `createdAt`, `sessionId`, and later (Sprint 7) the `(role, authProfileId, cwd)` triple — enabling robust GC, `myclaude sessions list`, and audit-log joins.

**Working assumption:** Add `session.json` in Sprint 7 when the session manager owns the full launch metadata. Sprint 5's persona-deployer only knows about the persona inputs; writing session metadata from there would couple concerns.

**Revisit signal:** If Sprint 6 or 7 needs per-session metadata before the session manager exists (unlikely but possible), we promote the sentinel into `packages/persona-deployer`.

---

### 18. Typed response-for-kind mapping in `DaemonClient.request<R>` (raised by Sprint 2)

**The question:** `DaemonClient.request<R extends RespT>(kind, data)` (in [`packages/ipc-protocol/src/client.ts`](../packages/ipc-protocol/src/client.ts)) does not statically constrain `R` to be the response variant matching `kind`. The caller picks the right type. A mapped type (`type RespFor<K extends ReqT['kind']> = ...`) would let the compiler enforce the pairing.

**Working assumption (Phase 2 milestone 2):** Defer the mapping. The kind set is small (six request kinds in this round) and likely to churn in milestones 3+ when write-side kinds and unsolicited events land. Adding the mapping now would invite refactor churn.

**Revisit signal:** Once the wire surface stabilizes (post-milestone 3 `safeStorage` + write kinds), introduce `RespFor<K>` and tighten the `request` signature. If two consecutive sprints add kinds without breaking existing ones, the surface is stable enough.

---

### 19. Unsolicited event channel (`sessions.event`) schematization (raised by Sprint 2) — *resolved Phase 2 milestone 5*

**The question:** [`docs/05-gui-spec.md` § "Unsolicited events"](05-gui-spec.md) describes `session.event` pushes from Main to subscribed clients (`sessions list --follow`, Renderer `sessions.onUpdate`). The Sprint 2 wire schema in [`packages/ipc-protocol/src/messages.ts`](../packages/ipc-protocol/src/messages.ts) does not include this kind — only request/response pairs.

**Resolution (2026-04-29, milestone 5):** Shipped the third envelope. `messages.ts` now exports an `Evt` discriminated union with `EvtSessionsEvent` (kinds: `started | idle | exited | killed | drifted`); `DaemonServer.broadcast(evt, predicate?)` walks per-connection subscriber sets; `DaemonClient` extends `EventEmitter` with a typed event map and a `subscribe("sessions")` helper that exchanges a `sessions.subscribe` request. CLI consumes the channel via `sessions list --follow`; Main consumes it through a long-lived event client and forwards each frame to every BrowserWindow as `myclaude.sessions.event`. Renderer falls back to a 5-second polling loop on `connection: down` notice. See [`adr/004-session-event-subscription.md`](adr/004-session-event-subscription.md).

---

### 20. Cookie file atomicity (raised by Sprint 2)

**The question:** [`packages/ipc-protocol/src/cookie.ts`](../packages/ipc-protocol/src/cookie.ts) writes `~/.myclaude/ipc-cookie` with `writeFile` followed by `chmod 0600`, not the safer write-tmp + rename pattern that `packages/persona-deployer`'s `atomicWrite` uses.

**Working assumption (Phase 2 milestone 2):** Acceptable in the single-writer-per-boot model. The cookie is rotated at most once per daemon startup and the writer is always Main; the brief window between `writeFile` and `chmod` is not exploitable by a same-user attacker because the parent directory is `0700`.

**Revisit signal:** If multi-writer rotation ever becomes a feature (e.g., daemon restart without a full Main relaunch, or a watchdog re-rotating mid-session), switch to write-tmp + rename to keep the file atomically observable from readers.

---

### 21. Peer-uid check on POSIX (raised by Sprint 2)

**The question:** Node has no built-in `SO_PEERCRED` (Linux), `LOCAL_PEEREID` (macOS), or equivalent binding. [`docs/06-security.md` § "IPC authentication"](06-security.md) calls for a peer-uid check on `accept`. This cannot be truly enforced without a native module.

**Decision (2026-05-04):** `packages/ipc-protocol` now exposes a host-owned peer-verification hook that runs immediately after socket accept and before handshake data is read. `apps/desktop` wires its `verifyPeer` function into that hook, but `verifyPeer` remains a documented pass-through until native OS peer credentials are available.

**Working assumption:** The `0600` socket file plus per-user runtime-dir gating (`$XDG_RUNTIME_DIR` or `/tmp/myclaude-<uid>.sock` mode `0600`) provides the different-user barrier on POSIX today. Combined with the cookie handshake and version check, this remains acceptable under the same-user threat model while the native peer-credential layer is pending.

**Revisit signal:** Adopt a small native module (or a Node N-API binding to `getpeereid`/`getsockopt(SO_PEERCRED)`) when one of: (a) a same-user-different-process confused-deputy scenario surfaces in security review; (b) Node ships a built-in API for peer credentials; (c) the daemon ever runs setuid or with elevated privileges (it does not today and is not expected to).

---

### 22. `loadAuthProfiles` implicit `MYCLAUDE_HOME` fallback (raised by Sprint 2)

**The question:** [`packages/cli-services`](../packages/cli-services/src/index.ts) re-exports `loadAuthProfiles`, which keeps an implicit fallback to `process.env.MYCLAUDE_HOME ?? os.homedir()` when callers don't pass `home`. This is convenient for the CLI but the daemon always passes `home` explicitly to keep its execution context pure.

**Working assumption (Phase 2 milestone 2):** Keep the fallback for CLI parity with Phase 1. The daemon does not rely on it.

**Revisit signal:** Once every caller in the workspace passes `home` explicitly (audit at the end of milestone 3), remove the fallback so the loader becomes a pure function. Removing it earlier would require updating every CLI command in the same change.

---

### 23. Documentation typo: `dameonVersion` in `docs/05-gui-spec.md` example payload (raised by Sprint 2)

**The question:** The `hello.ok` example payload at [`docs/05-gui-spec.md`](05-gui-spec.md) line 255 has a typo (`dameonVersion`). The implemented field is `serverVersion`, which is correct in [`packages/ipc-protocol/src/messages.ts`](../packages/ipc-protocol/src/messages.ts) (`RespHelloOk.serverVersion`).

**Working assumption (Phase 2 milestone 2):** Out of scope for this sprint (docs-only changes are limited to the new sprint plans, the ADR, the roadmap status, and this open-questions append). Fix the typo in the next docs pass.

**Revisit signal:** Next time `docs/05-gui-spec.md` is edited for any reason, correct the example payload to `serverVersion`. No code change is implied.

---

### 24. Audit log: JSONL → SQLite migration timing (raised by Sprint 3)

**The question:** [`docs/06-security.md` § "Audit log"](06-security.md) specifies a SQLite database at `~/.myclaude/audit.sqlite` with three tables. Sprint 3 ships an append-only JSONL log at `~/.myclaude/audit.log` whose row shapes map 1:1 to the planned SQLite columns. Adding the SQLite layer now would pull in `better-sqlite3` (a native module) and a migration shim for users who already have JSONL rows.

**Working assumption (Phase 2 milestone 3):** Stay on JSONL through milestones 4–7. The current write rate (one row per `auth.*`, `session.*`, `secret.get`) tops out around hundreds per day for a single user; JSONL is fine at that scale.

**Revisit signal:** Phase 3, when the auto-update / signing pipelines need a SIEM-friendly export. Move to SQLite + `audit export --since` then. The JSONL → SQLite shim reads the existing file once and inserts rows in order; the column shapes already match.

---

### 25. `safeStorage` `basic_text` policy on Linux headless (raised by Sprint 3)

**The question:** Electron's `safeStorage.getSelectedStorageBackend()` returns `"basic_text"` on Linux hosts without libsecret/kwallet. Sprint 3's `secrets-store.ts` flags this as `kind: "basic-text"` and the existing `assertSafe` policy in `@agent-profile/secrets` refuses to persist unless `MYCLAUDE_ALLOW_PLAINTEXT=1` is set.

**Working assumption (Phase 2 milestone 3):** Beta refuses to persist on `basic_text`. The CI escape hatch (`MYCLAUDE_ALLOW_PLAINTEXT=1`) keeps unit tests honest about the policy without persisting real secrets.

**Revisit signal:** Real Linux headless beta users hit this and ask for a "less aggressive" policy (e.g., per-secret opt-in instead of global). Likely outcome: keep the global gate, document the install hint more prominently in `myclaude doctor`.

---

### 26. Capability-token TTL semantics under wall-clock skew (raised by Sprint 3)

**The question:** `CapabilityIssuer.issue` and `CapabilityVerifier.verify` both use a `nowMs` callback defaulting to `Date.now`. Wall clock can move (NTP skew, sleep/wake, manual clock change). A token issued just before a forward jump could be rejected as expired even though no real time has passed.

**Working assumption (Phase 2 milestone 3):** Acceptable for now. The 60s default TTL absorbs most realistic skew, and the user-visible failure mode (`secret.get` returns AUTH; helper exits 6) is recoverable — Claude Code re-invokes `apiKeyHelper.sh` and the next invocation issues a fresh token via `session.start`.

**Revisit signal:** Bug reports of "Claude says my API key is bad after my laptop wakes up". Fix path: switch to a monotonic clock (`process.hrtime.bigint()`) for TTL math while keeping `Date.now` for audit timestamps. Both Issuer and Verifier need to share the monotonic origin.

---

### 27. Renderer → daemon access path (resolved by Sprint 4)

**The question:** Should the Renderer connect to the daemon socket directly,
or should every GUI request go through Electron Main?

**Decision (Phase 2 milestone 4):** Resolved: Renderer never talks to the
daemon socket. Preload exposes a narrow `window.myclaude` API; Main validates
the sender frame and payload, then delegates to the daemon with a short-lived
client. See [ADR 003](adr/003-renderer-main-daemon-path.md).

---

### 28. Renderer auth model before Auth Vault (raised by Sprint 4) — *resolved Phase 2 milestone 5*

**The question:** Profile Editor needs an auth selector to resolve effective
config, but Auth Vault is a later milestone. What can the Renderer know now?

**Working assumption (Phase 2 milestone 4):** Renderer may read auth metadata
only: id, display name, mode, and secret counts. Main always calls
`auth.list` without `includeRefs`, so the Renderer does not receive secret
refs or values. Secret creation/editing stays out of M4 and lands with Auth
Vault.

**Resolution (2026-04-29, milestone 5):** The metadata-only invariant holds.
Auth Vault uses a hybrid plaintext flow:
- `auth.add` — Renderer payload carries no secret value. Main opens a
  modal child `BrowserWindow` (data-URL HTML, dedicated preload exposing
  only `secretDialog.submit`/`cancel`) that collects the Anthropic API
  key locally. Plaintext lives in Main process memory only for the
  Promise's lifetime; it is base64-encoded and forwarded to the daemon.
- `auth.setSecret` / `auth.rotate` — Renderer modal with a
  `PasswordInput` (Show/Hide toggle, value held in component-local
  `useState`, cleared on close). The plaintext crosses the IPC bridge
  once, base64-encoded by Main, and never enters Jotai or any persistent
  store.
`auth.list` was **not** expanded with refs. See
[`apps/desktop/src/main/native-secret-dialog.ts`](../apps/desktop/src/main/native-secret-dialog.ts)
and [`apps/desktop/src/renderer/screens/auth-vault.tsx`](../apps/desktop/src/renderer/screens/auth-vault.tsx).

---

### 29. `profile.preview` draft model (raised by Sprint 4)

**The question:** Should preview model a full unsaved workspace of multiple
edited scope files, or just the currently selected draft?

**Working assumption (Phase 2 milestone 4):** Preview accepts one draft
`{ path, content }` and resolves it as a highest-precedence launch override.
This gives immediate diff feedback without introducing a multi-file edit
transaction model.

**Revisit signal:** If users edit several scope files before saving, add a
`drafts[]` overlay and a stable ordering rule. The daemon remains the preview
owner either way.

---

### 30. Canonical YAML save vs comment preservation (raised by Sprint 4)

**The question:** Should Profile Editor preserve comments and original YAML
formatting?

**Working assumption (Phase 2 milestone 4):** `profile.save` validates
`ScopeDoc`, canonicalizes key order, and writes YAML atomically. Comments and
formatting are not preserved. This keeps M4 safe and predictable, but it is a
UX trade-off.

**Revisit signal:** First beta feedback that users rely on comments in scope
files. Likely fix: parse with YAML CST, apply structured edits to the existing
document, and keep canonical write as an explicit "format document" command.

---

## How decisions are recorded

Once a question resolves, we:

1. Pick a decision.
2. Write a short ADR-style note under `docs/adr/NNN-<topic>.md` (the first ADR is [`docs/adr/001-capability-package.md`](adr/001-capability-package.md)).
3. Update the affected canonical document (e.g., if #2 resolves, update `02-architecture.md#persona-deployment`).
4. Remove the item from this file OR mark it `Resolved: see ADR-NNN`.

## Related documents

- The decisions that *are* baseline: `docs/README.md` (four-decision table) and [`00-overview.md`](00-overview.md)
- Where each resolution would land: linked inline above
