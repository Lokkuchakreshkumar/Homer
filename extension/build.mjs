/**
 * Build script for the extension.
 *
 * Each entry point is bundled on its own with esbuild: a classic (non-module) content
 * script IIFE, a service-worker module, and a plain popup script. Bundling matters —
 * content scripts cannot rely on bare `import` specifiers, and MV3 forbids remote code —
 * but no framework or plugin is involved, which is why this file is small enough to read.
 *
 * Usage:
 *   node extension/build.mjs          build once into extension/dist/
 *   node extension/build.mjs --watch  rebuild on every change
 */

import { build, context } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// This script lives at extension/build.mjs, so its own directory is the extension root and
// dist sits beside it, not under the repository root.
const outdir = join(here, "dist");

const entries = [
  ["src/content/index.ts", "content.js", "iife"],
  ["src/background.ts", "background.js", "esm"],
  ["src/popup/popup.ts", "popup/popup.js", "iife"],
];

const watch = process.argv.includes("--watch");

async function copyStatics() {
  if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true });

  // Manifest, already validated by hand against the MV3 schema.
  const manifest = JSON.parse(readFileSync(join(here, "src/manifest.json"), "utf8"));
  writeFileSync(join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Popup page and styles, copied byte for byte.
  cpSync(join(here, "src/popup/popup.html"), join(outdir, "popup/popup.html"));
  cpSync(join(here, "src/popup/popup.css"), join(outdir, "popup/popup.css"));

  // Icons. Generated below if they are missing, so a fresh clone still builds.
  const iconsDir = join(outdir, "icons");
  if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

  const { generateIcon } = await import("./icons.mjs");
  for (const size of [16, 48, 128]) {
    const target = join(iconsDir, `icon-${size}.png`);
    if (!existsSync(target)) generateIcon(target, size);
  }
}

async function bundleAll() {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  await copyStatics();

  for (const [entry, outfile, format] of entries) {
    const options = {
      entryPoints: [join(here, entry)],
      bundle: true,
      format,
      platform: "browser",
      target: ["chrome120"],
      outfile: join(outdir, outfile),
      sourcemap: true,
      logLevel: "warning",
      define: { "process.env.NODE_ENV": '"production"' },
    };

    if (watch) {
      const ctx = await context(options);
      await ctx.watch();
      console.log(`[jev-build] watching ${entry}`);
    } else {
      await build(options);
      console.log(`[jev-build] ${entry} -> ${outfile}`);
    }
  }

  if (!watch) console.log(`[jev-build] done. Load ${outdir} as an unpacked extension.`);
}

await bundleAll();
