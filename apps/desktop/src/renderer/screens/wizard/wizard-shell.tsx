import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@agent-profile/ui";
import { useAtom, useSetAtom } from "jotai";
import * as React from "react";
import { firstRunAtom, wizardDismissedAtom, wizardStepAtom } from "../../lib/atoms.js";
import { StepAuth } from "./step-auth.js";
import { StepDone } from "./step-done.js";
import { StepRole } from "./step-role.js";
import { StepWelcome } from "./step-welcome.js";

export function WizardShell(): React.ReactElement {
  const [step, setStep] = useAtom(wizardStepAtom);
  const setWizardDismissed = useSetAtom(wizardDismissedAtom);
  const setFirstRun = useSetAtom(firstRunAtom);

  const handleSessionDismiss = React.useCallback(() => {
    setWizardDismissed(true);
  }, [setWizardDismissed]);

  const handleComplete = React.useCallback(() => {
    setFirstRun(false);
    setWizardDismissed(true);
    setStep("welcome");
  }, [setFirstRun, setStep, setWizardDismissed]);

  return (
    <div className="h-full min-h-full bg-canvas text-primary">
      <Dialog
        open={true}
        onOpenChange={(open) => {
          if (!open) handleSessionDismiss();
        }}
      >
        <DialogContent
          className="max-h-[88vh] max-w-[720px] overflow-auto"
          data-testid="first-run-wizard"
        >
          <DialogHeader>
            <DialogTitle id="wizard-title">Agent Profile setup</DialogTitle>
            <DialogDescription>
              Create an auth profile and choose the role this window should open with.
            </DialogDescription>
          </DialogHeader>

          {step === "welcome" ? (
            <StepWelcome onNext={() => setStep("auth")} />
          ) : step === "auth" ? (
            <StepAuth onBack={() => setStep("welcome")} onNext={() => setStep("role")} />
          ) : step === "role" ? (
            <StepRole onBack={() => setStep("auth")} onNext={() => setStep("done")} />
          ) : (
            <StepDone onBack={() => setStep("role")} onComplete={handleComplete} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
