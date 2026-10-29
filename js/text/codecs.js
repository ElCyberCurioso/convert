// Operaciones de texto: codificar, decodificar y transformar.
// Las codificaciones trabajan sobre bytes (la entrada puede ser texto UTF-8,
// hexadecimal o Base64) para que, por ejemplo, Hex → Base64 sea directo.

const enc = new TextEncoder();
const utf8 = (s) => enc.encode(s);
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class CodecError extends Error {}
const bad = (msg) => { throw new CodecError(msg); };

// ---------------------------------------------------------------- bytes <-> texto

export function bytesFromBase64(s) {
  let t = s.trim().replace(/^data:[^,]*,/, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (/[^A-Za-z0-9+/=]/.test(t)) bad('Hay caracteres que no pertenecen a Base64.');
  t = t.replace(/=+$/, '');
  if (t.length % 4 === 1) bad('La longitud no es válida para Base64.');
  const out = new Uint8Array(Math.floor((t.length * 3) / 4));
  let bits = 0, val = 0, o = 0;
  for (const ch of t) {
    val = (val << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (val >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

export function bytesToBase64(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}

export function bytesFromHex(s) {
  const t = s.trim().replace(/0x|\\x|%|[\s,:;-]/gi, '');
  if (!t) return new Uint8Array();
  if (/[^0-9a-f]/i.test(t)) bad('Hay caracteres que no son hexadecimales.');
  if (t.length % 2) bad('El número de dígitos hexadecimales es impar.');
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

export const bytesToHex = (b, sep = '') => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(sep);

/** Interpreta la entrada según el modo elegido. */
export function inputBytes(text, mode) {
  if (mode === 'hex') return bytesFromHex(text);
  if (mode === 'base64') return bytesFromBase64(text);
  return utf8(text);
}

/** Muestra bytes como texto UTF-8; si no lo son, en hexadecimal con aviso. */
export function bytesToDisplay(bytes) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { text: bytesToHex(bytes, ' '), note: 'El resultado no es texto UTF-8 válido: se muestra en hexadecimal.' };
  }
}

// ---------------------------------------------------------------- Base32

function base32Encode(b) {
  let out = '', bits = 0, val = 0;
  for (const x of b) {
    val = (val << 8) | x; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out + '='.repeat((8 - (out.length % 8)) % 8);
}

function base32Decode(s) {
  const t = s.toUpperCase().replace(/[\s=]/g, '');
  if (/[^A-Z2-7]/.test(t)) bad('Hay caracteres que no pertenecen a Base32.');
  const out = [];
  let bits = 0, val = 0;
  for (const ch of t) {
    val = (val << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- URL

const UNRESERVED = /[A-Za-z0-9\-._~]/;
const pct = (x) => `%${x.toString(16).toUpperCase().padStart(2, '0')}`;

function percentEncode(bytes, { keep = UNRESERVED, space } = {}) {
  let out = '';
  for (const x of bytes) {
    const ch = String.fromCharCode(x);
    if (x === 0x20 && space) out += space;
    else if (x < 0x80 && keep && keep.test(ch)) out += ch;
    else out += pct(x);
  }
  return out;
}

function percentDecode(s, plusAsSpace) {
  const src = plusAsSpace ? s.replace(/\+/g, ' ') : s;
  const bytes = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '%' && /^[0-9a-f]{2}$/i.test(src.substr(i + 1, 2))) {
      bytes.push(parseInt(src.substr(i + 1, 2), 16));
      i += 3;
      continue;
    }
    const ch = String.fromCodePoint(src.codePointAt(i));
    for (const b of utf8(ch)) bytes.push(b);
    i += ch.length;
  }
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------- HTML

const HTML_BASIC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function htmlDecode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,31});?/gi, (m, ent) => {
    if (ent[0] === '#') {
      const cp = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    // Entidades con nombre (también las heredadas sin «;», como hace el navegador):
    // se resuelven en un documento inerte que solo contiene la entidad
    const txt = new DOMParser().parseFromString(`<!doctype html><body>${m}`, 'text/html').body.textContent;
    return txt || m;
  });
}

// ---------------------------------------------------------------- escapes Unicode / JS

function unicodeEscape(s) {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp < 0x7f && ch !== '\\') out += ch;
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else for (let i = 0; i < ch.length; i++) out += `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  return out;
}

function unicodeUnescape(s) {
  return s.replace(/\\(u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|[0-7]{1,3}|[nrtbfv0'"\\/])/gi, (m, e) => {
    const c = e[0];
    if (c === 'u' && e[1] === '{') { const cp = parseInt(e.slice(2, -1), 16); return cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
    if (c === 'u') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (c === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/[0-7]/.test(c) && e !== '0') return String.fromCharCode(parseInt(e, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] ?? c;
  });
}

// ---------------------------------------------------------------- Quoted-printable

function qpEncode(bytes) {
  const lines = [];
  let line = '';
  const push = (tok) => {
    if (line.length + tok.length > 75) { lines.push(`${line}=`); line = ''; }
    line += tok;
  };
  for (let i = 0; i < bytes.length; i++) {
    const x = bytes[i];
    if (x === 0x0a) { lines.push(line.replace(/[ \t]$/, (c) => pct(c.charCodeAt(0)).replace('%', '='))); line = ''; continue; }
    if (x === 0x0d && bytes[i + 1] === 0x0a) continue;
    const printable = (x >= 33 && x <= 126 && x !== 61) || x === 0x20 || x === 0x09;
    push(printable ? String.fromCharCode(x) : pct(x).replace('%', '='));
  }
  lines.push(line.replace(/[ \t]$/, (c) => pct(c.charCodeAt(0)).replace('%', '=')));
  return lines.join('\r\n');
}

function qpDecode(s) {
  // Saltos suaves fuera; los duros (CRLF en QP) vuelven a LF
  const t = s.replace(/=\r?\n/g, '').replace(/\r\n/g, '\n');
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9a-f]{2}$/i.test(t.substr(i + 1, 2))) { out.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; }
    else out.push(...utf8(t[i]));
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- Punycode (RFC 3492)

const PC = { base: 36, tMin: 1, tMax: 26, skew: 38, damp: 700, bias: 72, n: 128 };
function adapt(delta, num, first) {
  delta = first ? Math.floor(delta / PC.damp) : delta >> 1;
  delta += Math.floor(delta / num);
  let k = 0;
  while (delta > ((PC.base - PC.tMin) * PC.tMax) >> 1) { delta = Math.floor(delta / (PC.base - PC.tMin)); k += PC.base; }
  return k + Math.floor(((PC.base - PC.tMin + 1) * delta) / (delta + PC.skew));
}
const digitChar = (d) => String.fromCharCode(d + 22 + 75 * (d < 26));

function punyEncodeLabel(label) {
  const cps = [...label].map((c) => c.codePointAt(0));
  let out = cps.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join('');
  const b = out.length;
  let h = b;
  if (b) out += '-';
  let n = PC.n, delta = 0, bias = PC.bias;
  while (h < cps.length) {
    const m = Math.min(...cps.filter((c) => c >= n));
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = PC.base; ; k += PC.base) {
          const t = k <= bias ? PC.tMin : k >= bias + PC.tMax ? PC.tMax : k - bias;
          if (q < t) break;
          out += digitChar(t + ((q - t) % (PC.base - t)));
          q = Math.floor((q - t) / (PC.base - t));
        }
        out += digitChar(q);
        bias = adapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++; n++;
  }
  return out;
}

function punyDecodeLabel(input) {
  const out = [];
  let i = 0, n = PC.n, bias = PC.bias;
  const basic = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(0, basic); j++) out.push(input.charCodeAt(j));
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
    const oldi = i;
    for (let w = 1, k = PC.base; ; k += PC.base) {
      if (idx >= input.length) bad('Punycode no válido.');
      const c = input.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : PC.base;
      if (digit >= PC.base) bad('Punycode no válido.');
      i += digit * w;
      const t = k <= bias ? PC.tMin : k >= bias + PC.tMax ? PC.tMax : k - bias;
      if (digit < t) break;
      w *= PC.base - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

const mapLabels = (s, fn) => s.split(/(\.)/).map((part) => (part === '.' ? part : fn(part))).join('');
const punyEncode = (s) => mapLabels(s.trim().toLowerCase(), (l) => (/[^\x00-\x7f]/.test(l) ? `xn--${punyEncodeLabel(l)}` : l));
const punyDecode = (s) => mapLabels(s.trim(), (l) => (/^xn--/i.test(l) ? punyDecodeLabel(l.slice(4).toLowerCase()) : l));

// ---------------------------------------------------------------- JWT

function jwtDecode(token) {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length < 2 || parts.length > 5) bad('Un JWT tiene la forma cabecera.carga.firma.');
  const json = (p, what) => {
    try { return JSON.parse(new TextDecoder().decode(bytesFromBase64(p))); } catch { return bad(`La ${what} no es JSON en Base64URL.`); }
  };
  const header = json(parts[0], 'cabecera');
  const payload = parts.length === 5 ? null : json(parts[1], 'carga');
  const notes = [];
  if (parts.length === 5) notes.push('Es un JWE (cifrado): solo se puede leer la cabecera.');
  if (String(header.alg).toLowerCase() === 'none') notes.push('⚠ alg «none»: el token no está firmado.');
  if (parts.length === 3 && !parts[2]) notes.push('⚠ El token no tiene firma.');
  const fmtDate = (v) => new Date(v * 1000).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'medium' });
  if (payload) {
    for (const k of ['iat', 'nbf', 'exp']) if (typeof payload[k] === 'number') notes.push(`${k}: ${fmtDate(payload[k])}`);
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) notes.push('⚠ El token ha caducado.');
  }
  const text = `// Cabecera\n${JSON.stringify(header, null, 2)}\n\n${payload ? `// Carga\n${JSON.stringify(payload, null, 2)}\n\n` : ''}// Firma (Base64URL)\n${parts[2] || '(vacía)'}`;
  return { text, note: notes.join(' · ') || null };
}

// ---------------------------------------------------------------- transformaciones

const words = (s) => s
  .normalize('NFC')
  .replace(/([a-záéíóúñü\d])([A-ZÁÉÍÓÚÑÜ])/g, '$1 $2')
  .split(/[^\p{L}\p{N}]+/u)
  .filter(Boolean);
const stripAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
const graphemes = (s) => (Intl.Segmenter ? [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s]);
const rot = (s, n, from, to) => s.replace(new RegExp(`[${from}-${to}]`, 'g'), (c) => String.fromCharCode(((c.charCodeAt(0) - from.charCodeAt(0) + n) % (to.charCodeAt(0) - from.charCodeAt(0) + 1)) + from.charCodeAt(0)));
const lines = (s) => s.replace(/\r\n?/g, '\n').split('\n');
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

// ---------------------------------------------------------------- catálogo
//
// kind: 'bytes'  -> run(bytes) recibe los bytes de la entrada (según el modo)
//       'text'   -> run(text)
//       'decode' -> run(text) devuelve bytes que se muestran como texto
//       'hash'   -> se muestra la tabla de hashes (ver hash.js)

export const GROUPS = { encode: 'Codificar', decode: 'Decodificar', hash: 'Hashes', transform: 'Transformar' };

export const OPS = [
  // Codificar
  { id: 'b64', group: 'encode', label: 'Base64', kind: 'bytes', run: bytesToBase64 },
  { id: 'b64url', group: 'encode', label: 'Base64URL', kind: 'bytes', run: (b) => bytesToBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
  { id: 'b32', group: 'encode', label: 'Base32', kind: 'bytes', run: base32Encode },
  { id: 'hex', group: 'encode', label: 'Hexadecimal', kind: 'bytes', run: (b) => bytesToHex(b) },
  { id: 'hex-esc', group: 'encode', label: 'Hex \\x', kind: 'bytes', run: (b) => Array.from(b, (x) => `\\x${x.toString(16).padStart(2, '0')}`).join('') },
  { id: 'url', group: 'encode', label: 'URL (componente)', kind: 'bytes', run: (b) => percentEncode(b) },
  { id: 'url-all', group: 'encode', label: 'URL (todos los caracteres)', kind: 'bytes', run: (b) => percentEncode(b, { keep: null }) },
  { id: 'url-full', group: 'encode', label: 'URL completa', kind: 'text', run: (s) => encodeURI(s) },
  { id: 'form', group: 'encode', label: 'Formulario (+)', kind: 'bytes', run: (b) => percentEncode(b, { keep: /[A-Za-z0-9*\-._]/, space: '+' }) },
  { id: 'html', group: 'encode', label: 'Entidades HTML', kind: 'text', run: (s) => s.replace(/[&<>"']/g, (c) => HTML_BASIC[c]) },
  { id: 'html-all', group: 'encode', label: 'HTML numérico (&#x;)', kind: 'text', run: (s) => [...s].map((c) => (/[A-Za-z0-9 ]/.test(c) ? c : `&#x${c.codePointAt(0).toString(16)};`)).join('') },
  { id: 'unicode', group: 'encode', label: 'Escapes Unicode (\\u)', kind: 'text', run: unicodeEscape },
  { id: 'json', group: 'encode', label: 'Cadena JSON', kind: 'text', run: (s) => JSON.stringify(s) },
  { id: 'qp', group: 'encode', label: 'Quoted-printable', kind: 'bytes', run: qpEncode },
  { id: 'bin', group: 'encode', label: 'Binario', kind: 'bytes', run: (b) => Array.from(b, (x) => x.toString(2).padStart(8, '0')).join(' ') },
  { id: 'dec', group: 'encode', label: 'Decimal', kind: 'bytes', run: (b) => Array.from(b).join(' ') },
  { id: 'puny', group: 'encode', label: 'Punycode (IDN)', kind: 'text', run: punyEncode },
  { id: 'rot13', group: 'encode', label: 'ROT13', kind: 'text', run: (s) => rot(rot(s, 13, 'a', 'z'), 13, 'A', 'Z') },
  { id: 'rot47', group: 'encode', label: 'ROT47', kind: 'text', run: (s) => rot(s, 47, '!', '~') },

  // Decodificar
  { id: 'd-b64', group: 'decode', label: 'Base64 / Base64URL', kind: 'decode', run: bytesFromBase64 },
  { id: 'd-b32', group: 'decode', label: 'Base32', kind: 'decode', run: base32Decode },
  { id: 'd-hex', group: 'decode', label: 'Hexadecimal', kind: 'decode', run: bytesFromHex },
  { id: 'd-url', group: 'decode', label: 'URL', kind: 'decode', run: (s) => percentDecode(s, false) },
  { id: 'd-form', group: 'decode', label: 'Formulario (+)', kind: 'decode', run: (s) => percentDecode(s, true) },
  { id: 'd-html', group: 'decode', label: 'Entidades HTML', kind: 'text', run: htmlDecode },
  { id: 'd-unicode', group: 'decode', label: 'Escapes Unicode / JS', kind: 'text', run: unicodeUnescape },
  {
    id: 'd-json', group: 'decode', label: 'Cadena JSON', kind: 'text',
    run: (s) => {
      const t = s.trim();
      try { const v = JSON.parse(/^".*"$/s.test(t) ? t : `"${t}"`); return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch (e) { return bad(`JSON no válido: ${e.message}`); }
    },
  },
  { id: 'd-qp', group: 'decode', label: 'Quoted-printable', kind: 'decode', run: qpDecode },
  {
    id: 'd-bin', group: 'decode', label: 'Binario', kind: 'decode',
    run: (s) => { const t = s.replace(/[^01]/g, ''); if (t.length % 8) bad('El número de bits no es múltiplo de 8.'); return new Uint8Array(t.match(/.{8}/g)?.map((x) => parseInt(x, 2)) || []); },
  },
  {
    id: 'd-dec', group: 'decode', label: 'Decimal', kind: 'decode',
    run: (s) => { const n = s.trim().split(/[^\d]+/).filter(Boolean).map(Number); if (n.some((x) => x > 255)) bad('Cada número debe estar entre 0 y 255.'); return new Uint8Array(n); },
  },
  { id: 'd-puny', group: 'decode', label: 'Punycode (IDN)', kind: 'text', run: punyDecode },
  { id: 'jwt', group: 'decode', label: 'JWT', kind: 'text', run: jwtDecode },

  // Hashes
  { id: 'hashes', group: 'hash', label: 'Todos los hashes', kind: 'hash' },
  { id: 'hmac', group: 'hash', label: 'HMAC', kind: 'hash' },
  { id: 'ntlm', group: 'hash', label: 'NTLM', kind: 'hash' },

  // Transformar
  { id: 'upper', group: 'transform', label: 'MAYÚSCULAS', kind: 'text', run: (s) => s.toLocaleUpperCase('es') },
  { id: 'lower', group: 'transform', label: 'minúsculas', kind: 'text', run: (s) => s.toLocaleLowerCase('es') },
  { id: 'title', group: 'transform', label: 'Tipo Título', kind: 'text', run: (s) => s.toLocaleLowerCase('es').replace(/(^|[\s\-_/(«"'¿¡])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('es')) },
  { id: 'camel', group: 'transform', label: 'camelCase', kind: 'text', run: (s) => words(stripAccents(s)).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') },
  { id: 'pascal', group: 'transform', label: 'PascalCase', kind: 'text', run: (s) => words(stripAccents(s)).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') },
  { id: 'snake', group: 'transform', label: 'snake_case', kind: 'text', run: (s) => words(stripAccents(s)).map((w) => w.toLowerCase()).join('_') },
  { id: 'kebab', group: 'transform', label: 'kebab-case', kind: 'text', run: (s) => words(stripAccents(s)).map((w) => w.toLowerCase()).join('-') },
  { id: 'constant', group: 'transform', label: 'CONSTANT_CASE', kind: 'text', run: (s) => words(stripAccents(s)).map((w) => w.toUpperCase()).join('_') },
  { id: 'slug', group: 'transform', label: 'slug-para-url', kind: 'text', run: (s) => stripAccents(s).toLowerCase().replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') },
  { id: 'noaccents', group: 'transform', label: 'Quitar acentos', kind: 'text', run: stripAccents },
  { id: 'reverse', group: 'transform', label: 'Invertir', kind: 'text', run: (s) => graphemes(s).reverse().join('') },
  { id: 'sort', group: 'transform', label: 'Ordenar líneas', kind: 'text', run: (s) => lines(s).sort(collator.compare).join('\n') },
  { id: 'unique', group: 'transform', label: 'Quitar líneas duplicadas', kind: 'text', run: (s) => [...new Set(lines(s))].join('\n') },
  { id: 'noempty', group: 'transform', label: 'Quitar líneas vacías', kind: 'text', run: (s) => lines(s).filter((l) => l.trim()).join('\n') },
  { id: 'trim', group: 'transform', label: 'Recortar espacios', kind: 'text', run: (s) => lines(s).map((l) => l.trim().replace(/[ \t]{2,}/g, ' ')).join('\n').trim() },
];

export const opById = (id) => OPS.find((o) => o.id === id);

/** Ejecuta una operación que no es de hash. Devuelve { text, note }. */
export function runOp(op, text, mode) {
  if (op.kind === 'bytes') return { text: op.run(inputBytes(text, mode)) };
  const src = mode === 'utf8' || op.kind === 'decode' ? text : bytesToDisplay(inputBytes(text, mode)).text;
  if (op.kind === 'decode') return bytesToDisplay(op.run(src));
  const r = op.run(src);
  return typeof r === 'string' ? { text: r } : r;
}

/** ¿Los bytes parecen texto legible? (UTF-8 válido y casi todo imprimible) */
function readable(bytes) {
  if (!bytes.length) return false;
  let txt;
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return false; }
  const printable = [...txt].filter((c) => /[\p{L}\p{N}\p{P}\p{S}\s]/u.test(c)).length;
  return printable / [...txt].length > 0.9;
}
const tryBytes = (fn) => { try { return fn(); } catch { return new Uint8Array(); } };

/** Sugerencias según el aspecto de la entrada. */
export function suggest(text) {
  const t = text.trim();
  if (!t || t.length > 200000) return [];
  const out = [];
  const compact = t.replace(/\r?\n/g, '');
  if (/^(Bearer\s+)?eyJ[\w-]+\.eyJ[\w-]*\.[\w-]*$/.test(t)) out.push('jwt');
  if (/(^|\.)xn--[a-z0-9-]+/i.test(t) && !/\s/.test(t)) out.push('d-puny');
  if (/%[0-9a-f]{2}/i.test(t)) out.push('d-url');
  const hexDigits = t.replace(/0x|\\x|[\s:,-]/gi, '');
  if (/^[01]{8}(\s*[01]{8})*$/.test(t)) out.push('d-bin');
  else if (/^((0x|\\x)?[0-9a-f]{2}[\s:,-]?)+$/i.test(t) && hexDigits.length % 2 === 0 && (hexDigits.length >= 8 || /[\s:,]|0x|\\x/i.test(t))) out.push('d-hex');
  if (!out.length && /^[A-Za-z0-9+/\-_]+={0,2}$/.test(compact) && compact.length >= 8) {
    const b = tryBytes(() => bytesFromBase64(compact));
    if (readable(b) || (compact.length >= 24 && compact.length % 4 === 0 && /\d/.test(compact))) out.push('d-b64');
  }
  if (/^[A-Z2-7]{8,}=*$/.test(compact) && /[2-7=]/.test(compact) && compact.length % 8 === 0 && readable(tryBytes(() => base32Decode(compact)))) out.push('d-b32');
  if (/&(#x?[0-9a-f]+|[a-z]+);/i.test(t)) out.push('d-html');
  if (/\\u[0-9a-f]{4}|\\u\{[0-9a-f]+\}/i.test(t) || (/\\x[0-9a-f]{2}/i.test(t) && !out.includes('d-hex'))) out.push('d-unicode');
  return [...new Set(out)].slice(0, 3);
}
