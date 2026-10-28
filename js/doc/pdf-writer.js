// Maquetador de PDF sobre pdf-lib: texto real (seleccionable), fuentes DejaVu
// incrustadas (Unicode), encabezados, listas, tablas, código, citas, imágenes,
// enlaces activos y numeración de páginas.

import { loadPdfLib, loadFontkit, loadFontBytes } from '../loaders.js';
import { hubBlocks, runsText, imageData } from './hub.js';

const FONT_FILES = { r: 'DejaVuSans.ttf', b: 'DejaVuSans-Bold.ttf', i: 'DejaVuSans-Oblique.ttf', bi: 'DejaVuSans-BoldOblique.ttf', m: 'DejaVuSansMono.ttf' };
const PAGES = { a4: [595.28, 841.89], letter: [612, 792] };
const H_SIZES = [0, 21, 16.5, 13.5, 12, 11, 10.5];
const BODY = 10.5;

function collectFonts(blocks, set = new Set(['r'])) {
  for (const b of blocks) {
    if (b.t === 'h') set.add('b');
    if (b.t === 'code') set.add('m');
    for (const r of b.runs || []) {
      if (r.code) set.add('m'); else if (r.b && r.i) set.add('bi'); else if (r.b) set.add('b'); else if (r.i) set.add('i');
    }
    if (b.t === 'list') b.items.forEach((it) => collectFonts(it, set));
    if (b.t === 'quote') { set.add('i'); collectFonts(b.blocks, set); }
    if (b.t === 'table') b.rows.forEach((r) => r.forEach((c) => { if (c.header) set.add('b'); collectFonts([{ runs: c.runs }], set); }));
    if (b.t === 'img') set.add('i');
  }
  return set;
}

function collectImages(blocks, out = []) {
  for (const b of blocks) {
    if (b.t === 'img') out.push(b.src);
    if (b.t === 'list') b.items.forEach((it) => collectImages(it, out));
    if (b.t === 'quote') collectImages(b.blocks, out);
  }
  return out;
}

