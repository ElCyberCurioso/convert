// Pestaña «Texto»: codificar, decodificar, transformar y calcular hashes de
// texto en vivo. La entrada nunca se guarda (puede contener secretos).

import { OPS, GROUPS, opById, runOp, suggest, inputBytes, bytesToBase64, CodecError } from './text/codecs.js';
import { allHashes, hmac, ntlm, toHex } from './text/hash.js';
import { h, store, copyText } from './dom.js';
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);
const enc = new TextEncoder();
const LIVE_LIMIT = 5_000_000; // por encima, se calcula al pulsar

const state = {
  op: opById(store.get('textOp', 'b64')) ? store.get('textOp', 'b64') : 'b64',
  mode: store.get('textMode', 'utf8'),
  hashFormat: store.get('hashFormat', 'hex'),
  hmacAlgo: store.get('hmacAlgo', 'SHA-256'),
  hmacKey: '',
  output: '',
  hashLines: [],
  seq: 0,
};

let els;

const fmtHash = (bytes) => (state.hashFormat === 'base64' ? bytesToBase64(bytes) : state.hashFormat === 'HEX' ? toHex(bytes).toUpperCase() : toHex(bytes));

function stats(text) {
  const bytes = enc.encode(text).length;
  const chars = [...text].length;
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
  const words = (text.match(/[\p{L}\p{N}]+/gu) || []).length;
  const nf = new Intl.NumberFormat('es-ES');
  return `${nf.format(chars)} caracteres · ${nf.format(bytes)} bytes · ${nf.format(words)} palabras · ${nf.format(lines)} líneas`;
}

// ---------------------------------------------------------------- operaciones

function renderOps() {
  els.ops.replaceChildren(...Object.entries(GROUPS).map(([g, label]) => h('div', { class: 'tt-group' },
    h('span', { class: 'tt-group-label', text: label }),
    h('div', { class: 'chips' }, OPS.filter((o) => o.group === g).map((o) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(o.id === state.op), dataset: { op: o.id },
      onclick: () => selectTextOp(o.id),
    }, o.label))))));
}

export function selectTextOp(id) {
  if (!opById(id)) return;
  state.op = id;
  store.set('textOp', id);
  els.ops.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.op === id)));
  renderExtra();
  compute();
}

function renderExtra() {
  const op = opById(state.op);
  const parts = [];
  if (op.kind === 'hash') {
    parts.push(h('label', { class: 'tt-inline' }, h('span', { text: 'Formato' }),
      h('select', { onchange: (e) => { state.hashFormat = e.target.value; store.set('hashFormat', state.hashFormat); compute(); } },
        [['hex', 'hex'], ['HEX', 'HEX'], ['base64', 'Base64']].map(([v, l]) => h('option', { value: v, text: l, selected: v === state.hashFormat })))));
  }
  if (op.id === 'hmac') {
    parts.push(
      h('label', { class: 'tt-inline grow' }, h('span', { text: 'Clave' }),
        h('input', { type: 'text', value: state.hmacKey, placeholder: 'clave secreta (texto)', autocomplete: 'off', spellcheck: 'false', oninput: (e) => { state.hmacKey = e.target.value; compute(); } })),
      h('label', { class: 'tt-inline' }, h('span', { text: 'Algoritmo' }),
        h('select', { onchange: (e) => { state.hmacAlgo = e.target.value; store.set('hmacAlgo', state.hmacAlgo); compute(); } },
          ['SHA-256', 'SHA-1', 'SHA-384', 'SHA-512', 'MD5'].map((a) => h('option', { value: a, text: a, selected: a === state.hmacAlgo })))),
    );
  }
  els.extra.replaceChildren(...parts);
  els.extra.hidden = !parts.length;
  els.outLabel.textContent = `Resultado · ${op.label}`;
  const isHash = op.kind === 'hash';
  els.output.hidden = isHash;
  els.hashes.hidden = !isHash;
  els.use.hidden = isHash;
}

// ---------------------------------------------------------------- cálculo

let timer = null;
function schedule() {
  clearTimeout(timer);
  const len = els.input.value.length;
  els.stats.textContent = stats(els.input.value);
  renderSuggestions();
  if (len > LIVE_LIMIT) { setNote(`Texto muy largo: pulsa «Calcular» para procesarlo.`, false, true); return; }
  timer = setTimeout(compute, len > 200_000 ? 350 : 60);
}

function setNote(msg, isError = false, withButton = false) {
  els.note.replaceChildren();
  els.note.hidden = !msg;
  els.note.classList.toggle('error', isError);
  if (!msg) return;
  if (isError) els.note.append(icon('alert'));
  els.note.append(h('span', { text: msg }));
  if (withButton) els.note.append(h('button', { class: 'btn small', type: 'button', onclick: () => compute() }, 'Calcular'));
}

