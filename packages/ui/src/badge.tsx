import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "./utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-default bg-elevated text-secondary",
        success: "border-status-success bg-status-success-soft text-status-success",
        warning: "border-status-warning bg-status-warning-soft text-status-warning",
        danger: "border-status-danger bg-status-danger-soft text-status-danger",
        info: "border-status-info bg-status-info-soft text-status-info",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone, className }))} {...props} />
  )
);
Badge.displayName = "Badge";

export { badgeVariants };
