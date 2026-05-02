/**
 * Persona Composer — Phase 2 milestone 6.
 *
 * Renders the persona section in memory by calling the
 * `window.myclaude.persona.render` bridge whenever the active
 * `(role, auth, cwd)` triple is non-empty. Disk is never written; this is a
 * read-only preview. Categories rendered: combined CLAUDE.md, per-section
 * fragments, agents, skills, slash commands, memory seeds. Each file shows
 * its origin scope; collisions and missing sources are surfaced as banners.
 */
import { Badge, Button, CodeEditor } from "@agent-profile/ui";
import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import {
  cwdAtom,
  personaStateAtom,
  selectedAuthIdAtom,
  selectedPersonaFileAtom,
  selectedRoleAtom,
} from "../lib/atoms.js";
import type {
  PersonaRenderCategory,
  PersonaRenderFile,
  PersonaRenderResult,
  SelectedPersonaFile,
} from "../lib/types.js";

const CATEGORY_LABELS: Record<PersonaRenderCategory, string> = {
  agents: "Agents",
  skills: "Skills",
  slashCmds: "Slash commands",
  memory: "Memory seeds",
};

export function PersonaComposerScreen(): React.ReactElement {
  const role = useAtomValue(selectedRoleAtom);
  const auth = useAtomValue(selectedAuthIdAtom);
  const cwd = useAtomValue(cwdAtom);
  const [personaState, setPersonaState] = useAtom(personaStateAtom);
  const [selectedFile, setSelectedFile] = useAtom(selectedPersonaFileAtom);

  const fetchRender = React.useCallback(async () => {
    if (!role || !auth || !cwd) {
      setPersonaState({ status: "idle", result: null, errorMessage: null });
      return;
    }
    setPersonaState({ status: "loading", result: null, errorMessage: null });
    try {
      const bridge = window.myclaude?.persona;
      if (!bridge) {
        setPersonaState({
          status: "error",
          result: null,
          errorMessage: "Persona bridge unavailable.",
        });
        return;
      }
      const result = (await bridge.render({
        role,
        authProfileId: auth,
        cwd,
      })) as PersonaRenderResult;
      setPersonaState({ status: "ready", result, errorMessage: null });
    } catch (err) {
      setPersonaState({
        status: "error",
        result: null,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }, [role, auth, cwd, setPersonaState]);

  React.useEffect(() => {
    void fetchRender();
  }, [fetchRender]);

  if (!role || !auth || !cwd) {
    return (
      <div
        className="flex h-full items-center justify-center text-center text-sm text-secondary"
        data-testid="persona-empty"
      >
        <h1 className="sr-only" id="screen-heading" tabIndex={-1}>
          Persona Composer
        </h1>
        <div className="max-w-md space-y-2 px-6">
          <p className="text-base font-semibold text-primary">No selection</p>
          <p>Pick role + auth + cwd in the Profile Editor tab to render the persona.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-busy={personaState.status === "loading"}
      className="flex h-full flex-col overflow-hidden"
      data-testid="persona-composer"
    >
      <header className="flex items-start justify-between gap-3 border-b border-subtle bg-surface px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-primary" id="screen-heading" tabIndex={-1}>
            Persona Composer
          </h1>
          <p className="mt-0.5 text-xs text-secondary">
            role={role} · auth={auth} · cwd={cwd}
          </p>
        </div>
        <Button
          data-testid="persona-refresh"
          onClick={() => void fetchRender()}
          size="sm"
          type="button"
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      <ComposerBanner state={personaState} />

      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] overflow-hidden">
        <Catalog state={personaState} selected={selectedFile} onSelect={setSelectedFile} />
        <Preview state={personaState} selected={selectedFile} />
      </div>
    </div>
  );
}

function ComposerBanner({
  state,
}: {
  state: { status: string; errorMessage: string | null; result: PersonaRenderResult | null };
}): React.ReactElement | null {
  if (state.status === "loading") {
    return (
      <div className="border-b border-subtle bg-status-info-soft px-4 py-2 text-xs text-status-info">
        Loading persona render…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        className="border-b border-subtle bg-status-danger-soft px-4 py-2 text-xs text-status-danger"
        data-testid="persona-error"
      >
        {state.errorMessage ?? "Persona render failed."}
      </div>
    );
  }
  const result = state.result;
  if (!result) return null;
  const collisions = result.collisions.length;
  const missing = result.missingSources.length;
  if (collisions === 0 && missing === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-status-warning-soft px-4 py-2 text-xs text-status-warning">
      {collisions > 0 ? (
        <span data-testid="persona-collision-count">
          <Badge tone="warning">
            {collisions} collision{collisions === 1 ? "" : "s"}
          </Badge>
        </span>
      ) : null}
      {missing > 0 ? (
        <span data-testid="persona-missing-count">
          <Badge tone="warning">
            {missing} missing source{missing === 1 ? "" : "s"}
          </Badge>
        </span>
      ) : null}
    </div>
  );
}

function Catalog({
  state,
  selected,
  onSelect,
}: {
  state: { status: string; result: PersonaRenderResult | null };
  selected: SelectedPersonaFile | null;
  onSelect: (sel: SelectedPersonaFile | null) => void;
}): React.ReactElement {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <nav className="overflow-y-auto border-r border-default bg-subtle p-3 text-xs text-secondary">
        Loading…
      </nav>
    );
  }
  const result = state.result;
  if (!result) {
    return (
      <nav className="overflow-y-auto border-r border-default bg-subtle p-3 text-xs text-secondary">
        (no data)
      </nav>
    );
  }

  return (
    <nav
      className="overflow-y-auto border-r border-default bg-subtle"
      data-testid="persona-catalog"
    >
      <div className="border-b border-subtle">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
          CLAUDE.md{" "}
          {result.claudeMd
            ? `(${result.claudeMd.sections.length} source${result.claudeMd.sections.length === 1 ? "" : "s"})`
            : "(none)"}
        </div>
        {result.claudeMd ? (
          <ul>
            <li>
              <CatalogButton
                label="= combined preview"
                onClick={() => onSelect({ kind: "combined-claudeMd" })}
                isSelected={selected?.kind === "combined-claudeMd"}
                testId="persona-claudemd-combined"
              />
            </li>
          </ul>
        ) : null}
      </div>

      {(["agents", "skills", "slashCmds", "memory"] as const).map((category) => {
        const files = result.files.filter((f) => f.category === category);
        return (
          <div key={category} className="border-b border-subtle last:border-b-0">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              {CATEGORY_LABELS[category]} ({files.length})
            </div>
            {files.length === 0 ? (
              <div className="px-3 pb-3 text-xs text-secondary">(empty)</div>
            ) : (
              <ul>
                {files.map((file) => {
                  const isSelected =
                    selected?.kind === "file" &&
                    selected.category === category &&
                    selected.basename === file.basename;
                  return (
                    <li key={file.basename}>
                      <CatalogButton
                        label={file.basename}
                        sublabel={file.originScope}
                        onClick={() =>
                          onSelect({
                            kind: "file",
                            category,
                            basename: file.basename,
                          })
                        }
                        isSelected={isSelected}
                        testId={`persona-file-${category}-${file.basename}`}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function CatalogButton({
  label,
  sublabel,
  onClick,
  isSelected,
  testId,
}: {
  label: string;
  sublabel?: string;
  onClick: () => void;
  isSelected: boolean;
  testId: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-sm ${
        isSelected ? "bg-accent-soft text-primary" : "text-primary hover:bg-elevated"
      }`}
      data-testid={testId}
    >
      <div>{label}</div>
      {sublabel ? <div className="text-[11px] text-secondary">↳ {sublabel}</div> : null}
    </button>
  );
}

function Preview({
  state,
  selected,
}: {
  state: { status: string; result: PersonaRenderResult | null };
  selected: SelectedPersonaFile | null;
}): React.ReactElement {
  if (state.status !== "ready" || !state.result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        {state.status === "loading" ? "Rendering…" : "No content."}
      </div>
    );
  }
  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        Pick an entry on the left to preview its content.
      </div>
    );
  }

  const result = state.result;

  if (selected.kind === "combined-claudeMd") {
    if (!result.claudeMd) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-secondary">
          No CLAUDE.md sources for this profile.
        </div>
      );
    }
    return (
      <FilePreview
        title="CLAUDE.md (combined)"
        subtitle={`${result.claudeMd.sections.length} section${result.claudeMd.sections.length === 1 ? "" : "s"}`}
        content={result.claudeMd.combinedContent}
        language="markdown"
      />
    );
  }

  const file = pickFile(result.files, selected.category, selected.basename);
  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        File not found in current render.
      </div>
    );
  }
  return (
    <FilePreview
      title={file.basename}
      subtitle={`${CATEGORY_LABELS[file.category]} · origin ${file.originScope}`}
      content={file.content}
      language={languageFor(file.basename)}
      sourcePath={file.sourcePath}
    />
  );
}

function FilePreview({
  title,
  subtitle,
  content,
  language,
  sourcePath,
}: {
  title: string;
  subtitle: string;
  content: string;
  language: string;
  sourcePath?: string;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="persona-preview">
      <div className="border-b border-subtle bg-surface px-4 py-2">
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
        <p className="text-xs text-secondary">{subtitle}</p>
        {sourcePath ? (
          <p className="mt-0.5 font-mono text-[11px] text-secondary">{sourcePath}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor value={content} language={language} readOnly onChange={noopOnChange} />
      </div>
    </div>
  );
}

function pickFile(
  files: PersonaRenderFile[],
  category: PersonaRenderCategory,
  basename: string
): PersonaRenderFile | undefined {
  return files.find((file) => file.category === category && file.basename === basename);
}

// Read-only CodeEditor still requires an onChange prop on its public surface;
// supply a stable no-op so we don't allocate a fresh function per render.
function noopOnChange(_value: string): void {
  // intentional no-op
}

function languageFor(basename: string): string {
  if (basename.endsWith(".md") || basename.endsWith(".markdown")) return "markdown";
  if (basename.endsWith(".json")) return "json";
  if (basename.endsWith(".yaml") || basename.endsWith(".yml")) return "yaml";
  if (basename.endsWith(".js") || basename.endsWith(".mjs") || basename.endsWith(".cjs"))
    return "javascript";
  if (basename.endsWith(".ts")) return "typescript";
  if (basename.endsWith(".sh")) return "shell";
  return "plaintext";
}
