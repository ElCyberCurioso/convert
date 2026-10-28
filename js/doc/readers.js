// Lectores de documentos: cada uno produce un hub { doc, title }.

import { loadMarked, loadMammoth, loadFflate, openPdf } from '../loaders.js';
import { makeHub, escapeText } from './hub.js';
import { decodeText, fail, bytesToBase64 } from '../util.js';

const u8 = (s) => new TextDecoder('utf-8').decode(s);
const xml = (s) => {
  const d = new DOMParser().parseFromString(s, 'application/xml');
  if (d.querySelector('parsererror')) fail('XML interno no válido: el archivo puede estar dañado.');
  return d;
};
const mimeOf = (path) => {
  const e = path.toLowerCase().split('.').pop();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[e] || 'application/octet-stream';
};
const dataUri = (bytes, mime) => `data:${mime};base64,${bytesToBase64(bytes)}`;
const resolvePath = (base, rel) => {
  const parts = base.split('/').slice(0, -1);
  for (const p of decodeURIComponent(rel.split('#')[0]).split('/')) {
    if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
};

// ---------------------------------------------------------------- texto

export async function readMarkdown(text) {
  const { marked } = await loadMarked();
  const html = marked.parse(text, { gfm: true, async: false });
  return makeHub(`<body>${html}</body>`);
}

export function readText(text) {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim());
  const html = paras.map((p) => `<p>${escapeText(p).replace(/\t/g, '    ').replace(/\n/g, '<br>')}</p>`).join('\n');
  return makeHub(`<body>${html}</body>`);
}

export const readHtml = (text) => makeHub(text);

// ---------------------------------------------------------------- DOCX

export async function readDocx(bytes) {
  const mammoth = await loadMammoth();
  const res = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer }, {
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Título'] => h1:fresh",
      "p[style-name='Subtitle'] => h2:fresh",
      "p[style-name='Subtítulo'] => h2:fresh",
      "p[style-name='Quote'] => blockquote:fresh",
      "p[style-name='Cita'] => blockquote:fresh",
    ],
  });
  return makeHub(`<body>${res.value}</body>`);
}

// ---------------------------------------------------------------- PDF

export async function readPdf(bytes, ctx) {
  const pdf = await openPdf(bytes.slice());
  const pages = [];
  const sizes = new Map(); // tamaño -> nº de caracteres
  for (let p = 1; p <= pdf.numPages; p++) {
    ctx?.progress?.(p / pdf.numPages, `Leyendo página ${p} de ${pdf.numPages}`);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const lines = [];
    let cur = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const size = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10 || it.height || 10;
      const y = it.transform[5];
      const x = it.transform[4];
      if (!cur || (it.str.trim() && Math.abs(cur.y - y) > Math.max(cur.size, size) * 0.6)) {
        if (cur && cur.text.trim()) lines.push(cur);
        cur = { text: '', y, x, size, right: x };
      }
      cur.text += it.str;
      if (it.str.trim()) {
        cur.size = Math.max(cur.size, size);
        cur.right = Math.max(cur.right, x + (it.width || 0));
        sizes.set(size, (sizes.get(size) || 0) + it.str.length);
      }
      if (it.hasEOL) { if (cur.text.trim()) lines.push(cur); cur = null; }
    }
    if (cur && cur.text.trim()) lines.push(cur);
    pages.push(lines);
    page.cleanup();
  }
  await (pdf.loadingTask?.destroy?.() ?? pdf.destroy?.());
  if (!pages.some((l) => l.length)) {
    fail('El PDF no contiene texto seleccionable (¿es un escaneo?). Prueba a convertirlo a PNG/JPG.');
  }
  const body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  const headingSizes = [...sizes.keys()].filter((s) => s >= body * 1.18).sort((a, b) => b - a);
  const level = (s) => (s >= body * 1.18 ? Math.min(3, headingSizes.indexOf(s) + 1 || 3) : 0);

  const out = [];
  pages.forEach((lines, pi) => {
    if (pi) out.push('<div data-pagebreak></div>');
    const maxRight = Math.max(...lines.map((l) => l.right), 0);
    let para = null;
    const close = () => {
      if (!para) return;
      const t = escapeText(para.text.replace(/\s+/g, ' ').trim());
      if (t) out.push(para.level ? `<h${para.level}>${t}</h${para.level}>` : `<p>${t}</p>`);
      para = null;
    };
    lines.forEach((l, i) => {
      const lv = l.text.trim().length < 200 ? level(l.size) : 0;
      const prev = lines[i - 1];
      const gap = prev ? prev.y - l.y : 0;
      const newPara = !para || lv !== para.level || Math.abs(l.size - para.size) > para.size * 0.15
        || gap > l.size * 1.75 || gap < 0
        || (prev && prev.right < maxRight * 0.72 && /[.:!?»”"]$/.test(prev.text.trim()))
        || /^\s*([•·▪‣◦\-–—*]|\d+[.)])\s/.test(l.text);
      if (newPara) { close(); para = { text: l.text.trim(), level: lv, size: l.size }; return; }
      if (/[a-záéíóúñü]-$/i.test(para.text) && /^[a-záéíóúñü]/.test(l.text.trim())) para.text = para.text.slice(0, -1) + l.text.trim();
      else para.text += ' ' + l.text.trim();
    });
    close();
  });
  return makeHub(`<body>${out.join('\n')}</body>`);
}

