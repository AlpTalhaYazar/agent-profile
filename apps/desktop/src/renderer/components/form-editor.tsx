/**
 * @module components/form-editor
 *
 * Profile Editor "Form" mode. Renders the structured editor for the active
 * draft document — version, auth binding, env, settings, MCP servers, and
 * persona path lists.
 *
 * Extracted from `index.tsx` as part of ST-2 of Phase 2 milestone 7. The
 * component remains presentational: it consumes a draft `ScopeDoc` and
 * forwards updater callbacks supplied by `screens/profile-editor.tsx`. The
 * extraction preserves behavior 1:1 — the only change is that
 * `defaultServerEntry`, `inferTransport`, and `transportLabel` now live in
 * `components/server-form.tsx` so the diff component can reuse them.
 */

import { Button, Field, Input } from "@agent-profile/ui";
import * as React from "react";
import { createId } from "../lib/clone.js";
import { removeAuthBinding } from "../lib/normalize.js";
import type { ScopeDoc, ScopeDocServerEntry } from "../lib/types.js";
import { useRovingTabIndex } from "../lib/use-roving-tab-index.js";
import {
  KeyValueEditor,
  type KeyValuePair,
  ServerEditor,
  StringListEditor,
  defaultServerEntry,
} from "./server-form.js";

export interface FormEditorProps {
  doc: ScopeDoc | null;
  disabled: boolean;
  versionError: string | undefined;
  envError: string | undefined;
  settingsError: string | undefined;
  settingsText: string;
  authBindingValue: string;
  updateDraft: (updater: (current: ScopeDoc) => ScopeDoc) => void;
  updateSettingsObject: (text: string) => void;
}

export function FormEditor({
  doc,
  disabled,
  versionError,
  envError,
  settingsError,
  settingsText,
  authBindingValue,
  updateDraft,
  updateSettingsObject,
}: FormEditorProps): React.ReactElement {
  const serverEntries = React.useMemo(() => Object.entries(doc?.mcpServers ?? {}), [doc]);
  const { getItemProps: getServerItemProps } = useRovingTabIndex<HTMLFieldSetElement>({
    count: serverEntries.length,
    orientation: "vertical",
    onActivate: (index) => {
      const card = document.querySelector<HTMLElement>(`[data-server-card-index="${index}"]`);
      card?.querySelector<HTMLElement>("input,button,textarea,[tabindex='0']")?.focus();
    },
  });

  if (!doc) {
    return (
      <div className="px-4 py-8 text-sm text-secondary">
        Select a scope entry with content to start editing.
      </div>
    );
  }

  return (
    <div className="divide-y divide-subtle">
      <section className="px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-3">
          <Field {...(versionError !== undefined ? { error: versionError } : {})} label="Version">
            <Input
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const nextVersion = Number(event.target.value || 1);
                updateDraft((current) => ({ ...current, version: nextVersion === 1 ? 1 : 1 }));
              }}
              value={String(doc.version)}
            />
          </Field>
          <Field description="Optional auth binding written into the scope." label="Auth binding">
            <Input
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const nextValue = event.target.value.trim();
                updateDraft((current) =>
                  nextValue
                    ? { ...current, auth: { profileId: nextValue } }
                    : removeAuthBinding(current)
                );
              }}
              placeholder="work"
              value={authBindingValue}
            />
          </Field>
          <Field description="Reusable fragment names expanded before merge." label="Use fragments">
            <StringListEditor
              disabled={disabled}
              onChange={(values) => updateDraft((current) => ({ ...current, use: values }))}
              values={doc.use}
            />
          </Field>
        </div>
      </section>

      <section className="px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <Field
            description="Document-level environment entries."
            {...(envError !== undefined ? { error: envError } : {})}
            label="Environment"
          >
            <KeyValueEditor
              addLabel="Add variable"
              disabled={disabled}
              onChange={(pairs) =>
                updateDraft((current) => ({ ...current, env: pairsToRecord(pairs) }))
              }
              pairs={recordToPairs(doc.env)}
              valueLabel="Value"
            />
          </Field>

          <Field
            description="Compact JSON object merged into settings.json."
            {...(settingsError !== undefined ? { error: settingsError } : {})}
            label="Settings"
          >
            <textarea
              className="min-h-44 rounded-md border border-default bg-surface px-3 py-2 font-mono text-sm text-primary shadow-xs focus:outline-none focus:ring-2 focus:ring-focus"
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                updateSettingsObject(event.target.value)
              }
              value={settingsText}
            />
          </Field>
        </div>
      </section>

      <section className="px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">MCP servers</h3>
            <p className="mt-1 text-sm text-secondary">
              Transport-aware fields for stdio, HTTP, and SSE.
            </p>
          </div>
          <Button
            disabled={disabled}
            onClick={() =>
              updateDraft((current) => {
                const nextName = uniqueServerName(current.mcpServers);
                return {
                  ...current,
                  mcpServers: {
                    ...current.mcpServers,
                    [nextName]: defaultServerEntry("stdio"),
                  },
                };
              })
            }
            type="button"
            variant="secondary"
          >
            Add server
          </Button>
        </div>
        <div className="mt-4 grid gap-4">
          {serverEntries.length > 0 ? (
            serverEntries.map(([name, entry], index) => (
              <fieldset
                aria-label={`MCP server ${name}`}
                className="min-w-0 border-0 p-0"
                data-server-card-index={index}
                key={name}
                {...getServerItemProps(index)}
              >
                <ServerEditor
                  disabled={disabled}
                  entry={entry}
                  name={name}
                  onChange={(nextName, nextEntry) =>
                    updateDraft((current) => {
                      const nextServers = { ...current.mcpServers };
                      delete nextServers[name];
                      nextServers[nextName] = nextEntry;
                      return { ...current, mcpServers: nextServers };
                    })
                  }
                  onDelete={() =>
                    updateDraft((current) => {
                      const nextServers = { ...current.mcpServers };
                      delete nextServers[name];
                      return { ...current, mcpServers: nextServers };
                    })
                  }
                />
              </fieldset>
            ))
          ) : (
            <p className="text-sm text-secondary">No servers in this scope.</p>
          )}
        </div>
      </section>

      <section className="px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <Field description="Scope-level tombstones." label="Disabled servers">
            <StringListEditor
              disabled={disabled}
              onChange={(values) =>
                updateDraft((current) => ({ ...current, disabledServers: values }))
              }
              values={doc.disabledServers}
            />
          </Field>

          <div className="grid gap-4">
            <PathListField
              disabled={disabled}
              label="CLAUDE.md paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, claudeMd: values },
                }))
              }
              values={doc.persona?.claudeMd ?? []}
            />
            <PathListField
              disabled={disabled}
              label="Agent paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, agents: values },
                }))
              }
              values={doc.persona?.agents ?? []}
            />
            <PathListField
              disabled={disabled}
              label="Skill paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, skills: values },
                }))
              }
              values={doc.persona?.skills ?? []}
            />
            <PathListField
              disabled={disabled}
              label="Slash command paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, slashCmds: values },
                }))
              }
              values={doc.persona?.slashCmds ?? []}
            />
            <PathListField
              disabled={disabled}
              label="Memory seed paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, memory: values },
                }))
              }
              values={doc.persona?.memory ?? []}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

interface PathListFieldProps {
  label: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}

function PathListField({
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

function uniqueServerName(servers: Record<string, ScopeDocServerEntry | null>): string {
  let index = 1;
  let candidate = "server";
  while (candidate in servers) {
    index += 1;
    candidate = `server-${index}`;
  }
  return candidate;
}
