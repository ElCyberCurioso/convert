// Catálogo de formatos. Cada id es único; `ext` es la extensión de salida
// por defecto y `exts` las que se reconocen al detectar la entrada.
// Los ids con `variant: true` son salidas alternativas (no se detectan).

export const CATEGORIES = {
  image: 'Imagen',
  audio: 'Audio',
  video: 'Vídeo',
  doc: 'Documento',
  sheet: 'Hoja de cálculo',
  data: 'Datos',
  archive: 'Comprimido',
  font: 'Fuente',
  subtitle: 'Subtítulos',
  other: 'Codificación y otros',
};

const F = (cat, label, exts, mime, extra = {}) => ({ cat, label, exts, ext: exts[0], mime, ...extra });

export const FORMATS = {
  // Imagen
  png: F('image', 'PNG', ['png'], 'image/png'),
  jpg: F('image', 'JPG', ['jpg', 'jpeg', 'jpe', 'jfif'], 'image/jpeg'),
  webp: F('image', 'WEBP', ['webp'], 'image/webp'),
  avif: F('image', 'AVIF', ['avif'], 'image/avif'),
  gif: F('image', 'GIF', ['gif'], 'image/gif'),
  bmp: F('image', 'BMP', ['bmp', 'dib'], 'image/bmp'),
  ico: F('image', 'ICO', ['ico'], 'image/x-icon'),
  tiff: F('image', 'TIFF', ['tif', 'tiff'], 'image/tiff'),
  svg: F('image', 'SVG', ['svg'], 'image/svg+xml'),
  heic: F('image', 'HEIC/HEIF', ['heic', 'heif', 'hif'], 'image/heic'),
  psd: F('image', 'PSD', ['psd'], 'image/vnd.adobe.photoshop'),

  // Audio
  mp3: F('audio', 'MP3', ['mp3'], 'audio/mpeg'),
  wav: F('audio', 'WAV', ['wav', 'wave'], 'audio/wav'),
  ogg: F('audio', 'OGG (Vorbis)', ['ogg', 'oga'], 'audio/ogg'),
  opus: F('audio', 'OPUS', ['opus'], 'audio/opus'),
  flac: F('audio', 'FLAC', ['flac'], 'audio/flac'),
  m4a: F('audio', 'M4A (AAC)', ['m4a', 'm4b'], 'audio/mp4'),
  aac: F('audio', 'AAC', ['aac'], 'audio/aac'),
  aiff: F('audio', 'AIFF', ['aiff', 'aif', 'aifc'], 'audio/aiff'),
  wma: F('audio', 'WMA', ['wma'], 'audio/x-ms-wma'),
  amr: F('audio', 'AMR', ['amr'], 'audio/amr'),
  ac3: F('audio', 'AC3', ['ac3'], 'audio/ac3'),
  mka: F('audio', 'MKA', ['mka'], 'audio/x-matroska'),
  weba: F('audio', 'WEBA', ['weba'], 'audio/webm'),
  caf: F('audio', 'CAF', ['caf'], 'audio/x-caf'),

  // Vídeo
  mp4: F('video', 'MP4 (H.264)', ['mp4', 'm4v'], 'video/mp4'),
  webm: F('video', 'WEBM (VP8)', ['webm'], 'video/webm'),
  mkv: F('video', 'MKV', ['mkv'], 'video/x-matroska'),
  mov: F('video', 'MOV', ['mov', 'qt'], 'video/quicktime'),
  avi: F('video', 'AVI', ['avi'], 'video/x-msvideo'),
  flv: F('video', 'FLV', ['flv', 'f4v'], 'video/x-flv'),
  wmv: F('video', 'WMV', ['wmv', 'asf'], 'video/x-ms-wmv'),
  mpeg: F('video', 'MPEG-2', ['mpg', 'mpeg', 'm2v', 'vob'], 'video/mpeg'),
  ts: F('video', 'MPEG-TS', ['ts', 'mts', 'm2ts'], 'video/mp2t'),
  '3gp': F('video', '3GP', ['3gp', '3g2'], 'video/3gpp'),
  ogv: F('video', 'OGV (Theora)', ['ogv'], 'video/ogg'),
  'webp-anim': F('video', 'WEBP animado', ['webp'], 'image/webp', { variant: true }),
  frames: F('video', 'Fotogramas PNG (1 por segundo)', ['png'], 'image/png', { variant: true }),
  thumb: F('video', 'Miniatura JPG', ['jpg'], 'image/jpeg', { variant: true }),

  // Documentos
  pdf: F('doc', 'PDF', ['pdf'], 'application/pdf'),
  docx: F('doc', 'DOCX (Word)', ['docx', 'docm', 'dotx'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  odt: F('doc', 'ODT (LibreOffice)', ['odt'], 'application/vnd.oasis.opendocument.text'),
  rtf: F('doc', 'RTF', ['rtf'], 'application/rtf'),
  epub: F('doc', 'EPUB', ['epub'], 'application/epub+zip'),
  pptx: F('doc', 'PPTX (PowerPoint)', ['pptx', 'pptm', 'ppsx'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  html: F('doc', 'HTML', ['html', 'htm', 'xhtml'], 'text/html'),
  md: F('doc', 'Markdown', ['md', 'markdown', 'mdown', 'mkd'], 'text/markdown'),
  txt: F('doc', 'Texto plano', ['txt', 'text', 'log'], 'text/plain'),
  ipynb: F('doc', 'Jupyter Notebook', ['ipynb'], 'application/x-ipynb+json'),
  py: F('doc', 'Script Python', ['py'], 'text/x-python', { variant: true }),

  // Hojas de cálculo
  xlsx: F('sheet', 'XLSX (Excel)', ['xlsx', 'xlsm', 'xltx'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  xls: F('sheet', 'XLS (Excel 97-2003)', ['xls'], 'application/vnd.ms-excel'),
  xlsb: F('sheet', 'XLSB', ['xlsb'], 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'),
  ods: F('sheet', 'ODS (LibreOffice)', ['ods'], 'application/vnd.oasis.opendocument.spreadsheet'),
  numbers: F('sheet', 'Numbers', ['numbers'], 'application/x-iwork-numbers-sffnumbers'),
  csv: F('sheet', 'CSV', ['csv'], 'text/csv'),
  'csv-excel': F('sheet', 'CSV para Excel en español (;)', ['csv'], 'text/csv', { variant: true }),
  tsv: F('sheet', 'TSV', ['tsv', 'tab'], 'text/tab-separated-values'),
  dbf: F('sheet', 'DBF (dBase)', ['dbf'], 'application/dbase'),
  sql: F('sheet', 'SQL (INSERT)', ['sql'], 'application/sql', { variant: true }),

  // Datos estructurados
  json: F('data', 'JSON', ['json', 'geojson', 'webmanifest'], 'application/json'),
  'json-min': F('data', 'JSON minificado', ['json'], 'application/json', { variant: true }),
  jsonl: F('data', 'JSON Lines', ['jsonl', 'ndjson'], 'application/x-ndjson'),
  yaml: F('data', 'YAML', ['yaml', 'yml'], 'application/yaml'),
  toml: F('data', 'TOML', ['toml'], 'application/toml'),
  xml: F('data', 'XML', ['xml', 'plist', 'rss', 'atom'], 'application/xml'),
  ini: F('data', 'INI', ['ini', 'cfg'], 'text/plain'),

  // Comprimidos
  zip: F('archive', 'ZIP', ['zip'], 'application/zip'),
  '7z': F('archive', '7Z', ['7z'], 'application/x-7z-compressed'),
  rar: F('archive', 'RAR', ['rar'], 'application/vnd.rar'),
  tar: F('archive', 'TAR', ['tar'], 'application/x-tar'),
  tgz: F('archive', 'TAR.GZ', ['tar.gz', 'tgz'], 'application/gzip'),
  tbz2: F('archive', 'TAR.BZ2', ['tar.bz2', 'tbz2', 'tbz'], 'application/x-bzip2'),
  txz: F('archive', 'TAR.XZ', ['tar.xz', 'txz'], 'application/x-xz'),
  gz: F('archive', 'GZIP', ['gz', 'gzip'], 'application/gzip'),
  bz2: F('archive', 'BZIP2', ['bz2'], 'application/x-bzip2'),
  xz: F('archive', 'XZ', ['xz'], 'application/x-xz'),
  iso: F('archive', 'ISO', ['iso'], 'application/x-iso9660-image'),
  cab: F('archive', 'CAB', ['cab'], 'application/vnd.ms-cab-compressed'),
  unpack: F('archive', 'Descomprimir', ['bin'], 'application/octet-stream', { variant: true }),

  // Fuentes
  ttf: F('font', 'TTF', ['ttf'], 'font/ttf'),
  otf: F('font', 'OTF', ['otf'], 'font/otf'),
  woff: F('font', 'WOFF', ['woff'], 'font/woff'),
  woff2: F('font', 'WOFF2', ['woff2'], 'font/woff2'),
  sfnt: F('font', 'TTF/OTF (escritorio)', ['ttf'], 'font/ttf', { variant: true }),
  'css-font': F('font', 'CSS @font-face (Base64)', ['css'], 'text/css', { variant: true }),

  // Subtítulos
  srt: F('subtitle', 'SRT', ['srt'], 'application/x-subrip'),
  vtt: F('subtitle', 'WebVTT', ['vtt'], 'text/vtt'),
  sbv: F('subtitle', 'SBV (YouTube)', ['sbv'], 'text/plain'),
  ass: F('subtitle', 'ASS/SSA', ['ass', 'ssa'], 'text/x-ssa'),
  'sub-txt': F('subtitle', 'Solo texto', ['txt'], 'text/plain', { variant: true }),

  // Codificación y otros
  b64: F('other', 'Base64', ['b64', 'base64'], 'text/plain'),
  datauri: F('other', 'Data URI', ['txt'], 'text/plain', { variant: true }),
  hex: F('other', 'Volcado hexadecimal', ['txt'], 'text/plain', { variant: true }),
  decoded: F('other', 'Decodificar Base64', ['bin'], 'application/octet-stream', { variant: true }),
  exe: F('other', 'Ejecutable PE', ['exe', 'dll', 'sys'], 'application/vnd.microsoft.portable-executable'),
  elf: F('other', 'Ejecutable ELF', ['elf', 'so'], 'application/x-elf'),
  sqlite: F('other', 'Base de datos SQLite', ['sqlite', 'sqlite3', 'db'], 'application/vnd.sqlite3'),
  bin: F('other', 'Desconocido', ['bin'], 'application/octet-stream'),
};

// Extensión -> id (las compuestas, como tar.gz, se resuelven primero)
const EXT_INDEX = new Map();
for (const [id, f] of Object.entries(FORMATS)) {
  if (f.variant || id === 'bin') continue;
  for (const e of f.exts) if (!EXT_INDEX.has(e)) EXT_INDEX.set(e, id);
}

export function formatFromName(name) {
  const lower = name.toLowerCase();
  for (const compound of ['tar.gz', 'tar.bz2', 'tar.xz']) {
    if (lower.endsWith('.' + compound)) return EXT_INDEX.get(compound);
  }
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_INDEX.get(lower.slice(dot + 1)) || null;
}

export function splitName(name) {
  const lower = name.toLowerCase();
  for (const compound of ['.tar.gz', '.tar.bz2', '.tar.xz']) {
    if (lower.endsWith(compound)) return { base: name.slice(0, -compound.length), ext: compound.slice(1) };
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

export const fmt = (id) => FORMATS[id] || FORMATS.bin;
