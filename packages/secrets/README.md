# @agent-profile/secrets

OS-keychain-backed secret store and resolver for `@agent-profile/core` effective configs.

## Overview

This package provides:

- **CRUD operations** against the OS keychain (`getSecret`, `setSecret`, `removeSecret`, `listSecretKeys`, `hasSecret`)
- **Secret resolver** that materializes all secret references in a cascaded `ScopeDocT` config (`resolveSecrets`)
- **Pluggable `Backend` interface** — currently implemented by `@napi-rs/keyring`; Phase 2 will add a `safeStorage` adapter
- **Namespacing** — all keys stored under `agent-profile.<service>.<account>`

## Secret reference formats

Three forms are supported:

| Form | Source | Example |
|---|---|---|
| `keyring://svc/acct` | OS keychain directly | `keyring://figma/work` |
| `${secret:name}` | `authProfile.mcpSecretRefs[name]` → keyring URI | `${secret:github.pat}` |
| `${env:VAR}` | `process.env.VAR` at resolve time | `${env:POSTGRES_HOST}` |

## Security notes

- Secrets **never appear in logs**, error messages, or the resolution log.
- On Linux with the `basic-text` backend (no libsecret/kwallet), write/read/remove ops throw `BackendUnsafeError` unless `MYCLAUDE_ALLOW_PLAINTEXT=1` is set.
- **`ANTHROPIC_API_KEY` is NOT materialized by `resolveSecrets`**. The Anthropic API key is delivered to Claude Code via `apiKeyHelper.sh` in Sprint 5 (session manager). See `src/resolver/resolve-secrets.ts` for the TODO marker.

## Dependency injection

All CRUD functions and `resolveSecrets` accept an optional `backend` parameter. In tests, **always inject a `MockBackend`** to avoid touching the real OS keychain:

```ts
import { MockBackend } from "@agent-profile/secrets/test/helpers/mock-backend.js";

const backend = new MockBackend("keychain-macos");
await setSecret("svc", "acct", "value", backend);
```

## Linux `basic-text` fallback

On Linux without libsecret or kwallet, `@napi-rs/keyring` falls back to `basic-text` (plaintext file storage). This is considered unsafe and is refused by default:

```
Error: Linux secret service unavailable (basic_text backend detected).
Fix:
  Debian/Ubuntu:  sudo apt install libsecret-1-0 gnome-keyring
  Fedora:         sudo dnf install libsecret
  Arch:           sudo pacman -S libsecret

Alternatively, set MYCLAUDE_ALLOW_PLAINTEXT=1 if you understand the risk
(e.g., CI containers with ephemeral filesystem and no network-accessible secrets).
```

## Exports

```ts
// Backend
getBackend, isBackendSecure
type Backend, KeychainBackend

// CRUD
getSecret, setSecret, removeSecret, listSecretKeys, hasSecret

// Namespacing
toKeyringKey, parseKeyringUri

// Resolver
resolveSecrets
type ResolveSecretsInput, ResolveSecretsResult, MissingRef
type ResolutionLogEntry, ResolutionSource

// Errors
SecretNotFoundError, KeychainUnavailableError, BackendUnsafeError, InvalidSecretRefError
```
