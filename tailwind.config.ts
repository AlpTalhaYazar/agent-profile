import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

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
      colors: {
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
          soft: "var(--destructive-soft)",
        },
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)",
          soft: "var(--success-soft)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "var(--warning-foreground)",
          soft: "var(--warning-soft)",
        },
        info: {
          DEFAULT: "var(--info)",
          foreground: "var(--info-foreground)",
          soft: "var(--info-soft)",
        },
        overlay: "var(--overlay)",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        xs: "var(--ap-radius-xs)",
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
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
        ".bg-status-success": { backgroundColor: "var(--ap-color-status-success)" },
        ".bg-status-warning": { backgroundColor: "var(--ap-color-status-warning)" },
        ".bg-status-danger": { backgroundColor: "var(--ap-color-status-danger)" },
        ".bg-status-info": { backgroundColor: "var(--ap-color-bg-accent-solid)" },
        ".bg-status-success-soft": {
          backgroundColor: "color-mix(in srgb, var(--ap-color-status-success) 14%, transparent)",
        },
        ".bg-status-warning-soft": {
          backgroundColor: "color-mix(in srgb, var(--ap-color-status-warning) 14%, transparent)",
        },
        ".bg-status-danger-soft": {
          backgroundColor: "color-mix(in srgb, var(--ap-color-status-danger) 14%, transparent)",
        },
        ".bg-status-info-soft": {
          backgroundColor: "color-mix(in srgb, var(--ap-color-bg-accent-solid) 14%, transparent)",
        },
        ".text-primary": { color: "var(--ap-color-text-primary)" },
        ".text-secondary": { color: "var(--ap-color-text-secondary)" },
        ".text-tertiary": { color: "var(--ap-color-text-tertiary)" },
        ".text-on-accent": { color: "var(--ap-color-text-on-accent)" },
        ".text-status-success": { color: "var(--ap-color-status-success)" },
        ".text-status-warning": { color: "var(--ap-color-status-warning)" },
        ".text-status-danger": { color: "var(--ap-color-status-danger)" },
        ".text-status-info": { color: "var(--ap-color-bg-accent-solid)" },
        ".border-default": { borderColor: "var(--ap-color-border-default)" },
        ".border-subtle": { borderColor: "var(--ap-color-border-subtle)" },
        ".border-strong": { borderColor: "var(--ap-color-border-strong)" },
        ".border-accent-solid": { borderColor: "var(--ap-color-bg-accent-solid)" },
        ".border-status-success": { borderColor: "var(--ap-color-status-success)" },
        ".border-status-warning": { borderColor: "var(--ap-color-status-warning)" },
        ".border-status-danger": { borderColor: "var(--ap-color-status-danger)" },
        ".border-status-info": { borderColor: "var(--ap-color-bg-accent-solid)" },
        ".ring-focus": { "--tw-ring-color": "var(--ap-color-focus-ring)" },
      });
    }),
  ],
};

export default config;
