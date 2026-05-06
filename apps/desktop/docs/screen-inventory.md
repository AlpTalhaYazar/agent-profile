# Screen Inventory

## Required Pages

| Page | Purpose | Primary user | Primary action |
| --- | --- | --- | --- |
| Agent Profiles | Choose the current working Agent Profile, understand readiness, open contextual detail, and launch Claude from a calm primary surface. | Developer starting or resuming profile-based Claude work. | Launch Claude |
| Profile Workspace | Configure the selected profile's layers, MCP/tools, skills/persona assets, and debug surfaces while deeper side-panel editing is still being built. | Developer configuring Claude Code contexts. | Save profile configuration |
| Claude Auth | Manage Claude identities and credential health used by profile readiness and session launch. | Developer connecting Claude Code to an Agent Profile. | Connect Claude identity |
| Sessions | Monitor running/recent sessions and reopen the same profile run when possible. | Developer returning to active work. | Open terminal or run again |

## Supporting Views

- First-run wizard remains a modal startup flow for empty installs and lands on Agent Profiles after setup completion.
- Agent Profile side panel is the selected-profile detail model from Agent Profiles: Summary, Identity, Tools/MCP, Skills/Persona, Inspect. It preserves focus, Escape close, 40px+ primary targets, and reduced-motion-safe transitions.
- Side panel Summary is the default detail state and shows readiness, identity, workspace, safe capability counts, and one calm blocker/warning when the profile needs attention.
- Side panel Identity explains the Claude identity/readiness relationship and links to Claude Auth for credential fixes.
- Side panel Tools/MCP shows safe MCP server names, logical secret names, present/missing status, and validation counts without raw values or refs.
- Side panel Skills/Persona shows safe skill/persona asset counts and labels.
- Side panel Inspect shows safe counts/health signals only; raw provenance and raw effective config remain in Profile Workspace Debug.
- Provenance remains inside Profile Workspace debug tools until a later Inspect/Debug contract intentionally relocates it.
- Persona preview remains inside Profile Workspace debug tools until the profile side panel provides richer progressive disclosure.
- Terminal session view is reached from Agent Profiles launch, Profile Workspace launch, or Sessions actions; launched profile sessions become the active Sessions context when the bridge returns a session id.

## Relationships

- Agent Profiles is the default shell screen and consumes the safe `AgentProfileViewModel` summary/readiness/launch contract, including calm blockers/warnings and fix targets.
- Agent Profile side panel uses the opaque `AgentProfileViewModel.id` as its selection/reset boundary.
- Profile Workspace owns the selected `role`, `authProfileId`, and `cwd` configuration controls for now, with dirty layer changes guarded by Save / Discard / Cancel before those contexts can change.
- Profile Workspace still owns creation of writable scope layers and the top-level add flows for MCP servers and installed skills until later M001 slices relocate those edit flows into profile-owned detail.
- Claude Auth feeds available credential profiles into Agent Profiles readiness, Agent Profile side panel identity summary, and Profile Workspace selectors; it does not act as the primary tool/MCP status surface.
- Claude Auth keeps tool-secret writes behind an explicit advanced tool-support area for cases where a profile's Tools/MCP section asks for a stored logical token.
- Sessions are created from Agent Profiles or Profile Workspace launch using the same `AgentProfileViewModel.launch.payload`; Profile Workspace prompts on dirty layer drafts before launch.
- Sessions actions are source/capability-driven: attachable profile sessions open terminal, stale/exited profile records run again and can check drift/copy command, native Claude history resumes or runs with the current profile. Sessions rows have explicit keyboard focus treatment and command copy announces through the live region.
- Debug views read the currently resolved Profile Workspace state; they are not independent configuration surfaces.
