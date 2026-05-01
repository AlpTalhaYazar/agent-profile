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

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const badgeVariantTone: Record<BadgeVariant, VariantProps<typeof badgeVariants>["tone"]> = {
  default: "info",
  secondary: "neutral",
  destructive: "danger",
  outline: "neutral",
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  variant?: BadgeVariant;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, variant, ...props }, ref) => {
    const resolvedTone = tone ?? (variant ? badgeVariantTone[variant] : undefined);
    return (
      <span
        ref={ref}
        className={cn(
          badgeVariants({ tone: resolvedTone, className }),
          variant === "outline" && "bg-transparent text-foreground"
        )}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

export { badgeVariants };
