# ADR 005 — Persona render path is in-memory and Renderer-visible

**Status:** Accepted (2026-04-29, Phase 2 milestone 6).
**Owners:** Phase 2 Renderer working group.
**Related:** [`adr/003-renderer-main-daemon-path.md`](003-renderer-main-daemon-path.md),
[`adr/004-session-event-subscription.md`](004-session-event-subscription.md),
[`docs/05-gui-spec.md`](../05-gui-spec.md),
[`docs/06-security.md`](../06-security.md),
[`docs/09-open-questions.md`](../09-open-questions.md) #28.

## Context

The Phase 2 milestone 6 Persona Composer screen needs a non-mutating
preview of the persona section the launch path would deploy: the rendered
`CLAUDE.md` (combined and per-fragment), agents, skills, slash commands,
and memory seeds. The persona-deployer's existing `deployPersona` is
disk-only — every file goes through `atomicWrite` into an ephemeral
session directory. Calling `deployPersona` from the GUI would create a
fresh session directory on every render, which:

- pollutes the user's `~/.myclaude/sessions/` with throwaway dirs,
- requires GC bookkeeping the GUI doesn't otherwise need,
- defeats the launch-path's contract (a session dir implies a launch is
  imminent).

The IPC layer also needs a wire shape. Two structural questions:

1. **Where does the in-memory render live?** Inside `deployPersona`'s
   module so the disk-write and in-memory paths share helpers, or in a
   separate package that re-implements the render?
2. **Can the Renderer see persona file contents?** Open question #28
   resolved that secret refs stay metadata-only. Persona files are
   markdown / yaml / json text — never secrets — but the boundary should
   be codified.

## Decision

### A. Add `persona.render` as a new IPC kind

`packages/ipc-protocol/src/messages.ts` carries a new `ReqPersonaRender`
+ `RespPersonaRenderOk` pair, appended to the `Req`, `Resp`, and `Frame`
discriminated unions. The request body is `{ role, authProfileId, cwd }`
(Zod strict). The response carries:

- `claudeMd: { combinedContent, sections } | null` — combined rendered
  Markdown plus a per-fragment array (each section has `sourcePath`,
  `originScope`, raw `content`).
- `files: PersonaFileWire[]` — flat list across `agents`, `skills`,
  `slashCmds`, `memory`. Each file carries `category`, `basename`,
  `sourcePath`, `originScope`, and utf-8 `content`.
- `collisions: PersonaCollisionWire[]` — `(category, basename)` groups
  with `winningSource` + `overriddenSources[]`.
- `missingSources: PersonaMissingWire[]` — `(category, sourcePath)` for
  refs that did not resolve.

Persona content travels as **utf-8 strings**. Base64 is reserved for
secrets; persona files are not credentials.

### B. Extract `renderPersonaInMemory` from persona-deployer

`packages/persona-deployer/src/render.ts` exports the new function:

```ts
renderPersonaInMemory(input: {
  effective: EffectiveConfig["persona"];
  provenanceMap: Record<string, ScopeName>;
  onMissingSource?: "throw" | "skip";
}): Promise<PersonaRenderResult>
```

`buildClaudeMd` and `copyFiles` were refactored internally so the
disk-write path and the in-memory path share the same source-of-truth.
No external signature changed; `deployPersona` continues to return the
exact `DeploymentResult` shape Phase 1 callers expect. The two paths
emit byte-for-byte identical CLAUDE.md content for the same input.

### C. Renderer untrusted boundary extends to persona content

ADR 003 invariants hold:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webSecurity: true`.
- Renderer talks only to the preload bridge (`window.myclaude.persona
  .render(opts)`); the Renderer never imports `@agent-profile/ipc-protocol`,
  Electron internals, or filesystem APIs.
- Main validates `event.senderFrame.url` and Zod-narrows the payload
  before opening the daemon connection.

Persona content is permitted on this channel because:

- The files originate under the user's own `~/.myclaude/persona/` or
  `<project>/.myclaude/persona/` paths — already user-readable; the
  Renderer process trust model gains no new attack surface.
- Cascade does not resolve `${secret:foo}` placeholders during rendering;
  resolution happens only on the launch path via `resolveSecrets`. So
  even if a fragment names a secret reference, the in-memory render
  never substitutes plaintext.
- The Renderer still defers to `redactText` (Phase 2 milestone 5
  helper) when any cascade output flows into a UI surface that could
  contain `${secret:…}` or `keyring://…` patterns; the Composer's text
  preview surfaces persona content verbatim because Markdown / code
  bodies should not pass through a secret-pattern filter (high
  false-positive rate). The Provenance Inspector continues to apply
  `redactText` on env / mcpServers value displays.

