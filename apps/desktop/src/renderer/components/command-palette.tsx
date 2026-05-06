/**
 * @module components/command-palette
 *
 * Cmd+K command palette overlay. Renders a fuzzy-searchable list of commands
 * grouped by category (Navigate / Scope / Auth / Sessions / Provenance) and
 * delegates selection to caller-provided `onSelect`. The command list is
 * computed by `app-shell.tsx` from the active screen, theme, scope entries,
 * auth profiles, and provenance fields.
 *
 * Extracted from `index.tsx` as part of ST-2 of Phase 2 milestone 7. The
 * extraction preserves behavior 1:1, including the `data-testid` attributes
 * (`command-palette-overlay`, `command-palette`, `command-palette-item-*`)
 * used by Playwright assertions.
 */

import { Input, cn } from "@agent-profile/ui";
import { Command, Search } from "lucide-react";
import * as React from "react";

export interface CommandPaletteItem {
  id: string;
  group: string;
  label: string;
  description?: string;
  hint?: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface CommandPaletteProps {
  activeIndex: number;
  isOpen: boolean;
  items: CommandPaletteItem[];
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (item: CommandPaletteItem) => void;
  query: string;
}

export function CommandPalette({
  activeIndex,
  isOpen,
  items,
  onActiveIndexChange,
  onClose,
  onQueryChange,
  onSelect,
  query,
}: CommandPaletteProps): React.ReactElement | null {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const groupedItems = React.useMemo(() => {
    const groups = new Map<string, CommandPaletteItem[]>();
    for (const item of items) {
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    }
    return Array.from(groups.entries());
  }, [items]);

  React.useEffect(() => {
    if (!isOpen) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [isOpen]);

  React.useEffect(() => {
    if (!items.length) {
      onActiveIndexChange(0);
      return;
    }
    if (activeIndex >= items.length) {
      onActiveIndexChange(0);
    }
  }, [activeIndex, items, onActiveIndexChange]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-overlay px-4 pt-20 backdrop-blur-sm"
      data-testid="command-palette-overlay"
    >
      <div
        className="mx-auto flex max-h-[70vh] w-full max-w-[760px] flex-col overflow-hidden rounded-md border border-default bg-elevated shadow-xl"
        data-testid="command-palette"
      >
        <div className="border-b border-subtle p-3">
          <div className="flex h-11 items-center gap-3 rounded-md border border-default bg-canvas px-3">
            <Search className="h-4 w-4 text-secondary" aria-hidden="true" />
            <Input
              aria-label="Command palette query"
              className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  onActiveIndexChange(items.length ? (activeIndex + 1) % items.length : 0);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  onActiveIndexChange(
                    items.length ? (activeIndex - 1 + items.length) % items.length : 0
                  );
                } else if (event.key === "Enter" && items[activeIndex]) {
                  event.preventDefault();
                  onSelect(items[activeIndex]);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                }
              }}
              placeholder="Search screens, profile layers, identities, or provenance…"
              ref={inputRef}
              value={query}
            />
            <span className="inline-flex items-center gap-0.5 rounded border border-default bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-tertiary">
              <Command className="h-3 w-3" aria-hidden="true" />K
            </span>
          </div>
        </div>

        <div
          className="app-scrollbar min-w-0 overflow-y-auto overflow-x-hidden p-2"
          id="command-palette-results"
        >
          {groupedItems.length === 0 ? (
            <div className="px-3 py-6 text-sm text-secondary">No results.</div>
          ) : (
            groupedItems.map(([group, groupItems]) => (
              <section key={group} className="pb-2">
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                  {group}
                </div>
                <div className="grid gap-1">
                  {groupItems.map((item) => {
                    const absoluteIndex = items.findIndex((candidate) => candidate.id === item.id);
                    const active = absoluteIndex === activeIndex;
                    return (
                      <button
                        className={cn(
                          "flex min-h-12 min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                          active
                            ? "bg-accent-soft text-primary shadow-xs"
                            : "text-primary hover:bg-subtle"
                        )}
                        data-testid={`command-palette-item-${item.id}`}
                        id={`command-palette-item-${item.id}`}
                        key={item.id}
                        onClick={() => onSelect(item)}
                        onMouseEnter={() => onActiveIndexChange(absoluteIndex)}
                        type="button"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{item.label}</div>
                          {item.description ? (
                            <div className="truncate text-xs text-secondary">
                              {item.description}
                            </div>
                          ) : null}
                        </div>
                        {item.hint ? (
                          <span className="shrink-0 rounded border border-default bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-tertiary">
                            {item.hint}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
