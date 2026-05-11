import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const bundles = [
  {
    entryPoint: "src/vendor/content-parsers.entry.js",
    outfile: "vendor/content-parsers.js"
  },
  {
    entryPoint: "src/vendor/workspace-virtual.entry.js",
    outfile: "vendor/workspace-virtual.js"
  }
];

for (const bundle of bundles) {
  const outfile = resolve(rootDir, bundle.outfile);
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(rootDir, bundle.entryPoint)],
    outfile,
    bundle: true,
    format: "iife",
    target: "chrome120",
    define: {
      "process.env.NODE_ENV": '"production"'
    },
    legalComments: "none",
    logLevel: "silent",
    sourcemap: false
  });
  console.log(`built ${bundle.outfile}`);
}
