import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const ownPkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: { "myclaude-helper": "src/index.ts" },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  platform: "node",
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __HELPER_VERSION__: JSON.stringify(ownPkg.version),
  },
  esbuildOptions(options) {
    options.conditions = ["import", "module", "default"];
  },
});
