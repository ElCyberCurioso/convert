// Archivos comprimidos: lectura con libarchive (ZIP, 7Z, RAR 4/5, TAR, GZ,
// BZ2, XZ, ISO, CAB) y escritura con fflate (ZIP) o libarchive (7Z, TAR.*).

import { loadLibarchive, loadFflate, loadBz2, loadXz } from '../loaders.js';
import { fail, UserError } from '../util.js';

export const ARCH_IN = ['zip', '7z', 'rar', 'tar', 'tgz', 'tbz2', 'txz', 'gz', 'bz2', 'xz', 'iso', 'cab'];
const ARCH_OUT = ['zip', '7z', 'tar', 'tgz', 'tbz2', 'txz', 'unpack'];
const MAX_ENTRIES = 20000;

/** Descomprime un flujo único (.gz, .bz2, .xz) con librerías JS/wasm. */
async function decompressStream(input) {
  const bytes = await input.bytes();
  try {
    if (input.format === 'gz') return (await loadFflate()).gunzipSync(bytes);
    if (input.format === 'bz2') return (await loadBz2()).decompress(bytes);
    const { XzReadableStream } = await loadXz();
    return new Uint8Array(await new Response(new XzReadableStream(input.file.stream())).arrayBuffer());
  } catch (e) {
    return fail(`El archivo ${input.format.toUpperCase()} está dañado (${e.message || e}).`);
  }
}

/** Extrae un comprimido a [{ path, file }]. */
export async function extract(input, ctx) {
  const opts = ctx.opts || {};
  // Compresión de un único archivo (no .tar.*): se descomprime directamente
  if (['gz', 'bz2', 'xz'].includes(input.format)) {
    ctx.progress?.(null, 'Descomprimiendo…');
    const inner = await decompressStream(input);
    const isTar = inner.length > 262 && String.fromCharCode(...inner.subarray(257, 262)) === 'ustar';
    if (!isTar) {
      const name = input.name.replace(/\.(gz|gzip|bz2|xz)$/i, '') || `${input.base}.bin`;
      return [{ path: name, file: new File([inner], name) }];
    }
    return extractWith(new File([inner], `${input.base}.tar`), opts, ctx);
  }
  return extractWith(input.file, opts, ctx);
}

async function extractWith(file, opts, ctx) {
  try {
    return await extractLibarchive(file, opts, ctx);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    // Respaldo: 7-Zip real (descifra 7Z con AES y abre variantes que libarchive no admite)
    ctx.progress?.(null, 'Probando con 7-Zip…');
    try {
      return await extract7zip(file, opts, ctx);
    } catch (e2) {
      const msg = String(e2.message || e2);
      if (/wrong password|incorrect password|cannot open encrypted|encrypted/i.test(msg)) {
        fail(opts.password ? 'Contraseña incorrecta.' : 'El comprimido está protegido con contraseña: escríbela en los ajustes.');
      }
      throw e instanceof UserError ? e : new UserError(String(e.message || e));
    }
  }
}

async function extractLibarchive(file, opts, ctx) {
  const { Archive } = await loadLibarchive();
  ctx.progress?.(null, 'Abriendo comprimido…');
  let archive;
  try { archive = await Archive.open(file); } catch (e) { throw new UserError(`No se pudo abrir el comprimido: ${e.message || e}`); }
  let encrypted = null;
  try { encrypted = await archive.hasEncryptedData(); } catch { /* indeterminado */ }
  if (encrypted && !opts.password) fail('El comprimido está protegido con contraseña: escríbela en los ajustes.');
  if (opts.password) await archive.usePassword(opts.password);
  let count = 0;
  try {
    await archive.extractFiles(() => {
      count++;
      if (count % 25 === 0) ctx.progress?.(null, `Extrayendo… ${count} archivos`);
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (opts.password && /passphrase|password|decompression failed|encrypt/i.test(msg)) fail('Contraseña incorrecta.');
    throw new UserError(`Error al extraer: ${msg}`);
  }
  const list = (await archive.getFilesArray())
    .filter((e) => e.file instanceof Blob)
    .map((e) => ({ path: `${e.path}${e.file.name}`.replace(/^\/+/, ''), file: e.file }));
  if (!list.length) fail('El comprimido está vacío o no se reconoce su formato.');
  if (list.length > MAX_ENTRIES) fail(`Demasiados archivos (${list.length}).`);
  return list;
}

function sevenZipWorker(message, transfer, ctx) {
  const worker = new Worker(new URL('../workers/sevenzip.worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.error ? reject(new UserError(`7-Zip: ${data.error}`)) : resolve(data));
    worker.onerror = (e) => reject(new UserError(`7-Zip: ${e.message || 'error en el worker'}`));
    ctx.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true });
    worker.postMessage({ id: 1, ...message }, transfer);
  }).finally(() => worker.terminate());
}

async function extract7zip(file, opts, ctx) {
  const bytes = await file.arrayBuffer();
  const name = (file.name || 'archivo').replace(/[\\/]/g, '_');
  const { files } = await sevenZipWorker({ op: 'extract', name, bytes, password: opts.password || '' }, [bytes], ctx);
  if (!files.length) fail('El comprimido está vacío.');
  if (files.length > MAX_ENTRIES) fail(`Demasiados archivos (${files.length}).`);
  return files.map((f) => ({ path: f.path, file: new File([f.bytes], f.path.split('/').pop()) }));
}

/** 7Z y TAR.* con 7-Zip real en un Worker (libarchive.js no los escribe bien). */
async function writeWith7zip(files, to, ctx, base) {
  ctx.progress?.(null, 'Comprimiendo con 7-Zip…');
  const payload = [];
  for (const f of files) payload.push({ path: f.path.replace(/^\/+/, ''), bytes: await f.file.arrayBuffer() });
  const { out } = await sevenZipWorker({ op: 'create', files: payload, format: to, base: base.replace(/[\\/:*?"<>|]/g, '_') || 'archivo' }, payload.map((p) => p.bytes), ctx);
  if (!out?.length) fail('7-Zip no generó el archivo.');
  return new Blob([out], { type: 'application/octet-stream' });
}

async function writeArchive(files, to, ctx, base = 'archivo') {
  if (to === 'zip') {
    const { zipSync } = await loadFflate();
    const entries = {};
    for (const f of files) {
      const data = new Uint8Array(await f.file.arrayBuffer());
      // ya comprimidos: se guardan sin recomprimir
      const stored = /\.(zip|gz|7z|rar|xz|bz2|jpe?g|png|gif|webp|avif|mp[34]|m4a|mkv|webm|mov|docx|xlsx|pptx|odt|ods|epub|woff2?)$/i.test(f.path);
      entries[f.path] = [data, { level: stored ? 0 : 6 }];
    }
    return new Blob([zipSync(entries)], { type: 'application/zip' });
  }
  if (['7z', 'tar', 'tgz', 'tbz2', 'txz'].includes(to)) return writeWith7zip(files, to, ctx, base);
  return fail(`Salida no soportada: ${to}`);
}

export default {
  id: 'archive',
  routes: [
    {
      from: ARCH_IN,
      to: ARCH_OUT,
      exclude: (from, to) => from === to,
      labels: { unpack: 'Extraer archivos' },
      options: ['password'],
      async run(input, to, ctx) {
        const files = await extract(input, ctx);
        if (to === 'unpack') return files.map((f) => ({ name: f.path, blob: f.file }));
        return writeArchive(files, to, ctx, input.base.replace(/\.tar$/i, ''));
      },
    },
  ],
};

export { writeArchive };
