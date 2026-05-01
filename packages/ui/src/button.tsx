import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "./utils.js";

const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:opacity-90",
        primary: "border-primary bg-primary text-primary-foreground hover:opacity-90",
        secondary: "border-border bg-secondary text-secondary-foreground hover:bg-muted",
        outline:
          "border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost:
          "border-transparent bg-transparent text-foreground shadow-none hover:bg-accent hover:text-accent-foreground",
        link: "border-transparent bg-transparent text-foreground shadow-none underline-offset-4 hover:underline",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground hover:opacity-90",
        danger: "border-destructive bg-destructive text-destructive-foreground hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3",
        default: "h-9 px-4",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
