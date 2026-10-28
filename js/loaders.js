// Carga perezosa de librerías: solo se descarga lo que hace falta
// para la conversión que se va a hacer.

export const VENDOR = new URL('../vendor/', import.meta.url).href;

const cache = new Map();
function once(key, fn) {
  if (!cache.has(key)) {
    cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

/** Carga un script clásico (UMD) y devuelve la global que define. */
function script(path, globalName) {
  return once('script:' + path, () => new Promise((resolve, reject) => {
    if (globalThis[globalName]) return resolve(globalThis[globalName]);
    const s = document.createElement('script');
    s.src = VENDOR + path;
    s.async = true;
    s.onload = () => (globalThis[globalName] ? resolve(globalThis[globalName])
      : reject(new Error(`${path} no definió ${globalName}`)));
    s.onerror = () => reject(new Error(`No se pudo cargar ${path}`));
    document.head.append(s);
  }));
}

const esm = (path) => once('esm:' + path, () => import(VENDOR + path));

export const loadFflate = () => esm('fflate/fflate.js');
export const loadPdfLib = () => esm('pdf-lib/pdf-lib.esm.min.js');
export const loadFontkit = () => esm('fontkit/fontkit.es.min.js').then((m) => m.default || m);
export const loadMarked = () => esm('marked/marked.esm.js');
export const loadTurndown = () => esm('turndown/turndown.browser.es.js').then((m) => m.default);
export const loadGfm = () => esm('turndown/gfm.js');
export const loadAvif = () => esm('avif/encode.js').then((m) => m.default);
export const loadImageTracer = () => script('imagetracer/imagetracer.js', 'ImageTracer');
export const loadDocx = () => esm('docx/docx.mjs');
export const loadYaml = () => esm('js-yaml/js-yaml.esm.min.mjs');
export const loadToml = () => esm('smol-toml/index.js');
export const loadGifenc = () => esm('gifenc/gifenc.esm.js');
export const loadHeic = () => esm('heic-to/heic-to.js');
// WOFF2 se ejecuta en un Worker (ver js/workers/woff2.worker.js)
export const loadWoff2 = () => once('woff2', async () => {
  const worker = new Worker(new URL('./workers/woff2.worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let n = 0;
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error)); else p.resolve(data.out);
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'Error en el worker WOFF2')); pending.clear(); };
  const call = (op, bytes) => new Promise((resolve, reject) => {
    const id = ++n;
    pending.set(id, { resolve, reject });
    const copy = bytes.slice();
    worker.postMessage({ id, op, bytes: copy }, [copy.buffer]);
  });
  return { compress: (b) => call('compress', b), decompress: (b) => call('decompress', b) };
});
export const loadMammoth = () => script('mammoth/mammoth.browser.min.js', 'mammoth');
export const loadXLSX = () => script('xlsx/xlsx.full.min.js', 'XLSX');
export const loadXmlParser = () => script('fast-xml-parser/fxp.min.js', 'fxp');
export const loadPsd = () => script('ag-psd/ag-psd.js', 'agPsd');
export const loadBz2 = () => script('bz2/bz2.js', 'bz2');
export const loadXz = () => script('xz/xz-decompress.js', 'xz-decompress');

export const loadUTIF = () => once('utif', async () => {
  // UTIF.js espera `pako` global para TIFF con compresión Deflate: se le da fflate
  const fflate = await loadFflate();
  globalThis.pako ??= { inflateRaw: (d) => fflate.inflateSync(d) };
  return script('utif/UTIF.js', 'UTIF');
});

export const loadPdfjs = () => once('pdfjs', async () => {
  const pdfjs = await import(VENDOR + 'pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.mjs';
  return pdfjs;
});

/** Abre un PDF con pdf.js con las rutas de recursos auto-alojadas. */
export async function openPdf(bytes) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({
    data: bytes,
    cMapUrl: VENDOR + 'pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: VENDOR + 'pdfjs/standard_fonts/',
    wasmUrl: VENDOR + 'pdfjs/wasm/',
    isEvalSupported: false,
    enableXfa: false,
  }).promise;
}

export const loadLibarchive = () => once('libarchive', async () => {
  const mod = await esm('libarchive/libarchive.js');
  mod.Archive.init({ workerUrl: VENDOR + 'libarchive/worker-bundle.js' });
  return mod;
});

export const loadFontBytes = (file) => once('font:' + file, async () => {
  const res = await fetch(VENDOR + 'fonts/' + file);
  if (!res.ok) throw new Error(`No se pudo cargar la fuente ${file}`);
  return new Uint8Array(await res.arrayBuffer());
});
