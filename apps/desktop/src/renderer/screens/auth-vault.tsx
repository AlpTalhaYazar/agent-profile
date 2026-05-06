/**
 * @module renderer/screens/auth-vault
 *
 * Claude Auth screen focused on Claude identity and credential health.
 *
 * Hybrid plaintext flow:
 *  - `Add profile` → `window.myclaude.auth.add(spec)`. The Renderer payload
 *    has NO secret value; Main opens a child window to collect it.
 *  - `Add secret` / `Rotate secret` → Renderer modal with PasswordInput.
 *    Plaintext lives in component-local `useState` and is reset on submit /
 *    close. It never enters Jotai.
 *  - `Remove profile` → Main native confirm + daemon delegation.
 *  - Detected Claude Code OAuth credentials surface as a synthetic row at the
 *    top of the list with an inline "+ Add" affordance that expands an adopt
 *    form (display name only; profile id is auto-generated) and writes them
 *    into the vault.
 */

import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  PasswordInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agent-profile/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { KeyRound, Plus, RefreshCw, RotateCw, ShieldCheck, Trash2, Wrench } from "lucide-react";
import * as React from "react";
import type { AuthMode, OAuthMeta, SecretBackedAuthMode } from "../../shared/bridge.js";
import { useAnnounce } from "../components/live-announcer.js";
import {
  EmptyState,
  IconFrame,
  InfoPanel,
  ScreenHeader,
  ScreenSurface,
} from "../components/screen-ui.js";
import {
  authProfilesAtom,
  authVaultFocusRequestAtom,
  cwdAtom,
  effectiveStateAtom,
  previewStateAtom,
  selectedAuthIdAtom,
  selectedRoleAtom,
  validationStateAtom,
} from "../lib/atoms.js";
import {
  getErrorMessage,
  normalizeAuthProfiles,
  normalizeEffectiveState,
} from "../lib/normalize.js";
import { type RovingItemProps, useRovingTabIndex } from "../lib/use-roving-tab-index.js";

interface AuthProfileView {
  id: string;
  displayName: string;
  mode: string;
  /** Logical secret names (excluding "anthropic"). */
  secrets: string[];
  oauth?: OAuthMeta;
  /** True when this is a synthetic row backed by macOS Claude Code keychain only. */
  detected?: boolean;
}

const AUTH_MODES = [
  { value: "apiKey", label: "apiKey" },
  { value: "bedrock", label: "bedrock" },
  { value: "vertex", label: "vertex" },
  { value: "gateway", label: "gateway" },
  { value: "oauth", label: "OAuth (Anthropic Login)" },
] as const;

const DETECTED_ROW_ID = "claude-code-detected";
const LOGICAL_TOOL_SECRET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;

function isSafeLogicalToolSecretName(value: string): boolean {
  return LOGICAL_TOOL_SECRET_NAME_RE.test(value) && !value.includes("//");
}

function normalizeLogicalToolSecretName(value: string): string {
  return value.trim();
}

function normalizeAuthList(input: unknown): AuthProfileView[] {
  if (input === null || typeof input !== "object") return [];
  const profiles = (input as { profiles?: unknown }).profiles;
  if (!Array.isArray(profiles)) return [];
  return profiles
    .map((entry): AuthProfileView | null => {
      if (entry === null || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const id = typeof e.id === "string" ? e.id : null;
      if (!id) return null;
      const displayName = typeof e.displayName === "string" ? e.displayName : "";
      const mode = typeof e.mode === "string" ? e.mode : "apiKey";
      const secrets = Array.isArray(e.secrets)
        ? e.secrets.filter((s): s is string => typeof s === "string")
        : [];
      const oauthRaw = (e as { oauth?: unknown }).oauth;
      const oauth = oauthRaw && typeof oauthRaw === "object" ? (oauthRaw as OAuthMeta) : undefined;
      const view: AuthProfileView = { id, displayName, mode, secrets };
      if (oauth) view.oauth = oauth;
      return view;
    })
    .filter((p): p is AuthProfileView => p !== null);
}

function formatExpiresIn(iso: string | undefined): string | null {
  if (!iso) return null;
  const expiresAt = Date.parse(iso);
  if (Number.isNaN(expiresAt)) return null;
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return "expired";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `expires in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `expires in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `expires in ${days}d`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile"
  );
}

interface OAuthBridge {
  start?: (opts: { profileId: string; displayName?: string }) => Promise<unknown>;
  refresh?: (opts: { authId: string }) => Promise<unknown>;
  detect?: () => Promise<unknown>;
  adopt?: (opts: { profileId: string; displayName?: string }) => Promise<unknown>;
}

