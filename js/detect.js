// Detección de formato: extensión + firma (magic bytes).
// Si la firma contradice a la extensión con seguridad, manda la firma.

import { formatFromName, FORMATS } from './formats.js';

const ascii = (b, off, len) => String.fromCharCode(...b.subarray(off, off + len));
const startsWith = (b, sig, off = 0) => sig.every((v, i) => v === null || b[off + i] === v);

// Formatos que comparten contenedor: si la extensión cae dentro de la familia
// de la firma, se respeta la extensión (p. ej. un .docx es un ZIP).
const FAMILIES = {
  zip: ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub', 'xlsb', 'numbers', 'ipynb'],
  cfb: ['xls', 'msi'],
  ftyp: ['mp4', 'm4a', 'mov', '3gp', 'heic', 'avif', 'aac'],
  ogg: ['ogg', 'opus', 'ogv'],
  ebml: ['mkv', 'webm', 'mka', 'weba'],
  asf: ['wmv', 'wma'],
  riff: ['wav', 'avi', 'webp'],
  gz: ['gz', 'tgz'],
  bz2: ['bz2', 'tbz2'],
  xz: ['xz', 'txz'],
  mpeg: ['mpeg', 'ts'],
  text: ['txt', 'md', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'toml', 'xml', 'ini', 'html', 'svg',
    'srt', 'vtt', 'sbv', 'ass', 'b64', 'rtf', 'ipynb', 'py'],
  mp3: ['mp3'],
};

