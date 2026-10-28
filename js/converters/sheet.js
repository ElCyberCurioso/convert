// Hojas de cálculo (SheetJS) y conversión entre tablas y datos estructurados.

import { loadXLSX } from '../loaders.js';
import { fail, textBlob, escapeHtml, safeName } from '../util.js';
import { parseTree, writeTree, findRecords, flatten } from '../data/serialize.js';
import { makeHub } from '../doc/hub.js';
import { writeHub } from './document.js';
import { readDocument } from '../doc/readers.js';

export const SHEET_IN = ['xlsx', 'xls', 'xlsb', 'ods', 'numbers', 'csv', 'tsv', 'dbf'];
const BOOK_OUT = ['xlsx', 'xls', 'xlsb', 'ods'];
const FLAT_OUT = ['csv', 'csv-excel', 'tsv', 'dbf'];
const TREE_OUT = ['json', 'jsonl', 'yaml', 'toml', 'xml'];
const DOC_OUT = ['html', 'md', 'pdf', 'docx', 'odt', 'txt'];
export const TABLE_OUT = [...BOOK_OUT, ...FLAT_OUT, ...TREE_OUT, 'sql', ...DOC_OUT];
const MAX_DOC_ROWS = 20000;

// ---------------------------------------------------------------- CSV

function detectDelimiter(text) {
  const sample = text.slice(0, 20000).split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  if (/^sep=(.)$/i.test(sample[0] || '')) return sample[0].slice(4, 5);
  let best = ',', score = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const consistent = counts.filter((c) => c > 0 && c === counts[0]).length;
    const s = counts[0] > 0 ? consistent * 100 + counts[0] : -1;
    if (s > score) { score = s; best = d; }
  }
  return best;
}

export function parseCsv(text, delim) {
  text = text.replace(/^﻿/, '');
  if (/^sep=.\r?\n/i.test(text)) { delim ??= text[4]; text = text.replace(/^sep=.\r?\n/i, ''); }
  delim ??= detectDelimiter(text);
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { q = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Tipos: números (incluido formato español «1.234,56» en CSV con «;»)
  const es = delim === ';';
  return {
    delim,
    rows: rows.filter((r) => r.some((v) => v !== '')).map((r) => r.map((v) => {
      const t = v.trim();
      if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t) && !(es && /^-?\d{1,3}\.\d{3}$/.test(t))) return Number(t);
      if (es && /^-?(0|[1-9]\d{0,2}(\.\d{3})+|[1-9]\d*|0)(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
      return v;
    })),
  };
}

function csvCell(v, { delim, decimalComma, safe }) {
  if (v === null || v === undefined) return '';
  let s;
  if (v instanceof Date) s = isoDate(v);
  else if (typeof v === 'number') s = decimalComma ? String(v).replace('.', ',') : String(v);
  else if (typeof v === 'boolean') s = v ? 'TRUE' : 'FALSE';
  else s = String(v);
  // Inyección de fórmulas (CSV injection): opcionalmente se neutraliza
  if (safe && typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["\r\n]|^\s|\s$/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
}

const isoDate = (d) => {
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
};

function toCsv(aoa, opts) {
  return aoa.map((r) => r.map((v) => csvCell(v, opts)).join(opts.delim)).join(opts.eol || '\n') + (opts.eol || '\n');
}

// ---------------------------------------------------------------- libro <-> valores

async function readWorkbook(input) {
  const XLSX = await loadXLSX();
  if (input.format === 'csv' || input.format === 'tsv') {
    const { rows } = parseCsv(await input.text(), input.format === 'tsv' ? '\t' : undefined);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), safeSheet(input.base));
    return wb;
  }
  return XLSX.read(await input.bytes(), { type: 'array', cellDates: true, dense: true });
}

const safeSheet = (s) => String(s || 'Hoja1').replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Hoja1';

/** Matriz de valores de cada hoja (sin filas vacías al final). */
async function sheetsAoa(wb) {
  const XLSX = await loadXLSX();
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }),
  })).filter((s) => s.rows.length);
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h, i) => (h === null || h === '' ? `columna_${i + 1}` : String(h)));
  const seen = new Map();
  const keys = header.map((h) => { const n = seen.get(h) || 0; seen.set(h, n + 1); return n ? `${h}_${n + 1}` : h; });
  return rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
}

async function workbookToValue(wb) {
  const sheets = await sheetsAoa(wb);
  if (sheets.length === 1) return rowsToObjects(sheets[0].rows);
  return Object.fromEntries(sheets.map((s) => [s.name, rowsToObjects(s.rows)]));
}

async function valueToWorkbook(value, name) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  // Varias tablas en un objeto { hoja: [..], hoja2: [..] }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length > 1 && entries.every(([, v]) => Array.isArray(v) && v.every((x) => x && typeof x === 'object'))) {
      for (const [k, v] of entries) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.map((x) => flatten(x))), safeSheet(k));
      return wb;
    }
  }
  const records = findRecords(value);
  if (!records || !records.length) fail('Los datos no tienen forma de tabla (se esperaba una lista de registros).');
  const rows = records.map((r) => (r && typeof r === 'object' ? flatten(r) : { valor: r }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeSheet(name));
  return wb;
}

