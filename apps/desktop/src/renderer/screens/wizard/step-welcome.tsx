import { Button } from "@agent-profile/ui";
import { Sparkles } from "lucide-react";
import type * as React from "react";
import { IconFrame } from "../../components/screen-ui.js";

export function StepWelcome({ onNext }: { onNext: () => void }): React.ReactElement {
  return (
    <section aria-labelledby="wizard-welcome-title" className="grid gap-6">
      <div className="flex items-start gap-3">
        <IconFrame icon={Sparkles} />
        <div className="grid gap-2">
          <h1 className="text-xl font-semibold text-primary" id="wizard-welcome-title">
            Welcome to Agent Profile
          </h1>
          <p className="text-sm text-secondary">
            Create your first Claude credential and choose the role this workspace opens with.
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button data-testid="wizard-get-started" onClick={onNext} type="button" variant="primary">
          Get Started
        </Button>
      </div>
    </section>
  );
}
