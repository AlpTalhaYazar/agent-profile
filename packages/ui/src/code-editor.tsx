import * as React from "react";

const MonacoEditor = React.lazy(() => import("@monaco-editor/react"));

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string | number;
  readOnly?: boolean;
  ariaLabel?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = "json",
  height = "100%",
  readOnly = false,
  ariaLabel,
}: CodeEditorProps): React.ReactElement {
  return (
    <React.Suspense
      fallback={
        <output
          aria-label={ariaLabel}
          className="flex h-full min-h-40 items-center justify-center rounded-md border border-border bg-muted text-sm text-muted-foreground"
        >
          Loading editor
        </output>
      }
    >
      <MonacoEditor
        height={height}
        language={language}
        onChange={(next) => onChange(next ?? "")}
        options={{
          minimap: { enabled: false },
          readOnly,
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: "on",
        }}
        value={value}
      />
    </React.Suspense>
  );
}
