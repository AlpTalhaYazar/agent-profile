/**
 * @module components/preview-panel
 *
 * Renders the resolved-effective preview for the Profile Editor screen plus
 * the right-hand inspector aside that summarises state for the active
 * (role, auth, scope) triple. Owns the `createDiffSummary` helper used by
 * `screens/profile-editor.tsx` to compute draft impact, since the diff lines
 * format mirror the preview table.
 *
 * Extracted from `index.tsx` as part of ST-2 of Phase 2 milestone 7.
 */

import { Badge, cn } from "@agent-profile/ui";
import * as React from "react";
import {
  flattenObject,
  redactText,
  sortedUnion,
  stableStringify,
  stringifyInline,
} from "../lib/clone.js";
import { emptyPersona } from "../lib/normalize.js";
import type {
  DiffItem,
  EffectiveConfig,
  PreviewState,
  Provenance,
  ScopeDocPersona,
  ScopeListEntry,
  ValidationState,
} from "../lib/types.js";
import { summarizeServer, transportLabel } from "./server-form.js";

export interface PreviewSummaryProps {
  effective: EffectiveConfig | null;
  provenance: Provenance | null;
  selectedScope: ScopeListEntry | null;
  setTargetRef: (key: string, element: HTMLElement | null) => void;
}

export function PreviewSummary({
  effective,
  provenance,
  selectedScope,
  setTargetRef,
}: PreviewSummaryProps): React.ReactElement {
  const selectedScopeToken = scopeSelectionToken(selectedScope);
  const settingsEntries = React.useMemo(
    () => flattenObject(effective?.settings ?? {}),
    [effective?.settings]
  );

  return (
    <div>
      <section
        className={sectionClassName("summary", selectedScopeToken)}
        ref={(element) => setTargetRef("summary", element)}
      >
        <h3 className="text-sm font-semibold">Summary</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm xl:grid-cols-4">
          <SummaryMetric
            label="MCP servers"
            value={String(Object.keys(effective?.mcpServers ?? {}).length)}
          />
          <SummaryMetric
            label="Env vars"
            value={String(Object.keys(effective?.env ?? {}).length)}
          />
          <SummaryMetric label="Settings" value={String(settingsEntries.length)} />
          <SummaryMetric
            label="Persona files"
            value={String(
              Object.values(effective?.persona ?? {}).reduce(
                (count, paths) => count + paths.length,
                0
              )
            )}
          />
        </div>
      </section>

      <section
        className={sectionClassName("mcpServers", selectedScopeToken)}
        ref={(element) => setTargetRef("mcpServers", element)}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">MCP servers</h3>
          <span className="text-xs text-secondary">
            {Object.keys(effective?.mcpServers ?? {}).length} active
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-md border border-default bg-surface">
          <table className="min-w-full divide-y divide-subtle text-sm">
            <thead className="bg-subtle text-left text-xs uppercase tracking-wide text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Transport</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {Object.entries(effective?.mcpServers ?? {}).map(([name, server]) => {
                const source = provenance?.mcpServers?.[name]?.source ?? "—";
                const suppressedBy = provenance?.mcpServers?.[name]?.suppressedBy;
                return (
                  <tr key={name}>
                    <td className="px-3 py-2 font-medium text-primary">{name}</td>
                    <td className="px-3 py-2 text-secondary">{transportLabel(server)}</td>
                    <td className="px-3 py-2 text-secondary">{source}</td>
                    <td className="px-3 py-2 text-secondary">
                      {suppressedBy
                        ? `Suppressed by ${suppressedBy}`
                        : server.enabled === false
                          ? "Disabled"
                          : "Enabled"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className={sectionClassName("env", selectedScopeToken)}
        ref={(element) => setTargetRef("env", element)}
      >
        <h3 className="text-sm font-semibold">Environment</h3>
        <div className="mt-3 grid gap-2">
          {Object.entries(effective?.env ?? {}).map(([key, value]) => (
            <div
              className="grid gap-1 rounded-md border border-default bg-surface px-3 py-2"
              key={key}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-primary">{key}</span>
                <span className="text-xs text-secondary">
                  {provenance?.env?.[key]?.source ?? "—"}
                </span>
              </div>
              <div className="font-mono text-xs text-secondary">{redactText(value)}</div>
            </div>
          ))}
        </div>
      </section>

      <section
        className={sectionClassName("settings", selectedScopeToken)}
        ref={(element) => setTargetRef("settings", element)}
      >
        <h3 className="text-sm font-semibold">Settings</h3>
        <div className="mt-3 grid gap-2">
          {settingsEntries.length > 0 ? (
            settingsEntries.map(([key, value]) => (
              <div
                className="grid gap-1 rounded-md border border-default bg-surface px-3 py-2"
                key={key}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-primary">{key}</span>
                  <span className="text-xs text-secondary">
                    {provenance?.settings?.[key]?.source ?? "—"}
                  </span>
                </div>
                <div className="font-mono text-xs text-secondary">{stringifyInline(value)}</div>
              </div>
            ))
          ) : (
            <p className="text-sm text-secondary">No settings in the resolved config.</p>
          )}
        </div>
      </section>

      <section
        className={sectionClassName("persona", selectedScopeToken)}
        ref={(element) => setTargetRef("persona", element)}
      >
        <h3 className="text-sm font-semibold">Persona</h3>
        <div className="mt-3 grid gap-4">
          {Object.entries(effective?.persona ?? emptyPersona()).map(([label, paths]) => (
            <div className="grid gap-1" key={label}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-primary">{label}</span>
                <span className="text-xs text-secondary">{paths.length}</span>
              </div>
              {paths.length > 0 ? (
                <ul className="grid gap-1 text-xs text-secondary">
                  {paths.map((path) => (
                    <li className="truncate font-mono" key={`${label}:${path}`}>
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-secondary">None</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

interface SummaryMetricProps {
  label: string;
  value: string;
}

function SummaryMetric({ label, value }: SummaryMetricProps): React.ReactElement {
  return (
    <div className="rounded-md border border-default bg-surface px-3 py-3">
      <div className="text-xs uppercase tracking-wide text-secondary">{label}</div>
      <div className="mt-2 text-lg font-semibold text-primary">{value}</div>
    </div>
  );
}

export function createDiffSummary(
  current: EffectiveConfig | null,
  preview: EffectiveConfig | null
): DiffItem[] {
  if (!current || !preview) return [];
  const items: DiffItem[] = [];

  for (const key of sortedUnion(Object.keys(current.mcpServers), Object.keys(preview.mcpServers))) {
    const before = current.mcpServers[key];
    const after = preview.mcpServers[key];
    if (!before && after) {
      items.push({
        section: "mcpServers",
        key,
        change: "added",
        after: summarizeServer(after),
      });
    } else if (before && !after) {
      items.push({
        section: "mcpServers",
        key,
        change: "removed",
        before: summarizeServer(before),
      });
    } else if (before && after && stableStringify(before) !== stableStringify(after)) {
      items.push({
        section: "mcpServers",
        key,
        change: "changed",
        before: summarizeServer(before),
        after: summarizeServer(after),
      });
    }
  }

  for (const key of sortedUnion(Object.keys(current.env), Object.keys(preview.env))) {
    const before = current.env[key];
    const after = preview.env[key];
    if (before === undefined && after !== undefined) {
      items.push({ section: "env", key, change: "added", after: redactText(after) });
    } else if (before !== undefined && after === undefined) {
      items.push({ section: "env", key, change: "removed", before: redactText(before) });
    } else if (before !== after && before !== undefined && after !== undefined) {
      items.push({
        section: "env",
        key,
        change: "changed",
        before: redactText(before),
        after: redactText(after),
      });
    }
  }

  const currentSettings = flattenObject(current.settings);
  const previewSettings = flattenObject(preview.settings);
  for (const key of sortedUnion(
    currentSettings.map(([path]) => path),
    previewSettings.map(([path]) => path)
  )) {
    const before = currentSettings.find(([path]) => path === key)?.[1];
    const after = previewSettings.find(([path]) => path === key)?.[1];
    if (before === undefined && after !== undefined) {
      items.push({ section: "settings", key, change: "added", after: stringifyInline(after) });
    } else if (before !== undefined && after === undefined) {
      items.push({ section: "settings", key, change: "removed", before: stringifyInline(before) });
    } else if (stableStringify(before) !== stableStringify(after)) {
      items.push({
        section: "settings",
        key,
        change: "changed",
        before: stringifyInline(before),
        after: stringifyInline(after),
      });
    }
  }

  for (const label of Object.keys(emptyPersona()) as Array<keyof Required<ScopeDocPersona>>) {
    const before = current.persona[label];
    const after = preview.persona[label];
    if (stableStringify(before) !== stableStringify(after)) {
      items.push({
        section: "persona",
        key: label,
        change: before.length === 0 ? "added" : after.length === 0 ? "removed" : "changed",
        before: before.join(", "),
        after: after.join(", "),
      });
    }
  }

  return items;
}

export interface ProfileEditorInspectorProps {
  appError: string | null;
  hasUnsavedChanges: boolean;
  invalidDraft: boolean;
  isBootstrapping: boolean;
  isRefreshing: boolean;
  previewState: PreviewState;
  selectedAuthId: string;
  selectedRole: string;
  selectedScope: ScopeListEntry | null;
  theme: "dark" | "light";
  validationState: ValidationState;
  version: string | null;
}

export function ProfileEditorInspector({
  appError,
  hasUnsavedChanges,
  invalidDraft,
  isBootstrapping,
  isRefreshing,
  previewState,
  selectedAuthId,
  selectedRole,
  selectedScope,
  theme,
  validationState,
  version,
}: ProfileEditorInspectorProps): React.ReactElement {
  return (
    <aside
      aria-label="Inspector"
      className="app-scrollbar hidden min-h-0 overflow-auto border-l border-default bg-surface p-4 window-medium:flex window-medium:flex-col window-medium:gap-4"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-primary">Inspector</h2>
        <p className="text-xs text-secondary">Renderer state and draft status</p>
      </div>

      <div className="rounded-lg border border-default bg-canvas p-3">
        <dl className="grid gap-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-secondary">Theme</dt>
            <dd className="font-medium text-primary">{theme}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-secondary">Role</dt>
            <dd className="font-medium text-primary">{selectedRole || "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-secondary">Auth</dt>
            <dd className="font-medium text-primary">{selectedAuthId || "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-secondary">Scope</dt>
            <dd className="truncate font-mono text-[11px] text-primary">
              {selectedScope?.path ?? "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-secondary">Version</dt>
            <dd className="font-medium text-primary">{version ?? "loading"}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone={appError ? "danger" : isRefreshing || isBootstrapping ? "warning" : "success"}>
          {appError
            ? "error"
            : isRefreshing
              ? "refreshing"
              : isBootstrapping
                ? "bootstrapping"
                : "ready"}
        </Badge>
        <Badge tone={hasUnsavedChanges ? "warning" : "neutral"}>
          {hasUnsavedChanges ? "unsaved changes" : "saved"}
        </Badge>
        <Badge tone={invalidDraft ? "danger" : "success"}>
          {invalidDraft ? "invalid draft" : "valid draft"}
        </Badge>
      </div>

      <div className="rounded-lg border border-default bg-canvas p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-primary">Validation</span>
          <Badge
            tone={
              validationState.status === "error"
                ? "danger"
                : validationState.issues.length > 0
                  ? "warning"
                  : "success"
            }
          >
            {validationState.status}
          </Badge>
        </div>
        <p className="text-xs text-secondary">
          {validationState.errorMessage
            ? validationState.errorMessage
            : validationState.issues.length > 0
              ? `${validationState.issues.length} reported issue(s)`
              : "No validation issues"}
        </p>
      </div>

      <div className="rounded-lg border border-default bg-canvas p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-primary">Preview</span>
          <Badge
            tone={
              previewState.status === "error"
                ? "danger"
                : previewState.diff.length > 0
                  ? "warning"
                  : "neutral"
            }
          >
            {previewState.status}
          </Badge>
        </div>
        <p className="text-xs text-secondary">
          {previewState.errorMessage
            ? previewState.errorMessage
            : previewState.diff.length > 0
              ? `${previewState.diff.length} change(s) in effective config`
              : "No effective drift from draft"}
        </p>
      </div>
    </aside>
  );
}

export function previewTargetKey(scope: ScopeListEntry): string {
  const content = scope.content;
  if (!content) return "summary";
  if (Object.keys(content.mcpServers).length > 0) return "mcpServers";
  if (Object.keys(content.env).length > 0) return "env";
  if (Object.keys(content.settings).length > 0) return "settings";
  return "persona";
}

function scopeSelectionToken(scope: ScopeListEntry | null): string | null {
  if (!scope) return null;
  return previewTargetKey(scope);
}

function sectionClassName(section: string, selectedSection: string | null): string {
  return cn(
    "border-b border-subtle px-4 py-4 last:border-b-0",
    selectedSection === section && "bg-status-warning-soft"
  );
}
