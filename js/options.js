// Definición de los ajustes de conversión. Cada ruta declara qué claves usa
// (route.options) y aquí se describe cómo se muestran. `when(to)` limita un
// ajuste a ciertos formatos de destino.

const LOSSY_IMG = ['jpg', 'webp', 'avif'];
const VIDEO = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', 'wmv', 'mpeg', 'ts', '3gp', 'ogv', 'webp-anim'];
const AUDIO_LOSSY = ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'wma', 'ac3'];

export const OPTION_DEFS = {
  quality: {
    label: 'Calidad', type: 'range', min: 0.05, max: 1, step: 0.05, def: 0.85,
    fmt: (v) => `${Math.round(v * 100)} %`,
    when: (to, from) => LOSSY_IMG.includes(to) || VIDEO.includes(to) || (to === 'pdf' && from !== 'pdf') || (from === 'pdf' && to === 'jpg'),
    hint: 'Menos calidad = archivo más pequeño.',
  },
  resize: {
    label: 'Tamaño máximo', type: 'select', def: 'orig',
    choices: [['orig', 'Original'], ['3840', '3840 px'], ['2560', '2560 px'], ['1920', '1920 px'], ['1280', '1280 px'], ['1024', '1024 px'], ['800', '800 px'], ['512', '512 px'], ['256', '256 px'], ['75%', '75 %'], ['50%', '50 %'], ['25%', '25 %'], ['200%', '200 %']],
    hint: 'Lado mayor de la imagen. Nunca amplía salvo con porcentajes > 100 %.',
  },
  background: { label: 'Fondo para transparencias', type: 'color', def: '#ffffff', when: (to) => ['jpg', 'bmp'].includes(to) },
  icoSizes: {
    label: 'Tamaños del icono', type: 'select', def: '16,24,32,48,64,128,256', when: (to) => to === 'ico',
    choices: [['16,24,32,48,64,128,256', 'Completo (16–256 px)'], ['16,32,48', 'Favicon (16, 32, 48)'], ['256', 'Solo 256 px'], ['16', 'Solo 16 px']],
  },
  svgDetail: {
    label: 'Detalle del vectorizado', type: 'select', def: 'normal', when: (to) => to === 'svg',
    choices: [['bajo', 'Bajo (8 colores)'], ['normal', 'Normal (24 colores)'], ['alto', 'Alto (64 colores)']],
  },
  pdfPage: {
    label: 'Tamaño de página', type: 'select', def: 'a4', when: (to) => to === 'pdf' || to === 'merge-pdf',
    choices: [['a4', 'A4'], ['letter', 'Carta (EE. UU.)'], ['image', 'Igual que la imagen']],
  },
  pdfOrientation: {
    label: 'Orientación', type: 'select', def: 'auto', when: (to) => to === 'pdf',
    choices: [['auto', 'Automática'], ['portrait', 'Vertical'], ['landscape', 'Horizontal']],
  },
  dpi: { label: 'Resolución', type: 'select', def: '150', choices: [['72', '72 ppp'], ['96', '96 ppp'], ['150', '150 ppp'], ['200', '200 ppp'], ['300', '300 ppp (impresión)']] },
  audioBitrate: {
    label: 'Bitrate de audio', type: 'select', def: '192', when: (to) => AUDIO_LOSSY.includes(to) || VIDEO.includes(to),
    choices: [['64', '64 kbps'], ['96', '96 kbps'], ['128', '128 kbps'], ['160', '160 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']],
  },
  channels: { label: 'Canales', type: 'select', def: 'orig', choices: [['orig', 'Como el original'], ['1', 'Mono'], ['2', 'Estéreo']] },
  sampleRate: { label: 'Frecuencia de muestreo', type: 'select', def: 'orig', choices: [['orig', 'Como el original'], ['22050', '22,05 kHz'], ['44100', '44,1 kHz'], ['48000', '48 kHz']] },
  resolution: {
    label: 'Resolución de vídeo', type: 'select', def: 'orig', when: (to) => VIDEO.includes(to) || to === 'thumb' || to === 'frames',
    choices: [['orig', 'Original'], ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']],
    hint: 'Solo reduce; nunca amplía.',
  },
  gifFps: { group: 'gif', label: 'Fotogramas por segundo', type: 'select', def: '12', when: (to) => to === 'gif' || to === 'webp-anim', choices: [['5', '5'], ['8', '8'], ['10', '10'], ['12', '12'], ['15', '15'], ['20', '20'], ['25', '25']] },
  gifWidth: { group: 'gif', label: 'Ancho del GIF', type: 'select', def: '480', when: (to) => to === 'gif' || to === 'webp-anim', choices: [['240', '240 px'], ['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px'], ['0', 'Original']] },
  frameEvery: { group: 'frames', label: 'Un fotograma cada (s)', type: 'number', def: '1', min: 0.04, step: 0.5, when: (to) => to === 'frames' },
  trimStart: { group: 'trim', label: 'Recortar desde', type: 'text', def: '', placeholder: '0:00', hint: 'Formato h:mm:ss o segundos.' },
  trimEnd: { group: 'trim', label: 'Recortar hasta', type: 'text', def: '', placeholder: 'final' },
  copyStreams: { label: 'Copiar pistas sin recodificar (rápido, si el contenedor lo admite)', type: 'check', def: false },
  csvSafe: { label: 'Neutralizar fórmulas al exportar CSV (evita CSV injection)', type: 'check', def: false, when: (to) => ['csv', 'csv-excel', 'tsv'].includes(to) },
  password: { label: 'Contraseña del comprimido', type: 'password', def: '', placeholder: 'Solo si está cifrado' },
  subShift: { label: 'Desplazar tiempos (s)', type: 'number', def: '0', step: 0.1, hint: 'Negativo adelanta, positivo retrasa.' },
};

// Claves de grupo que usan las rutas -> claves reales
const GROUPS = { gif: ['gifFps', 'gifWidth'], frames: ['frameEvery'], trim: ['trimStart', 'trimEnd'] };

/** Expande las opciones de una ruta y filtra por destino. */
export function relevantOptions(routeOptions, to, from) {
  const keys = routeOptions.flatMap((k) => GROUPS[k] || [k]);
  return keys.filter((k) => OPTION_DEFS[k] && (!OPTION_DEFS[k].when || OPTION_DEFS[k].when(to, from)));
}

export function defaults() {
  return Object.fromEntries(Object.entries(OPTION_DEFS).map(([k, d]) => [k, d.def]));
}
