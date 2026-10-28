// Audio y vídeo con ffmpeg.wasm (núcleo de un hilo: no necesita
// SharedArrayBuffer ni cabeceras COOP/COEP, que GitHub Pages no permite).

import { VENDOR } from '../loaders.js';
import { fail, UserError, fetchWithProgress } from '../util.js';
import { FORMATS } from '../formats.js';

export const AUDIO_IN = ['mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'aiff', 'wma', 'amr', 'ac3', 'mka', 'weba', 'caf'];
export const VIDEO_IN = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', 'wmv', 'mpeg', 'ts', '3gp', 'ogv', 'gif'];
const AUDIO_OUT = ['mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'aiff', 'wma', 'ac3'];
const VIDEO_OUT = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', 'wmv', 'mpeg', 'ts', '3gp', 'ogv', 'gif', 'webp-anim', 'thumb', 'frames'];

// ---------------------------------------------------------------- instancia

let ffPromise = null;

async function getFFmpeg(ctx) {
  if (!ffPromise) {
    ffPromise = (async () => {
      const { FFmpeg } = await import(VENDOR + 'ffmpeg/index.js');
      const ff = new FFmpeg();
      // El .wasm se descarga con progreso; el navegador lo guarda en caché
      const wasm = await fetchWithProgress(VENDOR + 'ffmpeg-core/ffmpeg-core.wasm',
        (p) => ctx.progress(p, 'Descargando ffmpeg (32 MB, solo la primera vez)…'), ctx.signal);
      const wasmURL = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
      ctx.progress(null, 'Iniciando ffmpeg…');
      try {
        await ff.load({ coreURL: VENDOR + 'ffmpeg-core/ffmpeg-core.js', wasmURL });
      } finally { URL.revokeObjectURL(wasmURL); }
      return ff;
    })().catch((e) => { ffPromise = null; throw e; });
  }
  return ffPromise;
}

function resetFFmpeg() {
  const p = ffPromise;
  ffPromise = null;
  p?.then((ff) => ff.terminate()).catch(() => {});
}

const parseTime = (s) => {
  if (s == null || s === '') return null;
  const parts = String(s).trim().replace(',', '.').split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

/**
 * Ejecuta ffmpeg. `inputs`: [[nombre, Uint8Array | File]]; los File se montan
 * con WORKERFS (sin copiarlos a memoria). Devuelve los `outputs` leídos.
 * Si `outputs` es una RegExp, devuelve [{ name, data }] de los que coincidan.
 */
export async function runFFmpeg({ inputs, args, outputs, duration }, ctx) {
  const ff = await getFFmpeg(ctx);
  const log = [];
  let total = duration || 0;
  const onLog = ({ message }) => {
    log.push(message);
    if (log.length > 400) log.shift();
    if (!total) {
      const m = /Duration: (\d+:\d+:[\d.]+)/.exec(message);
      if (m) total = parseTime(m[1]);
    }
    const t = /time=\s*(\d+:\d+:[\d.]+)/.exec(message);
    if (t && total) ctx.progress(Math.min(0.99, parseTime(t[1]) / total), 'Convirtiendo…');
  };
  const onAbort = () => resetFFmpeg();
  ff.on('log', onLog);
  ctx.signal?.addEventListener('abort', onAbort, { once: true });
  const files = inputs.filter(([, d]) => d instanceof Blob);
  try {
    if (files.length) {
      await ff.createDir('/in').catch(() => {});
      await ff.mount('WORKERFS', { files: files.map(([n, f]) => new File([f], n)) }, '/in');
    }
    for (const [name, data] of inputs) if (!(data instanceof Blob)) await ff.writeFile(name, data.slice());
    ctx.progress(total ? 0 : null, 'Convirtiendo…');
    const code = await ff.exec(args);
    if (ctx.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    if (code !== 0) {
      const tail = log.filter((l) => /error|invalid|not|unsupported|could|failed/i.test(l)).slice(-3).join(' · ');
      throw new UserError(`ffmpeg terminó con error${tail ? `: ${tail}` : ''}`);
    }
    if (outputs instanceof RegExp) {
      const list = (await ff.listDir('/')).filter((e) => !e.isDir && outputs.test(e.name)).map((e) => e.name).sort();
      const res = [];
      for (const name of list) { res.push({ name, data: await ff.readFile(name) }); await ff.deleteFile(name); }
      return res;
    }
    const res = [];
    for (const name of outputs) res.push(await ff.readFile(name));
    return res;
  } finally {
    ff.off('log', onLog);
    ctx.signal?.removeEventListener('abort', onAbort);
    if (ffPromise) {
      // Limpieza del sistema de archivos virtual para no acumular memoria
      for (const [name, data] of inputs) if (!(data instanceof Blob)) await ff.deleteFile(name).catch(() => {});
      if (!(outputs instanceof RegExp)) for (const name of outputs || []) await ff.deleteFile(name).catch(() => {});
      if (files.length) await ff.unmount('/in').catch(() => {});
    }
  }
}

/** Información básica del archivo con ffprobe. */
async function probe(path, ctx) {
  const ff = await getFFmpeg(ctx);
  const out = 'probe.json';
  await ff.ffprobe(['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,avg_frame_rate,width,height:stream_disposition=attached_pic',
    '-of', 'json', path, '-o', out]);
  try {
    const json = JSON.parse(await ff.readFile(out, 'utf8'));
    await ff.deleteFile(out).catch(() => {});
    const streams = json.streams || [];
    const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const audio = streams.find((s) => s.codec_type === 'audio');
    const [n, d] = String(video?.avg_frame_rate || '0/1').split('/').map(Number);
    return {
      duration: Number(json.format?.duration) || 0,
      video, audio,
      fps: d ? n / d : 0,
      vcodec: video?.codec_name, acodec: audio?.codec_name,
    };
  } catch {
    return { duration: 0 };
  }
}

// ---------------------------------------------------------------- argumentos

const crf264 = (q) => String(Math.round(18 + (1 - q) * 22)); // 18 (máx.) … 40
const crfVpx = (q) => String(Math.round(10 + (1 - q) * 40)); // 10 … 50
const qscale = (q) => String(Math.round(2 + (1 - q) * 12)); // 2 … 14

function scaleFilter(opts, info) {
  const h = parseInt(opts.resolution, 10);
  if (!h || !info.video || info.video.height <= h) return null;
  return `scale=-2:${h}:flags=lanczos`;
}

function audioArgs(to, o) {
  const ab = `${o.audioBitrate || 192}k`;
  const common = [];
  if (o.channels === '1') common.push('-ac', '1');
  if (o.sampleRate && o.sampleRate !== 'orig') common.push('-ar', String(o.sampleRate));
  switch (to) {
    case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', ab, ...common];
    case 'wav': return ['-c:a', 'pcm_s16le', ...common];
    case 'ogg': return ['-c:a', 'libvorbis', '-b:a', ab, ...common];
    case 'opus': return ['-c:a', 'libopus', '-b:a', ab, ...common];
    case 'flac': return ['-c:a', 'flac', ...common];
    case 'm4a': return ['-c:a', 'aac', '-b:a', ab, '-movflags', '+faststart', ...common];
    case 'aac': return ['-c:a', 'aac', '-b:a', ab, '-f', 'adts', ...common];
    case 'aiff': return ['-c:a', 'pcm_s16be', ...common];
    case 'wma': return ['-c:a', 'wmav2', '-b:a', ab, ...common];
    case 'ac3': return ['-c:a', 'ac3', '-b:a', `${Math.max(192, o.audioBitrate || 192)}k`, ...common];
    default: return fail(`Salida de audio no soportada: ${to}`);
  }
}

function videoArgs(to, o, info) {
  const q = Math.min(1, Math.max(0.05, Number(o.quality ?? 0.8)));
  const ab = `${o.audioBitrate || 160}k`;
  const vf = [scaleFilter(o, info)].filter(Boolean);
  const x264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf264(q), '-pix_fmt', 'yuv420p'];
  const withVf = (extra = []) => [...(vf.length || extra.length ? ['-vf', [...extra, ...vf].join(',')] : [])];
  // H.264 en yuv420p exige dimensiones pares
  const even = 'pad=ceil(iw/2)*2:ceil(ih/2)*2';
  const aac = info.audio ? ['-c:a', 'aac', '-b:a', ab] : ['-an'];
  switch (to) {
    case 'mp4':
    case 'mov': return [...x264, ...withVf([even]), ...aac, '-movflags', '+faststart'];
    case 'mkv': return [...x264, ...withVf([even]), ...aac];
    case 'ts': return [...x264, ...withVf([even]), ...aac, '-f', 'mpegts'];
    case 'flv': return [...x264, ...withVf([even]), ...(info.audio ? ['-c:a', 'aac', '-b:a', ab, '-ar', '44100'] : ['-an'])];
    case '3gp': return [...x264, '-profile:v', 'baseline', ...withVf([even]),
      ...(info.audio ? ['-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100'] : ['-an'])];
    case 'webm': return ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-crf', crfVpx(q), '-b:v', '4M',
      ...withVf(), ...(info.audio ? ['-c:a', 'libopus', '-b:a', ab] : ['-an'])];
    case 'avi': return ['-c:v', 'mpeg4', '-vtag', 'xvid', '-q:v', qscale(q), ...withVf([even]),
      ...(info.audio ? ['-c:a', 'libmp3lame', '-b:a', ab] : ['-an'])];
    case 'wmv': return ['-c:v', 'wmv2', '-q:v', qscale(q), ...withVf([even]), ...(info.audio ? ['-c:a', 'wmav2', '-b:a', ab] : ['-an'])];
    case 'mpeg': {
      // MPEG-2 solo admite ciertas cadencias
      const ok = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].some((r) => Math.abs(r - info.fps) < 0.01);
      return ['-c:v', 'mpeg2video', '-q:v', qscale(q), ...(ok ? [] : ['-r', '25']), ...withVf([even]),
        ...(info.audio ? ['-c:a', 'mp2', '-b:a', '192k'] : ['-an']), '-f', 'mpeg'];
    }
    case 'ogv': return ['-c:v', 'libtheora', '-q:v', String(Math.round(q * 10)), ...withVf(),
      ...(info.audio ? ['-c:a', 'libvorbis', '-q:a', '5'] : ['-an'])];
    case 'gif': {
      const w = parseInt(o.gifWidth || '480', 10);
      const fps = parseInt(o.gifFps || '12', 10);
      const scale = w ? `,scale='min(${w},iw)':-2:flags=lanczos` : '';
      return ['-filter_complex', `[0:v]fps=${fps}${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
        '-loop', '0', '-an'];
    }
    case 'webp-anim': {
      const w = parseInt(o.gifWidth || '480', 10);
      const fps = parseInt(o.gifFps || '12', 10);
      const scale = w ? `,scale='min(${w},iw)':-2:flags=lanczos` : '';
      return ['-vf', `fps=${fps}${scale}`, '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(Math.round(q * 100)),
        '-loop', '0', '-an'];
    }
    case 'thumb': return ['-vf', ['thumbnail=60', ...vf].join(','), '-frames:v', '1', '-q:v', '2', '-an'];
    default: return fail(`Salida de vídeo no soportada: ${to}`);
  }
}

// ---------------------------------------------------------------- ejecución

async function convertMedia(input, to, ctx) {
  const o = ctx.opts;
  const inName = `input.${input.ext || FORMATS[input.format]?.ext || 'bin'}`;
  const inPath = `/in/${inName}`;
  // Montaje temporal solo para sondear el archivo
  const ff = await getFFmpeg(ctx);
  ctx.progress(null, 'Analizando…');
  await ff.createDir('/in').catch(() => {});
  await ff.mount('WORKERFS', { files: [new File([input.file], inName)] }, '/in');
  let info;
  try { info = await probe(inPath, ctx); } finally { await ff.unmount('/in').catch(() => {}); }

  const isAudioOut = AUDIO_OUT.includes(to);
  if (!isAudioOut && !info.video) fail('El archivo no contiene pista de vídeo.');
  if (isAudioOut && !info.audio) fail('El archivo no contiene pista de audio.');

  const start = parseTime(o.trimStart);
  const end = parseTime(o.trimEnd);
  const pre = [];
  const post = [];
  if (start) pre.push('-ss', String(start));
  if (end && end > (start || 0)) post.push('-t', String(end - (start || 0)));
  const duration = (end || info.duration || 0) - (start || 0);

  const ext = FORMATS[to].ext;
  if (to === 'frames') {
    const every = Math.max(0.04, Number(o.frameEvery || 1));
    const vf = [`fps=1/${every}`, scaleFilter(o, info)].filter(Boolean).join(',');
    const frames = await runFFmpeg({
      inputs: [[inName, input.file]],
      args: [...pre, '-i', inPath, ...post, '-vf', vf, '-frames:v', '2000', 'frame_%05d.png'],
      outputs: /^frame_\d+\.png$/, duration,
    }, ctx);
    if (!frames.length) fail('No se extrajo ningún fotograma.');
    ctx.progress(null, 'Empaquetando fotogramas…');
    const { zipSync } = await (await import('../loaders.js')).loadFflate();
    const entries = Object.fromEntries(frames.map((f, i) => [`${input.base}_${String(i + 1).padStart(5, '0')}.png`, [f.data, { level: 0 }]]));
    return { name: `${input.base}-fotogramas.zip`, blob: new Blob([zipSync(entries)], { type: 'application/zip' }) };
  }

  const outName = `output.${ext}`;
  const codecArgs = isAudioOut ? ['-vn', ...audioArgs(to, o)] : videoArgs(to, o, info);
  const attempts = [];
  // Copia directa de pistas cuando se pide y el contenedor lo admite
  if (o.copyStreams && ['mp4', 'mkv', 'mov', 'ts', 'flv', 'avi', 'webm', '3gp', 'mka', 'm4a'].includes(to) && !start && !end) {
    attempts.push(['-c', 'copy', ...(to === 'mp4' || to === 'mov' ? ['-movflags', '+faststart'] : [])]);
  }
  attempts.push(codecArgs);

  let lastErr;
  for (const a of attempts) {
    try {
      const [data] = await runFFmpeg({
        inputs: [[inName, input.file]],
        args: [...pre, '-i', inPath, ...post, '-map_metadata', '0', ...a, outName],
        outputs: [outName], duration,
      }, ctx);
      if (!data?.length) throw new UserError('ffmpeg no generó salida.');
      return new Blob([data], { type: FORMATS[to].mime });
    } catch (e) {
      if (e.name === 'AbortError' || ctx.signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

export default {
  id: 'media',
  routes: [
    {
      from: AUDIO_IN,
      to: AUDIO_OUT,
      allowSame: true,
      exclude: (from, to) => from === to && ['wav', 'flac', 'aiff'].includes(to),
      options: ['audioBitrate', 'channels', 'sampleRate', 'trim', 'copyStreams'],
      run: convertMedia,
    },
    {
      from: VIDEO_IN,
      to: [...VIDEO_OUT, ...AUDIO_OUT],
      allowSame: true,
      exclude: (from, to) => (from === 'gif' && AUDIO_OUT.includes(to)) || (from === to && !['mp4', 'webm', 'gif', 'mkv'].includes(to)),
      labels: { gif: 'GIF animado', thumb: 'Miniatura JPG', frames: 'Fotogramas PNG (ZIP)' },
      options: ['quality', 'resolution', 'audioBitrate', 'gif', 'frames', 'trim', 'copyStreams'],
      run: convertMedia,
    },
  ],
};
