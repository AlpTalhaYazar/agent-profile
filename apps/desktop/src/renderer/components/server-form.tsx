/**
 * @module components/server-form
 *
 * MCP server card editor and the small list-of-strings / list-of-pairs
 * primitives it composes with. Extracted from `index.tsx` as part of ST-2 of
 * Phase 2 milestone 7.
 *
 * Includes the transport helpers (`defaultServerEntry`, `inferTransport`,
 * `transportLabel`, `migrateServerTransport`, `summarizeServer`) so the
 * preview-panel diff component can reuse them without re-importing from
 * `index.tsx`.
 */

import { Button, Field, Input, Select, Switch } from "@agent-profile/ui";
import * as React from "react";
import { createId } from "../lib/clone.js";
import type { MergeMode, ScopeDocServerEntry, TransportType } from "../lib/types.js";

export interface ServerEditorProps {
  name: string;
  entry: ScopeDocServerEntry | null;
  disabled: boolean;
  onChange: (name: string, entry: ScopeDocServerEntry | null) => void;
  onDelete: () => void;
}

export function ServerEditor({
  name,
  entry,
  disabled,
  onChange,
  onDelete,
}: ServerEditorProps): React.ReactElement {
  if (entry === null) {
    return (
      <div className="rounded-md border border-default bg-subtle px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-primary">{name}</div>
            <div className="mt-1 text-sm text-secondary">Tombstoned in this scope.</div>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={disabled}
              onClick={() => onChange(name, defaultServerEntry("stdio"))}
              type="button"
              variant="secondary"
            >
              Restore
            </Button>
            <Button disabled={disabled} onClick={onDelete} type="button" variant="ghost">
              Remove row
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const transport = inferTransport(entry);
  const argsValue = (entry.args ?? []).join("\n");
  const headerPairs = recordToPairs(entry.headers);
  const envPairs = recordToPairs(entry.env);

  return (
    <div className="rounded-md border border-default bg-subtle">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_10rem]">
          <Field label="Name">
            <Input
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(event.target.value.toLowerCase() || name, entry)
              }
              value={name}
            />
          </Field>
          <Field label="Transport">
            <Select
              aria-label={`${name} transport`}
              disabled={disabled}
              onValueChange={(value: string) =>
                onChange(name, migrateServerTransport(entry, value as TransportType))
              }
              options={[
                { value: "stdio", label: "stdio" },
                { value: "http", label: "http" },
                { value: "streamable-http", label: "streamable-http" },
                { value: "sse", label: "sse" },
              ]}
              value={transport}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-primary">
            <Switch
              checked={entry.enabled ?? true}
              disabled={disabled}
              onCheckedChange={(checked: boolean) =>
                onChange(name, { ...entry, enabled: Boolean(checked) })
              }
            />
            Enabled
          </div>
          <Button disabled={disabled} onClick={onDelete} type="button" variant="ghost">
            Remove
          </Button>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 xl:grid-cols-3">
        <Field label="__extends">
          <Input
            disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(name, setOptionalString(entry, "__extends", event.target.value))
            }
            placeholder="global-role"
            value={entry.__extends ?? ""}
          />
        </Field>
        <Field label="__merge">
          <Select
            aria-label={`${name} merge mode`}
            disabled={disabled}
            onValueChange={(value: string) =>
              onChange(name, { ...entry, __merge: value as MergeMode })
            }
            options={[
              { value: "replace", label: "replace" },
              { value: "deep", label: "deep" },
            ]}
            value={entry.__merge ?? "replace"}
          />
        </Field>
      </div>

      <div className="grid gap-4 border-t border-subtle px-4 py-4 xl:grid-cols-2">
        {transport === "stdio" ? (
          <>
            <Field label="Command">
              <Input
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  onChange(name, { ...entry, command: event.target.value })
                }
                placeholder="npx"
                value={entry.command ?? ""}
              />
            </Field>
            <Field description="One argument per line." label="Args">
              <textarea
                className="min-h-28 rounded-md border border-default bg-surface px-3 py-2 font-mono text-sm text-primary shadow-xs focus:outline-none focus:ring-2 focus:ring-focus"
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  onChange(name, { ...entry, args: splitLines(event.target.value) })
                }
                value={argsValue}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <Input
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  onChange(name, { ...entry, url: event.target.value })
                }
                placeholder={
                  transport === "sse" ? "https://example.test/sse" : "https://example.test/mcp"
                }
                value={entry.url ?? ""}
              />
            </Field>
            <Field description="Basic header map for HTTP and SSE transports." label="Headers">
              <KeyValueEditor
                addLabel="Add header"
                disabled={disabled}
                onChange={(pairs) => onChange(name, { ...entry, headers: pairsToRecord(pairs) })}
                pairs={headerPairs}
                valueLabel="Value"
              />
            </Field>
          </>
        )}
      </div>

      <div className="border-t border-subtle px-4 py-4">
        <Field description="Server-specific environment variables." label="Env">
          <KeyValueEditor
            addLabel="Add env"
            disabled={disabled}
            onChange={(pairs) => onChange(name, { ...entry, env: pairsToRecord(pairs) })}
            pairs={envPairs}
            valueLabel="Value"
          />
        </Field>
      </div>
    </div>
  );
}

