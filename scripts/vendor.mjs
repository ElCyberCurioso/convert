#!/usr/bin/env node
// Copia las librerías de node_modules a vendor/ para que la web funcione
// sin paso de build y sin CDNs: todo se sirve desde el propio GitHub Pages.
//
//   npm ci            -> instala las versiones exactas del package-lock.json
//   npm run vendor    -> regenera vendor/
//
// El workflow de GitHub Actions ejecuta ambos pasos antes de publicar.

import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'vendor');

// Transformaciones mínimas para cargar módulos CommonJS o con imports
// desnudos directamente en el navegador.
const cjsToEsm = (src) => {
  const names = [...src.matchAll(/^exports\.(\w+) = \w+;$/gm)].map((m) => m[1]);
  return src
    .replace(/^'use strict';\s*/, '')
    .replace(/^Object\.defineProperty\(exports, '__esModule'.*$/m, '')
    .replace(/^exports\.\w+ = \w+;$/gm, '')
    + `\nexport { ${names.join(', ')} };\n`;
};
// El codificador AVIF multihilo necesita SharedArrayBuffer (cabeceras COOP/COEP
// que GitHub Pages no permite): se fuerza la versión de un hilo.
const avifSingleThread = (src) => src.replace(
  /import \{ threads \} from 'wasm-feature-detect';/,
  'const threads = async () => false;',
);

// fontkit importa «pako» (nombre de paquete): se sustituye por fflate local
const fontkitPako = (src) => src.replace(
  /import (\w+) ?from ?["']pako["'];?/,
  'import { unzlibSync as __unzlib } from "../fflate/fflate.js";const $1={inflate:(d)=>__unzlib(d instanceof Uint8Array?d:new Uint8Array(d))};',
);

// [origen relativo a node_modules, destino relativo a vendor, transformación?]
const FILES = [
  // ffmpeg.wasm: clase, utilidades y núcleo (~32 MB, solo se descarga al usarlo)
  ['@ffmpeg/ffmpeg/dist/esm', 'ffmpeg'],
  ['@ffmpeg/util/dist/esm', 'ffmpeg-util'],
  ['@ffmpeg/core/dist/esm/ffmpeg-core.js', 'ffmpeg-core/ffmpeg-core.js'],
  ['@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'ffmpeg-core/ffmpeg-core.wasm'],
  // PDF
  ['pdfjs-dist/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ['pdfjs-dist/cmaps', 'pdfjs/cmaps'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['pdfjs-dist/wasm', 'pdfjs/wasm'],
  ['pdfjs-dist/LICENSE', 'pdfjs/LICENSE'],
  ['pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib/pdf-lib.esm.min.js'],
  ['pdf-lib/LICENSE.md', 'pdf-lib/LICENSE.md'],
  ['@pdf-lib/fontkit/dist/fontkit.es.min.js', 'fontkit/fontkit.es.min.js', fontkitPako],
  // Fuentes Unicode para generar PDF (acentos, rumano, cirílico, griego…)
  ['dejavu-fonts-ttf/ttf/DejaVuSans.ttf', 'fonts/DejaVuSans.ttf'],
  ['dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf', 'fonts/DejaVuSans-Bold.ttf'],
  ['dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf', 'fonts/DejaVuSans-Oblique.ttf'],
  ['dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf', 'fonts/DejaVuSans-BoldOblique.ttf'],
  ['dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf', 'fonts/DejaVuSansMono.ttf'],
  ['dejavu-fonts-ttf/LICENSE', 'fonts/LICENSE-DejaVu'],
  // Fuentes de la interfaz (auto-alojadas, sin Google Fonts)
  ['@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2', 'ui-fonts/bricolage-latin.woff2'],
  ['@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-standard-normal.woff2', 'ui-fonts/bricolage-latin-ext.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ui-fonts/plex-mono-400.woff2'],
  // Documentos
  ['mammoth/mammoth.browser.min.js', 'mammoth/mammoth.browser.min.js'],
  ['marked/lib/marked.esm.js', 'marked/marked.esm.js'],
  ['turndown/lib/turndown.browser.es.js', 'turndown/turndown.browser.es.js'],
  ['@joplin/turndown-plugin-gfm/lib/turndown-plugin-gfm.cjs.js', 'turndown/gfm.js', cjsToEsm],
  ['docx/dist/index.mjs', 'docx/docx.mjs'],
  // Hojas de cálculo y datos
  ['@e965/xlsx/dist/xlsx.full.min.js', 'xlsx/xlsx.full.min.js'],
  ['@e965/xlsx/LICENSE', 'xlsx/LICENSE'],
  ['js-yaml/dist/browser/js-yaml.esm.min.mjs', 'js-yaml/js-yaml.esm.min.mjs'],
  ['smol-toml/dist', 'smol-toml'],
  ['fast-xml-parser/lib/fxp.min.js', 'fast-xml-parser/fxp.min.js'],
  // Compresión y archivos
  ['fflate/esm/browser.js', 'fflate/fflate.js'],
  ['libarchive.js/dist/libarchive.js', 'libarchive/libarchive.js'],
  ['libarchive.js/dist/worker-bundle.js', 'libarchive/worker-bundle.js'],
  ['libarchive.js/dist/libarchive.wasm', 'libarchive/libarchive.wasm'],
  ['bz2/index.js', 'bz2/bz2.js'],
  ['7z-wasm/7zz.es6.js', '7z/7zz.es6.js'],
  ['7z-wasm/7zz.wasm', '7z/7zz.wasm'],
  ['7z-wasm/License.txt', '7z/License.txt'],
  ['7z-wasm/unRarLicense.txt', '7z/unRarLicense.txt'],
  ['xz-decompress/dist/package/xz-decompress.min.js', 'xz/xz-decompress.js'],
  // Imagen
  ['gifenc/dist/gifenc.esm.js', 'gifenc/gifenc.esm.js'],
  ['utif2/UTIF.js', 'utif/UTIF.js'],
  ['heic-to/dist/csp/heic-to.js', 'heic-to/heic-to.js'],
  ['imagetracerjs/imagetracer_v1.2.6.js', 'imagetracer/imagetracer.js'],
  ['ag-psd/dist/bundle.js', 'ag-psd/ag-psd.js'],
  ['@jsquash/avif/encode.js', 'avif/encode.js', avifSingleThread],
  ['@jsquash/avif/meta.js', 'avif/meta.js'],
  ['@jsquash/avif/utils.js', 'avif/utils.js'],
  ['@jsquash/avif/codec/enc/avif_enc.js', 'avif/codec/enc/avif_enc.js'],
  ['@jsquash/avif/codec/enc/avif_enc.wasm', 'avif/codec/enc/avif_enc.wasm'],
  ['@jsquash/avif/LICENSE', 'avif/LICENSE'],
  // Fuentes tipográficas
  ['woff2-encoder/dist/index.js', 'woff2/woff2.js'],
];

if (!existsSync(nm)) {
  console.error('Falta node_modules: ejecuta primero `npm ci`.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });

let total = 0;
const size = (p) => statSync(p).isDirectory()
  ? readdirSync(p).reduce((s, f) => s + size(join(p, f)), 0)
  : statSync(p).size;

for (const [from, to, transform] of FILES) {
  const src = join(nm, from);
  const dst = join(out, to);
  if (!existsSync(src)) {
    console.error(`No existe ${from}. ¿Ha cambiado la estructura del paquete?`);
    process.exit(1);
  }
  mkdirSync(dirname(dst), { recursive: true });
  if (transform) {
    writeFileSync(dst, transform(readFileSync(src, 'utf8')));
  } else {
    cpSync(src, dst, { recursive: true, filter: (p) => !/\.(d\.ts|d\.cts|d\.mts|map)$/.test(p) });
  }
  total += size(dst);
}

// Quita las referencias a source maps (no se copian) para no generar 404
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
for (const file of walk(out).filter((p) => /\.m?js$/.test(p))) {
  const src = readFileSync(file, 'utf8');
  const clean = src.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
  if (clean !== src) writeFileSync(file, clean);
}

// Comprobación: ningún módulo ESM debe importar nombres de paquete
for (const file of walk(out).filter((p) => /\.m?js$/.test(p))) {
  const bare = /(?:^|;)\s*(?:import|export)\s[^'"\n;]*?from\s*["']([^./][^"']*)["']/m.exec(readFileSync(file, 'utf8'));
  if (bare) { console.error(`${file} importa «${bare[1]}», que el navegador no puede resolver.`); process.exit(1); }
}

console.log(`vendor/ listo: ${FILES.length} entradas, ${(total / 1048576).toFixed(1)} MB.`);