// ---------------------------------------------------------------- ODT

const NS = {
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  dc: 'http://purl.org/dc/elements/1.1/',
};

export async function readOdt(bytes) {
  const { unzipSync } = await loadFflate();
  const files = unzipSync(bytes);
  if (!files['content.xml']) fail('El ODT no contiene content.xml.');
  const content = xml(u8(files['content.xml']));
  const stylesDoc = files['styles.xml'] ? xml(u8(files['styles.xml'])) : null;

  // Estilos de texto (negrita, cursiva…) y listas numeradas
  const styles = new Map();
  const numberedLists = new Set();
  for (const d of [stylesDoc, content].filter(Boolean)) {
    for (const s of d.getElementsByTagNameNS(NS.style, 'style')) {
      const tp = s.getElementsByTagNameNS(NS.style, 'text-properties')[0];
      styles.set(s.getAttributeNS(NS.style, 'name'), {
        parent: s.getAttributeNS(NS.style, 'parent-style-name'),
        b: tp?.getAttributeNS(NS.fo, 'font-weight') === 'bold' || undefined,
        i: tp?.getAttributeNS(NS.fo, 'font-style') === 'italic' || undefined,
        u: (tp?.getAttributeNS(NS.style, 'text-underline-style') || 'none') !== 'none' || undefined,
        s: (tp?.getAttributeNS(NS.style, 'text-line-through-style') || 'none') !== 'none' || undefined,
        code: /mono|courier|consol/i.test(tp?.getAttributeNS(NS.style, 'font-name') || '') || undefined,
      });
    }
    for (const ls of d.getElementsByTagNameNS(NS.text, 'list-style')) {
      const first = ls.firstElementChild;
      if (first?.localName === 'list-level-style-number') numberedLists.add(ls.getAttributeNS(NS.style, 'name'));
    }
  }
  const styleOf = (name, depth = 0) => {
    const s = styles.get(name);
    if (!s || depth > 8) return {};
    return { ...styleOf(s.parent, depth + 1), ...Object.fromEntries(Object.entries(s).filter(([k, v]) => k !== 'parent' && v)) };
  };

  const html = document.implementation.createHTMLDocument('');
  const el = (tag) => html.createElement(tag);

  const inline = (node, parent) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { parent.append(c.data); continue; }
      if (c.nodeType !== 1) continue;
      const n = c.localName;
      if (n === 's') parent.append('\u00a0'.repeat(Number(c.getAttributeNS(NS.text, 'c')) || 1));
      else if (n === 'tab') parent.append('\t');
      else if (n === 'line-break') parent.append(el('br'));
      else if (n === 'a') {
        const a = el('a'); a.href = c.getAttributeNS(NS.xlink, 'href') || ''; inline(c, a); parent.append(a);
      } else if (n === 'span') {
        const st = styleOf(c.getAttributeNS(NS.text, 'style-name'));
        let target = parent;
        for (const [k, tag] of [['b', 'strong'], ['i', 'em'], ['u', 'u'], ['s', 's'], ['code', 'code']]) {
          if (st[k]) { const w = el(tag); target.append(w); target = w; }
        }
        inline(c, target);
      } else if (n === 'frame') {
        const img = c.getElementsByTagNameNS(NS.draw, 'image')[0];
        const href = img?.getAttributeNS(NS.xlink, 'href');
        if (href && files[href]) { const i = el('img'); i.src = dataUri(files[href], mimeOf(href)); parent.append(i); }
      } else if (n === 'note') {
        const body = c.getElementsByTagNameNS(NS.text, 'note-body')[0];
        if (body) { const sup = el('sup'); sup.textContent = `[${body.textContent.trim()}]`; parent.append(sup); }
      } else if (!['bookmark', 'bookmark-start', 'bookmark-end', 'soft-page-break', 'annotation', 'sequence-decls'].includes(n)) {
        inline(c, parent);
      }
    }
  };

  const block = (node, parent) => {
    for (const c of node.children) {
      const n = c.localName;
      if (n === 'h') {
        const lv = Math.min(6, Math.max(1, Number(c.getAttributeNS(NS.text, 'outline-level')) || 1));
        const h = el(`h${lv}`); inline(c, h); parent.append(h);
      } else if (n === 'p') {
        const p = el('p'); inline(c, p);
        const st = styleOf(c.getAttributeNS(NS.text, 'style-name'));
        if (st.code) { const pre = el('pre'); pre.textContent = p.textContent; parent.append(pre); } else parent.append(p);
      } else if (n === 'list') {
        const ordered = numberedLists.has(c.getAttributeNS(NS.text, 'style-name'));
        const list = el(ordered ? 'ol' : 'ul');
        for (const item of c.children) {
          if (item.localName !== 'list-item' && item.localName !== 'list-header') continue;
          const li = el('li'); block(item, li); list.append(li);
        }
        parent.append(list);
      } else if (n === 'table') {
        const t = el('table');
        const addRows = (container, header) => {
          for (const r of container.children) {
            if (r.localName === 'table-header-rows') { addRows(r, true); continue; }
            if (r.localName === 'table-rows' || r.localName === 'table-row-group') { addRows(r, header); continue; }
            if (r.localName !== 'table-row') continue;
            const tr = el('tr');
            for (const cell of r.children) {
              if (cell.localName !== 'table-cell') continue;
              const rep = Math.min(Number(cell.getAttributeNS(NS.table, 'number-columns-repeated')) || 1, 64);
              for (let k = 0; k < rep; k++) { const td = el(header ? 'th' : 'td'); block(cell, td); tr.append(td); }
            }
            // recorta celdas vacías al final
            while (tr.lastChild && !tr.lastChild.textContent.trim() && !tr.lastChild.querySelector('img')) tr.lastChild.remove();
            if (tr.children.length) t.append(tr);
          }
        };
        addRows(c, false);
        parent.append(t);
      } else if (['section', 'index-body', 'table-of-content', 'alphabetical-index', 'illustration-index', 'list-item'].includes(n)) {
        block(c, parent);
      } else if (n === 'frame') {
        const p = el('p'); inline({ childNodes: [c] }, p); parent.append(p);
      }
    }
  };

  const body = content.getElementsByTagNameNS(NS.office, 'text')[0];
  if (!body) fail('El ODT no contiene texto.');
  block(body, html.body);
  let title = '';
  if (files['meta.xml']) title = xml(u8(files['meta.xml'])).getElementsByTagNameNS(NS.dc, 'title')[0]?.textContent || '';
  return makeHub(html.documentElement.outerHTML, title);
}

