import { cn } from "@agent-profile/ui";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

export function ScreenSurface({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn("flex h-full min-h-0 min-w-0 flex-col bg-canvas text-primary", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ScreenHeader({
  actions,
  children,
  className,
  description,
  status,
  title,
}: {
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  description?: React.ReactNode;
  status?: React.ReactNode;
  title: string;
}): React.ReactElement {
  return (
    <header className={cn("min-w-0 border-b border-subtle bg-surface/80 px-6 py-5", className)}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            className="text-2xl font-semibold tracking-normal text-primary"
            id="screen-heading"
            tabIndex={-1}
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-5 text-secondary text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          {status ? <div className="text-sm text-secondary">{status}</div> : null}
          {actions}
        </div>
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </header>
  );
}

export function IconFrame({
  className,
  icon: Icon,
  size = "md",
  tone = "accent",
}: {
  className?: string;
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
  tone?: "accent" | "neutral" | "success" | "warning" | "danger";
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border",
        size === "sm" && "h-8 w-8",
        size === "md" && "h-10 w-10",
        size === "lg" && "h-14 w-14",
        tone === "accent" && "border-accent bg-status-info-soft text-status-info",
        tone === "neutral" && "border-default bg-subtle text-secondary",
        tone === "success" && "border-status-success bg-status-success-soft text-status-success",
        tone === "warning" && "border-status-warning bg-status-warning-soft text-status-warning",
        tone === "danger" && "border-status-danger bg-status-danger-soft text-status-danger",
        className
      )}
      aria-hidden="true"
    >
      <Icon className={cn(size === "lg" ? "h-7 w-7" : "h-4 w-4")} />
    </span>
  );
}

export function ContextControl({
  children,
  className,
  icon,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  icon: LucideIcon;
  label: string;
}): React.ReactElement {
  return (
    <div className={cn("grid min-w-0 gap-2", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        {React.createElement(icon, { className: "h-4 w-4 text-secondary", "aria-hidden": true })}
        <span>{label}</span>
      </div>
      <div className="min-h-10">{children}</div>
    </div>
  );
}

export function ActionBanner({
  actions,
  chips,
  description,
  icon,
  ready,
  title,
}: {
  actions?: React.ReactNode;
  chips?: React.ReactNode;
  description: string;
  icon: LucideIcon;
  ready: boolean;
  title: string;
}): React.ReactElement {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-4 rounded-md border px-5 py-4",
        ready ? "border-accent bg-accent-soft" : "border-status-warning bg-status-warning-soft"
      )}
    >
      <IconFrame icon={icon} size="lg" tone={ready ? "accent" : "warning"} />
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        <p className="mt-0.5 text-sm text-secondary">{description}</p>
        {chips ? <div className="mt-2 flex flex-wrap gap-2">{chips}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </section>
  );
}

export function StatusChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium",
        tone === "neutral" && "border-default bg-surface text-secondary",
        tone === "success" && "border-status-success bg-status-success-soft text-status-success",
        tone === "warning" && "border-status-warning bg-status-warning-soft text-status-warning",
        tone === "danger" && "border-status-danger bg-status-danger-soft text-status-danger",
        tone === "info" && "border-accent bg-status-info-soft text-status-info"
      )}
    >
      {children}
    </span>
  );
}

export function IconTile({
  detail,
  icon,
  label,
  onClick,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  value: number | string;
}): React.ReactElement {
  return (
    <button
      className="group flex min-h-[5.9rem] min-w-0 items-center justify-between gap-4 rounded-md border border-default bg-surface px-4 py-4 text-left transition-colors hover:border-accent hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      <div className="flex min-w-0 items-center gap-4">
        <IconFrame icon={icon} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-secondary">{label}</span>
          <span className="mt-1 block text-2xl font-semibold leading-none text-primary">
            {value}
          </span>
          <span className="mt-1 block truncate text-sm text-tertiary">{detail}</span>
        </span>
      </div>
      <span className="text-xl text-tertiary transition-transform group-hover:translate-x-0.5">
        ›
      </span>
    </button>
  );
}

export function InfoPanel({
  actions,
  children,
  className,
  icon,
  title,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  icon?: LucideIcon;
  title: string;
}): React.ReactElement {
  return (
    <section className={cn("min-w-0 rounded-md border border-default bg-surface p-4", className)}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <IconFrame icon={icon} size="sm" /> : null}
          <h2 className="truncate text-base font-semibold text-primary">{title}</h2>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({
  children,
  icon,
  title,
}: {
  children?: React.ReactNode;
  icon: LucideIcon;
  title: string;
}): React.ReactElement {
  return (
    <div className="flex h-full min-h-[12rem] items-center justify-center text-center">
      <div className="max-w-md px-6">
        <IconFrame className="mx-auto" icon={icon} size="lg" tone="neutral" />
        <p className="mt-4 text-base font-semibold text-primary">{title}</p>
        {children ? <div className="mt-2 text-sm text-secondary">{children}</div> : null}
      </div>
    </div>
  );
}
