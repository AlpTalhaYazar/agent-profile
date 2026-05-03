import { Button } from "@agent-profile/ui";
import { useSetAtom } from "jotai";
import { KeyRound } from "lucide-react";
import * as React from "react";
import { IconFrame } from "../../components/screen-ui.js";
import { authProfilesAtom, selectedAuthIdAtom } from "../../lib/atoms.js";
import { getErrorMessage, normalizeAuthProfiles } from "../../lib/normalize.js";
import { AddAuthProfileForm, type AddAuthProfileSpec } from "../auth-vault.js";

export function StepAuth({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}): React.ReactElement {
  const setAuthProfiles = useSetAtom(authProfilesAtom);
  const setSelectedAuthId = useSetAtom(selectedAuthIdAtom);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refreshProfiles = React.useCallback(async () => {
    const list = window.myclaude?.auth?.list ? await window.myclaude.auth.list() : [];
    const normalized = normalizeAuthProfiles(list);
    setAuthProfiles(normalized);
    return normalized;
  }, [setAuthProfiles]);

  const handleSubmit = React.useCallback(
    async (spec: AddAuthProfileSpec) => {
      setBusy(true);
      setError(null);
      try {
        await window.myclaude?.auth?.add({ spec });
        const nextProfiles = await refreshProfiles();
        setSelectedAuthId(spec.id || nextProfiles[0]?.id || "");
        onNext();
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [onNext, refreshProfiles, setSelectedAuthId]
  );

  return (
    <section aria-labelledby="wizard-auth-title" className="grid gap-5">
      <div className="flex items-start gap-3">
        <IconFrame icon={KeyRound} />
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold text-primary" id="wizard-auth-title">
            Add a Claude credential
          </h1>
          <p className="text-sm text-secondary">
            Secrets are collected by Main and stored outside the renderer.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
          {error}
        </div>
      ) : null}

      <AddAuthProfileForm
        autoFocus
        busy={busy}
        cancelLabel="Back"
        onCancel={onBack}
        onError={setError}
        onOAuthComplete={async () => {
          const nextProfiles = await refreshProfiles();
          setSelectedAuthId(nextProfiles[0]?.id ?? "");
          onNext();
        }}
        onSubmit={handleSubmit}
      />
    </section>
  );
}
