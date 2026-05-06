import { Button } from "@agent-profile/ui";
import { useAtomValue, useSetAtom } from "jotai";
import { CheckCircle2 } from "lucide-react";
import * as React from "react";
import { IconFrame } from "../../components/screen-ui.js";
import { currentScreenAtom, selectedAuthIdAtom, selectedRoleAtom } from "../../lib/atoms.js";
import { getErrorMessage } from "../../lib/normalize.js";

export function StepDone({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => void;
}): React.ReactElement {
  const selectedAuthId = useAtomValue(selectedAuthIdAtom);
  const selectedRole = useAtomValue(selectedRoleAtom);
  const setCurrentScreen = useSetAtom(currentScreenAtom);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const finish = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await window.myclaude?.setup?.markComplete();
      setCurrentScreen("home");
      onComplete();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [onComplete, setCurrentScreen]);

  return (
    <section aria-labelledby="wizard-done-title" className="grid gap-5">
      <div className="flex items-start gap-3">
        <IconFrame icon={CheckCircle2} tone="success" />
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold text-primary" id="wizard-done-title">
            Setup complete
          </h1>
          <p className="text-sm text-secondary">
            Agent Profiles will open with this credential and role ready to review.
          </p>
        </div>
      </div>

      <dl className="grid gap-2 rounded-md border border-default bg-subtle px-3 py-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-secondary">Auth profile</dt>
          <dd className="font-mono text-primary">{selectedAuthId || "profile"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-secondary">Role</dt>
          <dd className="font-mono text-primary">{selectedRole || "eng"}</dd>
        </div>
      </dl>

      {error ? (
        <div className="rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onBack} type="button" variant="ghost">
          Back
        </Button>
        <Button
          data-testid="wizard-go-to-editor"
          disabled={busy}
          onClick={() => void finish()}
          type="button"
          variant="primary"
        >
          {busy ? "Finishing..." : "Go to Agent Profiles"}
        </Button>
      </div>
    </section>
  );
}
