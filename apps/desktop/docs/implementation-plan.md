# Implementation Plan

## Steps

1. Add design outputs and documentation.
2. Reduce shell navigation to Profile Workspace, Auth, Sessions while preserving keyboard and command palette behavior.
3. Refactor Profile Editor into Profile Workspace tabs: Overview, Layers, Debug.
4. Move Provenance and Persona surfaces into Debug.
5. Simplify Claude Auth and Sessions page hierarchy and copy.
6. Add Renderer/Main/preload launch and terminal bridge APIs.
7. Add a focused terminal component for GUI-owned sessions and safe fallback to Run again for existing registry sessions.
8. Add discoverable profile management flows: context dropdowns, scope create, MCP add, and
   skills.sh install/attach.
9. Update tests and run typecheck, lint, unit tests, build/package checks, and visual smoke.

## File Plan

- `apps/desktop/src/renderer/components/app-shell.tsx`: navigation, screen labels, command palette targets.
- `apps/desktop/src/renderer/screens/profile-editor.tsx`: Profile Workspace tabs,
  Overview/Layers/Debug composition, context dropdowns, new layer, MCP add, and skill attach dialogs.
- `apps/desktop/src/renderer/screens/auth-vault.tsx`: simplified Claude credential/detail hierarchy, with MCP secrets demoted to a secondary section.
- `apps/desktop/src/renderer/screens/session-monitor.tsx`: selected detail actions and terminal affordance.
- `apps/desktop/src/shared/bridge.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/preload/index.ts`: new session, scope create, and skills APIs.
- `apps/desktop/src/main/ipc/sessions.ts`: renderer-facing launch and terminal handlers.
- `apps/desktop/src/main/ipc/skills.ts`, `apps/desktop/src/main/skills-service.ts`: skills.sh search/detail/audit/install bridge.
- `apps/desktop/src/main/daemon/*` or focused main service module: GUI launch and PTY lifecycle.
- `packages/cli-services/src/profile/create-scope.ts`: canonical global/project shared/role scope creation.
- `packages/persona-deployer/src/copy-files.ts`: directory-backed skill deploy support.

## Risks

- Native terminal dependencies may require platform-specific rebuilds.
- Existing E2E tests assert old navigation labels and must be updated with care.
- Terminal attach is only reliable for GUI-owned live sessions; CLI-created sessions will use Run again.
- Claude Auth must not copy visual-only mockup data such as OAuth scopes, client IDs, token quotas, or account limits unless Main exposes real fields.
- Live terminal output requires a working local `claude` binary and real credentials; automated checks should avoid pretending to resume CLI-created sessions.
- skills.sh search/install depends on network and `npx skills`; automated tests mock the command and only validate argument safety/path resolution.

## Validation

- Typecheck, lint, unit tests, packaging, and E2E must pass for the desktop app.
- E2E must cover Profile Workspace, Claude Auth, Sessions, and Debug tabs.
- Bridge/Main tests must cover launch and terminal IPC contracts; live terminal output should be validated in a real Claude environment.
- Visual smoke must confirm no blank screen, no overlap, working navigation, and visible primary actions at desktop viewport.
