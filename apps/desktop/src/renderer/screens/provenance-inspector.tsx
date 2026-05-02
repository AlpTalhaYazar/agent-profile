/**
 * Provenance Inspector — Phase 2 milestone 6.
 *
 * Read-only inspector for the cascade provenance returned by the daemon's
 * `profile.show` (already loaded into `effectiveStateAtom` by the App when
 * the role / auth / cwd selection is non-empty). The screen never makes its
 * own IPC call; it visualises whatever the Profile Editor has already
 * resolved.
 *
 * Layout: two-column. Left = field selector (sections + per-entry list).
 * Right = chain detail (scope, event, suppressedBy, overriddenFields, final
 * value). Secret-bearing values are masked through `redactText`.
 */
import { Badge } from "@agent-profile/ui";
import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import {
  cwdAtom,
  effectiveStateAtom,
  selectedAuthIdAtom,
  selectedProvenanceFieldAtom,
  selectedRoleAtom,
} from "../lib/atoms.js";
import { redactText } from "../lib/clone.js";
import type {
  EffectiveConfig,
  FieldProvenance,
  McpServerProvenance,
  Provenance,
  ProvenanceSection,
  SelectedProvenanceField,
} from "../lib/types.js";
import { useRovingTabIndex } from "../lib/use-roving-tab-index.js";

interface SectionEntry {
  id: ProvenanceSection;
  label: string;
  keys: string[];
}

export function ProvenanceInspectorScreen(): React.ReactElement {
  const effectiveState = useAtomValue(effectiveStateAtom);
  const [selected, setSelected] = useAtom(selectedProvenanceFieldAtom);
  const role = useAtomValue(selectedRoleAtom);
  const auth = useAtomValue(selectedAuthIdAtom);
  const cwd = useAtomValue(cwdAtom);

  const provenance = effectiveState.provenance;
  const effective = effectiveState.effective;

  if (!provenance || !effective) {
    return (
      <div
        className="flex h-full items-center justify-center text-center text-sm text-secondary"
        data-testid="provenance-empty"
      >
        <h1 className="sr-only" id="screen-heading" tabIndex={-1}>
          Provenance Inspector
        </h1>
        <div className="max-w-md space-y-2 px-6">
          <p className="text-base font-semibold text-primary">No provenance loaded</p>
          <p>
            Open the Profile Editor tab and pick a role + auth. The cascade resolves once those are
            set; come back here to inspect each field.
          </p>
        </div>
      </div>
    );
  }

  const sections: SectionEntry[] = [
    {
      id: "mcpServers",
      label: "MCP Servers",
      keys: Object.keys(provenance.mcpServers).sort(),
    },
    { id: "env", label: "Env", keys: Object.keys(provenance.env).sort() },
    { id: "settings", label: "Settings", keys: Object.keys(provenance.settings).sort() },
    {
      id: "persona",
      label: "Persona",
      keys: provenance.persona.map((entry) => entry.source ?? "unknown"),
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="provenance-inspector">
      <header className="border-b border-subtle bg-surface px-4 py-3">
        <h1 className="text-lg font-semibold text-primary" id="screen-heading" tabIndex={-1}>
          Provenance Inspector
        </h1>
        <p className="mt-0.5 text-xs text-secondary">
          role={role || "—"} · auth={auth || "—"} · cwd={cwd || "—"}
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr] overflow-hidden">
        <FieldSelector sections={sections} selected={selected} onSelect={setSelected} />
        <FieldDetail provenance={provenance} effective={effective} selected={selected} />
      </div>
    </div>
  );
}

