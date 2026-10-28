// Fuentes: TTF/OTF <-> WOFF <-> WOFF2 y @font-face en CSS.
// WOFF 1.0 se implementa aquí (zlib por tabla); WOFF2 usa el codificador
// oficial de Google compilado a wasm (woff2-encoder).

import { loadFflate, loadWoff2 } from '../loaders.js';
import { fail, textBlob, bytesToBase64 } from '../util.js';

const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const pad4 = (n) => (n + 3) & ~3;

function checksum(bytes, off = 0, len = bytes.length - off) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  let sum = 0;
  const end = off + (len & ~3);
  for (let i = off; i < end; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
  let rest = 0;
  for (let i = end, k = 0; i < off + len; i++, k++) rest |= bytes[i] << (24 - 8 * k);
  return (sum + rest) >>> 0;
}

/** Lee las tablas de un SFNT (TTF/OTF). */
function readSfnt(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flavor = dv.getUint32(0);
  if (tag(bytes, 0) === 'ttcf') fail('Las colecciones TTC no están soportadas: extrae primero la fuente individual.');
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(flavor)) fail('No es una fuente TrueType/OpenType válida.');
  const num = dv.getUint16(4);
  const tables = [];
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    const off = dv.getUint32(o + 8), len = dv.getUint32(o + 12);
    if (off + len > bytes.length) fail('La fuente está truncada o dañada.');
    tables.push({ tag: tag(bytes, o), checksum: dv.getUint32(o + 4), data: bytes.subarray(off, off + len) });
  }
  return { flavor, tables };
}

/** Construye un SFNT a partir de tablas, recalculando checkSumAdjustment. */
function buildSfnt(flavor, tables) {
  tables = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const num = tables.length;
  let size = 12 + 16 * num;
  for (const t of tables) size += pad4(t.data.length);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const es = Math.floor(Math.log2(num));
  dv.setUint32(0, flavor);
  dv.setUint16(4, num);
  dv.setUint16(6, 2 ** es * 16);
  dv.setUint16(8, es);
  dv.setUint16(10, num * 16 - 2 ** es * 16);
  let off = 12 + 16 * num;
  let headOff = -1;
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[o + k] = t.tag.charCodeAt(k);
    out.set(t.data, off);
    if (t.tag === 'head' && t.data.length >= 12) { headOff = off; out.fill(0, off + 8, off + 12); }
    dv.setUint32(o + 4, checksum(out, off, t.data.length));
    dv.setUint32(o + 8, off);
    dv.setUint32(o + 12, t.data.length);
    off += pad4(t.data.length);
  });
  if (headOff >= 0) dv.setUint32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

async function sfntToWoff(bytes) {
  const { zlibSync } = await loadFflate();
  const { flavor, tables } = readSfnt(bytes);
  const entries = tables.map((t) => {
    const z = zlibSync(t.data, { level: 9 });
    const data = z.length < t.data.length ? z : t.data;
    return { ...t, comp: data };
  });
  const num = entries.length;
  let size = 44 + 20 * num;
  for (const e of entries) size += pad4(e.comp.length);
  let sfntSize = 12 + 16 * num;
  for (const e of entries) sfntSize += pad4(e.data.length);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x774f4646); // wOFF
  dv.setUint32(4, flavor);
  dv.setUint32(8, size);
  dv.setUint16(12, num);
  dv.setUint32(16, sfntSize);
  dv.setUint16(20, 1);
  let off = 44 + 20 * num;
  entries.sort((a, b) => (a.tag < b.tag ? -1 : 1)).forEach((e, i) => {
    const o = 44 + i * 20;
    for (let k = 0; k < 4; k++) out[o + k] = e.tag.charCodeAt(k);
    dv.setUint32(o + 4, off);
    dv.setUint32(o + 8, e.comp.length);
    dv.setUint32(o + 12, e.data.length);
    dv.setUint32(o + 16, e.checksum);
    out.set(e.comp, off);
    off += pad4(e.comp.length);
  });
  return out;
}

