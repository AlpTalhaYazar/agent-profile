import { Button } from "@agent-profile/ui";
import type * as React from "react";

export function StepWelcome({ onNext }: { onNext: () => void }): React.ReactElement {
  return (
    <section aria-labelledby="wizard-welcome-title" className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold text-primary" id="wizard-welcome-title">
          Welcome to Agent Profile
        </h1>
        <p className="text-sm text-secondary">
          This setup creates your first auth profile and opens the editor on a starter role.
        </p>
      </div>
      <div className="flex justify-end">
        <Button data-testid="wizard-get-started" onClick={onNext} type="button" variant="primary">
          Get Started
        </Button>
      </div>
    </section>
  );
}
