# Screen Inventory

## Required Pages

| Page | Purpose | Primary user | Primary action |
| --- | --- | --- | --- |
| Profile Workspace | Manage profile layers, understand the effective config, and launch Claude with a selected role/auth/cwd. | Developer configuring Claude Code contexts. | Launch Claude |
| Claude Auth | Manage Claude credentials used by profile resolution and session launch. | Developer connecting Claude Code to a local profile. | Connect or update Claude credential |
| Sessions | Monitor running/recent sessions and reopen the same profile run when possible. | Developer returning to active work. | Open terminal or run again |

## Supporting Views

- First-run wizard remains a modal startup flow for empty installs.
- Provenance moves into Profile Workspace debug tools.
- Persona preview moves into Profile Workspace debug tools.
- Terminal session view is reached from Profile Workspace launch or Sessions actions.

## Relationships

- Profile Workspace owns the selected `role`, `authProfileId`, and `cwd`.
- Profile Workspace also owns creation of writable scope layers and the top-level add flows for
  MCP servers and installed skills.
- Claude Auth feeds available credential profiles into Profile Workspace.
- Sessions are created from Profile Workspace and can be inspected or rerun from Sessions.
- Debug views read the currently resolved Profile Workspace state; they are not independent configuration surfaces.