export async function writePdf(hub, opts = {}) {
  const { PDFDocument, rgb, PDFString, PDFName } = await loadPdfLib();
  const fontkit = await loadFontkit();
  const blocks = hubBlocks(hub);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const C = {
    text: rgb(0.11, 0.11, 0.12), muted: rgb(0.42, 0.42, 0.46), link: rgb(0.02, 0.36, 0.74),
    codeBg: rgb(0.953, 0.953, 0.962), border: rgb(0.77, 0.77, 0.81), thBg: rgb(0.93, 0.93, 0.95), bar: rgb(0.78, 0.78, 0.83),
  };

  // Fuentes: solo se incrustan (como subconjunto) las que se usan
  const F = {}; const charset = {};
  for (const k of collectFonts(blocks)) {
    F[k] = await pdf.embedFont(await loadFontBytes(FONT_FILES[k]), { subset: true });
    charset[k] = new Set(F[k].getCharacterSet());
  }
  const font = (k) => F[k] || F.r;
  const clean = (text, k) => {
    const set = charset[k] || charset.r;
    let out = '';
    for (const ch of text) out += set.has(ch.codePointAt(0)) ? ch : (ch === ' ' ? ' ' : '?');
    return out;
  };

  // Imágenes (solo data:/blob:, nunca se descarga nada)
  const images = new Map();
  for (const src of new Set(collectImages(blocks))) {
    try {
      const d = await imageData(src);
      if (!d) continue;
      const img = d.mime === 'image/png' ? await pdf.embedPng(d.bytes) : await pdf.embedJpg(d.bytes);
      images.set(src, { img, w: d.width, h: d.height });
    } catch { /* imagen ilegible: se omite */ }
  }

  // Geometría de página
  let [PW, PH] = PAGES[opts.pdfPage] || PAGES.a4;
  const wide = blocks.some((b) => b.t === 'table' && Math.max(...b.rows.map((r) => r.length)) > 7);
  if (opts.pdfOrientation === 'landscape' || (opts.pdfOrientation !== 'portrait' && wide)) [PW, PH] = [PH, PW];
  const M = 56;
  const CW = PW - 2 * M;
  const pages = [];
  let page, y;
  const newPage = () => { page = pdf.addPage([PW, PH]); pages.push(page); y = PH - M; };
  const atTop = () => y >= PH - M - 0.5;
  const ensure = (h) => { if (y - h < M && !atTop()) newPage(); };
  newPage();

  const addLink = (x1, y1, x2, y2, url) => {
    try {
      const annot = pdf.context.register(pdf.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [x1, y1, x2, y2], Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
      }));
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (annots) annots.push(annot); else page.node.set(PDFName.of('Annots'), pdf.context.obj([annot]));
    } catch { /* enlace no válido */ }
  };

  // ---- maquetación de líneas
  const keyOf = (r, base) => {
    if (r.code || base.code) return 'm';
    const b = r.b || base.b, i = r.i || base.i;
    return b && i ? 'bi' : b ? 'b' : i ? 'i' : 'r';
  };

  function layout(runs, { size, width, base = {}, color = C.text }) {
    const lines = [];
    let line = [], lw = 0, space = null;
    const push = () => {
      // fusiona piezas contiguas con el mismo estilo
      const merged = [];
      for (const it of line) {
        const p = merged[merged.length - 1];
        if (p && p.key === it.key && p.size === it.size && p.color === it.color && p.href === it.href && p.u === it.u && p.s === it.s && p.rise === it.rise) {
          p.text += it.text; p.w += it.w;
        } else merged.push({ ...it });
      }
      lines.push({ items: merged, width: lw });
      line = []; lw = 0; space = null;
    };
    for (const r of runs) {
      if (r.br) { push(); continue; }
      const key = keyOf(r, base);
      const f = font(key);
      const sz = r.sup || r.sub ? size * 0.7 : size;
      const st = { key, size: sz, color: r.href ? C.link : color, href: r.href, u: !!(r.u || r.href), s: !!r.s, rise: r.sup ? size * 0.33 : r.sub ? -size * 0.15 : 0 };
      const text = clean(r.text.replace(/\t/g, '    '), key);
      for (let tok of text.split(/( +)/)) {
        if (!tok) continue;
        if (tok[0] === ' ') { if (line.length) space = { ...st, text: tok, w: f.widthOfTextAtSize(tok, sz) }; continue; }
        let w = f.widthOfTextAtSize(tok, sz);
        const sw = space ? space.w : 0;
        if (line.length && lw + sw + w > width) push();
        else if (space) { line.push(space); lw += sw; }
        space = null;
        if (w > width) {
          // palabra más larga que la línea: se corta por caracteres
          let chunk = '', cw = 0;
          for (const ch of tok) {
            const chw = f.widthOfTextAtSize(ch, sz);
            if (cw + chw > width - lw && chunk) { line.push({ ...st, text: chunk, w: cw }); lw += cw; push(); chunk = ''; cw = 0; }
            chunk += ch; cw += chw;
          }
          tok = chunk; w = cw;
        }
        line.push({ ...st, text: tok, w }); lw += w;
      }
    }
    if (line.length || !lines.length) push();
    return lines;
  }

  const lineBox = (ln, size, lh) => {
    const max = Math.max(size, ...ln.items.map((i) => i.size));
    return { max, h: max * lh };
  };

  function drawLine(ln, x, baseline) {
    let cx = x;
    for (const it of ln.items) {
      if (it.text.trim()) {
        page.drawText(it.text, { x: cx, y: baseline + it.rise, size: it.size, font: font(it.key), color: it.color });
        if (it.u) page.drawLine({ start: { x: cx, y: baseline - it.size * 0.12 }, end: { x: cx + it.w, y: baseline - it.size * 0.12 }, thickness: 0.5, color: it.color });
        if (it.s) page.drawLine({ start: { x: cx, y: baseline + it.size * 0.3 }, end: { x: cx + it.w, y: baseline + it.size * 0.3 }, thickness: 0.6, color: it.color });
        if (it.href && /^(https?:|mailto:)/i.test(it.href)) addLink(cx, baseline - it.size * 0.25, cx + it.w, baseline + it.size * 0.85, it.href);
      }
      cx += it.w;
    }
  }

  function drawLines(lines, { x, size, lh = 1.45, marker, keep = 1 }) {
    lines.forEach((ln, idx) => {
      const box = lineBox(ln, size, lh);
      ensure(idx === 0 ? box.h * Math.min(keep, lines.length) : box.h);
      const baseline = y - box.h + (box.h - 1.17 * box.max) / 2 + 0.24 * box.max;
      if (idx === 0 && marker) {
        const mk = clean(marker, 'r');
        const mw = font('r').widthOfTextAtSize(mk, size);
        page.drawText(mk, { x: x - mw - 5, y: baseline, size, font: font('r'), color: C.text });
      }
      drawLine(ln, x, baseline);
      y -= box.h;
    });
  }

  // ---- tablas
  function drawTable(b, { x, width }) {
    const cols = Math.max(...b.rows.map((r) => r.length));
    const fs = cols <= 4 ? 9.5 : cols <= 7 ? 8.5 : cols <= 10 ? 7.5 : 6.5;
    const pad = 4;
    const natural = new Array(cols).fill(2 * pad + 10), minw = new Array(cols).fill(2 * pad + 10);
    for (const r of b.rows) {
      r.forEach((c, i) => {
        const k = c.header ? 'b' : 'r';
        const f = font(k);
        for (const l of runsText(c.runs).split('\n')) natural[i] = Math.max(natural[i], Math.min(width * 0.6, f.widthOfTextAtSize(clean(l, k), fs) + 2 * pad));
        for (const wd of runsText(c.runs).split(/\s+/)) minw[i] = Math.max(minw[i], Math.min(width / 3, f.widthOfTextAtSize(clean(wd, k), fs) + 2 * pad));
      });
    }
    const total = natural.reduce((a, v) => a + v, 0);
    let widths;
    if (total <= width) widths = natural.map((n) => (n / total) * width);
    else {
      const base = minw.map((m) => Math.min(m, width / cols));
      const rest = width - base.reduce((a, v) => a + v, 0);
      const extra = natural.map((n, i) => Math.max(0, n - base[i]));
      const se = extra.reduce((a, v) => a + v, 0);
      widths = rest > 0 ? base.map((bw, i) => bw + (se ? (extra[i] / se) * rest : rest / cols)) : new Array(cols).fill(width / cols);
    }
    const headerRows = [];
    for (const r of b.rows) { if (r.length && r.every((c) => c.header)) headerRows.push(r); else break; }

    const drawRow = (r, isRepeat) => {
      const cells = Array.from({ length: cols }, (_, i) => r[i] || { runs: [] });
      const ls = cells.map((c, i) => layout(c.runs, { size: fs, width: widths[i] - 2 * pad, base: c.header ? { b: true } : {} }));
      const lh = fs * 1.35;
      const rowH = Math.max(...ls.map((l) => l.length)) * lh + 2 * pad;
      if (y - rowH < M && !atTop()) {
        newPage();
        if (!isRepeat && headerRows.length && !headerRows.includes(r)) headerRows.forEach((h) => drawRow(h, true));
      }
      let cx = x;
      cells.forEach((c, i) => {
        page.drawRectangle({ x: cx, y: y - rowH, width: widths[i], height: rowH, color: c.header ? C.thBg : undefined, borderColor: C.border, borderWidth: 0.5 });
        let ty = y - pad;
        for (const ln of ls[i]) { drawLine(ln, cx + pad, ty - lh + (lh - 1.17 * fs) / 2 + 0.24 * fs); ty -= lh; }
        cx += widths[i];
      });
      y -= rowH;
    };
    for (const r of b.rows) drawRow(r, false);
    y -= 10;
  }

  // ---- bloques
  async function render(list, ctx) {
    for (const b of list) {
      const marker = ctx.marker; ctx.marker = null;
      switch (b.t) {
        case 'h': {
          const size = H_SIZES[b.level] || BODY;
          if (!atTop()) y -= size * 0.8;
          const lines = layout(b.runs, { size, width: ctx.width, base: { b: true }, color: ctx.color });
          // el encabezado nunca se queda solo al final de la página
          ensure(size * 1.3 * lines.length + BODY * 3);
          drawLines(lines, { x: ctx.x, size, lh: 1.3, marker });
          y -= size * 0.35;
          break;
        }
        case 'p': {
          const lines = layout(b.runs, { size: BODY, width: ctx.width, base: ctx.quote ? { i: true } : {}, color: ctx.color });
          drawLines(lines, { x: ctx.x, size: BODY, marker, keep: 2 });
          y -= ctx.tight ? 2 : 6;
          break;
        }
        case 'list': {
          const ind = 18;
          for (const [i, item] of b.items.entries()) {
            const mk = b.ordered ? `${b.start + i}.` : ['•', '◦', '▪'][(ctx.level || 0) % 3];
            await render(item, { ...ctx, x: ctx.x + ind, width: ctx.width - ind, marker: mk, level: (ctx.level || 0) + 1, tight: true });
          }
          y -= 4;
          break;
        }
        case 'code': {
          const size = 8.8, lh = size * 1.42, pad = 6;
          const f = font('m');
          const cw = f.widthOfTextAtSize('M', size);
          const maxChars = Math.max(10, Math.floor((ctx.width - 2 * pad) / cw));
          const vis = [];
          for (const raw of b.text.replace(/\t/g, '    ').split('\n')) {
            const l = clean(raw, 'm');
            if (!l.length) vis.push('');
            for (let k = 0; k < l.length; k += maxChars) vis.push(l.slice(k, k + maxChars));
          }
          ensure(lh * Math.min(3, vis.length) + 2 * pad);
          page.drawRectangle({ x: ctx.x, y: y - pad, width: ctx.width, height: pad, color: C.codeBg });
          y -= pad;
          for (const l of vis) {
            if (y - lh < M) { newPage(); }
            page.drawRectangle({ x: ctx.x, y: y - lh, width: ctx.width, height: lh, color: C.codeBg });
            if (l.trim()) page.drawText(l, { x: ctx.x + pad, y: y - lh + (lh - 1.17 * size) / 2 + 0.24 * size, size, font: f, color: C.text });
            y -= lh;
          }
          page.drawRectangle({ x: ctx.x, y: y - pad, width: ctx.width, height: pad, color: C.codeBg });
          y -= pad + 8;
          break;
        }
        case 'quote': {
          const startPage = pages.length - 1, startY = y;
          await render(b.blocks, { ...ctx, x: ctx.x + 14, width: ctx.width - 14, quote: true, color: C.muted });
          for (let p = startPage; p < pages.length; p++) {
            const top = p === startPage ? startY : PH - M;
            const bottom = p === pages.length - 1 ? y + 4 : M;
            pages[p].drawLine({ start: { x: ctx.x + 3, y: top }, end: { x: ctx.x + 3, y: bottom }, thickness: 2, color: C.bar });
          }
          y -= 4;
          break;
        }
        case 'hr':
          ensure(14); y -= 7;
          page.drawLine({ start: { x: ctx.x, y }, end: { x: ctx.x + ctx.width, y }, thickness: 0.6, color: C.border });
          y -= 7;
          break;
        case 'pagebreak': if (!atTop()) newPage(); break;
        case 'img': {
          const im = images.get(b.src);
          if (!im) {
            drawLines(layout([{ text: `[Imagen${b.alt ? `: ${b.alt}` : ''}]`, i: true }], { size: BODY, width: ctx.width, color: C.muted }), { x: ctx.x, size: BODY });
            y -= 6; break;
          }
          let w = im.w * 0.75, h = im.h * 0.75;
          const k = Math.min(1, ctx.width / w, (PH - 2 * M) / h);
          w *= k; h *= k;
          ensure(h + 4);
          page.drawImage(im.img, { x: ctx.x + (ctx.width - w) / 2, y: y - h, width: w, height: h });
          y -= h + 10;
          break;
        }
        case 'table': drawTable(b, ctx); break;
        default: break;
      }
    }
  }

  await render(blocks, { x: M, width: CW, color: C.text, level: 0 });

  // Numeración de páginas
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const t = `${i + 1} / ${pages.length}`;
      const w = font('r').widthOfTextAtSize(t, 8);
      p.drawText(t, { x: (PW - w) / 2, y: M / 2 - 4, size: 8, font: font('r'), color: C.muted });
    });
  }
  if (hub.title) pdf.setTitle(hub.title);
  pdf.setProducer('Converter');
  pdf.setCreator('Converter');
  pdf.setLanguage?.(opts.lang || 'es');
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
