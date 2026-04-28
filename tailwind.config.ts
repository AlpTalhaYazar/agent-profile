import type { Config } from "tailwindcss";

const config: Config = {
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
    },
  },
  plugins: [],
};

export default config;
