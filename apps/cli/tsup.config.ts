import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const ownPkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };
const corePkg = JSON.parse(readFileSync("../../packages/core/package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: { myclaude: "src/index.ts" },
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
    __CLI_VERSION__: JSON.stringify(ownPkg.version),
    __CORE_VERSION__: JSON.stringify(corePkg.version),
  },
  esbuildOptions(options) {
    options.conditions = ["import", "module", "default"];
  },
});
