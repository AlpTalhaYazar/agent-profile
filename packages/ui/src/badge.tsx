import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "./utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-border bg-secondary text-secondary-foreground",
        success: "border-success bg-success-soft text-success",
        warning: "border-warning bg-warning-soft text-warning",
        danger: "border-destructive bg-destructive-soft text-destructive",
        info: "border-info bg-info-soft text-info",
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