async function compute() {
  const seq = ++state.seq;
  const op = opById(state.op);
  const text = els.input.value;
  setNote('');
  try {
    if (op.kind === 'hash') {
      let rows;
      if (op.id === 'ntlm') {
        rows = [{ label: 'NTLM', bytes: ntlm(state.mode === 'utf8' ? text : new TextDecoder().decode(inputBytes(text, state.mode))) }];
        setNote('Hash NT de Windows: MD4 de la contraseña en UTF-16LE.');
      } else if (op.id === 'hmac') {
        const out = await hmac(state.hmacAlgo, enc.encode(state.hmacKey), inputBytes(text, state.mode));
        rows = [{ label: `HMAC-${state.hmacAlgo}`, bytes: out }];
        if (!state.hmacKey) setNote('Sin clave: se calcula con una clave vacía.');
      } else {
        const bytes = inputBytes(text, state.mode);
        rows = await allHashes(bytes);
        if (state.mode === 'utf8') rows.push({ label: 'NTLM', bytes: ntlm(text) });
      }
      if (seq !== state.seq) return;
      renderHashes(rows);
      return;
    }
    const r = runOp(op, text, state.mode);
    if (seq !== state.seq) return;
    state.output = r.text;
    els.output.value = r.text;
    if (r.note) setNote(r.note);
  } catch (e) {
    if (seq !== state.seq) return;
    state.output = '';
    els.output.value = '';
    renderHashes([]);
    setNote(e instanceof CodecError ? e.message : `No se pudo procesar: ${e.message || e}`, true);
  }
}

function renderHashes(rows) {
  state.hashLines = rows.map((r) => [r.label, fmtHash(r.bytes)]);
  state.output = state.hashLines.map(([l, v]) => `${l.padEnd(11)} ${v}`).join('\n');
  els.hashes.replaceChildren(...state.hashLines.map(([label, value]) => h('div', { class: 'tt-hash' },
    h('span', { class: 'tt-hash-label', text: label }),
    h('code', { class: 'tt-hash-value', text: value }),
    h('button', { class: 'icon-btn', type: 'button', title: `Copiar ${label}`, 'aria-label': `Copiar ${label}`, onclick: (e) => flash(e.currentTarget, copyText(value)) }, icon('copy')))));
}

async function flash(btn, promise) {
  const ok = await promise;
  btn.classList.add(ok ? 'ok' : 'fail');
  const prev = btn.querySelector('span')?.textContent;
  if (prev !== undefined) btn.querySelector('span').textContent = ok ? 'Copiado' : 'No se pudo copiar';
  setTimeout(() => { btn.classList.remove('ok', 'fail'); if (prev !== undefined) btn.querySelector('span').textContent = prev; }, 1200);
}

function renderSuggestions() {
  const ids = suggest(els.input.value).filter((id) => id !== state.op);
  els.suggest.replaceChildren(...(ids.length ? [h('span', { class: 'muted', text: 'Parece' })] : []),
    ...ids.map((id) => h('button', { class: 'chip suggest', type: 'button', onclick: () => selectTextOp(id) }, opById(id).label)));
}

// ---------------------------------------------------------------- arranque

export function initTextTool() {
  els = {
    input: $('#tt-input'), output: $('#tt-output'), ops: $('#tt-ops'), extra: $('#tt-extra'), hashes: $('#tt-hashes'),
    note: $('#tt-note'), stats: $('#tt-stats'), suggest: $('#tt-suggest'), outLabel: $('#tt-out-label'),
    mode: $('#tt-mode'), copy: $('#tt-copy'), use: $('#tt-use'), download: $('#tt-download'), clear: $('#tt-clear'),
  };
  els.mode.value = state.mode;
  els.mode.addEventListener('change', () => { state.mode = els.mode.value; store.set('textMode', state.mode); compute(); });
  els.input.addEventListener('input', schedule);
  els.clear.addEventListener('click', () => { els.input.value = ''; els.input.focus(); schedule(); });
  els.copy.addEventListener('click', () => flash(els.copy, copyText(state.output)));
  els.use.addEventListener('click', () => {
    els.input.value = state.output;
    state.mode = 'utf8'; els.mode.value = 'utf8'; store.set('textMode', 'utf8');
    schedule();
    els.input.focus();
  });
  els.download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([state.output], { type: 'text/plain;charset=utf-8' }));
    const a = h('a', { href: url, download: `resultado-${state.op}.txt` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  renderOps();
  renderExtra();
  schedule();
}

export const TEXT_OPS = OPS;
