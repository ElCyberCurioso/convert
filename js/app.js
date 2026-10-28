// Interfaz de Converter. Todo el contenido que procede de archivos del
// usuario (nombres, mensajes) se inserta con textContent, nunca como HTML.

import { detectFormat } from './detect.js';
import { Input, targetsFor, convert, catalog, optionsFor, MERGES } from './engine.js';
import { CATEGORIES, fmt } from './formats.js';
import { OPTION_DEFS, relevantOptions, defaults } from './options.js';
import { formatBytes, UserError } from './util.js';
import { icon } from './icons.js';
import { loadFflate } from './loaders.js';

// ---------------------------------------------------------------- utilidades DOM

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
const $ = (s, el = document) => el.querySelector(s);

const store = {
  get(k, d) { try { const v = localStorage.getItem(`converter:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`converter:${k}`, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

const DEFAULT_TARGET = {
  image: ['png', 'jpg'], audio: ['mp3', 'wav'], video: ['mp4', 'webm'], doc: ['pdf', 'docx'], sheet: ['xlsx', 'csv'],
  data: ['json', 'yaml'], archive: ['zip', 'unpack'], font: ['woff2', 'sfnt'], subtitle: ['srt', 'vtt'], other: ['zip'],
};
const MEDIA_CATS = new Set(['audio', 'video']);

// ---------------------------------------------------------------- estado

const state = {
  items: [],
  opts: { ...defaults(), ...store.get('opts', {}) },
  lastTarget: store.get('lastTarget', {}),
  running: false,
  merge: null, // { status, msg, progress, outputs, error }
};
delete state.opts.password; // nunca se recuerda la contraseña
let seq = 0;

const els = {
  input: $('#file-input'),
  drop: $('#drop'),
  queue: $('#queue'),
  toolbar: $('#toolbar'),
  options: $('#options'),
  optionsBody: $('#options-body'),
  catalog: $('#catalog'),
  live: $('#live'),
};

// ---------------------------------------------------------------- añadir archivos

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f && f.size !== undefined);
  if (!files.length) return;
  for (const file of files) {
    const det = await detectFormat(file);
    const input = new Input(file, det.id);
    const targets = targetsFor(det.id);
    const item = { id: ++seq, file, input, det, targets, to: pickTarget(det.id, targets), status: 'idle', progress: null, msg: '', outputs: [] };
    state.items.push(item);
    els.queue.append(renderItem(item));
  }
  announce(`${files.length === 1 ? 'Añadido 1 archivo' : `Añadidos ${files.length} archivos`}.`);
  refresh();
}

function pickTarget(from, targets) {
  const ids = targets.map((t) => t.id);
  const last = state.lastTarget[from];
  if (last && ids.includes(last)) return last;
  const cat = fmt(from).cat;
  for (const id of DEFAULT_TARGET[cat] || []) if (ids.includes(id) && id !== from) return id;
  return targets.find((t) => t.cat === cat && t.id !== from)?.id || ids[0] || '';
}

// ---------------------------------------------------------------- tarjetas

function targetSelect(targets, value, onChange, label) {
  const sel = h('select', { class: 'target', 'aria-label': label, onchange: (e) => onChange(e.target.value) });
  const groups = new Map();
  for (const t of targets) {
    if (!groups.has(t.cat)) groups.set(t.cat, h('optgroup', { label: CATEGORIES[t.cat] }));
    groups.get(t.cat).append(h('option', { value: t.id, text: t.label, selected: t.id === value }));
  }
  sel.append(...groups.values());
  return sel;
}

function renderItem(item) {
  const f = fmt(item.det.id);
  const busy = item.status === 'running' || item.status === 'queued';
  const root = item.el?.root || h('li', { class: 'card', dataset: { id: item.id } });
  root.replaceChildren();
  root.dataset.status = item.status;
  root.dataset.cat = f.cat;

  const meta = [formatBytes(item.file.size), item.det.id === 'bin' ? 'formato no reconocido' : f.label];
  if (item.det.by === 'firma' || item.det.by === 'ext+firma') meta.push('verificado por firma');

  const head = h('div', { class: 'card-head' },
    h('span', { class: 'badge', title: CATEGORIES[f.cat] }, icon(f.cat)),
    h('div', { class: 'card-title' },
      h('span', { class: 'name', text: item.file.name, title: item.file.name }),
      h('span', { class: 'meta', text: meta.join(' · ') })),
    h('button', { class: 'icon-btn', type: 'button', title: 'Quitar', 'aria-label': `Quitar ${item.file.name}`, onclick: () => removeItem(item) }, icon('x')));

  const notes = [];
  if (item.det.note) notes.push(h('p', { class: 'note warn' }, icon('alert'), h('span', { text: item.det.note })));
  if (MEDIA_CATS.has(f.cat) && item.file.size > 1.5e9) notes.push(h('p', { class: 'note warn' }, icon('alert'), h('span', { text: 'Archivo muy grande: el navegador puede quedarse sin memoria con ffmpeg (límite práctico ~2 GB).' })));

  const actions = h('div', { class: 'card-actions' });
  if (item.targets.length) {
    actions.append(
      h('label', { class: 'to' }, h('span', { class: 'to-label', text: 'a' }),
        targetSelect(item.targets, item.to, (v) => setTarget(item, v), `Formato de salida para ${item.file.name}`)),
      busy
        ? h('button', { class: 'btn ghost', type: 'button', onclick: () => cancelItem(item) }, icon('stop'), h('span', { text: 'Cancelar' }))
        : h('button', { class: 'btn primary', type: 'button', onclick: () => queueItems([item]) },
          icon(item.status === 'done' || item.status === 'error' ? 'retry' : 'arrow'),
          h('span', { text: item.status === 'done' ? 'Otra vez' : item.status === 'error' ? 'Reintentar' : 'Convertir' })),
    );
  } else {
    actions.append(h('p', { class: 'note', text: 'No hay conversiones disponibles para este archivo.' }));
  }

  const status = h('div', { class: 'status', hidden: item.status === 'idle' && !item.msg },
    h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Progreso', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span')),
    h('p', { class: 'msg', text: item.status === 'error' ? item.error : item.msg }));
  root.append(head, ...notes, actions, status);
  if (item.outputs.length) root.append(renderOutputs(item.outputs, item.input.base));

  item.el = { root, bar: $('.bar', root), fill: $('.bar span', root), msg: $('.msg', root), status };
  paintProgress(item);
  return root;
}

function renderOutputs(outputs, base) {
  const list = h('ul', { class: 'outputs' });
  for (const o of outputs) {
    const isImg = /^image\//.test(o.blob.type) && o.blob.type !== 'image/tiff' && o.blob.size < 25e6;
    const isAudio = /^audio\//.test(o.blob.type);
    const isVideo = /^video\/(mp4|webm|ogg|quicktime)/.test(o.blob.type);
    const shown = o.name.split('/').pop();
    const li = h('li', { class: 'output' },
      isImg ? h('img', { class: 'thumb', src: o.url, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'thumb ph' }, icon(fmtCatOf(o.name))),
      h('div', { class: 'out-title' },
        h('span', { class: 'name', text: o.name, title: o.name }),
        h('span', { class: 'meta', text: formatBytes(o.blob.size) })),
      (isAudio || isVideo) ? h('button', { class: 'icon-btn', type: 'button', title: 'Reproducir', 'aria-label': `Reproducir ${shown}`, onclick: (e) => togglePreview(e.currentTarget, o, isVideo) }, icon('play')) : null,
      h('a', { class: 'btn small', href: o.url, download: shown, title: `Descargar ${shown}` }, icon('download'), h('span', { text: 'Descargar' })));
    list.append(li);
  }
  if (outputs.length > 1) {
    list.append(h('li', { class: 'output all' },
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => downloadZip(outputs.map((o) => ({ name: o.name, blob: o.blob })), `${base}.zip`) },
        icon('archive'), h('span', { text: `Descargar los ${outputs.length} en ZIP` }))));
  }
  return list;
}

function fmtCatOf(name) {
  const ext = name.toLowerCase().split('.').pop();
  for (const [cat, ids] of Object.entries({ image: ['png', 'jpg', 'webp', 'gif', 'svg', 'ico', 'bmp', 'tiff', 'avif'], audio: ['mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'wma', 'aiff', 'ac3'], video: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', 'wmv', 'mpg', 'ts', '3gp', 'ogv'], doc: ['pdf', 'docx', 'odt', 'rtf', 'epub', 'html', 'md', 'txt'], sheet: ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'dbf', 'sql'], data: ['json', 'jsonl', 'yaml', 'toml', 'xml', 'ini'], archive: ['zip', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'], font: ['ttf', 'otf', 'woff', 'woff2', 'css'], subtitle: ['srt', 'vtt', 'sbv', 'ass'] })) {
    if (ids.includes(ext)) return cat;
  }
  return 'other';
}

function togglePreview(btn, o, isVideo) {
  const li = btn.closest('.output');
  const existing = li.nextElementSibling?.classList.contains('preview') ? li.nextElementSibling : null;
  if (existing) { existing.remove(); return; }
  const media = h(isVideo ? 'video' : 'audio', { src: o.url, controls: true, preload: 'metadata' });
  li.after(h('li', { class: 'preview' }, media));
  media.play().catch(() => {});
}

function paintProgress(item) {
  const { bar, fill, msg, status } = item.el;
  if (!bar) return;
  const running = item.status === 'running' || item.status === 'queued';
  status.hidden = item.status === 'idle' && !item.msg;
  bar.hidden = !running;
  bar.classList.toggle('indeterminate', running && (item.progress === null || item.progress === undefined));
  const pct = Math.round((item.progress || 0) * 100);
  fill.style.width = `${pct}%`;
  if (item.progress !== null && item.progress !== undefined) bar.setAttribute('aria-valuenow', String(pct)); else bar.removeAttribute('aria-valuenow');
  msg.textContent = item.status === 'error' ? item.error : item.msg;
  msg.classList.toggle('error', item.status === 'error');
}

let rafPending = new Set();
function scheduleProgress(item) {
  if (rafPending.has(item)) return;
  rafPending.add(item);
  requestAnimationFrame(() => { rafPending.delete(item); paintProgress(item); });
}

function setTarget(item, to, remember = true) {
  item.to = to;
  if (remember) {
    state.lastTarget[item.det.id] = to;
    store.set('lastTarget', state.lastTarget);
  }
  if (item.status !== 'running' && item.status !== 'queued') { item.status = 'idle'; item.msg = ''; }
  renderItem(item);
  refresh();
}

function removeItem(item) {
  cancelItem(item);
  item.outputs.forEach((o) => URL.revokeObjectURL(o.url));
  state.items = state.items.filter((i) => i !== item);
  item.el?.root.remove();
  refresh();
}

function cancelItem(item) {
  if (item.status === 'queued') { item.status = 'canceled'; item.msg = 'Cancelado'; renderItem(item); refresh(); }
  item.ctrl?.abort();
}

// ---------------------------------------------------------------- cola de trabajo

function queueItems(items) {
  for (const it of items) {
    if (!it.to || it.status === 'running' || it.status === 'queued') continue;
    it.outputs.forEach((o) => URL.revokeObjectURL(o.url));
    it.outputs = [];
    it.status = 'queued'; it.msg = 'En cola…'; it.progress = null; it.error = '';
    renderItem(it);
  }
  refresh();
  runQueue();
}

async function runQueue() {
  if (state.running) return;
  state.running = true;
  refresh();
  try {
    for (let next; (next = state.items.find((i) => i.status === 'queued'));) await runItem(next);
  } finally {
    state.running = false;
    refresh();
  }
}

async function runItem(item) {
  item.status = 'running';
  item.msg = 'Preparando…';
  item.progress = null;
  item.ctrl = new AbortController();
  renderItem(item);
  const t0 = performance.now();
  const ctx = {
    opts: { ...state.opts },
    signal: item.ctrl.signal,
    progress: (p, msg) => { item.progress = p; if (msg) item.msg = msg; scheduleProgress(item); },
  };
  try {
    const outs = await convert(item.input, item.to, ctx);
    if (item.ctrl.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    item.outputs = outs.map((o) => ({ ...o, url: URL.createObjectURL(o.blob) }));
    item.status = 'done';
    const s = (performance.now() - t0) / 1000;
    item.msg = `Listo en ${s < 10 ? s.toFixed(1).replace('.', ',') : Math.round(s)} s · ${outs.length > 1 ? `${outs.length} archivos` : formatBytes(outs[0].blob.size)}`;
    announce(`${item.file.name}: conversión terminada.`);
  } catch (e) {
    if (item.ctrl.signal.aborted || e?.name === 'AbortError') {
      item.status = 'canceled'; item.msg = 'Cancelado';
    } else {
      item.status = 'error';
      item.error = e instanceof UserError ? e.message : `Error inesperado: ${e?.message || e?.type || e}`;
      console.error(e);
      announce(`${item.file.name}: error.`);
    }
  }
  renderItem(item);
}

// ---------------------------------------------------------------- acciones globales

async function downloadZip(files, name) {
  const { zipSync } = await loadFflate();
  const entries = {};
  const used = new Set();
  for (const f of files) {
    let n = f.name.replace(/^\/+/, '');
    const dot = n.lastIndexOf('.');
    for (let k = 2; used.has(n.toLowerCase()); k++) n = dot > 0 ? `${f.name.slice(0, dot)} (${k})${f.name.slice(dot)}` : `${f.name} (${k})`;
    used.add(n.toLowerCase());
    entries[n] = [new Uint8Array(await f.blob.arrayBuffer()), { level: /\.(zip|gz|7z|xz|bz2|jpe?g|png|gif|webp|avif|mp[34]|m4a|webm|mkv|mov|docx|xlsx|odt|ods|epub|woff2?)$/i.test(n) ? 0 : 6 }];
  }
  const url = URL.createObjectURL(new Blob([zipSync(entries)], { type: 'application/zip' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function commonTargets() {
  const usable = state.items.filter((i) => i.targets.length);
  if (!usable.length) return [];
  let ids = new Set(usable[0].targets.map((t) => t.id));
  for (const it of usable.slice(1)) ids = new Set(it.targets.map((t) => t.id).filter((id) => ids.has(id)));
  return usable[0].targets.filter((t) => ids.has(t.id)).map((t) => ({ ...t, label: t.label.replace(/ \(recomprimir\)$/, '') }));
}

async function runMerge(m) {
  const inputs = state.items.filter((i) => m.accepts(i.det.id)).map((i) => i.input);
  state.merge = { label: m.label, status: 'running', msg: 'Preparando…', progress: null, outputs: [] };
  renderMerge();
  const ctx = { opts: { ...state.opts }, progress: (p, msg) => { state.merge.progress = p; if (msg) state.merge.msg = msg; renderMerge(); } };
  try {
    const outs = await m.run(inputs, ctx);
    state.merge.outputs = outs.map((o) => ({ ...o, url: URL.createObjectURL(o.blob) }));
    state.merge.status = 'done';
    state.merge.msg = `${inputs.length} archivos combinados`;
  } catch (e) {
    state.merge.status = 'error';
    state.merge.msg = e instanceof UserError ? e.message : `Error inesperado: ${e?.message || e?.type || e}`;
    console.error(e);
  }
  renderMerge();
}

function renderMerge() {
  let box = $('#merge-result');
  const m = state.merge;
  if (!m) { box?.remove(); return; }
  if (!box) { box = h('section', { id: 'merge-result', class: 'card merge', 'aria-live': 'polite' }); els.queue.before(box); }
  box.dataset.status = m.status;
  box.replaceChildren(
    h('div', { class: 'card-head' },
      h('span', { class: 'badge' }, icon('merge')),
      h('div', { class: 'card-title' }, h('span', { class: 'name', text: m.label }), h('span', { class: 'meta', text: m.msg })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => { m.outputs.forEach((o) => URL.revokeObjectURL(o.url)); state.merge = null; renderMerge(); } }, icon('x'))),
    m.status === 'running' ? h('div', { class: 'bar' + (m.progress == null ? ' indeterminate' : '') }, h('span', { style: null })) : null,
    m.outputs.length ? renderOutputs(m.outputs, 'combinado') : null,
  );
  const fill = $('.bar span', box);
  if (fill && m.progress != null) fill.style.width = `${Math.round(m.progress * 100)}%`;
}

function refresh() {
  renderToolbar();
  renderOptions();
  document.body.classList.toggle('has-items', state.items.length > 0);
}

function renderToolbar() {
  const tb = els.toolbar;
  tb.replaceChildren();
  if (!state.items.length) return;
  const common = commonTargets();
  const pending = state.items.filter((i) => i.to && ['idle', 'error', 'canceled'].includes(i.status));
  const outputs = state.items.flatMap((i) => i.outputs);
  const busy = state.items.some((i) => i.status === 'running' || i.status === 'queued');

  const left = h('div', { class: 'tb-group' },
    h('span', { class: 'count', text: `${state.items.length} ${state.items.length === 1 ? 'archivo' : 'archivos'}` }));
  if (state.items.length > 1 && common.length) {
    const sameTo = state.items.every((i) => i.to === state.items[0].to) ? state.items[0].to : '';
    const sel = targetSelect(common, sameTo, (v) => state.items.forEach((i) => i.targets.some((t) => t.id === v) && setTarget(i, v, false)), 'Formato de salida para todos');
    if (!sameTo) sel.prepend(h('option', { value: '', text: 'Elige…', selected: true, disabled: true }));
    left.append(h('label', { class: 'to all' }, h('span', { class: 'to-label', text: 'Todo a' }), sel));
  }
  const right = h('div', { class: 'tb-group' });
  if (pending.length) right.append(h('button', { class: 'btn primary', type: 'button', onclick: () => queueItems(pending) }, icon('arrow'), h('span', { text: pending.length > 1 ? `Convertir ${pending.length}` : 'Convertir' })));
  if (busy) right.append(h('button', { class: 'btn ghost', type: 'button', onclick: () => state.items.forEach(cancelItem) }, icon('stop'), h('span', { text: 'Cancelar todo' })));
  if (outputs.length > 1) right.append(h('button', { class: 'btn', type: 'button', onclick: () => downloadZip(outputs, 'converter.zip') }, icon('download'), h('span', { text: 'Descargar todo (ZIP)' })));
  for (const m of MERGES) {
    const n = state.items.filter((i) => m.accepts(i.det.id)).length;
    if (n >= 2 && n === state.items.length) right.append(h('button', { class: 'btn', type: 'button', disabled: state.merge?.status === 'running', onclick: () => runMerge(m) }, icon(m.id === 'merge-pdf' ? 'merge' : 'archive'), h('span', { text: m.label })));
  }
  right.append(h('button', { class: 'btn ghost', type: 'button', onclick: clearAll }, icon('trash'), h('span', { text: 'Vaciar' })));
  tb.append(left, right);
}

function clearAll() {
  for (const it of [...state.items]) removeItem(it);
  if (state.merge) { state.merge.outputs.forEach((o) => URL.revokeObjectURL(o.url)); state.merge = null; renderMerge(); }
  els.input.value = '';
}

// ---------------------------------------------------------------- ajustes

function renderOptions() {
  // Ajuste -> tipos de archivo que lo usan; los compartidos van a «General»
  const uses = new Map();
  const note = (label, keys) => keys.forEach((k) => { if (!uses.has(k)) uses.set(k, new Set()); uses.get(k).add(label); });
  const order = Object.keys(CATEGORIES);
  const items = [...state.items].filter((i) => i.to).sort((a, b) => order.indexOf(fmt(a.det.id).cat) - order.indexOf(fmt(b.det.id).cat));
  for (const it of items) note(CATEGORIES[fmt(it.det.id).cat], relevantOptions(optionsFor(it.det.id, it.to), it.to, it.det.id));
  for (const m of MERGES) if (state.items.filter((i) => m.accepts(i.det.id)).length >= 2) note(m.label, relevantOptions(m.options, m.id));
  const groups = new Map();
  const labels = new Set([...uses.values()].flatMap((s) => [...s]));
  for (const [k, set] of uses) {
    const label = set.size > 1 ? 'General' : [...set][0];
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(k);
  }
  const sorted = [...groups].sort(([a], [b]) => (a === 'General' ? -1 : b === 'General' ? 1 : 0));
  els.options.hidden = !uses.size;
  const body = els.optionsBody;
  // conserva el foco si el usuario está editando
  const focused = document.activeElement?.dataset?.opt;
  body.replaceChildren(...sorted.map(([label, keys]) => h('fieldset', { class: 'opt-group' },
    labels.size > 1 ? h('legend', { text: label }) : null,
    h('div', { class: 'opt-grid' }, keys.map((k) => optionField(k))))));
  if (focused) body.querySelector(`[data-opt="${focused}"]`)?.focus();
}

function optionField(key) {
  const d = OPTION_DEFS[key];
  const v = state.opts[key] ?? d.def;
  const id = `opt-${key}`;
  const save = (val) => {
    state.opts[key] = val;
    const persist = { ...state.opts };
    delete persist.password;
    store.set('opts', persist);
  };
  let control;
  if (d.type === 'select') {
    control = h('select', { id, dataset: { opt: key }, onchange: (e) => save(e.target.value) },
      d.choices.map(([val, label]) => h('option', { value: val, text: label, selected: String(v) === val })));
  } else if (d.type === 'range') {
    const out = h('output', { for: id, text: d.fmt(v) });
    control = h('div', { class: 'range' },
      h('input', { id, type: 'range', min: d.min, max: d.max, step: d.step, value: v, dataset: { opt: key }, oninput: (e) => { out.textContent = d.fmt(Number(e.target.value)); save(Number(e.target.value)); } }),
      out);
  } else if (d.type === 'check') {
    return h('label', { class: 'field check' },
      h('input', { id, type: 'checkbox', checked: !!v, dataset: { opt: key }, onchange: (e) => save(e.target.checked) }),
      h('span', { text: d.label }));
  } else {
    const type = { color: 'color', number: 'number', password: 'password', text: 'text' }[d.type];
    control = h('input', {
      id, type, value: v, placeholder: d.placeholder, min: d.min, step: d.step, dataset: { opt: key },
      autocomplete: d.type === 'password' ? 'off' : null, spellcheck: 'false',
      oninput: (e) => save(e.target.value),
    });
  }
  return h('div', { class: 'field' },
    h('label', { for: id, text: d.label }),
    control,
    d.hint ? h('small', { text: d.hint }) : null);
}

// ---------------------------------------------------------------- catálogo

function renderCatalog() {
  const formats = catalog();
  const byCat = new Map();
  let pairs = 0;
  for (const f of formats) {
    if (!byCat.has(f.cat)) byCat.set(f.cat, []);
    byCat.get(f.cat).push(f);
    pairs += f.targets.length;
  }
  $('#stat-formats').textContent = String(formats.length);
  $('#stat-pairs').textContent = new Intl.NumberFormat('es-ES').format(pairs);

  const detail = h('div', { class: 'cat-detail', 'aria-live': 'polite' }, h('p', { class: 'muted', text: 'Pulsa un formato para ver a qué se puede convertir.' }));
  const show = (f, chip) => {
    els.catalog.querySelectorAll('.chip[aria-pressed="true"]').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    const groups = new Map();
    for (const t of f.targets) { if (!groups.has(t.cat)) groups.set(t.cat, []); groups.get(t.cat).push(t.label); }
    detail.replaceChildren(
      h('p', { class: 'detail-head' }, h('strong', { text: f.label }), h('span', { class: 'muted', text: ` · .${f.exts.join(' .')}` })),
      ...[...groups].map(([cat, labels]) => h('p', { class: 'detail-row' }, h('span', { class: 'detail-cat', text: CATEGORIES[cat] }), h('span', { text: labels.join(' · ') }))),
    );
  };
  const search = h('input', { type: 'search', class: 'cat-search', placeholder: 'Busca un formato: heic, mkv, docx…', 'aria-label': 'Buscar formato', spellcheck: 'false' });
  const grid = h('div', { class: 'cat-grid' });
  for (const [cat, list] of byCat) {
    grid.append(h('div', { class: 'cat', dataset: { cat } },
      h('h3', {}, icon(cat), h('span', { text: CATEGORIES[cat] }), h('span', { class: 'muted', text: String(list.length) })),
      h('div', { class: 'chips' }, list.map((f) => {
        const chip = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', dataset: { q: [f.id, f.label, ...f.exts].join(' ').toLowerCase() }, text: f.label.replace(/ \(.+\)$/, '') });
        chip.addEventListener('click', () => show(f, chip));
        return chip;
      }))));
  }
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase().replace(/^\./, '');
    let first = null;
    for (const chip of grid.querySelectorAll('.chip')) {
      const hit = !q || chip.dataset.q.split(' ').some((w) => w.startsWith(q));
      chip.hidden = !hit;
      if (hit && q && !first) first = chip;
    }
    for (const c of grid.querySelectorAll('.cat')) c.hidden = ![...c.querySelectorAll('.chip')].some((x) => !x.hidden);
    if (first) first.click();
  });
  els.catalog.append(search, grid, detail);
}

// ---------------------------------------------------------------- arranque

function announce(text) { els.live.textContent = text; }

function setupDrop() {
  const { drop, input } = els;
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    addFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pegado-${Date.now()}-${i}.${(f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`, { type: f.type })))); }
  });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
}

function setupTheme() {
  const btn = $('#theme');
  const apply = (t) => {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    btn.replaceChildren(icon(dark ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', dark ? 'Usar tema claro' : 'Usar tema oscuro');
    btn.title = btn.getAttribute('aria-label');
  };
  apply(store.get('theme', null));
  btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    store.set('theme', next);
    apply(next);
  });
}

setupDrop();
setupTheme();
if (matchMedia('(max-width: 640px)').matches) els.options.open = false;
// En GitHub Pages se enlaza el repositorio automáticamente (usuario.github.io/repo/)
if (location.hostname.endsWith('.github.io')) {
  const user = location.hostname.split('.')[0];
  const repo = location.pathname.split('/').filter(Boolean)[0];
  const link = $('#repo-link');
  link.href = `https://github.com/${user}/${repo && !repo.includes('.') ? repo : `${user}.github.io`}`;
  link.rel = 'noopener';
  link.hidden = false;
}
renderCatalog();
refresh();
document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon)));
window.addEventListener('beforeunload', (e) => {
  if (state.items.some((i) => i.status === 'running' || i.status === 'queued')) { e.preventDefault(); e.returnValue = ''; }
});
