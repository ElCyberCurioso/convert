// Utilidades para cualquier archivo: Base64, Data URI, volcado hexadecimal,
// ZIP y GZIP de un solo archivo, y decodificación de Base64.

import { loadFflate } from '../loaders.js';
import { textBlob, bytesToBase64, base64ToBytes, fail } from '../util.js';
import { FORMATS } from '../formats.js';
import { detectFormat } from '../detect.js';

const MAX_TEXT = 64 * 1048576;

function hexDump(bytes) {
  const lines = [];
  const hx = (n) => n.toString(16).padStart(2, '0');
  for (let off = 0; off < bytes.length; off += 16) {
    const chunk = bytes.subarray(off, off + 16);
    let hex = '';
    let asc = '';
    for (let i = 0; i < 16; i++) {
      if (i < chunk.length) {
        hex += hx(chunk[i]) + (i === 7 ? '  ' : ' ');
        asc += chunk[i] >= 0x20 && chunk[i] < 0x7f ? String.fromCharCode(chunk[i]) : '.';
      } else hex += i === 7 ? '    ' : '   ';
    }
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} |${asc}|`);
  }
  lines.push(bytes.length.toString(16).padStart(8, '0'));
  return lines.join('\n') + '\n';
}

async function fileHashes(input, ctx) {
  ctx.progress?.(null, 'Calculando hashes…');
  const worker = new Worker(new URL('../workers/hash.worker.js', import.meta.url), { type: 'module' });
  try {
    const { rows, partial } = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(data));
      worker.onerror = (e) => reject(new Error(e.message || 'Error en el worker de hashes'));
      ctx.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true });
      worker.postMessage({ file: input.file });
    });
    const nf = new Intl.NumberFormat('es-ES');
    const width = Math.max(...rows.map((r) => r.label.length)) + 2;
    const sums = { md5: 'md5sum', sha1: 'sha1sum', sha256: 'sha256sum', sha512: 'sha512sum' };
    const lines = [
      `Hashes de «${input.name}» · ${nf.format(input.size)} bytes`,
      '',
      ...rows.map((r) => `${r.label.padEnd(width)}${r.hex}`),
      '',
      '# Comprobación con coreutils (p. ej. sha256sum -c):',
      ...rows.filter((r) => sums[r.id]).map((r) => `# ${sums[r.id]}: ${r.hex}  ${input.name}`),
    ];
    if (partial) lines.push('', '# Archivo de más de 256 MB: se omiten SHA-3, Keccak y MD4 (lentos en el navegador).');
    return { name: `${input.name}.hashes.txt`, blob: textBlob(lines.join('\n') + '\n') };
  } finally {
    worker.terminate();
  }
}

export default {
  id: 'generic',
  routes: [
    {
      from: '*',
      to: ['hashes', 'zip', 'gz', 'b64', 'datauri', 'hex'],
      exclude: (from, to) => from === to,
      labels: { zip: 'ZIP (comprimir)', gz: 'GZIP (comprimir)', b64: 'Base64', datauri: 'Data URI (Base64)', hex: 'Volcado hexadecimal', hashes: 'Hashes (MD5, SHA-1, SHA-256…)' },
      async run(input, to, ctx) {
        if (to === 'hashes') return fileHashes(input, ctx);
        const bytes = await input.bytes();
        const { zipSync, gzipSync } = await loadFflate();
        if (to === 'zip') return new Blob([zipSync({ [input.name]: [bytes, { level: 6 }] })], { type: 'application/zip' });
        if (to === 'gz') return { name: `${input.name}.gz`, blob: new Blob([gzipSync(bytes, { level: 9, filename: input.name, mtime: input.file.lastModified || Date.now() })], { type: 'application/gzip' }) };
        if (bytes.length > MAX_TEXT) fail('El archivo es demasiado grande para convertirlo a texto (máx. 64 MB).');
        if (to === 'b64') return { name: `${input.name}.b64`, blob: textBlob(bytesToBase64(bytes)) };
        if (to === 'datauri') {
          const mime = input.file.type || FORMATS[input.format]?.mime || 'application/octet-stream';
          return { name: `${input.name}.txt`, blob: textBlob(`data:${mime};base64,${bytesToBase64(bytes)}`) };
        }
        return { name: `${input.name}.hex.txt`, blob: textBlob(hexDump(bytes)) };
      },
    },
    {
      from: ['b64'],
      to: ['decoded'],
      labels: { decoded: 'Decodificar Base64 → archivo' },
      async run(input) {
        const text = await input.text();
        const mimeHint = /^data:([^;,]+)/.exec(text.trim())?.[1];
        const bytes = base64ToBytes(text.trim());
        const probe = new File([bytes], input.base);
        const det = await detectFormat(probe);
        const f = FORMATS[det.id];
        const ext = det.id !== 'bin' && det.id !== 'txt' ? f.ext
          : Object.values(FORMATS).find((x) => x.mime === mimeHint)?.ext || (det.id === 'txt' ? 'txt' : 'bin');
        return { name: `${input.base.replace(/\.(b64|base64)$/i, '')}.${ext}`, blob: new Blob([bytes], { type: f?.mime || mimeHint || 'application/octet-stream' }) };
      },
    },
  ],
};
