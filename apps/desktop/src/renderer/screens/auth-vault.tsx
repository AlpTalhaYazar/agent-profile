/**
 * @module renderer/screens/auth-vault
 *
 * Phase 2 milestone 5 Auth Vault screen.
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
import * as React from "react";

interface OAuthMeta {
  email?: string;
  orgName?: string;
  planType?: string;
  accessTokenExpiresAt?: string;
  refreshTokenRef?: string;
}

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
      const oauth =
        oauthRaw && typeof oauthRaw === "object"
          ? (oauthRaw as OAuthMeta)
          : undefined;
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

export function AuthVaultScreen(): React.ReactElement {
  const [profiles, setProfiles] = React.useState<AuthProfileView[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

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
              p.oauth.refreshTokenRef.includes("anthropic-oauth-refresh"),
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
  }, [selectedId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const selectedIsDetected = selected?.detected === true;
  const selectedIsOAuth = selected?.mode === "oauth";

  // Modal control
  const [addProfileOpen, setAddProfileOpen] = React.useState(false);
  const [addSecretOpen, setAddSecretOpen] = React.useState(false);
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<AuthProfileView | null>(null);
  const [adoptingId, setAdoptingId] = React.useState<string | null>(null);
  const [editingSecret, setEditingSecret] = React.useState<string | null>(null);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 window-large:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="app-scrollbar min-h-0 overflow-auto border-r border-default bg-surface">
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-primary">Auth profiles</h2>
            <p className="text-sm text-secondary">Metadata only — no secret values</p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setAddProfileOpen(true)}
            disabled={busy}
          >
            + Add profile
          </Button>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-secondary">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="px-4 py-6 text-sm text-secondary">No auth profiles yet.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {profiles.map((p) => (
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
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
                onEdit={() => setRenameTarget(p)}
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
          <p className="p-6 text-sm text-secondary">Select an auth profile.</p>
        ) : (
          <div className="space-y-6 p-6">
            <header className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-primary">
                  {selected.displayName || selected.id}
                </h2>
                <p className="text-sm text-secondary">
                  <span className="font-mono text-xs">{selected.id}</span> · mode {selected.mode}
                  {selected.oauth?.email ? <> · {selected.oauth.email}</> : null}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setAddSecretOpen(true)}
                  disabled={busy || selectedIsDetected}
                >
                  + Add MCP secret
                </Button>
                {selectedIsOAuth ? null : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setRotateOpen(true)}
                    disabled={busy || selectedIsDetected}
                  >
                    Rotate Anthropic key
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setRemoveOpen(true)}
                  disabled={busy || selectedIsDetected}
                >
                  Remove profile
                </Button>
              </div>
            </header>

            {selectedIsDetected ? (
              <div className="rounded-md border border-default bg-elevated px-3 py-2 text-sm text-secondary">
                This is an existing Claude Code login detected on this machine. Click the{" "}
                <span className="font-medium text-primary">+ Add</span> button next to it in the
                sidebar to import it into the vault.
              </div>
            ) : null}

            <section className="space-y-2">
              <header>
                <h3 className="text-sm font-semibold text-primary">MCP secrets</h3>
                <p className="text-xs text-secondary">
                  Third-party API tokens passed to MCP servers (e.g. <code>github.pat</code>,{" "}
                  <code>postgres.acme</code>). Not the Anthropic key.
                </p>
              </header>
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
                        No MCP secrets registered yet.
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
            </section>
          </div>
        )}
      </section>

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
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />

      {selected !== null ? (
        <SetSecretDialog
          key={`add-${selected.id}`}
          open={addSecretOpen}
          onOpenChange={setAddSecretOpen}
          profileId={selected.id}
          mode="add"
          busy={busy}
          onSubmit={async ({ name, value }) => {
            setBusy(true);
            try {
              await window.myclaude?.auth?.setSecret({
                profileId: selected.id,
                name,
                value,
                register: true,
              });
              await reload();
              setAddSecretOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
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
              await window.myclaude?.auth?.setSecret({
                profileId: selected.id,
                name: editingSecret,
                value,
                register: true,
              });
              await reload();
              setEditingSecret(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </div>
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
}: SidebarRowProps): React.ReactElement {
  const isDetected = profile.detected === true;
  const expiresLabel = formatExpiresIn(profile.oauth?.accessTokenExpiresAt);
  const primaryLabel = profile.displayName || profile.id;

  return (
    <li>
      <div
        className={`flex w-full items-center gap-2 px-4 py-3 transition-colors hover:bg-subtle ${
          active ? "bg-elevated" : ""
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex flex-1 flex-col items-start gap-0.5 text-left"
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={busy}
            >
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
  onSubmit: (spec: {
    id: string;
    displayName?: string;
    anthropic: { mode: "apiKey" | "bedrock" | "vertex" | "gateway" | "oauth"; secretRef: string };
  }) => Promise<void>;
}

function AddProfileDialog({
  open,
  onOpenChange,
  busy,
  onError,
  onSubmit,
}: AddProfileDialogProps): React.ReactElement {
  const [localBusy, setLocalBusy] = React.useState(false);
  const [displayName, setDisplayName] = React.useState("");
  const [mode, setMode] = React.useState<"apiKey" | "bedrock" | "vertex" | "gateway" | "oauth">("apiKey");
  const [secretRef, setSecretRef] = React.useState("");

  const derivedId = slugify(displayName);

  React.useEffect(() => {
    if (!open) {
      setDisplayName("");
      setMode("apiKey");
      setSecretRef("");
    }
  }, [open]);

  React.useEffect(() => {
    if (derivedId && !secretRef) {
      setSecretRef(`keyring://anthropic/${derivedId}`);
    }
  }, [derivedId, secretRef]);

  const isOAuth = mode === "oauth";
  const effectiveBusy = busy || localBusy;
  const canSubmit = displayName.trim().length > 0 && (isOAuth || secretRef.length > 0) && !effectiveBusy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add auth profile</DialogTitle>
          <DialogDescription>
            The Anthropic API key is collected by a Main-owned dialog after you save — it never
            travels through this window.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Display name" description="What you'll see in the list">
            <Input
              value={displayName}
              onChange={(ev) => setDisplayName(ev.target.value)}
              placeholder="Work account"
              autoFocus
            />
          </Field>
          <Field label="Auth mode">
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as "apiKey" | "bedrock" | "vertex" | "gateway" | "oauth")}
              options={AUTH_MODES.map((m) => ({ value: m.value, label: m.label }))}
            />
          </Field>
          {isOAuth ? null : (
            <Field label="Anthropic secret ref" description="Where the key will be stored">
              <Input value={secretRef} onChange={(ev) => setSecretRef(ev.target.value)} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={effectiveBusy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={async () => {
              if (isOAuth) {
                setLocalBusy(true);
                try {
                  const bridge = window.myclaude?.oauth;
                  if (!bridge) throw new Error("OAuth bridge unavailable");
                  const opts: { profileId: string; displayName?: string } = { profileId: derivedId };
                  if (displayName) opts.displayName = displayName;
                  await bridge.start(opts);
                  onOpenChange(false);
                } catch (err) {
                  onError?.(err instanceof Error ? err.message : String(err));
                } finally {
                  setLocalBusy(false);
                }
                return;
              }
              const spec: {
                id: string;
                displayName?: string;
                anthropic: {
                  mode: "apiKey" | "bedrock" | "vertex" | "gateway" | "oauth";
                  secretRef: string;
                };
              } = {
                id: derivedId,
                anthropic: { mode, secretRef },
              };
              if (displayName) spec.displayName = displayName;
              void onSubmit(spec);
            }}
          >
            {effectiveBusy ? (isOAuth ? "Opening browser…" : "Saving…") : isOAuth ? "Sign in with Anthropic" : "Continue (collect key)"}
          </Button>
        </DialogFooter>
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
  onSubmit: (input: { name: string; value: string }) => Promise<void>;
}

function SetSecretDialog({
  open,
  onOpenChange,
  profileId,
  mode,
  busy,
  onSubmit,
}: SetSecretDialogProps): React.ReactElement {
  const [name, setName] = React.useState(mode === "rotate" ? "anthropic" : "");
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setName(mode === "rotate" ? "anthropic" : "");
      setValue("");
    }
  }, [open, mode]);

  const canSubmit = name.length > 0 && value.length > 0 && !busy;
  const title =
    mode === "rotate" ? `Rotate Anthropic key for "${profileId}"` : `Add MCP secret to "${profileId}"`;
  const description =
    mode === "rotate"
      ? "Replaces the stored Anthropic key and revokes every live capability bound to this profile."
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
            <Field label="Secret name" description="Logical key — e.g. github.pat, postgres.acme">
              <Input value={name} onChange={(ev) => setName(ev.target.value)} autoFocus />
            </Field>
          ) : null}
          <Field label="Secret value">
            <PasswordInput
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
              const submitted = { name, value };
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
          <PasswordInput
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            autoFocus
          />
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
            Updates the human-readable label for <span className="font-mono">{profileId}</span>.
            The profile id and stored secrets are unchanged.
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
