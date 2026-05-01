import type * as React from "react";
import { cn } from "./utils.js";

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  description?: string;
  error?: string;
  htmlFor?: string;
}

export function Field({
  label,
  description,
  error,
  htmlFor,
  className,
  children,
  ...props
}: FieldProps): React.ReactElement {
  return (
    <div className={cn("grid gap-1.5", className)} {...props}>
      <label className="text-sm font-medium text-primary" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {description ? <p className="text-xs text-secondary">{description}</p> : null}
      {error ? <p className="text-xs font-medium text-status-danger">{error}</p> : null}
    </div>
  );
}
