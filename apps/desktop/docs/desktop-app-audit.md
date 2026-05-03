# Desktop App Audit

## Technical Structure

- The desktop app is an Electron Forge application under `apps/desktop`, using Vite for Main, preload, and React renderer bundles.
- The renderer stack is React 19, Jotai atoms, Tailwind utilities, CSS semantic tokens, and shared `@agent-profile/ui` primitives.
- Main owns trusted daemon, keychain, session registry, and IPC handlers. Renderer only talks through `window.myclaude` exposed by preload.
- Current renderer state is centralized in `apps/desktop/src/renderer/lib/atoms.ts`; routing is shell-owned rather than URL-based.
- Existing screen files are `profile-editor`, `auth-vault`, `session-monitor`, `provenance-inspector`, `persona-composer`, plus first-run wizard steps.

## Current Screens

- Profile Editor: combines working directory, role/auth selection, scope explorer, effective preview, editor, draft impact, and inspector.
- Auth Vault: lists auth profiles, detected Claude Code login, profile actions, and MCP secret rows. The implementation is really Claude credential management, but the current label and action hierarchy make it feel like a generic secret vault.
- Session Monitor: lists sessions with kill/relaunch/drift details.
- Provenance Inspector: read-only cascade field selector and chain detail.
- Persona Composer: read-only persona catalog and file preview.
- First-run wizard: creates first auth profile and chooses starting role.

## Current Problems

- Profile Editor has too many simultaneous regions, so the primary job of choosing a profile and launching Claude is visually buried.
- Provenance and Persona are top-level destinations even though they support profile debugging and preview.
- The always-visible inspector duplicates status already available in the editor header/statusbar and creates a third competing column.
- Auth shows loading/list/detail states without strong hierarchy; detected login can appear as selected detail before the list has settled.
- Auth currently gives MCP secrets too much visual weight. The primary user question is whether Claude can launch with the selected credential; MCP/tool secrets are secondary runtime support.
- Profile Workspace previously exposed role, workspace, and auth as plain controls and hid profile
  management under Layers. The missing product affordances were: create/manage role layers, add MCP
  server, and install/attach skills. These now need to be first-level actions on Profile Workspace.
- Session actions exist, but launch/start-from-profile is not available from the workspace.

## Complexity Sources

- Too many top-level navigation items for a workflow that has three main jobs: configure profile, manage Claude auth, monitor sessions.
- Same profile context appears in the titlebar, statusbar, editor header, preview subtitle, and inspector.
- Debug information is visible before the user asks for it.
- Profile Editor exposes effective preview, raw editing, validation, and detailed scope metadata at the same hierarchy level.
- Session token/tool/skill usage metrics are not backed by current runtime data and should not be displayed.
- OAuth scopes, client IDs, and Claude usage limits are not part of the current renderer contract and should not be displayed unless Main supplies real fields.
