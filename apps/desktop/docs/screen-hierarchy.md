# Screen Hierarchy

## Information Architecture

- Primary navigation has three items: Profile Workspace, Claude Auth, Sessions.
- Profile Workspace has three tabs: Overview, Layers, Debug.
- Overview is the default tab and is optimized for launch readiness.
- Layers is the editing surface for scope files.
- Debug contains Provenance and Persona previews behind secondary tabs.

## Navigation

- Sidebar labels are task-focused: Profile Workspace, Claude Auth, Sessions.
- Command palette remains global and includes direct commands for screens, scopes, auth profiles, and debug entries.
- Provenance and Persona command results navigate to Profile Workspace and open Debug.

## Page Hierarchies

### Profile Workspace

1. Context selector: working directory, role, auth. Each selector opens as a card dropdown:
   workspace path/recent paths, role search/create/manage, and Claude credential select/manage.
2. Launch strip: selected profile readiness, primary `Launch Claude`, secondary refresh.
3. Summary: active MCP servers, env vars, settings, and skills/persona assets. MCP and skills
   tiles open add/manage flows instead of acting as passive counters.
4. Tabs:
   - Overview: summaries, launch readiness, and direct actions for new layer, MCP server, and skill.
   - Layers: scope list, editor mode, save/revert, draft impact, MCP editor, and persona path editor.
   - Debug: provenance selector/detail and persona catalog/preview.

### Claude Auth

1. Claude credential list with mode/status and real OAuth expiry metadata when present.
2. Selected credential summary: mode, display name, email/org/plan/expiry when the backend supplies them, and secret status without values.
3. Primary action: connect Claude, refresh OAuth, or rotate the Claude key depending on mode.
4. MCP/tool secrets are an advanced secondary section under the selected credential.
5. Destructive actions are grouped away from primary actions.

### Sessions

1. Running sessions first, then recent history.
2. Selected session detail with cwd, command, drift, and status.
3. Primary action depends on attachability: open terminal for GUI-owned live sessions, run again for registry-only sessions.
4. Secondary actions: check drift, copy command, kill.

## Hidden or Secondary Information

- Renderer state/theme/version details are removed from the default Profile Workspace.
- Provenance chains, persona file contents, and raw JSON stay behind Debug/Layers interactions.
- Token/quota/tool usage metrics, OAuth scopes, client IDs, and usage limits are hidden until a backend contract provides real data.