## Alternatives considered

1. **Extend `profile.show.ok` with rendered persona.** Rejected. Couples
   two concerns (effective-config preview and persona disk preview) into
   a single response, bloating the payload for callers that only want
   provenance. Persona render takes a few extra disk reads — not free —
   so making it implicit on every `profile.show` would also pessimise
   the Profile Editor's hot path.

2. **Renderer reads persona files via a Main `fs` proxy.** Rejected.
   Violates ADR 003: it gives the Renderer access to a generic
   `system.readFile` API, which becomes a direct exfiltration channel
   if the renderer is compromised. The narrow `persona.render` channel
   is auditable and bounded to cascade output.

3. **Renderer renders persona client-side from `effective.persona`
   path arrays.** Rejected. The Renderer would need to know how to
   resolve relative paths, expand `~`, find project chains, follow
   provenance maps — all logic that already lives in core +
   persona-deployer. Duplicating it Renderer-side risks drift.

4. **Reuse `deployPersona` against a tmpdir.** Rejected. Costs
   filesystem I/O per render, leaves dangling tmp dirs on hard quits,
   and ties the GUI to the session-dir convention even when no launch
   is happening.

## Trade-offs

- **Wire payload size.** A persona library with many files emits a
  larger response. Today this is fine (typical libraries are dozens of
  short markdown files). If sizes grow to MBs, Phase 3 may add
  pagination or streaming on the same kind. The wire shape stays
  stable; the change would be optional fields like `cursor` / `pageSize`.
- **Render duplication.** The launch path still goes through
  `deployPersona` + `atomicWrite`. The in-memory path goes through
  `renderPersonaInMemory`. Both consume the same `buildClaudeMdSections`
  + `readCategoryFiles` helpers, so the rendered CLAUDE.md content is
  identical, but two top-level entry points exist. Acceptable cost for
  the cleaner separation of concerns.
- **Renderer-side category naming.** The internal `FileCategory` enum
  in persona-deployer uses `"commands"` for slash commands; the public
  `PersonaRenderFile.category` maps that to `"slashCmds"` to match the
  `EffectiveConfig.persona.slashCmds` array name. The translation
  happens inside `renderPersonaInMemory` and at the wire boundary; the
  daemon transport on the CLI side reverses it for collision-log
  emission. Documented; no future change anticipated.

## Consequences

- **Persona Composer screen.** `window.myclaude.persona.render` returns
  enough data to populate the catalog (combined CLAUDE.md + per-section
  fragments + agents/skills/slashCmds/memory) and the Monaco read-only
  preview. Collisions and missing-source counts surface as banners.
- **CLI parity.** `myclaude render persona [--role <r>] [--auth <a>]
  [--json]` provides the same in-memory render at the terminal. Both
  the daemon path (when running) and the in-proc path (standalone CLI)
  call the same `personaRenderService`.
- **Provenance Inspector** is purely Renderer-side; no new IPC kind.
  The cascade provenance from `profile.show.ok` is rich enough.
- **Future kinds** that need a similar read-only IPC surface follow the
  same recipe: append a request + response pair to `messages.ts`,
  declare a Zod-strict payload, register a daemon handler that
  delegates to a cli-services service, and expose a
  `window.myclaude.<channel>` method through the preload bridge.

## References

- [`packages/ipc-protocol/src/messages.ts`](../../packages/ipc-protocol/src/messages.ts)
  — `ReqPersonaRender`, `RespPersonaRenderOk`, supporting wire schemas.
- [`packages/persona-deployer/src/render.ts`](../../packages/persona-deployer/src/render.ts)
  — `renderPersonaInMemory`.
- [`packages/cli-services/src/persona/render.ts`](../../packages/cli-services/src/persona/render.ts)
  — `personaRenderService`.
- [`apps/desktop/src/main/daemon/handlers.ts`](../../apps/desktop/src/main/daemon/handlers.ts)
  — daemon handler + projection.
- [`apps/desktop/src/main/index.ts`](../../apps/desktop/src/main/index.ts)
  — Main IPC bridge handler.
- [`apps/desktop/src/preload/index.ts`](../../apps/desktop/src/preload/index.ts)
  — `window.myclaude.persona.render`.
- [`apps/desktop/src/renderer/screens/persona-composer.tsx`](../../apps/desktop/src/renderer/screens/persona-composer.tsx)
  — Composer screen.
- [`apps/cli/src/commands/render-persona.ts`](../../apps/cli/src/commands/render-persona.ts)
  — CLI subcommand.
- [`docs/impl/phase-2-sprint-6-provenance-persona.md`](../impl/phase-2-sprint-6-provenance-persona.md)
  — plan-as-shipped.
