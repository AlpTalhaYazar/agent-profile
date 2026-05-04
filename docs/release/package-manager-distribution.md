# Package-Manager Distribution Runbook

This runbook defines the local package-manager readiness gate for the desktop
release path. It prepares deterministic, checksum-backed inputs for Homebrew
Cask, Windows Package Manager, and Linux deb/rpm repository publication without
publishing to any external package-manager repository.

## Current scope

| Channel | Release artifact input | Metadata prepared locally | External publication |
|---|---|---|---|
| Homebrew Cask | macOS DMG for `darwin-x64` and `darwin-arm64` | token, app bundle name, URL, SHA-256 | not performed |
| Windows Package Manager | Windows Squirrel `*Setup.exe` for `win32-x64` | package identifier, installer type, URL, SHA-256 | not performed |
| apt/yum readiness | Linux `.deb` and `.rpm` for `linux-x64` | package name, artifact format, URL, SHA-256 | not performed |

The current release workflow already creates the underlying Forge artifacts:
macOS ZIP/DMG, Windows Squirrel, and Linux deb/rpm/ZIP. The package-manager
readiness gate starts after `verify-release` has accepted those artifacts.

## Local verifier

Run the verifier against an existing release artifact directory:

```sh
pnpm -C apps/desktop verify-package-manager-inputs -- --tag v0.0.1 --release-base-url https://github.com/AlpTalhaYazar/agent-profile/releases/download/v0.0.1
```

The verifier is local-only. It does not fetch release assets, mutate package
manager repositories, read credentials, publish manifests, or generate apt/yum
repository metadata.

It checks:

- `--tag` is a `v*` SemVer tag and matches `apps/desktop/package.json`.
- `--release-base-url` is HTTPS and ends with the same tag.
- Exactly one package-manager input artifact exists for each required target:
  `darwin-x64` DMG, `darwin-arm64` DMG, `win32-x64` Squirrel setup executable,
  `linux-x64` deb, and `linux-x64` rpm.
- Each selected artifact has a SHA-256 checksum.

It intentionally does not require Linux GPG signatures, AppImage artifacts,
Linux auto-update metadata, `Packages.gz`, `Release`, `repomd.xml`, Homebrew tap
files, winget-pkgs manifests, or package-manager credentials.

## JSON output

The verifier writes deterministic JSON to stdout:

```json
{
  "schemaVersion": 1,
  "tag": "v0.0.1",
  "version": "0.0.1",
  "releaseBaseUrl": "https://github.com/AlpTalhaYazar/agent-profile/releases/download/v0.0.1",
  "homebrewCask": {
    "token": "agent-profile",
    "name": "Agent Profile",
    "app": "AgentProfile.app",
    "artifacts": [
      {
        "platform": "darwin",
        "arch": "x64",
        "fileName": "AgentProfile-0.0.1-x64.dmg",
        "url": "https://github.com/AlpTalhaYazar/agent-profile/releases/download/v0.0.1/AgentProfile-0.0.1-x64.dmg",
        "sha256": "<sha256>",
        "sizeBytes": 123
      }
    ]
  }
}
```

The real output also includes the `darwin-arm64`, `win32-x64`, Linux deb, and
Linux rpm records. Use this JSON as a handoff artifact for maintainers preparing
external package-manager manifests.

## Publication boundaries

This gate does not close the GA exit criterion that says Homebrew, Windows
Package Manager, and apt/yum repositories are live. That external publication
gate remains open until maintainers decide:

- Which Homebrew tap or cask submission path owns `agent-profile`.
- Whether `AgentProfile.AgentProfile` is the final winget package identifier.
- Which apt/yum repository hosts Linux packages and who owns its signing key.
- What license metadata should be used by package-manager repositories.
- Whether Linux repository metadata generation and signing are part of a later
  release workflow.

The repository currently has no tracked license file, and the RPM Forge metadata
still declares `UNLICENSED`. Do not publish package-manager manifests that imply
a finalized license or external repository ownership before those decisions are
made.

## Maintainer flow

1. Run the release workflow for an existing `v*` tag and let `verify-release`
   pass for every platform.
2. Download or keep the `apps/desktop/out/make` artifacts locally.
3. Run `verify-package-manager-inputs` with the release tag and GitHub release
   asset base URL.
4. Review the JSON output and use it as input for external package-manager
   manifests.
5. Keep external repository publication as a separate, manual maintainer action
   until the ownership, license, and signing decisions are closed.
