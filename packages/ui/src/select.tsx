import * as SelectPrimitive from "@radix-ui/react-select";
import type * as React from "react";
import { cn } from "./utils.js";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  "aria-label": ariaLabel,
}: SelectProps): React.ReactElement {
  return (
    <SelectPrimitive.Root disabled={disabled ?? false} onValueChange={onValueChange} value={value}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-9 w-full items-center justify-between rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-neutral-950 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon aria-hidden>v</SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="z-50 min-w-[8rem] overflow-hidden rounded-md border border-neutral-200 bg-white shadow-md">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="relative flex h-8 cursor-default select-none items-center rounded-sm px-2 text-sm text-neutral-950 outline-none hover:bg-neutral-100 data-[highlighted]:bg-neutral-100"
                key={option.value}
                value={option.value}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
