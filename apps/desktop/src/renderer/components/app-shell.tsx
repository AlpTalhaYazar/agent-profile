/**
 * @module components/app-shell
 *
 * The application shell — titlebar (logo, palette trigger, theme orb),
 * primary sidebar (sidebar-* nav items used by every e2e spec), screen
 * router, statusbar, and the global keyboard shortcuts (⌘K, ⌘1–5).
 *
 * Owns the theme-toggle handler. The View Transition API circle-reveal is
 * gated by `usePrefersReducedMotion()`: when the OS has reduced-motion on,
 * the theme is set synchronously and the circle-reveal is skipped — see
 * commit `0df0a16` for the underlying CSS overrides.
 *
 * Owns the bootstrap effect that calls `window.myclaude.system.bootstrap()`
 * once on mount to learn `serverVersion`/`defaultCwd`/`firstRun`/`profileCount`
 * — replacing the old chain of `system.version` + `system.defaultCwd` +
 * `auth.list`. The `firstRun` flag is parked in `firstRunAtom` for ST-4 to
 * consume.
 *
 * Owns the command palette overlay and its command list, which is built
 * from the active scope/auth/provenance state via `useAtomValue`.
 *
 * Extracted from `index.tsx` as part of ST-2 of Phase 2 milestone 7. The
 * `data-testid="sidebar-*"` attributes are preserved verbatim — they are
 * the single navigation hook every e2e spec relies on.
 */

import { cn } from "@agent-profile/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import * as React from "react";
import logoMonoUrl from "../assets/logo-mono.svg";
import {
  type AppScreen,
  appErrorAtom,
  authProfilesAtom,
  availableRolesAtom,
  commandPaletteActiveIndexAtom,
  commandPaletteOpenAtom,
  commandPaletteQueryAtom,
  currentScreenAtom,
  cwdAtom,
  effectiveStateAtom,
  firstRunAtom,
  isBootstrappingAtom,
  isRefreshingAtom,
  scopeEntriesAtom,
  selectedAuthIdAtom,
  selectedProvenanceFieldAtom,
  selectedRoleAtom,
  selectedScopePathAtom,
  shortcutsHelpOpenAtom,
  themeAtom,
  versionAtom,
  wizardDismissedAtom,
} from "../lib/atoms.js";
import {
  collectRoles,
  getErrorMessage,
  normalizeAuthProfiles,
  normalizeEffectiveState,
  normalizeScopeList,
} from "../lib/normalize.js";
import { usePrefersReducedMotion } from "../lib/use-prefers-reduced-motion.js";
import { AuthVaultScreen } from "../screens/auth-vault.js";
import { PersonaComposerScreen } from "../screens/persona-composer.js";
import { ProfileEditorScreen, ProfileEditorScreenInspector } from "../screens/profile-editor.js";
import { ProvenanceInspectorScreen } from "../screens/provenance-inspector.js";
import { SessionMonitorScreen } from "../screens/session-monitor.js";
import { WizardShell } from "../screens/wizard/wizard-shell.js";
import { CommandPalette, type CommandPaletteItem } from "./command-palette.js";
import { LiveAnnouncer, useAnnounce } from "./live-announcer.js";
import { ShortcutsHelp } from "./shortcuts-help.js";

const THEME_STORAGE_KEY = "agent-profile.theme";

export const SCREEN_LABELS: Record<AppScreen, string> = {
  editor: "Profile Editor",
  "auth-vault": "Auth Vault",
  sessions: "Session Monitor",
  provenance: "Provenance Inspector",
  persona: "Persona Composer",
};

