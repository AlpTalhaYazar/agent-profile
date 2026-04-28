# ADR 003 — Renderer reaches the daemon only through Main

## Status

Accepted (2026-04-28). Sprint: Phase 2 milestone 4 (Profile Editor).
Builds on [ADR 001](001-capability-package.md) and
[ADR 002](002-safestorage-migration-direction.md).

## Context

The Profile Editor is the first real Renderer screen. It needs profile
metadata, effective config previews, validation, and an explicit save path.
Those operations ultimately live behind the Main-owned daemon because the
daemon already owns the boot cookie, write handlers, `safeStorage`, audit log,
and capability-token registry.

The Renderer is still an untrusted web surface:

- `contextIsolation: true`
- `nodeIntegration: false`
- sandboxed BrowserWindow
- no direct `ipcRenderer` import in Renderer code
- no direct daemon socket access
- no secret values returned to Renderer

The tempting shortcut is to let Renderer open the local daemon socket with
`@agent-profile/ipc-protocol`. That would make the GUI look like another CLI
client, but it would also move socket discovery, cookie use, and future
credential-adjacent APIs into untrusted code.

## Decision

Renderer talks only to the preload bridge:

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

Preload forwards those calls to Electron Main via `ipcRenderer.invoke`. Main
then:

1. Validates `event.senderFrame.url` against the expected Renderer entry URL.
2. Narrows the payload with a channel-specific Zod schema.
3. Opens a short-lived `DaemonClient` using the local daemon socket and the
   Main-readable boot cookie.
4. Delegates to the daemon request kind.
5. Returns only the response fields allowed for Renderer.

The daemon remains the write authority. `profile.save` persists only after
the daemon validates the `ScopeDoc` payload and allowlists the target path.
`auth.list` is exposed without `includeRefs`; Renderer receives auth metadata
only, not secret refs or values.

## Alternatives considered

1. **Renderer connects directly to the daemon socket.** Rejected. It pushes
   socket discovery, cookie handling, and future daemon auth policy into an
   untrusted frame. A compromised Renderer would gain the same raw daemon
   transport as the CLI.
2. **Renderer calls Main services directly, bypassing the daemon.** Rejected.
   It would split write policy between Main IPC handlers and daemon handlers,
   increasing the chance that CLI and GUI saves validate different things.
3. **Expose broad generic IPC (`myclaude.request(kind, payload)`).** Rejected.
   It makes auditing the Renderer surface harder. Named bridge methods keep
   channel ownership explicit and prevent accidental exposure of future daemon
   kinds.

## Consequences

- Main is the only process that reads the boot cookie for Renderer-initiated
  calls.
- Renderer bundle does not import `@agent-profile/ipc-protocol`, `node:net`,
  `node:fs`, Electron, or secrets packages.
- Every Renderer channel has two validation gates: sender-frame validation and
  payload schema validation.
- CLI and GUI share daemon behavior because Main delegates to the same daemon
  request kinds rather than reimplementing profile writes locally.
- The cost is one local loopback hop per Renderer request. Profile Editor calls
  are user-driven and short-lived, so this is acceptable.

## References

- [`docs/02-architecture.md`](../02-architecture.md) — Renderer trust boundary.
- [`docs/05-gui-spec.md`](../05-gui-spec.md) — Renderer ↔ Main IPC and Profile Editor.
- [`docs/06-security.md`](../06-security.md) — `contextBridge` and sender-frame validation.
- [`apps/desktop/src/preload/index.ts`](../../apps/desktop/src/preload/index.ts).
- [`apps/desktop/src/main/index.ts`](../../apps/desktop/src/main/index.ts).
- [`apps/desktop/src/main/security.ts`](../../apps/desktop/src/main/security.ts).
