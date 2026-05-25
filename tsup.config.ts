import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom"],
    treeshake: true,
  },
  {
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
    external: ["react", "react-dom"],
  },
  {
    // Self-contained browser bundle served by the CLI viewer.
    // force-graph is bundled in so the HTML page has no external deps.
    entry: { viewer: "src/viewer/index.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    platform: "browser",
    target: "es2020",
    noExternal: ["force-graph"],
  },
]);