function FieldSelector({
  sections,
  selected,
  onSelect,
}: {
  sections: SectionEntry[];
  selected: SelectedProvenanceField | null;
  onSelect: (field: SelectedProvenanceField | null) => void;
}): React.ReactElement {
  const selectorItems = React.useMemo(
    () =>
      sections.flatMap((section) =>
        section.keys.map((key, idx) => ({
          section: section.id,
          key,
          compositeKey: section.id === "persona" ? `${idx}:${key}` : key,
        }))
      ),
    [sections]
  );
  const indexByComposite = React.useMemo(
    () =>
      new Map(selectorItems.map((item, index) => [`${item.section}:${item.compositeKey}`, index])),
    [selectorItems]
  );
  const { getItemProps } = useRovingTabIndex<HTMLButtonElement>({
    count: selectorItems.length,
    orientation: "vertical",
    onActivate: (index) => {
      const item = selectorItems[index];
      if (item) onSelect({ section: item.section, key: item.compositeKey });
    },
  });

  return (
    <nav
      className="overflow-y-auto border-r border-default bg-subtle"
      data-testid="provenance-selector"
    >
      {sections.map((section) => (
        <div key={section.id} className="border-b border-subtle last:border-b-0">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {section.label} ({section.keys.length})
          </div>
          {section.keys.length === 0 ? (
            <div className="px-3 pb-3 text-xs text-secondary">(empty)</div>
          ) : (
            <ul>
              {section.keys.map((key, idx) => {
                // For persona we use idx + key together because two scopes
                // can theoretically share the same `source` label.
                const compositeKey = section.id === "persona" ? `${idx}:${key}` : key;
                const isSelected =
                  selected?.section === section.id && selected.key === compositeKey;
                const rovingIndex = indexByComposite.get(`${section.id}:${compositeKey}`) ?? 0;
                return (
                  <li key={compositeKey}>
                    <button
                      className={`block w-full px-3 py-1.5 text-left text-sm ${
                        isSelected
                          ? "bg-accent-soft text-primary"
                          : "text-primary hover:bg-elevated"
                      }`}
                      data-testid={`provenance-entry-${section.id}-${key}`}
                      onClick={() => onSelect({ section: section.id, key: compositeKey })}
                      type="button"
                      {...getItemProps(rovingIndex)}
                    >
                      {key}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}

function FieldDetail({
  provenance,
  effective,
  selected,
}: {
  provenance: Provenance;
  effective: EffectiveConfig;
  selected: SelectedProvenanceField | null;
}): React.ReactElement {
  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        Pick a field on the left to see its provenance chain.
      </div>
    );
  }

  switch (selected.section) {
    case "mcpServers": {
      const prov = provenance.mcpServers[selected.key];
      const value = effective.mcpServers[selected.key];
      return <McpServerDetail name={selected.key} provenance={prov} value={value} />;
    }
    case "env": {
      const prov = provenance.env[selected.key];
      const value = effective.env[selected.key];
      return <FieldChainDetail label={selected.key} provenance={prov} value={value} />;
    }
    case "settings": {
      const prov = provenance.settings[selected.key];
      const value = effective.settings[selected.key];
      return (
        <FieldChainDetail
          label={selected.key}
          provenance={prov}
          value={value === undefined ? undefined : JSON.stringify(value)}
        />
      );
    }
    case "persona": {
      // The composite key encodes the index, e.g. "1:global-role". Recover
      // the index so we can pick the right `PersonaProvenance` entry even if
      // two share the same source label.
      const colonIdx = selected.key.indexOf(":");
      const idx = colonIdx >= 0 ? Number(selected.key.slice(0, colonIdx)) : -1;
      const entry = idx >= 0 ? provenance.persona[idx] : undefined;
      const sourceLabel = colonIdx >= 0 ? selected.key.slice(colonIdx + 1) : selected.key;
      return <PersonaDetail source={sourceLabel} files={entry?.files ?? []} />;
    }
  }
}

function McpServerDetail({
  name,
  provenance,
  value,
}: {
  name: string;
  provenance: McpServerProvenance | undefined;
  value: { command?: string; type?: string; env?: Record<string, string> } | undefined;
}): React.ReactElement {
  if (!provenance) {
    return <EmptyDetail message={`No provenance entry for ${name}.`} />;
  }
  const chain = provenance.chain ?? [];
  return (
    <div className="overflow-y-auto p-4" data-testid="provenance-detail">
      <h2 className="text-base font-semibold text-primary">mcpServers.{name}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-secondary">Source:</span>
        <Badge tone="info">{provenance.source ?? "unknown"}</Badge>
        {provenance.suppressedBy ? (
          <>
            <span className="text-secondary">Suppressed by:</span>
            <Badge tone="warning">{provenance.suppressedBy}</Badge>
          </>
        ) : null}
      </div>

      <h3 className="mt-4 text-sm font-semibold text-primary">Chain</h3>
      {chain.length === 0 ? (
        <p className="mt-1 text-xs text-secondary">(no chain entries)</p>
      ) : (
        <table className="mt-1 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-subtle text-xs text-secondary">
              <th className="py-1.5 pr-4 font-medium">Scope</th>
              <th className="py-1.5 font-medium">Event</th>
            </tr>
          </thead>
          <tbody>
            {chain.map((step, idx) => (
              <tr
                key={`${step.scope ?? ""}-${step.event ?? ""}-${idx}`}
                className="border-b border-subtle last:border-b-0"
              >
                <td className="py-1.5 pr-4 font-mono text-xs text-primary">{step.scope ?? "—"}</td>
                <td className="py-1.5">
                  <Badge tone={badgeToneForEvent(step.event)}>{step.event ?? "—"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(provenance.overriddenFields?.length ?? 0) > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-primary">Overridden fields</h3>
          <ul className="mt-1 space-y-1 text-xs text-primary">
            {(provenance.overriddenFields ?? []).map((f) => (
              <li key={f} className="font-mono">
                {f}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {value ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-primary">Final value</h3>
          <dl className="mt-1 space-y-1 text-xs">
            {value.type ? (
              <div className="flex gap-2">
                <dt className="w-20 text-secondary">type</dt>
                <dd className="font-mono text-primary">{value.type}</dd>
              </div>
            ) : null}
            {value.command ? (
              <div className="flex gap-2">
                <dt className="w-20 text-secondary">command</dt>
                <dd className="font-mono text-primary">{value.command}</dd>
              </div>
            ) : null}
            {value.env && Object.keys(value.env).length > 0 ? (
              <div>
                <dt className="text-secondary">env</dt>
                <dd className="mt-0.5 ml-4 space-y-0.5">
                  {Object.entries(value.env).map(([k, v]) => (
                    <div key={k} className="flex gap-2 font-mono text-primary">
                      <span className="text-secondary">{k}=</span>
                      <span>{redactText(String(v))}</span>
                    </div>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : null}
    </div>
  );
}

function FieldChainDetail({
  label,
  provenance,
  value,
}: {
  label: string;
  provenance: FieldProvenance | undefined;
  value: string | undefined;
}): React.ReactElement {
  if (!provenance) {
    return <EmptyDetail message={`No provenance entry for ${label}.`} />;
  }
  const chain = provenance.chain ?? [];
  return (
    <div className="overflow-y-auto p-4" data-testid="provenance-detail">
      <h2 className="text-base font-semibold text-primary">{label}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-secondary">Source:</span>
        <Badge tone="info">{provenance.source ?? "unknown"}</Badge>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-primary">Contributing scopes</h3>
      {chain.length === 0 ? (
        <p className="mt-1 text-xs text-secondary">(no chain entries)</p>
      ) : (
        <ol className="mt-1 space-y-1 text-sm">
          {chain.map((scope, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: chain may repeat scope labels (e.g. deep-merged), so index disambiguates
            <li key={`${scope}-${idx}`} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-secondary">{idx + 1}.</span>
              <Badge tone={idx === chain.length - 1 ? "success" : "neutral"}>{scope}</Badge>
              {idx === chain.length - 1 ? (
                <span className="text-xs text-secondary">(winning)</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {value !== undefined ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-primary">Final value</h3>
          <pre className="mt-1 overflow-x-auto rounded border border-default bg-subtle p-2 font-mono text-xs text-primary">
            {redactText(value)}
          </pre>
        </>
      ) : null}
    </div>
  );
}

function PersonaDetail({
  source,
  files,
}: {
  source: string;
  files: string[];
}): React.ReactElement {
  return (
    <div className="overflow-y-auto p-4" data-testid="provenance-detail">
      <h2 className="text-base font-semibold text-primary">Persona contribution</h2>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="text-secondary">Source:</span>
        <Badge tone="info">{source}</Badge>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-primary">Files ({files.length})</h3>
      {files.length === 0 ? (
        <p className="mt-1 text-xs text-secondary">(no files)</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs">
          {files.map((path) => (
            <li key={path} className="font-mono text-primary">
              {path}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyDetail({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center text-sm text-secondary">{message}</div>
  );
}

function badgeToneForEvent(event: string | undefined): "info" | "warning" | "success" | "neutral" {
  switch (event) {
    case "introduced":
      return "info";
    case "extended":
    case "deep-merged":
      return "success";
    case "replaced":
      return "neutral";
    case "suppressed":
      return "warning";
    default:
      return "neutral";
  }
}
