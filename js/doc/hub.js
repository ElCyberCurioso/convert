// Representación intermedia de documentos.
//
// Todos los lectores producen un «hub»: { doc: Document HTML inerte, title }.
// Los escritores de HTML/Markdown/EPUB usan el DOM directamente; los de
// TXT, DOCX, ODT, RTF y PDF trabajan sobre un modelo de bloques más simple
// que se obtiene con domToBlocks().

import { dataURLToBytes } from '../util.js';

const DROP = 'script,style,iframe,frame,frameset,object,embed,link,meta,noscript,template,base,form,input,button,select,textarea,canvas,audio,video,source,track,applet,svg,math';

/** Crea un documento HTML inerte (DOMParser no ejecuta scripts ni carga recursos). */
export function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Limpia el DOM: quita elementos activos, manejadores de eventos y URLs peligrosas. */
export function cleanDoc(doc) {
  doc.querySelectorAll(DROP).forEach((n) => n.remove());
  for (const el of doc.body.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'style' || n === 'srcset' || n === 'class' && !/^language-/.test(a.value)) {
        el.removeAttribute(a.name);
      } else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) {
        el.removeAttribute(a.name);
      }
    }
  }
  return doc;
}

export function makeHub(html, title) {
  const doc = cleanDoc(parseHtml(html));
  const t = title || doc.querySelector('title')?.textContent?.trim() || doc.querySelector('h1')?.textContent?.trim() || '';
  return { doc, title: t.slice(0, 200) };
}

export const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- bloques
//
// Bloques: h{level,runs} p{runs} list{ordered,start,items:[blocks[]]} code{text}
//          quote{blocks} hr img{src,alt} table{rows:[[{runs,header}]]} pagebreak
// Runs:    {text,b,i,u,s,code,href,sup,sub} | {br:true}

const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FIGURE',
  'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'HR', 'TABLE', 'DL', 'DT', 'DD',
  'ADDRESS', 'DETAILS', 'SUMMARY', 'CENTER', 'BODY', 'HTML']);

function inlineStyle(el, st) {
  const t = el.tagName;
  const s = { ...st };
  if (t === 'B' || t === 'STRONG' || t === 'TH' || t === 'DT' || t === 'SUMMARY') s.b = true;
  if (t === 'I' || t === 'EM' || t === 'CITE' || t === 'DFN' || t === 'VAR') s.i = true;
  if (t === 'U' || t === 'INS') s.u = true;
  if (t === 'S' || t === 'STRIKE' || t === 'DEL') s.s = true;
  if (t === 'CODE' || t === 'KBD' || t === 'SAMP' || t === 'TT') s.code = true;
  if (t === 'SUP') s.sup = true;
  if (t === 'SUB') s.sub = true;
  if (t === 'A' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) s.href = el.getAttribute('href');
  return s;
}

/** Une runs contiguos con el mismo estilo y colapsa espacios. */
function normalizeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (r.br) { out.push(r); continue; }
    let text = r.text.replace(/[\s ]+/g, (m) => (m.includes(' ') && !/[\n\t ]/.test(m) ? m : ' '));
    const prev = out[out.length - 1];
    if (!prev || prev.br || /\s$/.test(prev.text)) text = text.replace(/^ +/, '');
    if (!text) continue;
    const same = prev && !prev.br && ['b', 'i', 'u', 's', 'code', 'href', 'sup', 'sub'].every((k) => (prev[k] || false) === (r[k] || false));
    if (same) prev.text += text;
    else out.push({ ...r, text });
  }
  // recorta espacio final y saltos sobrantes
  while (out.length && out[out.length - 1].br) out.pop();
  const last = out[out.length - 1];
  if (last) last.text = last.text.replace(/ +$/, '');
  return out.filter((r) => r.br || r.text);
}

export const runsText = (runs) => runs.map((r) => (r.br ? '\n' : r.text)).join('');