async function woffToSfnt(bytes) {
  const { unzlibSync } = await loadFflate();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== 0x774f4646) fail('No es un archivo WOFF válido.');
  const flavor = dv.getUint32(4);
  const num = dv.getUint16(12);
  const tables = [];
  for (let i = 0; i < num; i++) {
    const o = 44 + i * 20;
    const off = dv.getUint32(o + 4), comp = dv.getUint32(o + 8), orig = dv.getUint32(o + 12);
    const raw = bytes.subarray(off, off + comp);
    const data = comp < orig ? unzlibSync(raw) : raw;
    if (data.length !== orig) fail('Tabla WOFF dañada.');
    tables.push({ tag: tag(bytes, o), data });
  }
  return buildSfnt(flavor, tables);
}

async function toSfnt(input) {
  const bytes = await input.bytes();
  if (input.format === 'woff') return woffToSfnt(bytes);
  if (input.format === 'woff2') return (await loadWoff2()).decompress(bytes);
  readSfnt(bytes); // valida
  return bytes;
}

// ---------------------------------------------------------------- metadatos

function fontInfo(sfnt) {
  const { tables } = readSfnt(sfnt);
  const get = (t) => tables.find((x) => x.tag === t)?.data;
  const name = get('name');
  const names = {};
  if (name) {
    const dv = new DataView(name.buffer, name.byteOffset, name.byteLength);
    const count = dv.getUint16(2), strOff = dv.getUint16(4);
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 12;
      const pid = dv.getUint16(o), id = dv.getUint16(o + 6), len = dv.getUint16(o + 8), off = dv.getUint16(o + 10);
      const raw = name.subarray(strOff + off, strOff + off + len);
      let s;
      if (pid === 3 || pid === 0) s = new TextDecoder('utf-16be').decode(raw);
      else if (pid === 1) s = String.fromCharCode(...raw);
      else continue;
      if (!names[id] || pid === 3) names[id] = s;
    }
  }
  const os2 = get('OS/2');
  let weight = 400, italic = false;
  if (os2 && os2.length > 64) {
    const dv = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
    weight = dv.getUint16(4) || 400;
    italic = (dv.getUint16(62) & 1) === 1;
  }
  return { family: names[16] || names[1] || 'Fuente', subfamily: names[17] || names[2] || '', weight, italic };
}

// ---------------------------------------------------------------- rutas

export default {
  id: 'font',
  routes: [
    {
      from: ['ttf', 'otf', 'woff', 'woff2'],
      to: ['sfnt', 'woff', 'woff2', 'css-font'],
      exclude: (from, to) => from === to || (to === 'sfnt' && (from === 'ttf' || from === 'otf')),
      async run(input, to, ctx) {
        ctx.progress(null, 'Procesando fuente…');
        const sfnt = await toSfnt(input);
        if (to === 'sfnt') {
          const isCff = sfnt[0] === 0x4f && sfnt[1] === 0x54;
          return { name: `${input.base}.${isCff ? 'otf' : 'ttf'}`, blob: new Blob([sfnt], { type: isCff ? 'font/otf' : 'font/ttf' }) };
        }
        if (to === 'woff') return new Blob([await sfntToWoff(sfnt)], { type: 'font/woff' });
        const woff2 = input.format === 'woff2' ? await input.bytes() : await (await loadWoff2()).compress(sfnt);
        if (to === 'woff2') return new Blob([woff2], { type: 'font/woff2' });
        const info = fontInfo(sfnt);
        const css = `/* ${info.family} ${info.subfamily} — generado con Transmuta */\n@font-face {\n  font-family: '${info.family.replace(/'/g, "\\'")}';\n  src: url(data:font/woff2;base64,${bytesToBase64(woff2)}) format('woff2');\n  font-weight: ${info.weight};\n  font-style: ${info.italic ? 'italic' : 'normal'};\n  font-display: swap;\n}\n`;
        return textBlob(css, 'text/css');
      },
    },
  ],
};
