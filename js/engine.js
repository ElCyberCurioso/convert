// Motor: registro de rutas de conversión y ejecución.
// Cada módulo de converters/ exporta { id, routes: [{ from, to, run, ... }] }.

import { FORMATS, CATEGORIES, splitName, fmt } from './formats.js';
import { decodeText, fail } from './util.js';

import image from './converters/image.js';
import media from './converters/media.js';
import documents from './converters/document.js';
import sheet from './converters/sheet.js';
import data from './converters/data.js';
import archive from './converters/archive.js';
import font from './converters/font.js';
import subtitle from './converters/subtitle.js';
import generic from './converters/generic.js';
import { mergeToPdf, IMAGE_IN } from './converters/image.js';

// El orden importa: si dos rutas cubren el mismo par, gana la primera.
const MODULES = [image, media, documents, sheet, data, archive, font, subtitle, generic];

const ROUTES = MODULES.flatMap((m) => m.routes.map((r) => ({
  ...r,
  module: m.id,
  from: new Set(r.from === '*' ? Object.keys(FORMATS) : r.from),
  to: r.to,
})));

/** Representa un archivo de entrada con lectura perezosa. */
export class Input {
  constructor(file, format) {
    this.file = file;
    this.name = file.name || 'archivo';
    this.format = format;
    this.size = file.size;
    const { base, ext } = splitName(this.name);
    this.base = base;
    this.ext = ext;
  }
  async bytes() { return (this._bytes ??= new Uint8Array(await this.file.arrayBuffer())); }
  async text() { return (this._text ??= decodeText(await this.bytes())); }
}

function excluded(r, from, to) {
  if (from === to && !r.allowSame) return true;
  return r.exclude?.(from, to) ?? false;
}

export function findRoute(from, to) {
  return ROUTES.find((r) => r.from.has(from) && r.to.includes(to) && !excluded(r, from, to)) || null;
}

/** Destinos posibles para un formato, agrupados por categoría y sin duplicados. */
export function targetsFor(from) {
  const seen = new Map();
  for (const r of ROUTES) {
    if (!r.from.has(from)) continue;
    for (const to of r.to) {
      if (seen.has(to) || excluded(r, from, to)) continue;
      seen.set(to, {
        id: to,
        label: from === to ? (r.sameLabels?.[to] || `${fmt(to).label} (recomprimir)`) : (r.labels?.[to] || fmt(to).label),
        options: r.options || [],
        cat: fmt(to).cat,
      });
    }
  }
  const order = Object.keys(CATEGORIES);
  return [...seen.values()].sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
}

/** Catálogo completo para la tabla de formatos soportados. */
export function catalog() {
  return Object.entries(FORMATS)
    .filter(([id, f]) => !f.variant && id !== 'bin')
    .map(([id, f]) => ({ id, ...f, targets: targetsFor(id) }))
    .filter((f) => f.targets.some((t) => !['b64', 'datauri', 'hex', 'zip', 'gz'].includes(t.id)));
}

export function outputName(input, to, suffix = '') {
  const ext = fmt(to).ext;
  let name = `${input.base}${suffix}.${ext}`;
  if (name.toLowerCase() === input.name.toLowerCase()) name = `${input.base}-convertido.${ext}`;
  return name;
}

/**
 * Convierte `input` al formato `to`.
 * ctx = { opts, progress(fraccion|null, texto), signal }
 * Devuelve [{ name, blob }].
 */
export async function convert(input, to, ctx) {
  const route = findRoute(input.format, to);
  if (!route) fail(`No hay ruta de ${fmt(input.format).label} a ${fmt(to).label}.`);
  const result = await route.run(input, to, ctx);
  const list = Array.isArray(result) ? result : [result];
  if (!list.length) fail('La conversión no produjo ningún archivo.');
  if (list.length === 1 && !(list[0].blob || list[0]).size && to !== 'unpack') fail('La conversión produjo un archivo vacío.');
  return list.map((o) => (o instanceof Blob ? { blob: o, name: outputName(input, to) } : { name: o.name || outputName(input, to), blob: o.blob }));
}

/** Opciones que admite la ruta de un par concreto. */
export function optionsFor(from, to) {
  return findRoute(from, to)?.options || [];
}

/** Acciones que combinan varios archivos en uno. */
export const MERGES = [
  {
    id: 'merge-pdf',
    label: 'Unir en un solo PDF',
    accepts: (format) => format === 'pdf' || IMAGE_IN.includes(format),
    options: ['pdfPage', 'quality', 'resize'],
    async run(inputs, ctx) {
      const blob = await mergeToPdf(inputs, ctx);
      return [{ name: `${inputs[0].base}-unido.pdf`, blob }];
    },
  },
  {
    id: 'merge-zip',
    label: 'Comprimir todo en un ZIP',
    accepts: () => true,
    options: [],
    async run(inputs, ctx) {
      const { loadFflate } = await import('./loaders.js');
      const { zipSync } = await loadFflate();
      const entries = {};
      const used = new Set();
      for (const [i, inp] of inputs.entries()) {
        ctx.progress(i / inputs.length, `Añadiendo ${inp.name}`);
        let name = inp.name;
        for (let k = 2; used.has(name.toLowerCase()); k++) name = `${inp.base} (${k})${inp.ext ? '.' + inp.ext : ''}`;
        used.add(name.toLowerCase());
        entries[name] = [await inp.bytes(), { level: 6 }];
      }
      return [{ name: 'archivos.zip', blob: new Blob([zipSync(entries)], { type: 'application/zip' }) }];
    },
  },
];