/** Convierte un subárbol DOM en una lista de bloques. */
export function domToBlocks(root) {
  const blocks = [];
  let runs = [];

  const flush = () => {
    const r = normalizeRuns(runs);
    if (r.length) blocks.push({ t: 'p', runs: r });
    runs = [];
  };

  const walkInline = (node, st) => {
    if (node.nodeType === 3) { runs.push({ ...st, text: node.data }); return; }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName;
    if (tag === 'BR') { runs.push({ br: true }); return; }
    if (tag === 'IMG') {
      flush();
      if (el.getAttribute('src')) blocks.push({ t: 'img', src: el.getAttribute('src'), alt: el.getAttribute('alt') || '' });
      return;
    }
    if (el.hasAttribute('data-pagebreak')) { flush(); blocks.push({ t: 'pagebreak' }); return; }
    if (BLOCK_TAGS.has(tag)) { flush(); blocks.push(...domToBlocks(el)); return; }
    const s = inlineStyle(el, st);
    for (const c of el.childNodes) walkInline(c, s);
  };

  for (const node of root.childNodes) {
    if (node.nodeType === 3) { runs.push({ text: node.data }); continue; }
    if (node.nodeType !== 1) continue;
    const el = node;
    const tag = el.tagName;
    if (el.hasAttribute('data-pagebreak')) { flush(); blocks.push({ t: 'pagebreak' }); continue; }
    if (/^H[1-6]$/.test(tag)) {
      flush();
      const saved = runs; runs = [];
      for (const c of el.childNodes) walkInline(c, {});
      const r = normalizeRuns(runs); runs = saved;
      if (r.length) blocks.push({ t: 'h', level: Number(tag[1]), runs: r });
      continue;
    }
    switch (tag) {
      case 'UL': case 'OL': {
        flush();
        const items = [];
        for (const li of el.children) {
          if (li.tagName !== 'LI') continue;
          const b = domToBlocks(li);
          const box = li.querySelector(':scope > input[type=checkbox]');
          if (box && b[0]?.t === 'p') b[0].runs.unshift({ text: box.checked ? '☑ ' : '☐ ' });
          items.push(b.length ? b : [{ t: 'p', runs: [{ text: '' }] }]);
        }
        if (items.length) blocks.push({ t: 'list', ordered: tag === 'OL', start: Number(el.getAttribute('start')) || 1, items });
        break;
      }
      case 'PRE': flush(); blocks.push({ t: 'code', text: el.textContent.replace(/\n$/, '') }); break;
      case 'BLOCKQUOTE': {
        flush();
        const inner = domToBlocks(el);
        if (inner.length) blocks.push({ t: 'quote', blocks: inner });
        break;
      }
      case 'HR': flush(); blocks.push({ t: 'hr' }); break;
      case 'IMG': flush(); if (el.getAttribute('src')) blocks.push({ t: 'img', src: el.getAttribute('src'), alt: el.getAttribute('alt') || '' }); break;
      case 'TABLE': {
        flush();
        const rows = [];
        for (const tr of el.querySelectorAll('tr')) {
          if (tr.closest('table') !== el) continue;
          const cells = [];
          for (const td of tr.children) {
            if (td.tagName !== 'TD' && td.tagName !== 'TH') continue;
            const saved = runs; runs = [];
            const inner = domToBlocks(td);
            // celdas: se aplanan los bloques en runs con saltos de línea
            const cellRuns = [];
            inner.forEach((b, i) => {
              if (i) cellRuns.push({ br: true });
              if (b.runs) cellRuns.push(...b.runs.map((r) => (td.tagName === 'TH' && !r.br ? { ...r, b: true } : r)));
              else if (b.t === 'code') cellRuns.push({ text: b.text, code: true });
              else if (b.t === 'list') b.items.forEach((it, j) => { if (j) cellRuns.push({ br: true }); cellRuns.push({ text: '• ' }, ...(it[0]?.runs || [])); });
            });
            runs = saved;
            cells.push({ runs: cellRuns, header: td.tagName === 'TH' });
          }
          if (cells.length) rows.push(cells);
        }
        if (rows.length) blocks.push({ t: 'table', rows });
        break;
      }
      case 'DT': flush(); for (const c of el.childNodes) walkInline(c, { b: true }); flush(); break;
      default:
        if (BLOCK_TAGS.has(tag)) { flush(); blocks.push(...domToBlocks(el)); }
        else walkInline(el, {});
    }
  }
  flush();
  return blocks;
}

export const hubBlocks = (hub) => domToBlocks(hub.doc.body);

// ---------------------------------------------------------------- imágenes

/**
 * Devuelve { bytes, mime, width, height } de una imagen del documento, convirtiendo
 * a PNG lo que no sea PNG/JPEG. Solo se aceptan data: y blob: (nunca se descarga
 * nada de internet). `accept` = tipos admitidos sin conversión.
 */
export async function imageData(src, accept = ['image/png', 'image/jpeg']) {
  let bytes, mime;
  if (src.startsWith('data:')) {
    const d = dataURLToBytes(src);
    if (!d) return null;
    ({ bytes, mime } = d);
  } else if (src.startsWith('blob:')) {
    const b = await (await fetch(src)).blob();
    bytes = new Uint8Array(await b.arrayBuffer()); mime = b.type;
  } else return null;
  mime = (mime || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  let bmp;
  try { bmp = await createImageBitmap(new Blob([bytes], { type: mime })); } catch {
    if (mime !== 'image/svg+xml') return null;
  }
  if (!bmp) {
    // SVG: se rasteriza con <img>
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    } catch { return null; } finally { URL.revokeObjectURL(url); }
  }
  const width = bmp.width || bmp.naturalWidth || 1;
  const height = bmp.height || bmp.naturalHeight || 1;
  if (!accept.includes(mime)) {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    bytes = new Uint8Array(await blob.arrayBuffer()); mime = 'image/png';
  }
  return { bytes, mime, width, height };
}

export const extForMime = (m) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' }[m] || 'bin');