// ---------------------------------------------------------------- RTF

const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'headerl', 'headerr', 'headerf', 'footer',
  'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata',
  'colorschememapping', 'datastore', 'latentstyles', 'pgdsctbl', 'mmathPr', 'fldinst', 'pn', 'object', 'filetbl',
  'revtbl', 'userprops', 'docvar', 'bkmkstart', 'bkmkend', 'nonshppict', 'footnote', 'annotation', 'atnid', 'atnauthor', 'xe', 'tc']);
const RTF_CHARS = { bullet: '•', emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ', tab: '\t' };

export function readRtf(src) {
  if (!src.startsWith('{\\rtf')) fail('No es un archivo RTF válido.');
  let decoder = new TextDecoder('windows-1252');
  const html = document.implementation.createHTMLDocument('');
  const body = html.body;
  const stack = [];
  let st = { b: false, i: false, u: false, s: false, skip: false, uc: 1, pict: null };
  let runs = [];        // [{text, b, i, u, s}] | {img} | {br}
  let para = { level: 0, intbl: false };
  let table = null; let row = null; let cell = null;
  let pendingSkip = 0;
  let bytes = [];       // \'hh acumulados (para codificaciones multibyte)

  const flushBytes = () => {
    if (!bytes.length) return;
    addText(decoder.decode(new Uint8Array(bytes)));
    bytes = [];
  };
  const addText = (t) => {
    if (st.skip || !t) return;
    const last = runs[runs.length - 1];
    if (last && last.text !== undefined && last.b === st.b && last.i === st.i && last.u === st.u && last.s === st.s) last.text += t;
    else runs.push({ text: t, b: st.b, i: st.i, u: st.u, s: st.s });
  };
  const renderRuns = (target) => {
    for (const r of runs) {
      if (r.br) { target.append(html.createElement('br')); continue; }
      if (r.img) { const i = html.createElement('img'); i.src = r.img; target.append(i); continue; }
      let node = html.createTextNode(r.text);
      for (const [k, tag] of [['s', 's'], ['u', 'u'], ['i', 'em'], ['b', 'strong']]) {
        if (r[k]) { const w = html.createElement(tag); w.append(node); node = w; }
      }
      target.append(node);
    }
    runs = [];
  };
  const endPara = () => {
    flushBytes();
    const hasContent = runs.some((r) => r.img || r.br || (r.text && r.text.trim()));
    if (para.intbl) {
      if (!cell) cell = html.createElement('td');
      if (cell.childNodes.length) cell.append(html.createElement('br'));
      renderRuns(cell);
      return;
    }
    if (table) { body.append(table); table = null; }
    if (!hasContent) { runs = []; return; }
    const p = html.createElement(para.level ? `h${Math.min(6, para.level)}` : 'p');
    renderRuns(p);
    body.append(p);
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '{') { flushBytes(); stack.push({ ...st }); i++; continue; }
    if (ch === '}') {
      flushBytes();
      if (st.pict && !stack[stack.length - 1]?.pict) {
        const p = st.pict;
        if (p.type && p.hex.length) {
          const hex = p.hex.join('').replace(/[^0-9a-f]/gi, '');
          const b = new Uint8Array(hex.length >> 1);
          for (let k = 0; k < b.length; k++) b[k] = parseInt(hex.substr(k * 2, 2), 16);
          runs.push({ img: dataUri(b, p.type) });
        }
      }
      st = stack.pop() || st; i++; continue;
    }
    if (ch === '\\') {
      const nx = src[i + 1];
      if (/[a-zA-Z]/.test(nx)) {
        let j = i + 1;
        while (j < n && /[a-zA-Z]/.test(src[j])) j++;
        const word = src.slice(i + 1, j);
        let param = null;
        const m = /^-?\d+/.exec(src.slice(j, j + 12));
        if (m) { param = Number(m[0]); j += m[0].length; }
        if (src[j] === ' ') j++;
        i = j;
        if (word !== 'u' && word !== 'bin') flushBytes();
        if (pendingSkip && word !== 'u') { pendingSkip--; continue; }
        // {\*\destino}: se ignora salvo las imágenes de Word (\shppict)
        if (st.star) { st.star = false; if (word !== 'shppict') st.skip = true; continue; }
        if (st.skip) continue;
        if (st.pict) {
          if (word === 'pngblip') st.pict.type = 'image/png';
          else if (word === 'jpegblip') st.pict.type = 'image/jpeg';
          continue;
        }
        if (RTF_SKIP.has(word)) { st.skip = true; continue; }
        switch (word) {
          case 'ansicpg': try { decoder = new TextDecoder(`windows-${param}`); } catch { /* se mantiene 1252 */ } break;
          case 'par': case 'sect': endPara(); break;
          case 'page': endPara(); { const d = html.createElement('div'); d.setAttribute('data-pagebreak', ''); body.append(d); } break;
          case 'line': runs.push({ br: true }); break;
          case 'pard': para = { level: 0, intbl: false }; break;
          case 'intbl': para.intbl = true; break;
          case 'outlinelevel': para.level = (param ?? 0) + 1; break;
          case 'plain': st.b = st.i = st.u = st.s = false; break;
          case 'b': st.b = param !== 0; break;
          case 'i': st.i = param !== 0; break;
          case 'ul': st.u = param !== 0; break;
          case 'ulnone': st.u = false; break;
          case 'strike': st.s = param !== 0; break;
          case 'uc': st.uc = param ?? 1; break;
          case 'u': flushBytes(); addText(String.fromCharCode(param < 0 ? param + 65536 : param)); pendingSkip = st.uc; break;
          case 'trowd': if (!table) table = html.createElement('table'); row = html.createElement('tr'); break;
          case 'cell': case 'nestcell': endPara(); if (!row) row = html.createElement('tr'); row.append(cell || html.createElement('td')); cell = null; break;
          case 'row': case 'nestrow':
            if (!table) table = html.createElement('table');
            if (row) table.append(row);
            row = null; cell = null; break;
          case 'pict': st.pict = { type: null, hex: [] }; break;
          default: if (RTF_CHARS[word]) addText(RTF_CHARS[word]);
        }
        continue;
      }
      // símbolos de control
      if (nx === "'") {
        const hex = src.substr(i + 2, 2);
        i += 4;
        if (pendingSkip) { pendingSkip--; continue; }
        if (!st.skip) bytes.push(parseInt(hex, 16));
        continue;
      }
      flushBytes();
      i += 2;
      if (pendingSkip) { pendingSkip--; continue; }
      if (nx === '*') { st.star = true; continue; }
      if (nx === '~') addText('\u00a0');
      else if (nx === '_') addText('‑');
      else if (nx === '\n' || nx === '\r') endPara();
      else if (nx === '{' || nx === '}' || nx === '\\') addText(nx);
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (st.pict) {
      let j = i;
      while (j < n && !'\\{}'.includes(src[j])) j++;
      if (!st.skip) st.pict.hex.push(src.slice(i, j));
      i = j; continue;
    }
    // texto literal
    flushBytes();
    let j = i;
    while (j < n && !'\\{}\r\n'.includes(src[j])) j++;
    let chunk = src.slice(i, j);
    if (pendingSkip) { const k = Math.min(pendingSkip, chunk.length); chunk = chunk.slice(k); pendingSkip -= k; }
    addText(chunk);
    i = j;
  }
  endPara();
  if (table) body.append(table);
  return makeHub(html.documentElement.outerHTML);
}

// ---------------------------------------------------------------- EPUB

export async function readEpub(bytes) {
  const { unzipSync } = await loadFflate();
  const files = unzipSync(bytes);
  const container = files['META-INF/container.xml'];
  if (!container) fail('El EPUB no tiene META-INF/container.xml.');
  const opfPath = xml(u8(container)).querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath || !files[opfPath]) fail('No se encontró el paquete OPF del EPUB.');
  const opf = xml(u8(files[opfPath]));
  const manifest = new Map([...opf.getElementsByTagName('item')].map((it) => [it.getAttribute('id'), it]));
  const spine = [...opf.getElementsByTagName('itemref')].map((r) => manifest.get(r.getAttribute('idref'))).filter(Boolean);
  const title = opf.getElementsByTagNameNS(NS.dc, 'title')[0]?.textContent || '';
  const out = document.implementation.createHTMLDocument(title);
  spine.forEach((item, idx) => {
    const path = resolvePath(opfPath, item.getAttribute('href'));
    if (!files[path] || !/x?html|xml/.test(item.getAttribute('media-type') || 'html')) return;
    const text = u8(files[path]);
    let doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (doc.querySelector('parsererror') || !doc.body) doc = new DOMParser().parseFromString(text, 'text/html');
    for (const img of doc.querySelectorAll('img, image')) {
      const attr = img.tagName.toLowerCase() === 'img' ? 'src' : 'href';
      const ref = img.getAttribute(attr) || img.getAttributeNS(NS.xlink, 'href');
      const p = ref && resolvePath(path, ref);
      if (p && files[p]) {
        const i = out.createElement('img');
        i.src = dataUri(files[p], mimeOf(p));
        i.alt = img.getAttribute('alt') || '';
        (img.closest('svg') || img).replaceWith(i);
      }
    }
    if (idx && out.body.childNodes.length) { const d = out.createElement('div'); d.setAttribute('data-pagebreak', ''); out.body.append(d); }
    for (const c of [...(doc.body?.childNodes || [])]) out.body.append(out.importNode(c, true));
  });
  return makeHub(out.documentElement.outerHTML, title);
}

