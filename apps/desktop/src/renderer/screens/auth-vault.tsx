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

interface AuthSecretView {
  name: string;
  ref: string;
  status: "present" | "missing";
}

interface AuthProfileView {
  id: string;
  displayName: string;
  mode: string;
  /** Logical secret names (excluding "anthropic"). */
  secrets: string[];
}

const AUTH_MODES = [
  { value: "apiKey", label: "apiKey" },
  { value: "bedrock", label: "bedrock" },
  { value: "vertex", label: "vertex" },
  { value: "gateway", label: "gateway" },
] as const;

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
      return { id, displayName, mode, secrets };
    })
    .filter((p): p is AuthProfileView => p !== null);
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

  // Modal control
  const [addProfileOpen, setAddProfileOpen] = React.useState(false);
  const [addSecretOpen, setAddSecretOpen] = React.useState(false);
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="app-scrollbar min-h-0 overflow-auto border-r border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Auth profiles</h2>
            <p className="text-sm text-neutral-500">Metadata only — no secret values</p>
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
          <p className="px-4 py-6 text-sm text-neutral-500">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="px-4 py-6 text-sm text-neutral-500">No auth profiles yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {profiles.map((p) => {
              const active = p.id === selectedId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-neutral-50 ${
                      active ? "bg-neutral-100" : ""
                    }`}
                  >
                    <span className="text-sm font-medium">{p.id}</span>
                    <span className="text-xs text-neutral-500">
                      {p.displayName || "(no display name)"} · {p.mode} · {p.secrets.length} secret
                      {p.secrets.length === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error ? (
          <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </aside>

      <section className="app-scrollbar min-h-0 overflow-auto bg-neutral-50">
        {selected === null ? (
          <p className="p-6 text-sm text-neutral-500">Select an auth profile.</p>
        ) : (
          <div className="space-y-4 p-6">
            <header className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.id}</h2>
                <p className="text-sm text-neutral-600">
                  {selected.displayName || "(no display name)"} · mode {selected.mode}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setAddSecretOpen(true)}
                  disabled={busy}
                >
                  + Add secret
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setRotateOpen(true)}
                  disabled={busy}
                >
                  Rotate Anthropic key
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setRemoveOpen(true)}
                  disabled={busy}
                >
                  Remove profile
                </Button>
              </div>
            </header>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selected.secrets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-sm text-neutral-500">
                      No MCP secrets. Use “Add secret” to register one.
                    </TableCell>
                  </TableRow>
                ) : (
                  selected.secrets.map((name) => (
                    <TableRow key={name}>
                      <TableCell className="font-mono text-xs">{name}</TableCell>
                      <TableCell>
                        <Badge tone="success">present</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <AddProfileDialog
        open={addProfileOpen}
        onOpenChange={setAddProfileOpen}
        busy={busy}
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
          title={`Remove "${selected.id}"?`}
          description="This deletes every keychain entry tied to this profile. The action is irreversible."
          destructive
          confirmLabel="Remove"
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try {
              await window.myclaude?.auth?.remove({ profileId: selected.id });
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
    </div>
  );
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

interface AddProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (spec: {
    id: string;
    displayName?: string;
    anthropic: { mode: "apiKey" | "bedrock" | "vertex" | "gateway"; secretRef: string };
  }) => Promise<void>;
}

function AddProfileDialog({
  open,
  onOpenChange,
  busy,
  onSubmit,
}: AddProfileDialogProps): React.ReactElement {
  const [id, setId] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [mode, setMode] = React.useState<"apiKey" | "bedrock" | "vertex" | "gateway">("apiKey");
  const [secretRef, setSecretRef] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setId("");
      setDisplayName("");
      setMode("apiKey");
      setSecretRef("");
    }
  }, [open]);

  React.useEffect(() => {
    if (id && !secretRef) {
      setSecretRef(`keyring://anthropic/${id}`);
    }
  }, [id, secretRef]);

  const canSubmit = id.length > 0 && secretRef.length > 0 && !busy;

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
          <Field label="Profile id" description="Lowercase identifier (e.g. work, personal)">
            <Input
              value={id}
              onChange={(ev) => setId(ev.target.value)}
              placeholder="work"
              autoFocus
            />
          </Field>
          <Field label="Display name" description="Optional human-readable label">
            <Input
              value={displayName}
              onChange={(ev) => setDisplayName(ev.target.value)}
              placeholder="Work account"
            />
          </Field>
          <Field label="Auth mode">
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as "apiKey" | "bedrock" | "vertex" | "gateway")}
              options={AUTH_MODES.map((m) => ({ value: m.value, label: m.label }))}
            />
          </Field>
          <Field label="Anthropic secret ref" description="Where the key will be stored">
            <Input value={secretRef} onChange={(ev) => setSecretRef(ev.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => {
              const spec: {
                id: string;
                displayName?: string;
                anthropic: {
                  mode: "apiKey" | "bedrock" | "vertex" | "gateway";
                  secretRef: string;
                };
              } = {
                id,
                anthropic: { mode, secretRef },
              };
              if (displayName) spec.displayName = displayName;
              void onSubmit(spec);
            }}
          >
            {busy ? "Saving…" : "Continue (collect key)"}
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
  // Plaintext lives ONLY in component-local state. Cleared on every close.
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setName(mode === "rotate" ? "anthropic" : "");
      setValue("");
    }
  }, [open, mode]);

  const canSubmit = name.length > 0 && value.length > 0 && !busy;
  const title =
    mode === "rotate" ? `Rotate Anthropic key for "${profileId}"` : `Add secret to "${profileId}"`;
  const description =
    mode === "rotate"
      ? "Replaces the stored Anthropic key and revokes every live capability bound to this profile."
      : "Registers and stores a new MCP secret for this profile.";

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