function getOAuthBridge(): OAuthBridge | undefined {
  return window.myclaude?.oauth as OAuthBridge | undefined;
}

interface AuthBridgeExtras {
  updateMeta?: (opts: { profileId: string; displayName?: string }) => Promise<unknown>;
}

type AuthBridge = NonNullable<typeof window.myclaude>["auth"];

function getAuthBridge(): (AuthBridge & AuthBridgeExtras) | undefined {
  return window.myclaude?.auth as (AuthBridge & AuthBridgeExtras) | undefined;
}

const UNSAFE_AUTH_ERROR_TEXT_RE =
  /keyring:\/\/|\$\{secret:|bearer\s+\S+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+/i;

function formatSafeAuthError(error: unknown, fallback: string): string {
  const message = getErrorMessage(error);
  if (!message || UNSAFE_AUTH_ERROR_TEXT_RE.test(message)) return fallback;
  return message;
}

export function AuthVaultScreen(): React.ReactElement {
  const [profiles, setProfiles] = React.useState<AuthProfileView[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const announce = useAnnounce();
  const [focusRequest, setFocusRequest] = useAtom(authVaultFocusRequestAtom);
  const selectedAgentAuthId = useAtomValue(selectedAuthIdAtom);
  const selectedRole = useAtomValue(selectedRoleAtom);
  const cwd = useAtomValue(cwdAtom);
  const setGlobalAuthProfiles = useSetAtom(authProfilesAtom);
  const setEffectiveState = useSetAtom(effectiveStateAtom);
  const setPreviewState = useSetAtom(previewStateAtom);
  const setValidationState = useSetAtom(validationStateAtom);

  const reload = React.useCallback(async () => {
    const bridge = window.myclaude?.auth;
    if (!bridge) {
      setError("Bridge unavailable");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await bridge.list();
      const next = normalizeAuthList(list);
      setGlobalAuthProfiles(normalizeAuthProfiles(list));

      try {
        const detectResult = await getOAuthBridge()?.detect?.();
        if (detectResult && (detectResult as { detected?: boolean }).detected) {
          const d = detectResult as {
            detected: boolean;
            planType?: string;
            accessTokenExpiresAt?: string;
            email?: string;
          };
          // Hide the synthetic row when ANY oauth profile already references the
          // Claude Code refresh-token keyring path. Detection of that path is the
          // most reliable way to say "this user has already adopted the local
          // Claude Code login into their vault".
          const alreadyAdopted = next.some(
            (p) =>
              p.mode === "oauth" &&
              !!p.oauth?.refreshTokenRef &&
              p.oauth.refreshTokenRef.includes("anthropic-oauth-refresh")
          );
          if (!alreadyAdopted) {
            const detectedView: AuthProfileView = {
              id: DETECTED_ROW_ID,
              displayName: `Claude Code Login${d.planType ? ` (${d.planType})` : ""}`,
              mode: "oauth",
              secrets: [],
              detected: true,
            };
            const meta: OAuthMeta = {};
            if (d.email) meta.email = d.email;
            if (d.planType) meta.planType = d.planType;
            if (d.accessTokenExpiresAt) meta.accessTokenExpiresAt = d.accessTokenExpiresAt;
            detectedView.oauth = meta;
            next.unshift(detectedView);
          }
        }
      } catch {
        // Detection is best-effort, don't block the list
      }

      setProfiles(next);
      if (next.length > 0 && !next.some((p) => p.id === selectedId)) {
        setSelectedId(next[0]?.id ?? null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedId, setGlobalAuthProfiles]);

  const refreshSelectedAgentProfile = React.useCallback(
    async (profileId: string) => {
      if (selectedAgentAuthId !== profileId || !selectedRole || !cwd) return;
      const profileBridge = window.myclaude?.profile;
      if (!profileBridge?.show) return;
      const shown = await profileBridge.show({ role: selectedRole, authProfileId: profileId, cwd });
      setEffectiveState(normalizeEffectiveState(shown));
      setValidationState({ status: "idle", issues: [], errorMessage: null });
      setPreviewState({ status: "idle", effective: null, diff: [], errorMessage: null });
    },
    [cwd, selectedAgentAuthId, selectedRole, setEffectiveState, setPreviewState, setValidationState]
  );

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const selectedIsDetected = selected?.detected === true;
  const selectedIsOAuth = selected?.mode === "oauth";
  const { getItemProps: getProfileItemProps } = useRovingTabIndex<HTMLButtonElement>({
    count: profiles.length,
    orientation: "vertical",
    onActivate: (index) => {
      const profile = profiles[index];
      if (profile) setSelectedId(profile.id);
    },
  });

  const handleRefreshOAuth = React.useCallback(
    async (profileId: string) => {
      setBusy(true);
      try {
        const oauth = getOAuthBridge();
        if (!oauth?.refresh) throw new Error("OAuth refresh bridge unavailable");
        await oauth.refresh({ authId: profileId });
        await reload();
        setError(null);
        announce("Claude OAuth refreshed");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [announce, reload]
  );

  // Modal control
  const [addProfileOpen, setAddProfileOpen] = React.useState(false);
  const [addSecretOpen, setAddSecretOpen] = React.useState(false);
  const [addSecretTargetProfileId, setAddSecretTargetProfileId] = React.useState<string | null>(
    null
  );
  const [addSecretInitialName, setAddSecretInitialName] = React.useState("");
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<AuthProfileView | null>(null);
  const [adoptingId, setAdoptingId] = React.useState<string | null>(null);
  const [editingSecret, setEditingSecret] = React.useState<string | null>(null);

  const openAddSecretForProfile = React.useCallback((profileId: string, initialName = "") => {
    setAddSecretTargetProfileId(profileId);
    setAddSecretInitialName(initialName);
    setAddSecretOpen(true);
  }, []);

  const closeAddSecretDialog = React.useCallback((open: boolean) => {
    setAddSecretOpen(open);
    if (!open) {
      setAddSecretTargetProfileId(null);
      setAddSecretInitialName("");
    }
  }, []);

  React.useEffect(() => {
    if (!focusRequest || loading) return;
    const requestedName = normalizeLogicalToolSecretName(focusRequest.secretName ?? "");
    if (!requestedName || !isSafeLogicalToolSecretName(requestedName)) {
      setError("That tool secret name is not supported. Use a logical name such as github.pat.");
      setFocusRequest(null);
      announce("Tool secret repair needs a valid logical name");
      return;
    }

    const requestedProfile = profiles.find((profile) => profile.id === focusRequest.profileId);
    if (!requestedProfile || requestedProfile.detected) {
      setSelectedId(profiles.find((profile) => !profile.detected)?.id ?? profiles[0]?.id ?? null);
      setError(
        "Selected Claude identity is no longer available. Refresh Agent Profiles and choose an identity before repairing this tool secret."
      );
      setFocusRequest(null);
      announce("Tool secret repair needs an available Claude identity");
      return;
    }

    setSelectedId(requestedProfile.id);
    openAddSecretForProfile(requestedProfile.id, requestedName);
    setError(null);
    setFocusRequest(null);
    announce(`Auth repair opened for ${requestedName}`);
  }, [announce, focusRequest, loading, openAddSecretForProfile, profiles, setFocusRequest]);

  const addSecretTarget = addSecretTargetProfileId
    ? (profiles.find((profile) => profile.id === addSecretTargetProfileId) ?? null)
    : selected;

  return (
    <ScreenSurface aria-busy={loading || busy}>
      <ScreenHeader
        actions={
          <Button
            disabled={busy}
            onClick={() => setAddProfileOpen(true)}
            type="button"
            variant="primary"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Connect Claude
          </Button>
        }
        description="Claude identities used by Agent Profiles launch and readiness"
        title="Claude Auth"
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 window-large:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="app-scrollbar min-h-0 overflow-auto border-r border-default bg-surface">
          <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
            <div className="flex items-center gap-3">
              <IconFrame icon={KeyRound} size="sm" />
              <div>
                <h2 className="text-base font-semibold text-primary">Claude identities</h2>
                <p className="text-sm text-secondary">{profiles.length} connected</p>
              </div>
            </div>
          </div>
          {loading ? (
            <p className="px-4 py-6 text-sm text-secondary">Loading…</p>
          ) : profiles.length === 0 ? (
            <div className="h-72">
              <EmptyState icon={KeyRound} title="No Claude identities">
                Connect Claude before launching an Agent Profile.
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-subtle">
              {profiles.map((p, index) => (
                <SidebarRow
                  key={p.id}
                  profile={p}
                  active={p.id === selectedId}
                  busy={busy}
                  adoptOpen={adoptingId === p.id}
                  onSelect={() => setSelectedId(p.id)}
                  onAdoptToggle={() => setAdoptingId(adoptingId === p.id ? null : p.id)}
                  onAdoptSubmit={async ({ profileId, displayName }) => {
                    setBusy(true);
                    try {
                      const oauth = getOAuthBridge();
                      if (!oauth?.adopt) throw new Error("OAuth bridge unavailable");
                      const opts: { profileId: string; displayName?: string } = { profileId };
                      if (displayName) opts.displayName = displayName;
                      await oauth.adopt(opts);
                      setAdoptingId(null);
                      setSelectedId(profileId);
                      await reload();
                      announce("Auth profile added");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  onEdit={() => setRenameTarget(p)}
                  rovingProps={getProfileItemProps(index)}
                />
              ))}
            </ul>
          )}
          {error ? (
            <div className="m-4 rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
              {error}
            </div>
          ) : null}
        </aside>

        <section className="app-scrollbar min-h-0 overflow-auto bg-subtle">
          {selected === null ? (
            <EmptyState icon={KeyRound} title="Select a Claude identity">
              Choose an identity from the list to inspect credential health and actions.
            </EmptyState>
          ) : (
            <div className="space-y-6 p-6">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <IconFrame icon={ShieldCheck} />
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-semibold text-primary">
                      {selected.displayName || selected.id}
                    </h2>
                    <p className="truncate text-sm text-secondary">
                      <span className="font-mono text-xs">{selected.id}</span> · Claude{" "}
                      {selected.mode}
                      {selected.oauth?.email ? <> · {selected.oauth.email}</> : null}
                    </p>
                  </div>
                </div>
                {selectedIsDetected ? null : (
                  <div className="flex flex-wrap gap-2">
                    {selectedIsOAuth ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleRefreshOAuth(selected.id)}
                        disabled={busy}
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        Refresh OAuth
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setRotateOpen(true)}
                        disabled={busy}
                      >
                        <RotateCw className="h-4 w-4" aria-hidden="true" />
                        Rotate Claude key
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => setRemoveOpen(true)}
                      disabled={busy}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Remove profile
                    </Button>
                  </div>
                )}
              </header>

              {selectedIsDetected ? (
                <div className="rounded-md border border-default bg-elevated px-3 py-2 text-sm text-secondary">
                  Detected local Claude Code login. Use{" "}
                  <span className="font-medium text-primary">+ Add</span> on this row to manage it
                  here.
                </div>
              ) : null}

              <div data-testid="claude-auth-identity-summary">
                <CredentialSummary profile={selected} />
              </div>

              <section
                className="rounded-md border border-subtle bg-surface shadow-xs"
                data-testid="claude-auth-tool-secret-support"
              >
                <details>
                  <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <IconFrame icon={Wrench} size="sm" tone="neutral" />
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-primary">
                        Advanced tool secret support
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-secondary">
                        Tool and MCP readiness is shown from each Agent Profile. Use this advanced
                        area only when a profile's Tools section asks you to add or update a stored
                        tool token for this Claude identity.
                      </span>
                    </span>
                  </summary>
                  <div className="border-t border-subtle px-4 pb-4 pt-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs leading-5 text-secondary">
                        Stores third-party tool tokens by logical name. Plaintext stays in this
                        short-lived dialog and never enters renderer global state.
                      </p>
                      <Button
                        aria-label="Add or update MCP secret"
                        disabled={busy || selectedIsDetected}
                        onClick={() => openAddSecretForProfile(selected.id)}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add / update tool secret
                      </Button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.secrets.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-sm text-secondary">
                              No tool secrets registered yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          selected.secrets.map((name) => (
                            <TableRow key={name}>
                              <TableCell className="font-mono text-xs">{name}</TableCell>
                              <TableCell>
                                <Badge tone="success">present</Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy || selectedIsDetected}
                                  onClick={() => setEditingSecret(name)}
                                >
                                  Edit
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              </section>
            </div>
          )}
        </section>
      </div>

      <AddProfileDialog
        open={addProfileOpen}
        onOpenChange={setAddProfileOpen}
        busy={busy}
        onError={setError}
        onSubmit={async (spec) => {
          setBusy(true);
          try {
            await window.myclaude?.auth?.add({ spec });
            await reload();
            setAddProfileOpen(false);
            announce("Auth profile added");
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />

      {addSecretTarget !== null ? (
        <SetSecretDialog
          key={`add-${addSecretTarget.id}-${addSecretInitialName}`}
          open={addSecretOpen}
          onOpenChange={closeAddSecretDialog}
          profileId={addSecretTarget.id}
          mode="add"
          busy={busy}
          initialName={addSecretInitialName}
          onSubmit={async ({ name, value }) => {
            setBusy(true);
            try {
              const auth = window.myclaude?.auth;
              if (!auth?.setSecret) throw new Error("Auth bridge unavailable");
              await auth.setSecret({
                profileId: addSecretTarget.id,
                name,
                value,
                register: true,
              });
              await reload();
              await refreshSelectedAgentProfile(addSecretTarget.id);
              closeAddSecretDialog(false);
              setError(null);
              announce("Tool secret saved");
            } catch (err) {
              setError(
                formatSafeAuthError(
                  err,
                  "Tool secret could not be saved. Try again from Auth support."
                )
              );
              announce("Tool secret save failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {selected !== null ? (
        <SetSecretDialog
          key={`rotate-${selected.id}`}
          open={rotateOpen}
          onOpenChange={setRotateOpen}
          profileId={selected.id}
          mode="rotate"
          busy={busy}
          onSubmit={async ({ value }) => {
            setBusy(true);
            try {
              await window.myclaude?.auth?.rotate({ profileId: selected.id, value });
              await reload();
              setRotateOpen(false);
              announce("Claude key rotated");
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {selected !== null ? (
        <ConfirmDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          title={`Remove "${selected.displayName || selected.id}"?`}
          description="This deletes the vault profile and the keychain entries this app stored for it. The detected Claude Code login on this machine is left untouched."
          destructive
          confirmLabel="Remove"
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try {
              await window.myclaude?.auth?.remove({ profileId: selected.id, yes: true });
              await reload();
              setRemoveOpen(false);
              setSelectedId(null);
              announce("Auth profile removed");
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {renameTarget !== null ? (
        <RenameProfileDialog
          key={`rename-${renameTarget.id}`}
          open={true}
          initialDisplayName={renameTarget.displayName}
          profileId={renameTarget.id}
          busy={busy}
          onOpenChange={(o) => {
            if (!o) setRenameTarget(null);
          }}
          onSubmit={async (displayName) => {
            const target = renameTarget;
            if (!target) return;
            setBusy(true);
            try {
              const auth = getAuthBridge();
              if (!auth?.updateMeta) throw new Error("Auth bridge unavailable");
              await auth.updateMeta({ profileId: target.id, displayName });
              await reload();
              setRenameTarget(null);
              announce("Auth profile renamed");
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {selected !== null && editingSecret !== null ? (
        <EditSecretDialog
          key={`edit-${selected.id}-${editingSecret}`}
          open={true}
          profileId={selected.id}
          secretName={editingSecret}
          busy={busy}
          onOpenChange={(o) => {
            if (!o) setEditingSecret(null);
          }}
          onSubmit={async ({ value }) => {
            setBusy(true);
            try {
              const auth = window.myclaude?.auth;
              if (!auth?.setSecret) throw new Error("Auth bridge unavailable");
              await auth.setSecret({
                profileId: selected.id,
                name: editingSecret,
                value,
                register: true,
              });
              await reload();
              await refreshSelectedAgentProfile(selected.id);
              setEditingSecret(null);
              setError(null);
              announce("Tool secret updated");
            } catch (err) {
              setError(
                formatSafeAuthError(
                  err,
                  "Tool secret could not be updated. Try again from Auth support."
                )
              );
              announce("Tool secret update failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </ScreenSurface>
  );
}

function CredentialSummary({ profile }: { profile: AuthProfileView }): React.ReactElement {
  const expiresLabel = formatExpiresIn(profile.oauth?.accessTokenExpiresAt);
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Mode", value: profile.mode },
    {
      label: profile.mode === "oauth" ? "OAuth status" : "Claude secret",
      value:
        profile.detected === true ? (
          <Badge tone="info">Detected</Badge>
        ) : profile.mode === "oauth" ? (
          <Badge tone="success">Connected</Badge>
        ) : (
          <Badge tone="success">Stored</Badge>
        ),
    },
  ];

  if (profile.oauth?.email) rows.push({ label: "Email", value: profile.oauth.email });
  if (profile.oauth?.orgName) rows.push({ label: "Organization", value: profile.oauth.orgName });
  if (profile.oauth?.planType) rows.push({ label: "Plan", value: profile.oauth.planType });
  if (profile.oauth?.accessTokenExpiresAt) {
    rows.push({
      label: "Access token",
      value: `${profile.oauth.accessTokenExpiresAt}${expiresLabel ? ` (${expiresLabel})` : ""}`,
    });
  }
  if (profile.oauth?.refreshTokenRef) {
    rows.push({ label: "Refresh token", value: "Stored" });
  }

  return (
    <InfoPanel icon={KeyRound} title="Credential health">
      <dl className="mt-3 grid gap-3 text-sm window-large:grid-cols-2">
        {rows.map((row) => (
          <div className="grid gap-1" key={row.label}>
            <dt className="text-xs text-secondary">{row.label}</dt>
            <dd className="min-w-0 truncate text-primary">{row.value}</dd>
          </div>
        ))}
      </dl>
    </InfoPanel>
  );
}

// ─── Sidebar row ────────────────────────────────────────────────────────────

interface SidebarRowProps {
  profile: AuthProfileView;
  active: boolean;
  busy: boolean;
  adoptOpen: boolean;
  onSelect: () => void;
  onAdoptToggle: () => void;
  onAdoptSubmit: (input: { profileId: string; displayName?: string }) => Promise<void>;
  onEdit: () => void;
  rovingProps: RovingItemProps<HTMLButtonElement>;
}

function SidebarRow({
  profile,
  active,
  busy,
  adoptOpen,
  onSelect,
  onAdoptToggle,
  onAdoptSubmit,
  onEdit,
  rovingProps,
}: SidebarRowProps): React.ReactElement {
  const isDetected = profile.detected === true;
  const expiresLabel = formatExpiresIn(profile.oauth?.accessTokenExpiresAt);
  const primaryLabel = profile.displayName || profile.id;

  return (
    <li>
      <div
        className={`flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle ${
          active ? "bg-accent-soft" : ""
        }`}
      >
        <IconFrame icon={KeyRound} size="sm" tone={isDetected ? "accent" : "neutral"} />
        <button
          aria-label={`${profile.id} ${primaryLabel}`}
          className="flex flex-1 flex-col items-start gap-0.5 text-left"
          onClick={onSelect}
          type="button"
          {...rovingProps}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-primary">{primaryLabel}</span>
            {isDetected ? <Badge tone="info">detected</Badge> : null}
          </div>
          <span className="text-xs text-tertiary">
            <span className="text-secondary">{profile.mode}</span>
            {expiresLabel ? <> · {expiresLabel}</> : null}
            {!isDetected && profile.displayName && profile.displayName !== profile.id ? (
              <>
                {" · "}
                <span className="font-mono">{profile.id}</span>
              </>
            ) : null}
          </span>
        </button>
        {isDetected ? (
          <Button
            type="button"
            variant={adoptOpen ? "ghost" : "primary"}
            size="sm"
            disabled={busy}
            onClick={(ev) => {
              ev.stopPropagation();
              onAdoptToggle();
            }}
          >
            {adoptOpen ? "Cancel" : "+ Add"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label="Edit display name"
            onClick={(ev) => {
              ev.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </Button>
        )}
      </div>
      {isDetected ? (
        <CollapsibleAdoptForm
          open={adoptOpen}
          busy={busy}
          defaultDisplayName={profile.displayName || "Claude Code Login"}
          onSubmit={onAdoptSubmit}
          onCancel={onAdoptToggle}
        />
      ) : null}
    </li>
  );
}

// ─── Inline adopt form (slide-down) ─────────────────────────────────────────

interface CollapsibleAdoptFormProps {
  open: boolean;
  busy: boolean;
  defaultDisplayName: string;
  onSubmit: (input: { profileId: string; displayName?: string }) => Promise<void>;
  onCancel: () => void;
}

function CollapsibleAdoptForm({
  open,
  busy,
  defaultDisplayName,
  onSubmit,
  onCancel,
}: CollapsibleAdoptFormProps): React.ReactElement {
  const [displayName, setDisplayName] = React.useState(defaultDisplayName);

  React.useEffect(() => {
    if (open) {
      setDisplayName(defaultDisplayName);
    }
  }, [open, defaultDisplayName]);

  const canSubmit = displayName.trim().length > 0 && !busy;

  return (
    <div
      className={`grid overflow-hidden bg-subtle transition-[grid-template-rows,opacity] duration-200 ease-out ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
      aria-hidden={!open}
    >
      <div className="min-h-0">
        <div className="space-y-3 border-b border-subtle px-4 py-3">
          <Field label="Display name" description="What you'll see in the list">
            <Input
              value={displayName}
              onChange={(ev) => setDisplayName(ev.target.value)}
              placeholder="Claude Code Login"
              autoFocus={open}
              disabled={busy}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!canSubmit}
              onClick={() => {
                const input: { profileId: string; displayName?: string } = {
                  profileId: slugify(displayName),
                };
                if (displayName) input.displayName = displayName;
                void onSubmit(input);
              }}
            >
              {busy ? "Adding…" : "Add to vault"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

interface AddProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onError?: (error: string) => void;
  onSubmit: (spec: AddAuthProfileSpec) => Promise<void>;
}

export interface AddAuthProfileSpec {
  id: string;
  displayName?: string;
  anthropic: { mode: SecretBackedAuthMode; secretRef: string };
}

export interface AddAuthProfileFormProps {
  busy: boolean;
  autoFocus?: boolean;
  cancelLabel?: string;
  submitLabel?: string;
  onCancel?: () => void;
  onError?: (error: string) => void;
  onOAuthComplete?: () => void;
  onSubmit: (spec: AddAuthProfileSpec) => Promise<void>;
}

export function AddAuthProfileForm({
  busy,
  autoFocus,
  cancelLabel,
  submitLabel,
  onCancel,
  onError,
  onOAuthComplete,
  onSubmit,
}: AddAuthProfileFormProps): React.ReactElement {
  const [localBusy, setLocalBusy] = React.useState(false);
  const [displayName, setDisplayName] = React.useState("");
  const [mode, setMode] = React.useState<AuthMode>("apiKey");
  const displayNameId = React.useId();

  const derivedId = slugify(displayName);
  const derivedSecretRef = `keyring://anthropic/${derivedId}`;

  const isOAuth = mode === "oauth";
  const effectiveBusy = busy || localBusy;
  const canSubmit = displayName.trim().length > 0 && !effectiveBusy;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <Field
          description="What you'll see in the list"
          htmlFor={displayNameId}
          label="Display name"
        >
          <Input
            autoFocus={autoFocus}
            id={displayNameId}
            onChange={(ev) => setDisplayName(ev.target.value)}
            placeholder="Work account"
            value={displayName}
          />
        </Field>
        <Field label="Claude auth mode">
          <Select
            aria-label="Claude auth mode"
            onValueChange={(v) => setMode(v as AuthMode)}
            options={AUTH_MODES.map((m) => ({ value: m.value, label: m.label }))}
            value={mode}
          />
        </Field>
        {isOAuth ? (
          <p className="rounded-md border border-subtle bg-subtle px-3 py-2 text-sm text-secondary">
            OAuth opens a browser sign-in flow. Raw OAuth internals stay outside this screen.
          </p>
        ) : (
          <p className="rounded-md border border-subtle bg-subtle px-3 py-2 text-sm text-secondary">
            The Claude key is collected in a secure Main-owned dialog after this step. Storage refs
            and key values are not shown here.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button disabled={effectiveBusy} onClick={onCancel} type="button" variant="ghost">
            {cancelLabel ?? "Cancel"}
          </Button>
        ) : null}
        <Button
          disabled={!canSubmit}
          onClick={async () => {
            if (isOAuth) {
              setLocalBusy(true);
              try {
                const bridge = window.myclaude?.oauth;
                if (!bridge) throw new Error("OAuth bridge unavailable");
                const opts: { profileId: string; displayName?: string } = {
                  profileId: derivedId,
                };
                if (displayName) opts.displayName = displayName;
                await bridge.start(opts);
                onOAuthComplete?.();
              } catch (err) {
                onError?.(err instanceof Error ? err.message : String(err));
              } finally {
                setLocalBusy(false);
              }
              return;
            }
            const spec: AddAuthProfileSpec = {
              id: derivedId,
              anthropic: { mode, secretRef: derivedSecretRef },
            };
            if (displayName) spec.displayName = displayName;
            void onSubmit(spec);
          }}
          type="button"
          variant="primary"
        >
          {effectiveBusy
            ? isOAuth
              ? "Opening browser..."
              : "Saving..."
            : (submitLabel ?? (isOAuth ? "Sign in with Claude" : "Continue (collect key)"))}
        </Button>
      </div>
    </div>
  );
}

function AddProfileDialog({
  open,
  onOpenChange,
  busy,
  onError,
  onSubmit,
}: AddProfileDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Claude identity</DialogTitle>
          <DialogDescription>
            API keys are collected by a secure Main-owned dialog. OAuth opens the browser sign-in
            flow.
          </DialogDescription>
        </DialogHeader>
        <AddAuthProfileForm
          autoFocus
          busy={busy}
          onCancel={() => onOpenChange(false)}
          onOAuthComplete={() => onOpenChange(false)}
          onSubmit={onSubmit}
          {...(onError ? { onError } : {})}
        />
      </DialogContent>
    </Dialog>
  );
}

interface SetSecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  mode: "add" | "rotate";
  busy: boolean;
  initialName?: string;
  onSubmit: (input: { name: string; value: string }) => Promise<void>;
}

function SetSecretDialog({
  open,
  onOpenChange,
  profileId,
  mode,
  busy,
  initialName = "",
  onSubmit,
}: SetSecretDialogProps): React.ReactElement {
  const defaultName = mode === "rotate" ? "anthropic" : initialName;
  const [name, setName] = React.useState(defaultName);
  const [value, setValue] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const nameId = React.useId();
  const valueId = React.useId();

  React.useEffect(() => {
    if (open) {
      setName(mode === "rotate" ? "anthropic" : initialName);
      setValue("");
      setNameError(null);
      return;
    }
    setName(mode === "rotate" ? "anthropic" : initialName);
    setValue("");
    setNameError(null);
  }, [open, mode, initialName]);

  const normalizedName = normalizeLogicalToolSecretName(name);
  const nameIsSafe = mode === "rotate" || isSafeLogicalToolSecretName(normalizedName);
  const canSubmit = name.length > 0 && value.length > 0 && !busy;
  const title =
    mode === "rotate" ? `Rotate Claude key for "${profileId}"` : `Add secret to "${profileId}"`;
  const description =
    mode === "rotate"
      ? "Replaces the stored Claude key and revokes every live capability bound to this profile."
      : "Registers and stores a third-party API token used by an MCP server.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {mode === "add" ? (
            <Field
              {...(nameError ? { error: nameError } : {})}
              htmlFor={nameId}
              label="Secret name"
              description="Logical key — e.g. github.pat, postgres.acme"
            >
              <Input
                data-testid="auth-secret-name-input"
                id={nameId}
                value={name}
                onChange={(ev) => {
                  setName(ev.target.value);
                  setNameError(null);
                }}
                autoFocus
              />
            </Field>
          ) : null}
          <Field htmlFor={valueId} label="Secret value">
            <PasswordInput
              data-testid="auth-secret-value-input"
              id={valueId}
              value={value}
              onChange={(ev) => setValue(ev.target.value)}
              autoFocus={mode === "rotate"}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={mode === "rotate" ? "danger" : "primary"}
            disabled={!canSubmit}
            onClick={() => {
              if (!nameIsSafe) {
                setNameError(
                  "Use a logical secret name such as github.pat. Do not paste refs or values."
                );
                return;
              }
              const submitted = { name: normalizedName, value };
              setValue("");
              void onSubmit(submitted);
            }}
          >
            {busy ? "Saving…" : mode === "rotate" ? "Rotate" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditSecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  secretName: string;
  busy: boolean;
  onSubmit: (input: { value: string }) => Promise<void>;
}

function EditSecretDialog({
  open,
  onOpenChange,
  profileId,
  secretName,
  busy,
  onSubmit,
}: EditSecretDialogProps): React.ReactElement {
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  const canSubmit = value.length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edit MCP secret <span className="font-mono">{secretName}</span>
          </DialogTitle>
          <DialogDescription>
            Update the stored value for this secret on profile{" "}
            <span className="font-mono">{profileId}</span>.
          </DialogDescription>
        </DialogHeader>
        <Field label="Secret value">
          <PasswordInput value={value} onChange={(ev) => setValue(ev.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => {
              const submitted = { value };
              setValue("");
              void onSubmit(submitted);
            }}
          >
            {busy ? "Saving…" : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RenameProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  initialDisplayName: string;
  busy: boolean;
  onSubmit: (displayName: string) => Promise<void>;
}

function RenameProfileDialog({
  open,
  onOpenChange,
  profileId,
  initialDisplayName,
  busy,
  onSubmit,
}: RenameProfileDialogProps): React.ReactElement {
  const [displayName, setDisplayName] = React.useState(initialDisplayName);

  React.useEffect(() => {
    if (open) setDisplayName(initialDisplayName);
  }, [open, initialDisplayName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename profile</DialogTitle>
          <DialogDescription>
            Updates the human-readable label for <span className="font-mono">{profileId}</span>. The
            profile id and stored secrets are unchanged.
          </DialogDescription>
        </DialogHeader>
        <Field label="Display name">
          <Input
            value={displayName}
            onChange={(ev) => setDisplayName(ev.target.value)}
            autoFocus
            disabled={busy}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => {
              void onSubmit(displayName);
            }}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