// ---------------------------------------------------------------- PPTX

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export async function readPptx(bytes) {
  const { unzipSync } = await loadFflate();
  const files = unzipSync(bytes);
  const pres = files['ppt/presentation.xml'] && xml(u8(files['ppt/presentation.xml']));
  if (!pres) fail('El PPTX no contiene ppt/presentation.xml.');
  const rels = (path) => {
    const rp = path.replace(/([^/]+)$/, '_rels/$1.rels');
    if (!files[rp]) return new Map();
    return new Map([...xml(u8(files[rp])).getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), resolvePath(path, r.getAttribute('Target'))]));
  };
  const presRels = rels('ppt/presentation.xml');
  const slides = [...pres.getElementsByTagNameNS(P, 'sldId')].map((s) => presRels.get(s.getAttributeNS(R, 'id'))).filter((p) => p && files[p]);
  const out = document.implementation.createHTMLDocument('');
  const el = (t) => out.createElement(t);

  const paragraphs = (txBody, target) => {
    for (const p of txBody.getElementsByTagNameNS(A, 'p')) {
      const para = el('p');
      for (const r of p.children) {
        if (r.localName === 'br') { para.append(el('br')); continue; }
        if (r.localName !== 'r' && r.localName !== 'fld') continue;
        const t = r.getElementsByTagNameNS(A, 't')[0]?.textContent || '';
        const pr = r.getElementsByTagNameNS(A, 'rPr')[0];
        let node = out.createTextNode(t);
        if (pr?.getAttribute('i') === '1') { const w = el('em'); w.append(node); node = w; }
        if (pr?.getAttribute('b') === '1') { const w = el('strong'); w.append(node); node = w; }
        para.append(node);
      }
      if (para.textContent.trim()) {
        const lvl = Number(p.getElementsByTagNameNS(A, 'pPr')[0]?.getAttribute('lvl') || 0);
        target.push({ node: para, bullet: !!p.getElementsByTagNameNS(A, 'buChar')[0] || !!p.getElementsByTagNameNS(A, 'buAutoNum')[0], lvl });
      }
    }
  };

  slides.forEach((path, idx) => {
    const slide = xml(u8(files[path]));
    const sRels = rels(path);
    if (idx) { const d = el('div'); d.setAttribute('data-pagebreak', ''); out.body.append(d); }
    let title = '';
    const content = [];
    for (const sp of slide.getElementsByTagNameNS(P, 'sp')) {
      const ph = sp.getElementsByTagNameNS(P, 'ph')[0];
      const tx = sp.getElementsByTagNameNS(P, 'txBody')[0];
      if (!tx) continue;
      if (ph && /title|ctrTitle/.test(ph.getAttribute('type') || '') && !title) { title = tx.textContent.trim(); continue; }
      paragraphs(tx, content);
    }
    const h = el('h2');
    h.textContent = title ? `${idx + 1}. ${title}` : `Diapositiva ${idx + 1}`;
    out.body.append(h);
    let list = null;
    for (const c of content) {
      if (c.bullet || c.lvl > 0) {
        if (!list) { list = el('ul'); out.body.append(list); }
        const li = el('li'); li.append(...c.node.childNodes); list.append(li);
      } else { list = null; out.body.append(c.node); }
    }
    for (const tbl of slide.getElementsByTagNameNS(A, 'tbl')) {
      const t = el('table');
      for (const tr of tbl.getElementsByTagNameNS(A, 'tr')) {
        const row = el('tr');
        for (const tc of tr.getElementsByTagNameNS(A, 'tc')) { const td = el('td'); td.textContent = tc.textContent; row.append(td); }
        t.append(row);
      }
      out.body.append(t);
    }
    for (const pic of slide.getElementsByTagNameNS(P, 'pic')) {
      const blip = pic.getElementsByTagNameNS(A, 'blip')[0];
      const target = blip && sRels.get(blip.getAttributeNS(R, 'embed'));
      if (target && files[target] && /^image\/(png|jpeg|gif|webp|bmp|svg)/.test(mimeOf(target))) {
        const img = el('img'); img.src = dataUri(files[target], mimeOf(target)); out.body.append(img);
      }
    }
  });
  if (!slides.length) fail('La presentación no tiene diapositivas.');
  return makeHub(out.documentElement.outerHTML);
}