export interface PathListFieldProps {
  label: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}

export function PathListField({
  label,
  values,
  disabled,
  onChange,
}: PathListFieldProps): React.ReactElement {
  return (
    <Field label={label}>
      <StringListEditor disabled={disabled} onChange={onChange} values={values} />
    </Field>
  );
}

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

export interface KeyValueEditorProps {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  disabled: boolean;
  addLabel: string;
  valueLabel: string;
}

export function KeyValueEditor({
  pairs,
  onChange,
  disabled,
  addLabel,
  valueLabel,
}: KeyValueEditorProps): React.ReactElement {
  return (
    <div className="grid gap-2">
      {pairs.map((pair) => (
        <div
          className="grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,1.5fr)_auto]"
          key={pair.id}
        >
          <Input
            disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(
                pairs.map((candidate) =>
                  candidate.id === pair.id ? { ...candidate, key: event.target.value } : candidate
                )
              )
            }
            placeholder="KEY"
            value={pair.key}
          />
          <Input
            disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(
                pairs.map((candidate) =>
                  candidate.id === pair.id ? { ...candidate, value: event.target.value } : candidate
                )
              )
            }
            placeholder={valueLabel}
            value={pair.value}
          />
          <Button
            disabled={disabled}
            onClick={() => onChange(pairs.filter((candidate) => candidate.id !== pair.id))}
            type="button"
            variant="ghost"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        disabled={disabled}
        onClick={() =>
          onChange([
            ...pairs,
            {
              id: createId(),
              key: "",
              value: "",
            },
          ])
        }
        type="button"
        variant="secondary"
      >
        {addLabel}
      </Button>
    </div>
  );
}

export interface StringListEditorProps {
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
}

export function StringListEditor({
  values,
  onChange,
  disabled,
}: StringListEditorProps): React.ReactElement {
  const items = React.useMemo(() => {
    const seen = new Map<string, number>();
    return values.map((value, position) => {
      const count = (seen.get(value) ?? 0) + 1;
      seen.set(value, count);
      return {
        id: `${value || "__empty__"}:${count}`,
        position,
        value,
      };
    });
  }, [values]);

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" key={item.id}>
          <Input
            disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(
                values.map((candidate, candidateIndex) =>
                  candidateIndex === item.position ? event.target.value : candidate
                )
              )
            }
            value={item.value}
          />
          <Button
            disabled={disabled}
            onClick={() =>
              onChange(values.filter((_, candidateIndex) => candidateIndex !== item.position))
            }
            type="button"
            variant="ghost"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
        type="button"
        variant="secondary"
      >
        Add path
      </Button>
    </div>
  );
}

// ─── Transport helpers (re-exported for the preview-panel diff summary) ──────

export function defaultServerEntry(transport: TransportType): ScopeDocServerEntry {
  if (transport === "stdio") {
    return { type: "stdio", command: "", args: [], env: {}, enabled: true, __merge: "replace" };
  }
  return {
    type: transport,
    url: "",
    headers: {},
    env: {},
    enabled: true,
    __merge: "replace",
  };
}

export function migrateServerTransport(
  entry: ScopeDocServerEntry,
  transport: TransportType
): ScopeDocServerEntry {
  const base: ScopeDocServerEntry = {
    enabled: entry.enabled ?? true,
    __merge: entry.__merge ?? "replace",
    ...(entry.__extends ? { __extends: entry.__extends } : {}),
    ...(entry.env ? { env: entry.env } : {}),
  };

  if (transport === "stdio") {
    return {
      ...base,
      type: "stdio",
      command: entry.command ?? "",
      args: entry.args ?? [],
    };
  }

  return {
    ...base,
    type: transport,
    url: entry.url ?? "",
    headers: entry.headers ?? {},
  };
}

export function inferTransport(entry: ScopeDocServerEntry): TransportType {
  if (entry.type === "http" || entry.type === "streamable-http" || entry.type === "sse") {
    return entry.type;
  }
  if (typeof entry.url === "string" && entry.url.length > 0) return "http";
  return "stdio";
}

export function transportLabel(server: ScopeDocServerEntry): string {
  return inferTransport(server);
}

export function summarizeServer(server: ScopeDocServerEntry): string {
  const transport = inferTransport(server);
  if (transport === "stdio") {
    return `${transport} ${server.command ?? ""}`.trim();
  }
  return `${transport} ${server.url ?? ""}`.trim();
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function recordToPairs(record?: Record<string, string>): KeyValuePair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({
    id: createId(),
    key,
    value,
  }));
}

function pairsToRecord(pairs: KeyValuePair[]): Record<string, string> {
  return Object.fromEntries(
    pairs.filter((pair) => pair.key.trim().length > 0).map((pair) => [pair.key.trim(), pair.value])
  );
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function setOptionalString<T extends ScopeDocServerEntry, K extends "__extends">(
  entry: T,
  key: K,
  value: string
): T {
  const trimmed = value.trim();
  if (!trimmed) {
    const next = { ...entry };
    delete next[key];
    return next;
  }
  return { ...entry, [key]: trimmed };
}
