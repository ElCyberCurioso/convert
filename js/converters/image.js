// Imágenes: decodificación con el navegador (o librerías para TIFF/HEIC/PSD)
// y codificación con canvas, gifenc, UTIF, jSquash (AVIF), ImageTracer (SVG)
// y pdf-lib (PDF).

import { loadUTIF, loadHeic, loadPsd, loadGifenc, loadPdfLib, loadAvif, loadImageTracer } from '../loaders.js';
import { canvasToBlob, fail, UserError } from '../util.js';
import { FORMATS } from '../formats.js';

export const IMAGE_IN = ['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'ico', 'tiff', 'svg', 'heic', 'psd'];
const IMAGE_OUT = ['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'ico', 'tiff', 'svg', 'pdf'];
const MAX_PIXELS = 16_777_216 * 4; // ~67 MP: por encima muchos navegadores fallan

// ---------------------------------------------------------------- decodificación

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new UserError('El navegador no pudo decodificar la imagen (¿archivo dañado o formato no soportado?).'));
    img.src = url;
  });
}

/** Calcula el tamaño final según la opción de redimensionado. */
export function targetSize(w, h, opts = {}) {
  const r = String(opts.resize || 'orig');
  let scale = 1;
  if (r.endsWith('%')) scale = Math.min(4, Math.max(0.01, parseFloat(r) / 100));
  else if (r !== 'orig') {
    const max = parseInt(r, 10);
    if (max > 0) scale = Math.min(1, max / Math.max(w, h));
  }
  let tw = Math.max(1, Math.round(w * scale));
  let th = Math.max(1, Math.round(h * scale));
  if (tw * th > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (tw * th));
    tw = Math.floor(tw * k); th = Math.floor(th * k);
  }
  return [tw, th];
}

function drawScaled(source, sw, sh, opts) {
  const [w, h] = targetSize(sw, sh, opts);
  const c = newCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

async function svgToCanvas(text, opts) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) fail('El SVG no es válido.');
  const num = (v) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN);
  let w = num(svg.getAttribute('width'));
  let h = num(svg.getAttribute('height'));
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (!w && !h) { w = vb[2]; h = vb[3]; }
    else if (!w) w = (h * vb[2]) / vb[3];
    else if (!h) h = (w * vb[3]) / vb[2];
  }
  if (!w || !h) { w = w || 1024; h = h || 1024; }
  // Un SVG sin tamaño se rasteriza al menos a 1024 px por el lado mayor
  if ((opts.resize || 'orig') === 'orig' && Math.max(w, h) < 1024) {
    const k = 1024 / Math.max(w, h); w *= k; h *= k;
  }
  const [tw, th] = targetSize(w, h, opts);
  svg.setAttribute('width', tw);
  svg.setAttribute('height', th);
  if (vb.length !== 4) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url);
    const c = newCanvas(tw, th);
    c.getContext('2d').drawImage(img, 0, 0, tw, th);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

/** Decodifica cualquier imagen soportada a un canvas ya redimensionado. */
export async function decodeToCanvas(input, opts = {}) {
  const f = input.format;
  if (f === 'svg') return svgToCanvas(await input.text(), opts);
  if (f === 'tiff') {
    const UTIF = await loadUTIF();
    const buf = (await input.bytes()).slice().buffer;
    const ifds = UTIF.decode(buf);
    const page = ifds.find((i) => i.t256 && i.t257) || ifds[0];
    if (!page) fail('El TIFF no contiene imágenes.');
    UTIF.decodeImage(buf, page, ifds);
    const rgba = UTIF.toRGBA8(page);
    const c = newCanvas(page.width, page.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, page.width * page.height * 4), page.width, page.height), 0, 0);
    return drawScaled(c, c.width, c.height, opts);
  }
  if (f === 'heic') {
    const { heicTo } = await loadHeic();
    const bmp = await heicTo({ blob: input.file, type: 'bitmap' });
    return drawScaled(bmp, bmp.width, bmp.height, opts);
  }
  if (f === 'psd') {
    const agPsd = await loadPsd();
    const psd = agPsd.readPsd((await input.bytes()).slice().buffer, { skipLayerImageData: true, skipThumbnail: true });
    if (!psd.canvas) fail('El PSD no incluye imagen compuesta (guárdalo con «Maximizar compatibilidad»).');
    return drawScaled(psd.canvas, psd.width, psd.height, opts);
  }
  // Formatos nativos del navegador
  try {
    const bmp = await createImageBitmap(input.file);
    return drawScaled(bmp, bmp.width, bmp.height, opts);
  } catch {
    const url = URL.createObjectURL(input.file);
    try {
      const img = await loadImg(url);
      return drawScaled(img, img.naturalWidth, img.naturalHeight, opts);
    } finally { URL.revokeObjectURL(url); }
  }
}

