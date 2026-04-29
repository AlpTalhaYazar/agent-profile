import * as React from "react";
import { Button } from "./button.js";
import { Input, type InputProps } from "./input.js";
import { cn } from "./utils.js";

export interface PasswordInputProps extends Omit<InputProps, "type"> {
  /** Label for the toggle button when the value is hidden. Defaults to "Show". */
  showLabel?: string;
  /** Label for the toggle button when the value is visible. Defaults to "Hide". */
  hideLabel?: string;
}

/**
 * Single-line password field with a Show/Hide toggle.
 *
 * The toggle state lives in component-local state — the plaintext value is
 * only ever in the parent's controlled `value`. Form callers MUST keep the
 * value in `useState` and reset it when their dialog/modal closes; never
 * route plaintext through Jotai atoms or shared stores.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, showLabel = "Show", hideLabel = "Hide", ...props }, ref) => {
    const [revealed, setRevealed] = React.useState(false);
    return (
      <div className={cn("flex items-stretch gap-2", className)}>
        <Input ref={ref} type={revealed ? "text" : "password"} className="flex-1" {...props} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
        >
          {revealed ? hideLabel : showLabel}
        </Button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";
