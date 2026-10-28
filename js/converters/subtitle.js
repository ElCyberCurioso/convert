// Subtítulos: SRT, WebVTT, SBV (YouTube), ASS/SSA y texto plano.

import { fail, textBlob } from '../util.js';

const SUB_IN = ['srt', 'vtt', 'sbv', 'ass'];
const SUB_OUT = ['srt', 'vtt', 'sbv', 'ass', 'sub-txt'];

// ---------------------------------------------------------------- tiempos

function parseTs(s) {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/.exec(s.trim());
  if (!m) return null;
  const [, h = 0, mi, se, ms = '0'] = m;
  return ((Number(h) * 60 + Number(mi)) * 60 + Number(se)) * 1000 + Number(ms.padEnd(3, '0'));
}
const two = (n) => String(n).padStart(2, '0');
function fmtTs(ms, sep = ',', hours = 2, msDigits = 3) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  const frac = msDigits === 2 ? two(Math.floor((ms % 1000) / 10)) : String(ms % 1000).padStart(3, '0');
  return `${hours === 1 ? h : String(h).padStart(hours, '0')}:${two(m)}:${two(s)}${sep}${frac}`;
}

// ---------------------------------------------------------------- lectura

function parseBlocks(text, arrow) {
  const cues = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l, i) => i > 0 || l.trim());
    const ti = lines.findIndex((l) => l.includes(arrow));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split(arrow);
    const start = parseTs(a), end = parseTs(b);
    if (start === null || end === null) continue;
    const body = lines.slice(ti + 1).join('\n').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

const stripTags = (s) => s.replace(/<\/?(?:[biu]|font[^>]*|c(?:\.[^>]*)?|v[^>]*|lang[^>]*|ruby|rt|\d\d:[^>]*)>/gi, '');

function parseSbv(text) {
  const cues = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const [times, ...rest] = block.trim().split('\n');
    const m = /^([\d:.]+),([\d:.]+)$/.exec(times?.trim() || '');
    if (!m) continue;
    const body = rest.join('\n').trim();
    if (body) cues.push({ start: parseTs(m[1]), end: parseTs(m[2]), text: body });
  }
  return cues;
}

function parseAss(text) {
  const cues = [];
  let format = null;
  let inEvents = false;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (/^\[.+\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue; }
    if (!inEvents) continue;
    if (/^format:/i.test(line)) { format = line.slice(7).split(',').map((s) => s.trim().toLowerCase()); continue; }
    if (!/^dialogue:/i.test(line)) continue;
    const f = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const parts = line.slice(9).split(',');
    const vals = [...parts.slice(0, f.length - 1), parts.slice(f.length - 1).join(',')].map((s) => s.trim());
    const get = (k) => vals[f.indexOf(k)];
    const body = (get('text') || '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n').replace(/\\h/g, '\u00a0').trim();
    if (body) cues.push({ start: parseTs(get('start')), end: parseTs(get('end')), text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function readCues(format, text) {
  text = text.replace(/^\uFEFF/, '');
  let cues;
  if (format === 'srt') cues = parseBlocks(text, '-->').map((c) => ({ ...c, text: stripTags(c.text).replace(/\{\\[^}]*\}/g, '') }));
  else if (format === 'vtt') cues = parseBlocks(text.replace(/^WEBVTT[^\n]*\n/, ''), '-->').map((c) => ({ ...c, text: stripTags(c.text) }));
  else if (format === 'sbv') cues = parseSbv(text);
  else if (format === 'ass') cues = parseAss(text);
  if (!cues?.length) fail('No se encontraron subtítulos en el archivo.');
  return cues;
}

// ---------------------------------------------------------------- escritura

function writeCues(to, cues, base) {
  switch (to) {
    case 'srt': return textBlob(cues.map((c, i) => `${i + 1}\n${fmtTs(c.start)} --> ${fmtTs(c.end)}\n${c.text}\n`).join('\n'), 'application/x-subrip');
    case 'vtt': return textBlob(`WEBVTT\n\n${cues.map((c) => `${fmtTs(c.start, '.')} --> ${fmtTs(c.end, '.')}\n${c.text.replace(/-->/g, '→')}\n`).join('\n')}`, 'text/vtt');
    case 'sbv': return textBlob(cues.map((c) => `${fmtTs(c.start, '.', 1)},${fmtTs(c.end, '.', 1)}\n${c.text}\n`).join('\n'), 'text/plain');
    case 'ass': {
      const esc = (s) => s.replace(/\n/g, '\\N').replace(/[{}]/g, '');
      return textBlob(`[Script Info]
; Generado con Transmuta
Title: ${base}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cues.map((c) => `Dialogue: 0,${fmtTs(c.start, '.', 1, 2)},${fmtTs(c.end, '.', 1, 2)},Default,,0,0,0,,${esc(c.text)}`).join('\n')}
`, 'text/x-ssa');
    }
    case 'sub-txt': return textBlob(cues.map((c) => c.text.replace(/<[^>]+>/g, '')).join('\n\n') + '\n');
    default: return fail(`Salida de subtítulos no soportada: ${to}`);
  }
}

export default {
  id: 'subtitle',
  routes: [
    {
      from: SUB_IN,
      to: SUB_OUT,
      allowSame: true,
      sameLabels: { srt: 'SRT (ajustar tiempos)', vtt: 'WebVTT (ajustar tiempos)', sbv: 'SBV (ajustar tiempos)', ass: 'ASS (ajustar tiempos)' },
      options: ['subShift'],
      async run(input, to, ctx) {
        let cues = readCues(input.format, await input.text());
        const shift = Number(ctx.opts.subShift || 0) * 1000;
        if (shift) cues = cues.map((c) => ({ ...c, start: c.start + shift, end: c.end + shift })).filter((c) => c.end > 0);
        return writeCues(to, cues, input.base);
      },
    },
  ],
};