export function AppShell(): React.ReactElement {
  const [currentScreen, setCurrentScreen] = useAtom(currentScreenAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  const [commandPaletteOpen, setCommandPaletteOpen] = useAtom(commandPaletteOpenAtom);
  const [commandPaletteQuery, setCommandPaletteQuery] = useAtom(commandPaletteQueryAtom);
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useAtom(
    commandPaletteActiveIndexAtom
  );
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useAtom(shortcutsHelpOpenAtom);
  const setVersion = useSetAtom(versionAtom);
  const setCwd = useSetAtom(cwdAtom);
  const setScopeEntries = useSetAtom(scopeEntriesAtom);
  const setAvailableRoles = useSetAtom(availableRolesAtom);
  const setAuthProfiles = useSetAtom(authProfilesAtom);
  const setSelectedRole = useSetAtom(selectedRoleAtom);
  const setSelectedAuthId = useSetAtom(selectedAuthIdAtom);
  const setSelectedScopePath = useSetAtom(selectedScopePathAtom);
  const setEffectiveState = useSetAtom(effectiveStateAtom);
  const setIsBootstrapping = useSetAtom(isBootstrappingAtom);
  const setAppError = useSetAtom(appErrorAtom);
  const setFirstRun = useSetAtom(firstRunAtom);
  const setSelectedProvenanceField = useSetAtom(selectedProvenanceFieldAtom);
  const authProfiles = useAtomValue(authProfilesAtom);
  const scopeEntries = useAtomValue(scopeEntriesAtom);
  const effectiveState = useAtomValue(effectiveStateAtom);
  const appError = useAtomValue(appErrorAtom);
  const cwd = useAtomValue(cwdAtom);
  const isBootstrapping = useAtomValue(isBootstrappingAtom);
  const isRefreshing = useAtomValue(isRefreshingAtom);
  const firstRun = useAtomValue(firstRunAtom);
  const selectedAuthId = useAtomValue(selectedAuthIdAtom);
  const selectedRole = useAtomValue(selectedRoleAtom);
  const version = useAtomValue(versionAtom);
  const wizardDismissed = useAtomValue(wizardDismissedAtom);
  const prefersReducedMotion = usePrefersReducedMotion();
  const announce = useAnnounce();
  const commandPaletteReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const previousScreenRef = React.useRef<AppScreen | null>(null);

  // ─── Bootstrap effect (replaces the old system.version + system.defaultCwd
  // + auth.list chain with a single system.bootstrap round-trip) ────────────
  React.useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setIsBootstrapping(true);
      setAppError(null);
      try {
        const bridge = window.myclaude;
        const bootstrapResult = bridge?.system?.bootstrap
          ? await bridge.system.bootstrap().catch(() => null)
          : null;

        const nextVersion =
          bootstrapResult?.serverVersion ??
          (await bridge?.system?.version?.().catch(() => null)) ??
          (await bridge?.version?.().catch(() => null)) ??
          "unavailable";
        const nextCwd =
          bootstrapResult?.defaultCwd ??
          (await bridge?.system?.defaultCwd?.().catch(() => null)) ??
          (typeof window.location.pathname === "string" ? window.location.pathname : "");

        const listed = bridge?.profile?.list ? await bridge.profile.list({ cwd: nextCwd }) : [];
        const normalizedEntries = normalizeScopeList(listed);
        const roles = collectRoles(normalizedEntries);
        const authList = bridge?.auth?.list ? await bridge.auth.list() : [];
        const normalizedAuthProfiles = normalizeAuthProfiles(authList);

        if (cancelled) return;

        setVersion(nextVersion);
        setCwd(nextCwd);
        setScopeEntries(normalizedEntries);
        setAvailableRoles(roles);
        setAuthProfiles(normalizedAuthProfiles);
        setFirstRun(Boolean(bootstrapResult?.firstRun));

        const initialRole = roles[0] ?? "";
        const initialAuthId = normalizedAuthProfiles[0]?.id ?? "";
        setSelectedRole(initialRole);
        setSelectedAuthId(initialAuthId);
        setSelectedScopePath(normalizedEntries[0]?.path ?? null);

        if (initialRole && initialAuthId && nextCwd && bridge?.profile?.show) {
          const shown = await bridge.profile.show({
            role: initialRole,
            authProfileId: initialAuthId,
            cwd: nextCwd,
          });
          if (cancelled) return;
          setEffectiveState(normalizeEffectiveState(shown));
        }
      } catch (error) {
        if (!cancelled) setAppError(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [
    setAppError,
    setAuthProfiles,
    setAvailableRoles,
    setCwd,
    setEffectiveState,
    setFirstRun,
    setIsBootstrapping,
    setScopeEntries,
    setSelectedAuthId,
    setSelectedRole,
    setSelectedScopePath,
    setVersion,
  ]);

  // ─── Theme persistence + DOM `data-theme` syncing ─────────────────────────

  React.useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }
  }, [setTheme]);

  React.useEffect(() => {
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  // ─── Theme-toggle handler with reduced-motion gate ────────────────────────

  const handleToggleTheme = React.useCallback(
    (event?: { clientX?: number; clientY?: number }) => {
      const nextTheme = theme === "dark" ? "light" : "dark";

      // When the user prefers reduced motion, set the theme synchronously and
      // skip the View Transition API circle-reveal entirely.
      if (prefersReducedMotion) {
        document.documentElement.dataset.theme = nextTheme;
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        setTheme(nextTheme);
        return;
      }

      const origin =
        event?.clientX != null && event?.clientY != null
          ? { x: event.clientX, y: event.clientY }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 };

      const endRadius = Math.hypot(
        Math.max(origin.x, window.innerWidth - origin.x),
        Math.max(origin.y, window.innerHeight - origin.y)
      );

      const transition = (
        document as unknown as {
          startViewTransition?: (cb: () => void) => { ready: Promise<void> };
        }
      ).startViewTransition?.(() => {
        document.documentElement.dataset.theme = nextTheme;
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        setTheme(nextTheme);
      });

      if (transition) {
        transition.ready.then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${origin.x}px ${origin.y}px)`,
                `circle(${endRadius}px at ${origin.x}px ${origin.y}px)`,
              ],
            },
            {
              duration: 550,
              easing: "cubic-bezier(0.4, 0, 0.2, 1)",
              pseudoElement: "::view-transition-new(root)",
            }
          );
        });
      } else {
        document.documentElement.dataset.theme = nextTheme;
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        setTheme(nextTheme);
      }
    },
    [prefersReducedMotion, setTheme, theme]
  );

  // ─── Command palette open/close + focus restore ───────────────────────────

  const closeCommandPalette = React.useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery("");
    setCommandPaletteActiveIndex(0);
    window.setTimeout(() => {
      commandPaletteReturnFocusRef.current?.focus();
    }, 0);
  }, [setCommandPaletteActiveIndex, setCommandPaletteOpen, setCommandPaletteQuery]);

  const openCommandPalette = React.useCallback(() => {
    const activeElement = document.activeElement;
    commandPaletteReturnFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    setCommandPaletteOpen(true);
    setCommandPaletteQuery("");
    setCommandPaletteActiveIndex(0);
  }, [setCommandPaletteActiveIndex, setCommandPaletteOpen, setCommandPaletteQuery]);

  // ─── Global keyboard shortcuts ⌘K + ⌘1–5 + Escape ─────────────────────────

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifier = event.metaKey || event.ctrlKey;
      if (isModifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
        return;
      }

      if (isModifier && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        const nextScreenMap: Record<string, AppScreen> = {
          "1": "editor",
          "2": "auth-vault",
          "3": "sessions",
          "4": "provenance",
          "5": "persona",
        };
        const nextScreen = nextScreenMap[event.key];
        if (!nextScreen) return;
        setCurrentScreen(nextScreen);
        return;
      }

      if (event.key === "Escape" && commandPaletteOpen) {
        event.preventDefault();
        closeCommandPalette();
        return;
      }

      if (event.key === "?" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setShortcutsHelpOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    closeCommandPalette,
    commandPaletteOpen,
    openCommandPalette,
    setCurrentScreen,
    setShortcutsHelpOpen,
  ]);

  // ─── Command palette item list ────────────────────────────────────────────

  const paletteItems = React.useMemo(() => {
    const items: CommandPaletteItem[] = [
      {
        id: "nav-editor",
        group: "Navigate",
        label: "Profile Editor",
        hint: "Cmd+1",
        keywords: ["editor", "profile", "scope"],
        onSelect: () => setCurrentScreen("editor"),
      },
      {
        id: "nav-auth",
        group: "Navigate",
        label: "Auth Vault",
        hint: "Cmd+2",
        keywords: ["auth", "vault", "profiles"],
        onSelect: () => setCurrentScreen("auth-vault"),
      },
      {
        id: "nav-sessions",
        group: "Navigate",
        label: "Session Monitor",
        hint: "Cmd+3",
        keywords: ["sessions", "monitor"],
        onSelect: () => setCurrentScreen("sessions"),
      },
      {
        id: "nav-provenance",
        group: "Navigate",
        label: "Provenance Inspector",
        hint: "Cmd+4",
        keywords: ["provenance", "cascade", "inspect"],
        onSelect: () => setCurrentScreen("provenance"),
      },
      {
        id: "nav-persona",
        group: "Navigate",
        label: "Persona Composer",
        hint: "Cmd+5",
        keywords: ["persona", "composer", "claude"],
        onSelect: () => setCurrentScreen("persona"),
      },
      ...scopeEntries.map((entry) => ({
        id: `scope:${entry.path}`,
        group: "Scope",
        label: entry.role !== "—" ? `${entry.scope} / ${entry.role}` : entry.scope,
        description: entry.path,
        keywords: [entry.scope, entry.role, entry.path],
        onSelect: () => {
          setCurrentScreen("editor");
          setSelectedScopePath(entry.path);
        },
      })),
      ...authProfiles.map((profile) => ({
        id: `auth:${profile.id}`,
        group: "Auth",
        label: profile.displayName || profile.id,
        description: `${profile.id} · ${profile.mode}`,
        keywords: [profile.id, profile.displayName, profile.mode],
        onSelect: () => {
          setCurrentScreen("editor");
          setSelectedAuthId(profile.id);
        },
      })),
      {
        id: "sessions:open",
        group: "Sessions",
        label: "Open Session Monitor",
        description: "Jump to active and recent sessions",
        keywords: ["sessions", "monitor", "processes"],
        onSelect: () => setCurrentScreen("sessions"),
      },
      {
        id: "help:shortcuts",
        group: "Help",
        label: "Show keyboard shortcuts",
        hint: "?",
        keywords: ["keyboard", "shortcuts", "help"],
        onSelect: () => setShortcutsHelpOpen(true),
      },
    ];

    if (effectiveState.provenance) {
      const provenanceEntries: Array<[string, string]> = [
        ...Object.keys(effectiveState.provenance.env).map(
          (key) => ["env", key] as [string, string]
        ),
        ...Object.keys(effectiveState.provenance.settings).map(
          (key) => ["settings", key] as [string, string]
        ),
        ...Object.keys(effectiveState.provenance.mcpServers).map(
          (key) => ["mcpServers", key] as [string, string]
        ),
      ];
      for (const [section, key] of provenanceEntries) {
        items.push({
          id: `provenance:${section}:${key}`,
          group: "Provenance",
          label: key,
          description: section,
          keywords: [section, key, "provenance"],
          onSelect: () => {
            setSelectedProvenanceField({
              section: section as "env" | "settings" | "mcpServers",
              key,
            });
            setCurrentScreen("provenance");
          },
        });
      }
    }

    const query = commandPaletteQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.label, item.description ?? "", ...(item.keywords ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [
    authProfiles,
    commandPaletteQuery,
    effectiveState.provenance,
    scopeEntries,
    setCurrentScreen,
    setSelectedAuthId,
    setSelectedProvenanceField,
    setSelectedScopePath,
    setShortcutsHelpOpen,
  ]);

  const showEditorInspector = currentScreen === "editor";

  React.useEffect(() => {
    if (firstRun && !wizardDismissed) return;
    const previousScreen = previousScreenRef.current;
    previousScreenRef.current = currentScreen;
    announce(`${SCREEN_LABELS[currentScreen]} screen`);
    if (previousScreen === null || previousScreen === currentScreen) return;
    let cancelled = false;
    const focusScreenHeading = () => {
      if (cancelled) return;
      document.querySelector<HTMLElement>("#screen-heading")?.focus();
    };
    focusScreenHeading();
    const frameId = window.requestAnimationFrame(focusScreenHeading);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [announce, currentScreen, firstRun, wizardDismissed]);

  if (firstRun && !wizardDismissed) {
    return <WizardShell />;
  }

  return (
    <div className="grid h-full min-h-full grid-rows-[52px_minmax(0,1fr)_28px] bg-canvas text-primary">
      <a className="skip-nav" href="#main-content">
        Skip to main content
      </a>
      <AppTitlebar
        currentScreen={currentScreen}
        isPaletteOpen={commandPaletteOpen}
        onOpenPalette={() => {
          if (commandPaletteOpen) {
            closeCommandPalette();
            return;
          }
          openCommandPalette();
        }}
        onToggleTheme={handleToggleTheme}
        theme={theme}
      />

      <div className="grid min-h-0 grid-cols-[48px_minmax(0,1fr)] window-medium:grid-cols-[240px_minmax(0,1fr)]">
        <AppSidebar
          authCount={authProfiles.length}
          currentScreen={currentScreen}
          onSelect={setCurrentScreen}
          scopeCount={scopeEntries.length}
        />

        <main
          id="main-content"
          tabIndex={-1}
          aria-busy={isBootstrapping || isRefreshing}
          className={cn(
            "grid min-h-0 grid-cols-1",
            showEditorInspector && "window-medium:grid-cols-[minmax(0,1fr)_320px]"
          )}
        >
          <div className="min-h-0 overflow-hidden bg-canvas">
            {currentScreen === "editor" ? (
              <ProfileEditorScreen />
            ) : (
              <div className="flex h-full min-h-0 flex-col bg-canvas">
                {appError ? (
                  <div className="border-b border-status-danger bg-status-danger-soft px-4 py-2 text-sm text-status-danger">
                    {appError}
                  </div>
                ) : null}
                <div className="min-h-0 flex-1 overflow-hidden">
                  {currentScreen === "auth-vault" ? (
                    <AuthVaultScreen />
                  ) : currentScreen === "sessions" ? (
                    <SessionMonitorScreen />
                  ) : currentScreen === "provenance" ? (
                    <ProvenanceInspectorScreen />
                  ) : currentScreen === "persona" ? (
                    <PersonaComposerScreen />
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {showEditorInspector ? <ProfileEditorScreenInspector /> : null}
        </main>
      </div>

      <AppStatusbar
        appError={appError}
        currentScreen={currentScreen}
        cwd={cwd}
        isBootstrapping={isBootstrapping}
        isRefreshing={isRefreshing}
        selectedAuthId={selectedAuthId}
        selectedRole={selectedRole}
        version={version}
      />

      <CommandPalette
        activeIndex={commandPaletteActiveIndex}
        isOpen={commandPaletteOpen}
        items={paletteItems}
        onActiveIndexChange={setCommandPaletteActiveIndex}
        onClose={closeCommandPalette}
        onQueryChange={setCommandPaletteQuery}
        onSelect={(item) => {
          item.onSelect();
          closeCommandPalette();
        }}
        query={commandPaletteQuery}
      />
      <ShortcutsHelp open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
      <LiveAnnouncer />
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

interface AppTitlebarProps {
  currentScreen: AppScreen;
  isPaletteOpen: boolean;
  onOpenPalette: () => void;
  onToggleTheme: (event?: { clientX?: number; clientY?: number }) => void;
  theme: "dark" | "light";
}

function AppTitlebar({
  currentScreen,
  isPaletteOpen,
  onOpenPalette,
  onToggleTheme,
  theme,
}: AppTitlebarProps): React.ReactElement {
  return (
    <header
      className="grid grid-cols-[78px_minmax(0,1fr)_auto] items-center border-b border-default bg-surface px-3"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Native traffic lights rendered by macOS via titleBarStyle:"hiddenInset" */}
      <div className="flex h-full items-center" />
      <div className="flex min-w-0 items-center gap-3">
        <img alt="Agent Profile" className="h-7 w-7 shrink-0" src={logoMonoUrl} />
        <div className="hidden min-w-0 flex-col window-medium:flex">
          <span className="truncate text-sm font-semibold text-primary">Agent Profile</span>
          <span className="truncate text-xs text-tertiary">{SCREEN_LABELS[currentScreen]}</span>
        </div>
        <button
          aria-expanded={isPaletteOpen}
          aria-label="Open command palette"
          className="ml-auto flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-subtle bg-canvas px-3 text-left text-sm text-tertiary transition-colors hover:bg-elevated window-medium:max-w-[420px]"
          onClick={onOpenPalette}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          type="button"
        >
          <span className="text-base leading-none">⌕</span>
          <span className="truncate">Jump to profile, session, or scope…</span>
          <span className="ml-auto rounded border border-default bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-secondary">
            ⌘K
          </span>
        </button>
      </div>
      <div className="ml-3 flex items-center">
        <button
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className="theme-orb group relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-default bg-canvas transition-all duration-500 hover:border-strong hover:bg-elevated"
          onClick={(e) => onToggleTheme(e)}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          type="button"
        >
          <span
            aria-hidden="true"
            className="theme-orb-icon absolute transition-all duration-500 ease-[var(--ap-ease-spring)]"
            style={{
              opacity: theme === "dark" ? 1 : 0,
              transform: theme === "dark" ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(0.4)",
            }}
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4 text-amber-400"
              fill="currentColor"
              focusable="false"
              viewBox="0 0 20 20"
            >
              <path
                clipRule="evenodd"
                d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                fillRule="evenodd"
              />
            </svg>
          </span>
          <span
            aria-hidden="true"
            className="theme-orb-icon absolute transition-all duration-500 ease-[var(--ap-ease-spring)]"
            style={{
              opacity: theme === "light" ? 1 : 0,
              transform: theme === "light" ? "rotate(0deg) scale(1)" : "rotate(90deg) scale(0.4)",
            }}
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4 text-blue-300"
              fill="currentColor"
              focusable="false"
              viewBox="0 0 20 20"
            >
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          </span>
        </button>
      </div>
    </header>
  );
}

interface AppSidebarProps {
  authCount: number;
  currentScreen: AppScreen;
  onSelect: (screen: AppScreen) => void;
  scopeCount: number;
}

function AppSidebar({
  authCount,
  currentScreen,
  onSelect,
  scopeCount,
}: AppSidebarProps): React.ReactElement {
  const navItems: Array<{
    id: AppScreen;
    label: string;
    icon: string;
    badge?: string;
  }> = [
    { id: "editor", label: "Profile Editor", icon: "⊡", badge: String(scopeCount) },
    { id: "auth-vault", label: "Auth Vault", icon: "⚿", badge: String(authCount) },
    { id: "sessions", label: "Session Monitor", icon: "◐" },
    { id: "provenance", label: "Provenance Inspector", icon: "⊟" },
    { id: "persona", label: "Persona Composer", icon: "◇" },
  ];

  return (
    <aside className="border-r border-default bg-surface px-2 py-3">
      <nav aria-label="Primary">
        <ul className="grid gap-1">
          {navItems.map((item) => {
            const active = item.id === currentScreen;
            return (
              <li key={item.id}>
                <button
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={cn(
                    "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors",
                    active
                      ? "bg-elevated text-primary shadow-xs"
                      : "text-secondary hover:bg-elevated hover:text-primary"
                  )}
                  data-testid={`sidebar-${item.id}`}
                  onClick={() => onSelect(item.id)}
                  title={item.label}
                  type="button"
                >
                  <span className="w-4 shrink-0 text-center text-base leading-none">
                    {item.icon}
                  </span>
                  <span className="hidden truncate window-medium:block">{item.label}</span>
                  {item.badge ? (
                    <span className="ml-auto hidden font-mono text-[11px] text-tertiary window-medium:block">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

interface AppStatusbarProps {
  appError: string | null;
  currentScreen: AppScreen;
  cwd: string;
  isBootstrapping: boolean;
  isRefreshing: boolean;
  selectedAuthId: string;
  selectedRole: string;
  version: string | null;
}

function AppStatusbar({
  appError,
  currentScreen,
  cwd,
  isBootstrapping,
  isRefreshing,
  selectedAuthId,
  selectedRole,
  version,
}: AppStatusbarProps): React.ReactElement {
  return (
    <footer className="flex items-center gap-3 border-t border-default bg-surface px-3 text-[11px] font-medium text-tertiary">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          appError
            ? "bg-status-danger"
            : isRefreshing || isBootstrapping
              ? "bg-status-warning"
              : "bg-status-success"
        )}
      />
      <span>
        {appError
          ? "Error"
          : isRefreshing
            ? "Refreshing"
            : isBootstrapping
              ? "Bootstrapping"
              : "Ready"}
      </span>
      <span className="text-secondary">·</span>
      <span>{SCREEN_LABELS[currentScreen]}</span>
      <span className="text-secondary">·</span>
      <span className="truncate">
        {selectedRole || "—"} @ {selectedAuthId || "—"}
      </span>
      <span className="text-secondary">·</span>
      <span className="truncate">{cwd || "No working directory"}</span>
      <span className="ml-auto">v{version ?? "loading"}</span>
    </footer>
  );
}