// ---------------------------------------------------------------- Jupyter

export async function readIpynb(text) {
  let nb;
  try { nb = JSON.parse(text); } catch { fail('El cuaderno .ipynb no es JSON válido.'); }
  const { marked } = await loadMarked();
  const src = (s) => (Array.isArray(s) ? s.join('') : String(s || ''));
  const lang = nb.metadata?.kernelspec?.language || nb.metadata?.language_info?.name || 'python';
  const parts = [];
  for (const cell of nb.cells || []) {
    if (cell.cell_type === 'markdown') parts.push(marked.parse(src(cell.source), { gfm: true, async: false }));
    else if (cell.cell_type === 'code') {
      parts.push(`<pre><code class="language-${escapeText(lang)}">${escapeText(src(cell.source))}</code></pre>`);
      for (const o of cell.outputs || []) {
        if (o.output_type === 'stream') parts.push(`<pre>${escapeText(src(o.text))}</pre>`);
        else if (o.output_type === 'error') parts.push(`<pre>${escapeText(`${o.ename}: ${o.evalue}`)}</pre>`);
        else if (o.data) {
          if (o.data['image/png']) parts.push(`<p><img src="data:image/png;base64,${src(o.data['image/png']).replace(/\s/g, '')}" alt="Salida"></p>`);
          else if (o.data['image/jpeg']) parts.push(`<p><img src="data:image/jpeg;base64,${src(o.data['image/jpeg']).replace(/\s/g, '')}" alt="Salida"></p>`);
          else if (o.data['text/html']) parts.push(src(o.data['text/html']));
          else if (o.data['text/plain']) parts.push(`<pre>${escapeText(src(o.data['text/plain']))}</pre>`);
        }
      }
    } else if (cell.cell_type === 'raw') parts.push(`<pre>${escapeText(src(cell.source))}</pre>`);
  }
  return makeHub(`<body>${parts.join('\n')}</body>`, nb.metadata?.title || '');
}

export function ipynbToPython(text) {
  const nb = JSON.parse(text);
  const src = (s) => (Array.isArray(s) ? s.join('') : String(s || ''));
  const out = [];
  for (const cell of nb.cells || []) {
    if (cell.cell_type === 'code') out.push(`# %%\n${src(cell.source).trimEnd()}\n`);
    else if (cell.cell_type === 'markdown') out.push(`# %% [markdown]\n${src(cell.source).trimEnd().split('\n').map((l) => `# ${l}`.trimEnd()).join('\n')}\n`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- despacho

export async function readDocument(input, ctx) {
  switch (input.format) {
    case 'md': return readMarkdown(await input.text());
    case 'txt': return readText(await input.text());
    case 'html': return readHtml(await input.text());
    case 'docx': return readDocx(await input.bytes());
    case 'odt': return readOdt(await input.bytes());
    case 'rtf': return readRtf(await input.text());
    case 'epub': return readEpub(await input.bytes());
    case 'pptx': return readPptx(await input.bytes());
    case 'pdf': return readPdf(await input.bytes(), ctx);
    case 'ipynb': return readIpynb(await input.text());
    default: return fail(`No se puede leer ${input.format} como documento.`);
  }
}

export { decodeText };
