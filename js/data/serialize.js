// Datos estructurados: JSON, JSON Lines, YAML, TOML, XML e INI.

import { loadYaml, loadToml, loadXmlParser } from '../loaders.js';
import { fail, textBlob, UserError } from '../util.js';

const XML_OPTS = {
  ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text',
  parseTagValue: true, parseAttributeValue: false, trimValues: true, processEntities: true,
};

// ---------------------------------------------------------------- INI

function parseIni(text) {
  const root = {};
  let cur = root;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      cur = root;
      for (const part of sec[1].split('.')) cur = (cur[part.trim()] ??= {});
      continue;
    }
    const eq = line.indexOf('=') >= 0 ? line.indexOf('=') : line.indexOf(':');
    if (eq < 0) { cur[line] = true; continue; }
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (/^".*"$|^'.*'$/.test(val)) val = val.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
    else if (/^(true|yes|on)$/i.test(val)) val = true;
    else if (/^(false|no|off)$/i.test(val)) val = false;
    if (key.endsWith('[]')) (cur[key.slice(0, -2)] ??= []).push(val);
    else cur[key] = val;
  }
  return root;
}

function writeIni(value) {
  if (Array.isArray(value)) value = { elementos: value };
  if (typeof value !== 'object' || value === null) value = { valor: value };
  const lines = [];
  const scalar = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    return /[;#=\s"]/.test(s) || s === '' ? JSON.stringify(s) : s;
  };
  const section = (obj, name) => {
    const nested = [];
    const body = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) nested.push([k, v]);
      else if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) v.forEach((x) => body.push(`${k}[] = ${scalar(x)}`));
      else body.push(`${k} = ${scalar(v)}`);
    }
    if (body.length) { if (name) lines.push(`[${name}]`); lines.push(...body, ''); }
    for (const [k, v] of nested) section(v, name ? `${name}.${k}` : k);
  };
  section(value, '');
  return lines.join('\n').trim() + '\n';
}

// ---------------------------------------------------------------- utilidades

/** TOML no tiene null ni admite raíz que no sea tabla. */
function tomlSafe(v) {
  if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? '' : tomlSafe(x)));
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, tomlSafe(x)]));
  }
  return v;
}

const xmlName = (k) => {
  let n = String(k).replace(/[^\w.\-:]/g, '_').replace(/:/g, '_');
  if (!/^[A-Za-z_]/.test(n)) n = `_${n}`;
  if (/^xml/i.test(n)) n = `_${n}`;
  return n || '_';
};
function xmlSafe(v) {
  if (Array.isArray(v)) return v.map(xmlSafe);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.startsWith('@_') || k === '#text' ? k : xmlName(k), xmlSafe(x)]));
  }
  return v;
}

// ---------------------------------------------------------------- API

export async function parseTree(format, text) {
  try {
    switch (format) {
      case 'json': return JSON.parse(text.replace(/^﻿/, ''));
      case 'jsonl': return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
      case 'yaml': {
        const yaml = await loadYaml();
        const docs = yaml.loadAll(text);
        return docs.length === 1 ? docs[0] : docs;
      }
      case 'toml': return (await loadToml()).parse(text);
      case 'xml': {
        const fxp = await loadXmlParser();
        const valid = fxp.XMLValidator.validate(text);
        if (valid !== true) fail(`XML no válido: ${valid.err?.msg || 'error de sintaxis'} (línea ${valid.err?.line ?? '?'})`);
        const obj = new fxp.XMLParser(XML_OPTS).parse(text);
        delete obj['?xml'];
        return obj;
      }
      case 'ini': return parseIni(text);
      default: return fail(`No se puede leer ${format} como datos.`);
    }
  } catch (e) {
    if (e instanceof UserError) throw e;
    fail(`No se pudo interpretar el ${format.toUpperCase()}: ${e.message}`);
  }
}

export async function writeTree(format, value) {
  switch (format) {
    case 'json': return textBlob(JSON.stringify(value, null, 2) + '\n', 'application/json');
    case 'json-min': return textBlob(JSON.stringify(value), 'application/json');
    case 'jsonl': {
      const arr = Array.isArray(value) ? value : [value];
      return textBlob(arr.map((x) => JSON.stringify(x)).join('\n') + '\n', 'application/x-ndjson');
    }
    case 'yaml': {
      const yaml = await loadYaml();
      return textBlob(yaml.dump(value, { lineWidth: 120, noRefs: true }), 'application/yaml');
    }
    case 'toml': {
      const toml = await loadToml();
      let v = tomlSafe(value);
      if (Array.isArray(v) || typeof v !== 'object' || v === null) v = { elementos: Array.isArray(v) ? v : [v] };
      try { return textBlob(toml.stringify(v) + '\n', 'application/toml'); } catch (e) { return fail(`No se puede expresar en TOML: ${e.message}`); }
    }
    case 'xml': {
      const fxp = await loadXmlParser();
      let v = xmlSafe(value);
      const keys = v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).filter((k) => !k.startsWith('?')) : [];
      if (Array.isArray(v)) v = { datos: { elemento: v } };
      else if (typeof v !== 'object' || v === null) v = { valor: v };
      else if (keys.length !== 1 || Array.isArray(v[keys[0]])) v = { datos: v };
      const xml = new fxp.XMLBuilder({ ...XML_OPTS, format: true, indentBy: '  ', suppressEmptyNode: true }).build(v);
      return textBlob(`<?xml version="1.0" encoding="UTF-8"?>\n${xml.trim()}\n`, 'application/xml');
    }
    case 'ini': return textBlob(writeIni(value), 'text/plain');
    default: return fail(`Salida de datos no soportada: ${format}`);
  }
}

/** Busca en un valor una lista de registros para convertirla en tabla. */
export function findRecords(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    // { raiz: { item: [...] } } (típico de XML) o { datos: [...] }
    if (entries.length === 1) return findRecords(entries[0][1]);
    const arrays = entries.filter(([, v]) => Array.isArray(v));
    if (arrays.length === 1) return arrays[0][1];
    return [value];
  }
  return null;
}

/** Aplana objetos anidados con notación de puntos para tablas. */
export function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object' || obj instanceof Date) {
    out[prefix || 'valor'] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    if (obj.every((x) => x === null || typeof x !== 'object')) { out[prefix || 'valor'] = obj.join(', '); return out; }
    obj.forEach((x, i) => flatten(x, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}
