# Screen Hierarchy

## Information Architecture

- Primary navigation has four items: Agent Profiles, Profile Workspace, Claude Auth, Sessions.
- Agent Profiles is the default desktop surface after first-run conditions are satisfied.
- Agent Profiles is optimized for the primary loop: choose the current working profile, understand readiness, inspect detail progressively, and launch Claude.
- Selecting an Agent Profile opens a contextual side panel that preserves the home context and starts summary-first.
- Profile Workspace remains the secondary configuration surface for the selected profile until the side panel owns deeper edit flows in later milestones; dirty layer drafts are protected by a Save / Discard / Cancel guard.
- Profile Workspace has three tabs: Overview, Layers, Debug.
- Overview remains the configuration/readiness bridge for existing profile behavior.
- Layers is the editing surface for scope files.
- Debug contains Provenance and Persona previews behind secondary tabs.

## Navigation

- Sidebar labels are task-focused: Agent Profiles, Profile Workspace, Claude Auth, Sessions.
- Keyboard shortcuts map to the primary hierarchy: Cmd/Ctrl+1 Agent Profiles, 2 Profile Workspace, 3 Claude Auth, 4 Sessions.
- Command palette remains global and includes direct commands for screens, scopes, auth profiles, and debug entries.
- Keyboard-visible focus is explicit on shell controls, side-panel controls, profile actions, and Sessions rows; primary profile controls meet the 40px target-size quality bar.
- Provenance and Persona command results navigate to Profile Workspace and open Debug.
- Agent Profiles opens selected-profile detail in a side panel; repair/configuration actions link into Profile Workspace or Claude Auth for existing edit flows.
- Agent Profiles library selection switches the current role/auth/workspace context only after resolving the selected target; missing or stale identities stay visible as safe non-switchable states.
- Dirty Profile Workspace layer drafts block sidebar, keyboard shortcut, command palette, scope/layer, role, workspace, and Claude identity context changes until the user chooses Save, Discard, or Cancel.
- The side panel closes with its close button or Escape and returns focus to the detail trigger.

## Page Hierarchies

### Agent Profiles

1. Profile-first heading and calm product framing: choose a working profile, check readiness, launch Claude.
2. Current Agent Profile card: purpose-first display name, purpose label, readiness, Claude identity, workspace, MCP/tool count, and skill/persona count. If a role scope carries explicit profile metadata, that metadata is the headline; older role-only profiles use deterministic role-derived labels.
3. Agent Profiles library: a selectable list of role profiles with purpose-first names, role/identity/workspace chips, safe capability summaries, selected-state marker, and visible non-switchable states for missing or stale Claude identities.
4. Primary action: `Launch Claude` when the selected profile is ready; it uses the `AgentProfileViewModel.launch.payload` and hands off to Sessions with the launched session active. Disabled states show a plain-language reason and do not launch.
5. Detail action: open the contextual side panel without leaving the home surface.
6. Secondary action: open Profile Workspace for configuration, Claude Auth when identity is the blocking fix path, or the side-panel Tools/Skills/Inspect section when a warning needs review.
7. Calm failure surface: one plain-language blocker or warning appears on the card with the correct fix path; library switch failures appear as a safe alert above the library without changing the current profile.
8. Default surface excludes raw JSON, provenance, scope/layer labels, scope file paths, keyring refs, OAuth refs, MCP headers/env values, raw secret expressions, and debug detail.

### Agent Profile Side Panel

1. Header: selected profile name, purpose label, readiness, Claude identity, and workspace.
2. Summary section: readiness explanation, identity, workspace, and safe capability counts.
3. Identity section: Claude identity/readiness framed as profile capability, with an action into Claude Auth for credential fixes.
4. Tools/MCP section: active MCP server names, logical secret names, present/missing status, validation issue count, and a repair path into Profile Workspace/Auth without raw values.
5. Skills/Persona section: safe skill/persona asset counts and labels that explain what the profile carries into launch.
6. Inspect section: safe counts and health signals only — scope layer count, issue count, MCP server count, persona asset count.
7. Motion and control quality: subtle opacity/transform transitions in standard mode; reduced-motion mode suppresses transform animation and collapses transition duration; close and section controls keep 40px+ hit targets.
8. Hidden by default: raw config, provenance chains, exact MCP/env values, keyring refs, OAuth refs, `${secret:...}` expressions, headers, and raw effective state.

### Profile Workspace

1. Context selector: working directory, role, auth. Each selector opens as a card dropdown:
   workspace path/recent paths, role search/create/manage, and Claude identity select/manage.
2. Launch strip: selected profile readiness, primary `Launch Claude`, secondary refresh. Dirty layer drafts prompt Save / Discard / Cancel before launch so a session never silently ignores visible unsaved edits.
3. Summary: active MCP servers, env vars, settings, and skills/persona assets. MCP and skills
   tiles open add/manage flows instead of acting as passive counters.
4. Tabs:
   - Overview: summaries, launch readiness, and direct actions for new layer, MCP server, and skill.
   - Layers: scope list, editor mode, save/revert, draft impact, MCP editor, and persona path editor.
   - Debug: provenance selector/detail and persona catalog/preview.
5. Dirty draft guard: attempting to leave dirty layer edits via shell navigation, keyboard shortcuts, command palette, scope/layer switch, role switch, workspace switch, or Claude identity switch prompts Save / Discard / Cancel.
6. Save persists through the existing profile save bridge before continuing; Discard restores the last saved document before continuing; Cancel keeps the user in place and restores focus to the trigger.

### Claude Auth

1. Claude identity list with mode/status and real OAuth expiry metadata when present.
2. Selected identity summary: mode, display name, email/org/plan/expiry when the backend supplies them, and credential status without values, keyring refs, OAuth refs, scopes, quota, or usage claims.
3. Primary action: connect Claude, adopt detected Claude Code login, refresh OAuth, rotate the Claude key, or remove the identity depending on mode/state.
4. Tool/MCP secret writes are demoted into an explicit advanced tool-support section. Tool readiness itself is understood from the selected Agent Profile side panel.
5. Destructive actions are grouped away from primary actions.

### Sessions

1. Running sessions first, then recent history.
2. Selected session detail with cwd, command, drift, and status.
3. Primary action depends on capability: Open Terminal for attachable GUI-owned/live sessions, Resume for native Claude history, and Run Again for registry/history sessions that cannot attach.
4. Secondary actions: Check drift for profile sessions, Copy command when a spawn command exists, and Kill only for live profile sessions with an alive process. Copy command announces completion through the live region.

## Hidden or Secondary Information

- Renderer state/theme/version details are removed from default Agent Profiles and Profile Workspace overview surfaces.
- Provenance chains, persona file contents, raw JSON, and layer internals stay behind explicit Inspect/Debug/Layers interactions.
- Agent Profiles failure surfaces use one calm blocker or warning first; exact issue detail remains behind side-panel Inspect or Profile Workspace Debug.
- The side panel's Inspect section is a safe summary, not a raw debug viewer.
- Token/quota/tool usage metrics, OAuth scopes, client IDs, and usage limits are hidden until a backend contract provides real data.
