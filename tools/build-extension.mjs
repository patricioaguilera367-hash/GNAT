#!/usr/bin/env node
/**
 * Build one loadable extension folder per version.
 *
 *   node tools/build-extension.mjs 1.5
 *   node tools/build-extension.mjs 1.6
 *
 * Result: `build-versions/v<version>/`, a self-contained unpacked extension you
 * can point chrome://extensions at. The output is generated, never committed:
 * each build is reproducible from the commit that produced it.
 *
 * Versioning: this line advances 1.5, 1.6, 1.7 ... After the merge with V10 the
 * numbering continues as 11.0, 11.1, 11.1.1.
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = join(ROOT, "build-versions");

/** Runtime files of the extension, at their extension-relative path. */
const RUNTIME_FILES = [
  "background.js",
  "centrality_v10.js",
  "centrality_tools_core.js",
  "centrality_tools_v1.js",
  "tools/gnat-adapter/gnat-adapter.js",
  "tools/gnat-adapter/gnat-adapter.browser.js",
];

const version = String(process.argv[2] || "").trim();
if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  console.error("uso: node tools/build-extension.mjs <version>   (ej: 1.5)");
  process.exit(1);
}

const target = join(OUT_ROOT, `v${version}`);
if (existsSync(target)) rmSync(target, { recursive: true, force: true });

const missing = RUNTIME_FILES.filter((file) => !existsSync(join(ROOT, file)));
if (missing.length > 0) {
  console.error(`faltan archivos: ${missing.join(", ")}`);
  process.exit(1);
}

for (const file of RUNTIME_FILES) {
  const destination = join(target, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(ROOT, file), destination);
}

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
manifest.version = version;
manifest.name = `${manifest.name} (build ${version})`;
writeFileSync(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

writeFileSync(
  join(target, "BUILD.txt"),
  [
    `build ${version}`,
    `generado desde: ${ROOT}`,
    `archivos: ${RUNTIME_FILES.length + 2}`,
    "",
    "Cargar: chrome://extensions -> Modo de desarrollador -> Cargar descomprimida -> esta carpeta",
    "",
  ].join("\n"),
  "utf8"
);

console.log(`build ${version} → ${target}`);
console.log(`cargar: chrome://extensions → Cargar descomprimida → esa carpeta`);