// ---------------------------------------------------------------- codificación

function flatten(canvas, color = '#ffffff') {
  const c = newCanvas(canvas.width, canvas.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height);

function hasAlpha(c) {
  const d = pixels(c).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

function encodeBMP(canvas) {
  const { width: w, height: h } = canvas;
  const src = pixels(flatten(canvas)).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const out = new Uint8Array(buf);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true);
  dv.setInt32(38, 2835, true);
  dv.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o++] = src[i + 2]; out[o++] = src[i + 1]; out[o++] = src[i];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

async function encodeICO(canvas, opts) {
  const wanted = (opts.icoSizes || '16,24,32,48,64,128,256').split(',').map(Number);
  const side = Math.max(canvas.width, canvas.height);
  const sizes = wanted.filter((s) => s <= Math.max(side, 16));
  if (!sizes.length) sizes.push(16);
  const pngs = [];
  for (const s of sizes) {
    const c = newCanvas(s, s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const k = s / side;
    const w = canvas.width * k, h = canvas.height * k;
    ctx.drawImage(canvas, (s - w) / 2, (s - h) / 2, w, h);
    pngs.push(new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer()));
  }
  const head = new Uint8Array(6 + 16 * sizes.length);
  const dv = new DataView(head.buffer);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, sizes.length, true);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const o = 6 + i * 16;
    head[o] = s >= 256 ? 0 : s;
    head[o + 1] = s >= 256 ? 0 : s;
    dv.setUint16(o + 4, 1, true);
    dv.setUint16(o + 6, 32, true);
    dv.setUint32(o + 8, pngs[i].length, true);
    dv.setUint32(o + 12, offset, true);
    offset += pngs[i].length;
  });
  return new Blob([head, ...pngs], { type: 'image/x-icon' });
}

async function encodeGIF(canvas) {
  const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
  const { data, width, height } = pixels(canvas);
  const alpha = hasAlpha(canvas);
  const format = alpha ? 'rgba4444' : 'rgb565';
  const palette = quantize(data, 256, { format, oneBitAlpha: alpha });
  const index = applyPalette(data, palette, format);
  const gif = GIFEncoder();
  const transparentIndex = alpha ? palette.findIndex((p) => p[3] === 0) : -1;
  gif.writeFrame(index, width, height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
  });
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

async function encodeTIFF(canvas) {
  const UTIF = await loadUTIF();
  const { data, width, height } = pixels(canvas);
  return new Blob([UTIF.encodeImage(data, width, height)], { type: 'image/tiff' });
}

async function encodeAVIF(canvas, q) {
  // Algunos navegadores ya codifican AVIF en canvas; si no, jSquash (libaom en wasm)
  try {
    const b = await canvasToBlob(canvas, 'image/avif', q);
    if (b.type === 'image/avif') return b;
  } catch { /* se usa el codificador wasm */ }
  const encode = await loadAvif();
  const buf = await encode(pixels(canvas), { quality: Math.round(q * 100), speed: 8 });
  return new Blob([buf], { type: 'image/avif' });
}

async function encodeWEBP(canvas, q, ctx) {
  const b = await canvasToBlob(canvas, 'image/webp', q);
  if (b.type === 'image/webp') return b;
  // Safari no codifica WEBP en canvas: se usa libwebp de ffmpeg
  const { runFFmpeg } = await import('./media.js');
  const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
  const [out] = await runFFmpeg({
    inputs: [['in.png', png]],
    args: ['-i', 'in.png', '-c:v', 'libwebp', '-quality', String(Math.round(q * 100)), 'out.webp'],
    outputs: ['out.webp'],
  }, ctx);
  return new Blob([out], { type: 'image/webp' });
}

