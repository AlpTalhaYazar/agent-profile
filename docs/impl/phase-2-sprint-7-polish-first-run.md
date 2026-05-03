# Phase 2 Sprint 7 — Polish + First-Run Flow (as shipped)

**Status:** Shipped on `main` at `3e2da1b` (2026-05-03).
**Branch:** `main`.
**Roadmap entry:** [`docs/08-roadmap.md` Phase 2 Milestone 7](../08-roadmap.md).

This document is the as-shipped record of milestone 7. It closes the
Phase 2 GUI/runtime beta-readiness work on `main`; signing, notarization,
and distribution remain Phase 3 milestone 1.

## Scope

Milestone 7 finishes the desktop beta surface with polish and end-to-end
hardening already represented in the e2e suite:

1. **First-run wizard.** The wizard appears for an empty `MYCLAUDE_HOME`,
   walks through the initial Claude credential step, allows the role step
   to be skipped, writes `.setup-complete`, and stays complete across
   relaunch. Dismissal hides the wizard for the current run but does not
   write the marker, so the wizard returns on relaunch.
2. **Keyboard navigation.** The shell exposes skip-to-main, command palette,
   scope-tree arrow navigation, screen shortcuts, shortcuts help, Escape
   close behavior, and focus restoration across modal surfaces.
3. **Accessibility pass.** Automated coverage checks shell landmarks,
   primary navigation labeling, a single screen heading per screen, skip
   link focus, and live-region feedback after profile save. The manual
   checklist records VoiceOver, keyboard, reduced-motion, and contrast
   checks for the M7 release pass.
4. **Visual contract and theme polish.** The visual contract spec locks the
   modernized hierarchy for Profile Workspace, Claude Auth, Sessions, and
   the command palette across desktop viewports, including no horizontal
   overflow. The manual accessibility checklist includes the dark/light
   theme toggle and reduced-motion behavior.
5. **Terminal/session runtime hardening.** The packaged-app live-session
   spec launches a real packaged app entry, starts a stubbed Claude session,
   verifies terminal output includes the generated session id, kills the
   session, and confirms clean termination output.
6. **Packaged-app Phase 2 e2e hardening.** The packaged-app auth-write spec
   drives Claude Auth add + rotate in a packaged app and asserts
   `authProfiles.yml` stores the `keyring://` reference without either
   plaintext key.

## Evidence

| Area | Evidence |
|------|----------|
| First-run wizard | `apps/desktop/test/e2e/first-run-wizard.spec.ts` |
| Keyboard navigation | `apps/desktop/test/e2e/keyboard-nav.spec.ts` |
| Accessibility automation | `apps/desktop/test/e2e/a11y.spec.ts` |
| Accessibility manual checklist | `docs/a11y-manual-tests.md` |
| Visual contract | `apps/desktop/test/e2e/visual-contract.spec.ts` |
| Packaged app auth add + rotate | `apps/desktop/test/e2e/phase2-auth-write.spec.ts` |
| Packaged app launch + kill runtime | `apps/desktop/test/e2e/phase2-live-session.spec.ts` |
| Existing GUI capability smoke | `apps/desktop/test/e2e/profile-editor.spec.ts`, `auth-vault.spec.ts`, `session-monitor.spec.ts`, `provenance-inspector.spec.ts`, `persona-composer.spec.ts` |

## Phase 2 exit position

Phase 2 exits with the GUI/runtime beta surface represented by the desktop
e2e suite: profile editing, auth add/rotate, session listing, packaged-app
session launch/kill, provenance inspection, persona preview, first-run,
keyboard navigation, accessibility checks, and visual contract coverage.

The distribution gate is intentionally separate. macOS signing/notarization,
Windows Authenticode signing, unsigned Linux artifact verification, and CI
enforcement of release artifacts are Phase 3 milestone 1 responsibilities.

## Known limitations / follow-ups

- **Manual accessibility evidence is checklist-based.** Automated e2e covers
  shell semantics and live-region behavior; VoiceOver, reduced-motion, and
  contrast spot checks are recorded as manual release checks.
- **Distribution is not closed here.** The packaged-app e2e specs prove
  runtime behavior against built app artifacts when present, but they do not
  sign, notarize, or publish installers.