function sheetsToHub(sheets, title) {
  const parts = [];
  for (const s of sheets) {
    if (sheets.length > 1) parts.push(`<h2>${escapeHtml(s.name)}</h2>`);
    const rows = s.rows.slice(0, MAX_DOC_ROWS + 1);
    const cols = Math.max(...rows.map((r) => r.length));
    const cell = (v) => escapeHtml(v instanceof Date ? isoDate(v) : v ?? '');
    parts.push('<table>');
    rows.forEach((r, i) => {
      const tag = i === 0 ? 'th' : 'td';
      parts.push(`<tr>${Array.from({ length: cols }, (_, j) => `<${tag}>${cell(r[j])}</${tag}>`).join('')}</tr>`);
    });
    parts.push('</table>');
    if (s.rows.length > rows.length) parts.push(`<p><em>… ${s.rows.length - rows.length} filas más omitidas.</em></p>`);
  }
  return makeHub(`<body>${parts.join('\n')}</body>`, title);
}

function toSql(sheets, base) {
  const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lit = (v) => {
    if (v === null || v === undefined || v === '') return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v instanceof Date) return `'${isoDate(v)}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const out = [`-- Generado con Transmuta (${new Date().toISOString().slice(0, 10)})`, ''];
  for (const s of sheets) {
    const table = (sheets.length > 1 ? s.name : base).replace(/[^\w]+/g, '_').replace(/^(\d)/, '_$1').toLowerCase() || 'tabla';
    const objs = rowsToObjects(s.rows);
    const cols = Object.keys(objs[0] || {});
    if (!cols.length) continue;
    const type = (k) => {
      const vals = objs.map((o) => o[k]).filter((v) => v !== null && v !== '');
      if (vals.length && vals.every((v) => typeof v === 'number' && Number.isInteger(v))) return 'INTEGER';
      if (vals.length && vals.every((v) => typeof v === 'number')) return 'REAL';
      if (vals.length && vals.every((v) => v instanceof Date)) return 'TIMESTAMP';
      if (vals.length && vals.every((v) => typeof v === 'boolean')) return 'BOOLEAN';
      return 'TEXT';
    };
    out.push(`CREATE TABLE IF NOT EXISTS ${ident(table)} (\n${cols.map((c) => `  ${ident(c)} ${type(c)}`).join(',\n')}\n);`, '');
    for (let i = 0; i < objs.length; i += 500) {
      const chunk = objs.slice(i, i + 500);
      out.push(`INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES\n${chunk.map((o) => `  (${cols.map((c) => lit(o[c])).join(', ')})`).join(',\n')};`, '');
    }
  }
  return textBlob(out.join('\n'), 'application/sql');
}

/** Escribe un libro en cualquier salida tabular. */
async function writeWorkbook(wb, to, ctx, base) {
  const XLSX = await loadXLSX();
  const o = ctx.opts;
  if (BOOK_OUT.includes(to) || to === 'dbf') {
    if (to === 'dbf' && wb.SheetNames.length > 1) wb = { SheetNames: [wb.SheetNames[0]], Sheets: { [wb.SheetNames[0]]: wb.Sheets[wb.SheetNames[0]] } };
    const data = XLSX.write(wb, { bookType: to === 'xls' ? 'biff8' : to, type: 'array', compression: true, cellDates: true });
    return new Blob([data], { type: 'application/octet-stream' });
  }
  const sheets = await sheetsAoa(wb);
  if (!sheets.length) fail('La hoja está vacía.');
  if (to === 'csv' || to === 'csv-excel' || to === 'tsv') {
    const opts = to === 'csv-excel' ? { delim: ';', decimalComma: true, eol: '\r\n', safe: o.csvSafe }
      : to === 'tsv' ? { delim: '\t', safe: o.csvSafe } : { delim: ',', safe: o.csvSafe };
    const ext = to === 'tsv' ? 'tsv' : 'csv';
    const files = sheets.map((s) => ({
      name: sheets.length > 1 ? `${base}-${safeName(s.name)}.${ext}` : `${base}.${ext}`,
      blob: textBlob(toCsv(s.rows, opts), to === 'tsv' ? 'text/tab-separated-values' : 'text/csv', to === 'csv-excel'),
    }));
    return files;
  }
  if (TREE_OUT.includes(to)) return writeTree(to, await workbookToValue(wb));
  if (to === 'sql') return toSql(sheets, base);
  if (DOC_OUT.includes(to)) return writeHub(sheetsToHub(sheets, base), to, ctx, base);
  return fail(`Salida no soportada: ${to}`);
}

// ---------------------------------------------------------------- rutas

export default {
  id: 'sheet',
  routes: [
    {
      from: SHEET_IN,
      to: TABLE_OUT,
      exclude: (from, to) => from === to,
      labels: { md: 'Markdown (tabla)', html: 'HTML (tabla)', txt: 'Texto (tabla alineada)' },
      options: ['csvSafe', 'pdfOrientation'],
      async run(input, to, ctx) {
        ctx.progress(null, 'Leyendo hoja…');
        const wb = await readWorkbook(input);
        return writeWorkbook(wb, to, ctx, input.base);
      },
    },
    {
      // Tablas dentro de documentos -> hoja de cálculo
      from: ['html', 'md', 'docx', 'odt'],
      to: [...BOOK_OUT, 'csv', 'csv-excel', 'tsv', 'json'],
      labels: { xlsx: 'XLSX (tablas del documento)', csv: 'CSV (tablas del documento)' },
      options: ['csvSafe'],
      async run(input, to, ctx) {
        const XLSX = await loadXLSX();
        const hub = await readDocument(input, ctx);
        const tables = [...hub.doc.querySelectorAll('table')];
        if (!tables.length) fail('El documento no contiene tablas.');
        const wb = XLSX.utils.book_new();
        tables.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(t, { raw: false }), `Tabla ${i + 1}`));
        return writeWorkbook(wb, to, ctx, input.base);
      },
    },
  ],
};

// Para el módulo de datos
export { valueToWorkbook, writeWorkbook, parseTree };