async function encodeSVG(canvas, opts, ctx) {
  ctx.progress(null, 'Vectorizando…');
  const ImageTracer = await loadImageTracer();
  // Vectorizar es costoso: se limita a 1200 px por el lado mayor
  let c = canvas;
  const side = Math.max(c.width, c.height);
  if (side > 1200) c = drawScaled(c, c.width, c.height, { resize: '1200' });
  const detail = opts.svgDetail || 'normal';
  const presets = {
    bajo: { numberofcolors: 8, pathomit: 16, ltres: 2, qtres: 2, blurradius: 2 },
    normal: { numberofcolors: 24, pathomit: 8, ltres: 1, qtres: 1 },
    alto: { numberofcolors: 64, pathomit: 2, ltres: 0.5, qtres: 0.5, colorquantcycles: 4 },
  };
  const svg = ImageTracer.imagedataToSVG(pixels(c), { ...presets[detail] || presets.normal, viewbox: true, strokewidth: 0 });
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** Codifica un canvas al formato de imagen pedido. */
export async function encodeCanvas(canvas, to, opts = {}, ctx = { progress() {} }) {
  const q = Math.min(1, Math.max(0.05, Number(opts.quality ?? 0.9)));
  switch (to) {
    case 'png': return canvasToBlob(canvas, 'image/png');
    case 'jpg': return canvasToBlob(flatten(canvas, opts.background || '#ffffff'), 'image/jpeg', q);
    case 'webp': return encodeWEBP(canvas, q, ctx);
    case 'avif': return encodeAVIF(canvas, q);
    case 'gif': return encodeGIF(canvas);
    case 'bmp': return encodeBMP(canvas);
    case 'ico': return encodeICO(canvas, opts);
    case 'tiff': return encodeTIFF(canvas);
    case 'svg': return encodeSVG(canvas, opts, ctx);
    default: fail(`Salida de imagen no soportada: ${to}`);
  }
}

// ---------------------------------------------------------------- PDF

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

/** Añade una imagen (canvas o bytes JPEG originales) a un PDFDocument. */
async function addImagePage(pdf, { canvas, jpegBytes }, opts) {
  let image;
  if (jpegBytes) image = await pdf.embedJpg(jpegBytes);
  else {
    const usePng = hasAlpha(canvas) || opts.pdfLossless;
    const blob = usePng ? await canvasToBlob(canvas, 'image/png')
      : await canvasToBlob(flatten(canvas), 'image/jpeg', Math.min(1, Number(opts.quality ?? 0.9)));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    image = usePng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  }
  const size = opts.pdfPage || 'image';
  if (size === 'image') {
    // 96 ppp -> puntos PDF
    const w = (image.width * 72) / 96, h = (image.height * 72) / 96;
    pdf.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
    return;
  }
  let [pw, ph] = PAGE_SIZES[size] || PAGE_SIZES.a4;
  if (image.width > image.height) [pw, ph] = [ph, pw];
  const margin = 28;
  const k = Math.min((pw - 2 * margin) / image.width, (ph - 2 * margin) / image.height);
  const w = image.width * k, h = image.height * k;
  pdf.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}

async function imageSource(input, opts) {
  // Un JPG sin redimensionar se incrusta tal cual: sin pérdida adicional
  if (input.format === 'jpg' && (opts.resize || 'orig') === 'orig') return { jpegBytes: await input.bytes() };
  return { canvas: await decodeToCanvas(input, opts) };
}

/** Une varias imágenes y PDF en un solo PDF (acción «Unir en un PDF»). */
export async function mergeToPdf(inputs, ctx) {
  const { PDFDocument } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  let i = 0;
  for (const input of inputs) {
    ctx.progress(i++ / inputs.length, `Añadiendo ${input.name}`);
    if (input.format === 'pdf') {
      const src = await PDFDocument.load(await input.bytes(), { ignoreEncryption: true });
      const pages = await pdf.copyPages(src, src.getPageIndices());
      pages.forEach((p) => pdf.addPage(p));
    } else {
      await addImagePage(pdf, await imageSource(input, ctx.opts), ctx.opts);
    }
  }
  pdf.setProducer('Transmuta');
  pdf.setCreator('Transmuta');
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

// ---------------------------------------------------------------- rutas

export default {
  id: 'image',
  routes: [
    {
      from: IMAGE_IN,
      to: IMAGE_OUT,
      allowSame: true,
      exclude: (from, to) => (from === to && !['png', 'jpg', 'webp', 'avif'].includes(to)) || (from === 'svg' && to === 'svg'),
      labels: { svg: 'SVG (vectorizado)' },
      options: ['quality', 'resize', 'background', 'icoSizes', 'svgDetail', 'pdfPage'],
      async run(input, to, ctx) {
        const opts = ctx.opts;
        ctx.progress(null, 'Decodificando imagen…');
        if (to === 'pdf') {
          const { PDFDocument } = await loadPdfLib();
          const pdf = await PDFDocument.create();
          await addImagePage(pdf, await imageSource(input, opts), opts);
          pdf.setProducer('Transmuta');
          return new Blob([await pdf.save()], { type: 'application/pdf' });
        }
        const canvas = await decodeToCanvas(input, opts);
        ctx.progress(null, `Codificando ${FORMATS[to].label}…`);
        return encodeCanvas(canvas, to, opts, ctx);
      },
    },
  ],
};
