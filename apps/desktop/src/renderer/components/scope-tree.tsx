/**
 * @module components/scope-tree
 *
 * Sidebar tree of scope files for the Profile Editor screen. Groups entries
 * by `ScopeKind` and renders each as a button row with stat badges
 * (servers / env / settings / persona counts).
 *
 * Extracted from `index.tsx` as part of ST-2 of Phase 2 milestone 7.
 */

import { cn } from "@agent-profile/ui";
import * as React from "react";
import type { ScopeDoc, ScopeKind, ScopeListEntry } from "../lib/types.js";
import { useRovingTabIndex } from "../lib/use-roving-tab-index.js";

export interface ScopeTreeProps {
  entries: ScopeListEntry[];
  selectedPath: string | null;
  onSelect: (path: string, returnFocusTo?: HTMLElement | null) => void;
}

export function ScopeTree({ entries, selectedPath, onSelect }: ScopeTreeProps): React.ReactElement {
  const groupedEntries = React.useMemo(() => {
    const order: ScopeKind[] = [
      "global-shared",
      "global-role",
      "project-shared",
      "project-shared-local",
      "project-role",
    ];
    return order
      .map((scope) => ({
        scope,
        entries: entries.filter((entry) => entry.scope === scope),
      }))
      .filter((group) => group.entries.length > 0);
  }, [entries]);
  const indexByPath = React.useMemo(
    () => new Map(entries.map((entry, index) => [entry.path, index])),
    [entries]
  );
  const { getItemProps } = useRovingTabIndex<HTMLButtonElement>({
    count: entries.length,
    orientation: "vertical",
    onActivate: (index) => {
      const entry = entries[index];
      if (entry) onSelect(entry.path);
    },
  });

  if (entries.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-secondary">
        No scope files discovered for the current directory.
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      {groupedEntries.map((group) => (
        <section className="border-b border-subtle px-2 py-2 last:border-b-0" key={group.scope}>
          <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-secondary">
            {group.scope}
          </h2>
          <ul className="grid gap-1">
            {group.entries.map((entry) => {
              const stats = scopeEntryStats(entry.content);
              const rovingIndex = indexByPath.get(entry.path) ?? 0;
              return (
                <li key={entry.path}>
                  <button
                    className={cn(
                      "grid w-full gap-1 rounded-md border border-transparent px-2 py-2 text-left transition-colors",
                      selectedPath === entry.path ? "border-default bg-elevated" : "hover:bg-subtle"
                    )}
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                      onSelect(entry.path, event.currentTarget)
                    }
                    type="button"
                    {...getItemProps(rovingIndex)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-primary">
                        {entry.role !== "—" ? entry.role : leafName(entry.path)}
                      </span>
                      <span className="text-xs text-tertiary">{stats.servers} srv</span>
                    </div>
                    <div className="truncate text-xs text-secondary">{entry.path}</div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-tertiary">
                      <span>{stats.env} env</span>
                      <span>{stats.settings} settings</span>
                      <span>{stats.persona} persona</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function leafName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function scopeEntryStats(content: ScopeDoc | null): {
  servers: number;
  env: number;
  settings: number;
  persona: number;
} {
  return {
    servers: Object.keys(content?.mcpServers ?? {}).length,
    env: Object.keys(content?.env ?? {}).length,
    settings: Object.keys(content?.settings ?? {}).length,
    persona: Object.values(content?.persona ?? {}).reduce(
      (count, value) => count + (Array.isArray(value) ? value.length : 0),
      0
    ),
  };
}
