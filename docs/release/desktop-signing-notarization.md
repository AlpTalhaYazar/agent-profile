# Desktop Signing and Notarization Runbook

This runbook covers the Phase 3 desktop release path for maintainers. The
release workflow builds Electron Forge artifacts, verifies fuses, platform
signing expectations, and update metadata where supported, and can publish a
draft GitHub Release from an existing `v*` tag.

## Current artifact matrix

| Platform | Runner | Arch | Makers | Signing state | Verification |
|---|---|---:|---|---|---|
| macOS | `macos-15-intel` | `x64` | ZIP, DMG | Developer ID signed and notarized | signature + notarization + updater ZIP required |
| macOS | `macos-15` | `arm64` | ZIP, DMG | Developer ID signed and notarized | signature + notarization + updater ZIP required |
| Windows | `windows-2025` | `x64` | Squirrel | Authenticode signed | signature + Squirrel update metadata required |
| Linux | `ubuntu-24.04` | `x64` | deb, rpm, ZIP | unsigned in Phase 3 M1 | unsigned artifacts allowed |

There is no AppImage maker in Phase 3 M1. Linux GPG signing and AppImage
distribution remain outside this milestone. Linux auto-update is also deferred
to a future signed Linux distribution strategy.

## Release gate

Forge signing is enabled only when:

```sh
AGENT_PROFILE_RELEASE=1
```

Without that environment variable, Forge can package local development builds
without requiring release credentials. The release workflow sets the variable
only on macOS and Windows signing jobs after preparing the platform signing
environment.

## Required GitHub secrets