function sniff(b) {
  if (b.length < 4) return null;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { id: 'png' };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { id: 'jpg' };
  if (ascii(b, 0, 4) === 'GIF8') return { id: 'gif' };
  if (ascii(b, 0, 4) === '%PDF') return { id: 'pdf' };
  if (ascii(b, 0, 4) === '8BPS') return { id: 'psd' };
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return { id: 'tiff' };
  if (startsWith(b, [0x00, 0x00, 0x01, 0x00]) && b[4] > 0 && b[5] === 0) return { id: 'ico' };
  if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12) {
    const t = ascii(b, 8, 4);
    if (t === 'WEBP') return { id: 'webp', family: 'riff' };
    if (t === 'WAVE') return { id: 'wav', family: 'riff' };
    if (t === 'AVI ') return { id: 'avi', family: 'riff' };
  }
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return { id: 'heic', family: 'ftyp' };
    if (brand === 'avif' || brand === 'avis') return { id: 'avif', family: 'ftyp' };
    if (brand === 'qt  ') return { id: 'mov', family: 'ftyp' };
    if (brand.startsWith('M4A') || brand.startsWith('M4B')) return { id: 'm4a', family: 'ftyp' };
    if (brand.startsWith('3g')) return { id: '3gp', family: 'ftyp' };
    return { id: 'mp4', family: 'ftyp' };
  }
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) {
    // EPUB / ODF guardan "mimetype" sin comprimir como primera entrada
    if (ascii(b, 30, 8) === 'mimetype') {
      const m = ascii(b, 38, 60);
      if (m.startsWith('application/epub+zip')) return { id: 'epub', family: 'zip' };
      if (m.startsWith('application/vnd.oasis.opendocument.text')) return { id: 'odt', family: 'zip' };
      if (m.startsWith('application/vnd.oasis.opendocument.spreadsheet')) return { id: 'ods', family: 'zip' };
    }
    return { id: 'zip', family: 'zip', container: true };
  }
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { id: 'xls', family: 'cfb', container: true };
  if (startsWith(b, [0x1f, 0x8b])) return { id: 'gz', family: 'gz' };
  if (ascii(b, 0, 3) === 'BZh') return { id: 'bz2', family: 'bz2' };
  if (startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return { id: 'xz', family: 'xz' };
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { id: '7z' };
  if (ascii(b, 0, 6) === 'Rar!\x1a\x07') return { id: 'rar' };
  if (ascii(b, 0, 4) === 'MSCF') return { id: 'cab' };
  if (b.length > 262 && ascii(b, 257, 5) === 'ustar') return { id: 'tar' };
  if (ascii(b, 0, 4) === 'fLaC') return { id: 'flac' };
  if (ascii(b, 0, 4) === 'OggS') {
    const head = ascii(b, 0, Math.min(b.length, 128));
    if (head.includes('OpusHead')) return { id: 'opus', family: 'ogg' };
    if (head.includes('theora')) return { id: 'ogv', family: 'ogg' };
    return { id: 'ogg', family: 'ogg' };
  }
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { id: ascii(b, 0, Math.min(b.length, 64)).includes('webm') ? 'webm' : 'mkv', family: 'ebml' };
  }
  if (ascii(b, 0, 4) === 'FORM' && b.length >= 12 && ascii(b, 8, 3) === 'AIF') return { id: 'aiff' };
  if (startsWith(b, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return { id: 'wmv', family: 'asf' };
  if (ascii(b, 0, 3) === 'FLV') return { id: 'flv' };
  if (ascii(b, 0, 5) === '#!AMR') return { id: 'amr' };
  if (b[0] === 0x47 && b.length > 188 && b[188] === 0x47) return { id: 'ts', family: 'mpeg' };
  if (startsWith(b, [0x00, 0x00, 0x01, 0xba]) || startsWith(b, [0x00, 0x00, 0x01, 0xb3])) return { id: 'mpeg', family: 'mpeg' };
  if (ascii(b, 0, 3) === 'ID3') return { id: 'mp3', family: 'mp3' };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { id: 'aac' };
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { id: 'mp3', family: 'mp3' };
  if (startsWith(b, [0x0b, 0x77])) return { id: 'ac3' };
  if (ascii(b, 0, 4) === 'wOFF') return { id: 'woff' };
  if (ascii(b, 0, 4) === 'wOF2') return { id: 'woff2' };
  if (ascii(b, 0, 4) === 'OTTO') return { id: 'otf' };
  if (startsWith(b, [0x00, 0x01, 0x00, 0x00, 0x00]) || ascii(b, 0, 4) === 'true') return { id: 'ttf' };
  if (ascii(b, 0, 2) === 'MZ') return { id: 'exe' };
  if (ascii(b, 0, 4) === '\x7fELF') return { id: 'elf' };
  if (ascii(b, 0, 15) === 'SQLite format 3') return { id: 'sqlite' };
  if (startsWith(b, [0x42, 0x4d]) && b.length > 14 && b[14] >= 12 && b[15] === 0) return { id: 'bmp' };

  // Texto: se mira el principio sin BOM ni espacios
  let s = 0;
  if (startsWith(b, [0xef, 0xbb, 0xbf])) s = 3;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(s, Math.min(b.length, 4096))).trimStart();
  if (head.startsWith('{\\rtf')) return { id: 'rtf', family: 'text' };
  if (head.startsWith('WEBVTT')) return { id: 'vtt', family: 'text' };
  if (/^<svg[\s>]/i.test(head) || (/^<\?xml/i.test(head) && /<svg[\s>]/i.test(head))) return { id: 'svg', family: 'text' };
  if (/^<!doctype html|^<html[\s>]/i.test(head)) return { id: 'html', family: 'text' };
  if (/^<\?xml/i.test(head)) return { id: 'xml', family: 'text' };
  if (/^\[Script Info\]/i.test(head)) return { id: 'ass', family: 'text' };
  if (/^\d+\s*\r?\n\d\d:\d\d:\d\d,\d{3} --> /.test(head)) return { id: 'srt', family: 'text' };
  if (/^[{[]/.test(head) && /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(head.slice(0, 512))) {
    return { id: head.includes('"nbformat"') ? 'ipynb' : 'json', family: 'text' };
  }
  // ¿Parece texto? (sin bytes de control raros en la muestra)
  const sample = b.subarray(s, Math.min(b.length, 1024));
  let bad = 0;
  for (const c of sample) if (c < 9 || (c > 13 && c < 32)) bad++;
  if (sample.length && bad / sample.length < 0.01) return { id: 'txt', family: 'text', weak: true };
  return null;
}

/**
 * Devuelve { id, by, magicId, mismatch, sig } para un File.
 */
export async function detectFormat(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const byExt = formatFromName(file.name);
  const magic = sniff(head);
  const sig = head.subarray(0, 8);

  if (!magic) return { id: byExt || 'bin', by: byExt ? 'ext' : 'none', sig };
  if (!byExt) {
    if (magic.container && magic.family === 'zip') {
      return { id: (await zipSubtype(file)) || 'zip', by: 'firma', sig };
    }
    if (magic.family === 'cfb') {
      return { id: 'bin', by: 'firma', sig, note: 'Contenedor OLE2 de Office antiguo: solo se convierten los .xls' };
    }
    return { id: magic.weak ? 'txt' : magic.id, by: 'firma', sig };
  }
  if (byExt === magic.id) return { id: byExt, by: 'ext+firma', sig };

  const fam = magic.family && FAMILIES[magic.family];
  if (fam && fam.includes(byExt)) return { id: byExt, by: 'ext+firma', sig };
  // Contenido de texto: si la extensión es de un formato de texto, es más
  // informativa que la heurística; si es de un formato binario (p. ej. un .ts de
  // TypeScript, que no es MPEG-TS), manda el contenido.
  if (magic.weak || magic.family === 'text') {
    if (FAMILIES.text.includes(byExt)) return { id: byExt, by: 'ext', sig };
    return {
      id: magic.weak ? 'txt' : magic.id, by: 'firma', sig, mismatch: true,
      note: `El contenido es texto, aunque la extensión .${file.name.split('.').pop()} indica ${FORMATS[byExt].label}.`,
    };
  }
  // Extensiones de texto con contenido binario reconocible: manda la firma
  return {
    id: magic.id, by: 'firma', sig, mismatch: true,
    note: `La firma indica ${FORMATS[magic.id].label}, aunque la extensión es .${file.name.split('.').pop()}`,
  };
}

// Para un ZIP sin extensión útil: mira el directorio central
async function zipSubtype(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const dv = new DataView(tail.buffer, tail.byteOffset);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  if (cdOff + cdSize > file.size || cdSize > 8 * 1048576) return null;
  const cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const cdv = new DataView(cd.buffer);
  const names = [];
  for (let p = 0; p + 46 <= cd.length && names.length < 2000;) {
    if (cdv.getUint32(p, true) !== 0x02014b50) break;
    const n = cdv.getUint16(p + 28, true), x = cdv.getUint16(p + 30, true), c = cdv.getUint16(p + 32, true);
    names.push(new TextDecoder().decode(cd.subarray(p + 46, p + 46 + n)));
    p += 46 + n + x + c;
  }
  const has = (pre) => names.some((n) => n.startsWith(pre));
  if (has('word/')) return 'docx';
  if (has('xl/')) return 'xlsx';
  if (has('ppt/')) return 'pptx';
  if (has('Index/') && names.some((n) => n.endsWith('.iwa'))) return 'numbers';
  return null;
}

export const hexSig = (sig) => Array.from(sig, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
