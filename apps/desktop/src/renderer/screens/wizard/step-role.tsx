import { Button, Field, Input } from "@agent-profile/ui";
import { useAtom, useAtomValue } from "jotai";
import { UserRound } from "lucide-react";
import * as React from "react";
import { IconFrame } from "../../components/screen-ui.js";
import { availableRolesAtom, selectedRoleAtom } from "../../lib/atoms.js";

export function StepRole({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}): React.ReactElement {
  const roles = useAtomValue(availableRolesAtom);
  const [selectedRole, setSelectedRole] = useAtom(selectedRoleAtom);
  const [customRole, setCustomRole] = React.useState(selectedRole || "eng");
  const effectiveRole = selectedRole || customRole.trim() || "eng";

  const chooseRole = React.useCallback(
    (role: string) => {
      setSelectedRole(role);
      onNext();
    },
    [onNext, setSelectedRole]
  );

  return (
    <section aria-labelledby="wizard-role-title" className="grid gap-5">
      <div className="flex items-start gap-3">
        <IconFrame icon={UserRound} />
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold text-primary" id="wizard-role-title">
            Choose a starting role
          </h1>
          <p className="text-sm text-secondary">
            Existing role files appear here. If none exist, setup uses the default role.
          </p>
        </div>
      </div>

      {roles.length > 0 ? (
        <div className="grid gap-2" data-testid="wizard-role-list">
          {roles.map((role) => (
            <Button
              key={role}
              onClick={() => chooseRole(role)}
              type="button"
              variant={role === selectedRole ? "primary" : "secondary"}
            >
              {role}
            </Button>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-default bg-subtle px-3 py-2 text-sm text-secondary">
          No role files were found. The editor will use <span className="font-mono">eng</span>.
        </p>
      )}

      <Field label="Custom role">
        <Input
          aria-label="Custom role"
          onChange={(event) => {
            setCustomRole(event.target.value);
            setSelectedRole(event.target.value.trim() || "eng");
          }}
          value={customRole}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button onClick={onBack} type="button" variant="ghost">
          Back
        </Button>
        <Button onClick={() => chooseRole(effectiveRole || "eng")} type="button" variant="primary">
          Continue
        </Button>
        <Button onClick={() => chooseRole("eng")} type="button" variant="secondary">
          Skip
        </Button>
      </div>
    </section>
  );
}
