import plugin from "tailwindcss/plugin";
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: {
    relative: true,
    files: ["./apps/desktop/src/renderer/**/*.{ts,tsx}", "./packages/ui/src/**/*.{ts,tsx}"],
  },
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        xs: "var(--ap-radius-xs)",
        sm: "var(--ap-radius-sm)",
        md: "var(--ap-radius-md)",
        lg: "var(--ap-radius-lg)",
        xl: "var(--ap-radius-xl)",
        "2xl": "var(--ap-radius-2xl)",
      },
      boxShadow: {
        xs: "var(--ap-shadow-xs)",
        sm: "var(--ap-shadow-sm)",
        md: "var(--ap-shadow-md)",
        lg: "var(--ap-shadow-lg)",
        xl: "var(--ap-shadow-xl)",
        inner: "var(--ap-shadow-inner)",
      },
      screens: {
        "window-compact": "960px",
        "window-medium": "1200px",
        "window-large": "1440px",
        "window-wide": "1680px",
      },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      addUtilities({
        ".bg-canvas": { backgroundColor: "var(--ap-color-bg-canvas)" },
        ".bg-surface": { backgroundColor: "var(--ap-color-bg-surface)" },
        ".bg-elevated": { backgroundColor: "var(--ap-color-bg-elevated)" },
        ".bg-subtle": { backgroundColor: "var(--ap-color-bg-subtle)" },
        ".bg-overlay": { backgroundColor: "var(--ap-color-bg-overlay)" },
        ".bg-accent-soft": { backgroundColor: "var(--ap-color-bg-accent-soft)" },
        ".bg-accent-solid": { backgroundColor: "var(--ap-color-bg-accent-solid)" },
        ".text-primary": { color: "var(--ap-color-text-primary)" },
        ".text-secondary": { color: "var(--ap-color-text-secondary)" },
        ".text-tertiary": { color: "var(--ap-color-text-tertiary)" },
        ".text-on-accent": { color: "var(--ap-color-text-on-accent)" },
        ".text-status-success": { color: "var(--ap-color-status-success)" },
        ".text-status-warning": { color: "var(--ap-color-status-warning)" },
        ".text-status-danger": { color: "var(--ap-color-status-danger)" },
        ".border-default": { borderColor: "var(--ap-color-border-default)" },
        ".border-subtle": { borderColor: "var(--ap-color-border-subtle)" },
        ".border-strong": { borderColor: "var(--ap-color-border-strong)" },
        ".ring-focus": { "--tw-ring-color": "var(--ap-color-focus-ring)" },
      });
    }),
  ],
};

export default config;