macOS release jobs use:

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE_BASE64` | Base64-encoded Developer ID `.p12` certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the Developer ID certificate |
| `APPLE_CODESIGN_IDENTITY` | Code-signing identity passed to Forge |
| `APPLE_KEYCHAIN_PASSWORD` | Temporary CI keychain password |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect API key `.p8` |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer UUID |

Windows release jobs use:

| Secret | Purpose |
|---|---|
| `WINDOWS_CERTIFICATE_PFX_BASE64` | Optional base64-encoded Authenticode PFX |
| `WINDOWS_CERTIFICATE_PASSWORD` | Optional PFX password |
| `WINDOWS_SIGN_WITH_PARAMS` | Optional custom `signtool` parameters for HSM/EV signing |

## Required GitHub variables

Windows HSM/custom signing can also use:

| Variable | Purpose |
|---|---|
| `WINDOWS_SIGNTOOL_PATH` | Optional custom `signtool.exe` path |
| `WINDOWS_TIMESTAMP_SERVER` | Optional timestamp server URL |

Windows signing supports either:

- PFX signing with `WINDOWS_CERTIFICATE_PFX_BASE64` and
  `WINDOWS_CERTIFICATE_PASSWORD`.
- HSM/custom `signtool` signing with `WINDOWS_SIGN_WITH_PARAMS`, plus optional
  `WINDOWS_SIGNTOOL_PATH` and `WINDOWS_TIMESTAMP_SERVER`.

## Forge signing environment

The macOS Forge config expects these environment variables after the workflow
imports the certificate and API key:

```sh
AGENT_PROFILE_RELEASE=1
APPLE_CODESIGN_IDENTITY=...
APPLE_KEYCHAIN=...
APPLE_API_KEY_PATH=...
APPLE_API_KEY_ID=...
APPLE_API_ISSUER=...
```

The Windows Forge config expects one of these sets:

```powershell
$env:AGENT_PROFILE_RELEASE = "1"
$env:WINDOWS_CERTIFICATE_FILE = "C:\path\to\certificate.pfx"
$env:WINDOWS_CERTIFICATE_PASSWORD = "..."
```

or:

```powershell
$env:AGENT_PROFILE_RELEASE = "1"
$env:WINDOWS_SIGN_WITH_PARAMS = "..."
$env:WINDOWS_SIGNTOOL_PATH = "C:\path\to\signtool.exe" # optional
$env:WINDOWS_TIMESTAMP_SERVER = "https://timestamp.example" # optional
```

## Manual dry run

Use the release workflow manually without publishing a GitHub Release:

1. Open **Actions > Release Desktop > Run workflow**.
2. Select the branch or tag to build.
3. Leave `tag` empty to build the selected ref, or enter an existing `v*` tag
   to dry-run that tag without publishing.
4. Keep `publish_release` set to `false`.
5. Run the workflow.

The workflow will package, make, verify, and upload artifacts as workflow
artifacts. It will not create a GitHub Release.

## Auto-update staged rollout

Packaged macOS and Windows builds use the public GitHub update path through
`update.electronjs.org`. The app checks updates only in packaged release builds
after local policy gates pass. Dev, test, Vitest, unpackaged builds, Linux,
Windows Squirrel first-run, and `MYCLAUDE_UPDATES=0` do not check the network.
Headless daemon mode is also disabled by default unless `MYCLAUDE_UPDATES=1` is
set explicitly.

Publishing creates a release asset named `agent-profile-rollout.json`:

```json
{
  "version": "0.0.1",
  "channel": "stable",
  "stagingPercentage": 5
}
```

The default workflow value is `5`. Maintainers can ramp to `25` and `100` by
replacing this JSON asset on the draft/published release. The staged rollout is
client-side and deterministic: Main stores a random local install id and hashes
it with the target version. This is not telemetry and does not upload machine,
user, repo, profile, session, or secret data.

There is no signed `latest.yml` in the current Forge pipeline. Do not describe
update metadata as cryptographically signed; the signed artifacts are the app
bundles/installers verified by this runbook.

## Tag publish

Publishing always uses an existing `v*` tag. The workflow validates the tag for
manual publish runs and the publish job creates a draft release with:

```sh
gh release create "$TAG" ... --draft --generate-notes --verify-tag
```

There are two supported publish paths:

1. Push a `v*` tag. The release workflow treats tag pushes as publish runs.
2. Run the workflow manually with `publish_release=true` and `tag` set to an
   existing tag such as `v1.2.3`.

The release is a draft. A maintainer must review the uploaded artifacts and
release notes before publishing it publicly.

## Local verification commands

Run these after `pnpm -C apps/desktop package` and
`pnpm -C apps/desktop make` for the target platform and architecture:

```sh
pnpm -C apps/desktop verify-release -- --platform darwin --arch x64 --require-signature --require-notarization --require-update-artifacts
pnpm -C apps/desktop verify-release -- --platform darwin --arch arm64 --require-signature --require-notarization --require-update-artifacts
pnpm -C apps/desktop verify-release -- --platform win32 --arch x64 --require-signature --require-update-artifacts
pnpm -C apps/desktop verify-release -- --platform linux --arch x64 --unsigned-ok
```

The verifier also runs the strict Electron Fuses check against the packaged
binary before checking platform-specific artifacts.

## Troubleshooting

### Missing release environment

Symptom: Forge throws a missing environment variable error during macOS or
Windows packaging.

Check that `AGENT_PROFILE_RELEASE=1` was set only after the signing material was
prepared, and that all platform-specific variables listed above are present.
For local unsigned packaging, leave `AGENT_PROFILE_RELEASE` unset.

### Missing macOS signature

Symptom: `codesign --verify` or `spctl -a` fails.

Check `APPLE_CODESIGN_IDENTITY`, the imported `.p12`, and the temporary keychain
path in `APPLE_KEYCHAIN`. The identity must exist in that keychain and be
usable by `codesign`.

### Missing macOS notarization

Symptom: `xcrun stapler validate` fails.

Check `APPLE_API_KEY_PATH`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. The
packaged `.app` must be notarized and stapled before the verifier runs with
`--require-notarization`.

### Missing Windows signature

Symptom: `Get-AuthenticodeSignature` reports anything other than `Valid` for an
`.exe`, `.dll`, `.node`, or Squirrel setup executable.

For PFX signing, check `WINDOWS_CERTIFICATE_PFX_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD`. For HSM/custom signing, check
`WINDOWS_SIGN_WITH_PARAMS`, and confirm any custom `WINDOWS_SIGNTOOL_PATH` and
`WINDOWS_TIMESTAMP_SERVER` values are valid on the Windows runner.

### Linux signature failure

Symptom: the verifier rejects `--require-signature` for Linux.

This is expected in Phase 3 M1. Linux artifacts are deb, rpm, and ZIP, and are
verified with `--unsigned-ok`. Linux GPG signing is future work.

### Fuse verification failure

Symptom: `verify-fuses` reports a mismatch.

Check `apps/desktop/forge.config.ts` and rebuild the packaged binary. The
release verifier checks the packaged binary under `apps/desktop/out/`, so stale
output can also cause a failure after changing fuse configuration.

### Missing artifacts

Symptom: `verify-release` reports a missing DMG, ZIP, Squirrel setup, deb, or
rpm.

Run both package and make for the same platform and architecture. The verifier
looks under `apps/desktop/out/make/` and filters artifacts by architecture.

### Missing update artifacts

Symptom: `verify-release --require-update-artifacts` reports a missing macOS
updater ZIP, Windows Squirrel `RELEASES`, or Windows `.nupkg`.

For macOS, confirm the ZIP maker produced an architecture-specific ZIP under
`apps/desktop/out/make/zip/darwin/<arch>/`. For Windows, confirm the Squirrel
maker produced `RELEASES` and a `.nupkg` under the matching architecture
directory. Linux does not support `--require-update-artifacts` in this
milestone.
