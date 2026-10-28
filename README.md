# Transmuta

**Conversor de archivos que funciona entero en el navegador.** Imágenes, audio, vídeo,
documentos, hojas de cálculo, datos, comprimidos, fuentes y subtítulos: **81 formatos
de entrada y 1.377 conversiones**, sin servidor, sin subir nada y sin dependencias de
terceros en tiempo de ejecución. Pensado para publicarse en **GitHub Pages**.

- **Privado por diseño.** Las conversiones se ejecutan en tu dispositivo con
  WebAssembly (ffmpeg, libarchive, 7-Zip, pdf.js, libaom, libheif…) y APIs del navegador.
- **Sin terceros.** Todo se sirve desde el propio sitio. La CSP solo permite `'self'`:
  la página no puede conectarse a ningún otro dominio.
- **Detección por firma.** El formato se identifica por los *magic bytes*, no solo por la
  extensión, y avisa si no coinciden (p. ej. un `.pdf` que en realidad es un ZIP).
- **Por lotes.** Arrastra o pega varios archivos, conviértelos todos a un formato común,
  únelos en un PDF o descárgalo todo en un ZIP.

## Publicar en GitHub Pages

1. Crea un repositorio (por ejemplo `transmuta`) y sube el contenido de esta carpeta:

   ```bash
   git init -b main
   git add .
   git commit -m "Transmuta: conversor de archivos en el navegador"
   git remote add origin git@github.com:TU_USUARIO/transmuta.git
   git push -u origin main
   ```

2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. El workflow `.github/workflows/deploy.yml` se ejecuta en cada push a `main`: instala las
   dependencias exactas del `package-lock.json` (`npm ci --ignore-scripts`), copia las
   librerías a `vendor/` y publica. En 1–2 minutos estará en
   `https://TU_USUARIO.github.io/transmuta/`.

El sitio funciona en cualquier subruta (todas las rutas son relativas), así que también
vale como sitio de usuario (`TU_USUARIO.github.io`) o con dominio propio.

### Alternativa sin Actions («Deploy from a branch»)

Si prefieres publicar directamente desde la rama, genera `vendor/` en local y súbelo:

```bash
npm ci && npm run vendor
# quita la línea «vendor/» del .gitignore
git add vendor && git commit -m "Librerías" && git push
```

Y en **Settings → Pages** elige *Deploy from a branch* → `main` → `/ (root)`. El archivo
más grande es `vendor/ffmpeg-core/ffmpeg-core.wasm` (~32 MB), por debajo del límite de
100 MB por archivo de GitHub.

## Desarrollo local

Requiere Node.js 20 o superior.

```bash
npm ci           # dependencias exactas
npm run vendor   # copia las librerías a vendor/
npm run serve    # http://localhost:8080/transmuta/  (imita GitHub Pages)
```

No hay paso de compilación: el código está en `js/` como módulos ES nativos y se puede
editar y recargar directamente.

## Cómo funciona

```
index.html            Interfaz y CSP
css/styles.css        Estilos (tema claro/oscuro, móvil)
js/app.js             Interfaz: cola, ajustes, progreso, descargas, catálogo
js/engine.js          Registro de rutas de conversión y ejecución
js/formats.js         Catálogo de formatos (extensiones, MIME, categoría)
js/detect.js          Detección por firma (magic bytes) + extensión
js/options.js         Ajustes de conversión y cuándo se muestran
js/loaders.js         Carga perezosa de librerías (solo lo que se usa)
js/converters/        Un módulo por familia: image, media, document, sheet,
                      data, archive, font, subtitle, generic
js/doc/               Documentos: lectores → HTML intermedio → escritores
js/data/              JSON, YAML, TOML, XML, INI
js/workers/           Código aislado en Workers (7-Zip, WOFF2)
scripts/vendor.mjs    Copia librerías de node_modules a vendor/
scripts/serve.mjs     Servidor local bajo /transmuta/
```

- **Rutas.** Cada conversor declara rutas `{ from: [...], to: [...], run }`. El motor
  calcula los destinos posibles de cada archivo y la interfaz los ofrece agrupados.
  Añadir un formato es añadirlo a `formats.js` y a una ruta.
- **Documentos.** Todos los lectores (PDF, DOCX, ODT, RTF, EPUB, PPTX, HTML, Markdown,
  TXT, Jupyter) producen un HTML intermedio inerte y saneado; todos los escritores (PDF,
  DOCX, ODT, RTF, EPUB, HTML, Markdown, TXT) parten de él. Con N lectores y M escritores
  se obtienen N×M conversiones.
- **PDF.** Se genera con un maquetador propio sobre pdf-lib con fuentes DejaVu
  incrustadas (subconjunto): texto real y seleccionable, acentos, rumano, cirílico y
  griego, tablas que se reparten entre páginas, enlaces activos y numeración.
- **Audio y vídeo.** ffmpeg.wasm con el núcleo de un hilo (GitHub Pages no permite las
  cabeceras COOP/COEP que exige `SharedArrayBuffer`). El núcleo (~32 MB) se descarga solo
  la primera vez que se convierte audio o vídeo y queda en la caché del navegador. Los
  archivos de entrada se montan con WORKERFS, sin copiarlos a memoria.
- **Imágenes.** Canvas del navegador más UTIF (TIFF), libheif (HEIC), ag-psd (PSD),
  gifenc (GIF), libaom vía jSquash (AVIF), ImageTracer (vectorizado a SVG) y codificadores
  propios de BMP e ICO (multitamaño).
- **Comprimidos.** Lectura con libarchive (ZIP, 7Z, RAR 4/5, TAR, ISO, CAB…), GZIP con
  fflate, BZIP2 y XZ con descompresores dedicados; escritura de ZIP con fflate y de 7Z/TAR.*
  con 7-Zip real (7z-wasm) en un Worker, que también sirve de respaldo para extraer lo que
  libarchive no abre (como 7Z cifrado con AES).

## Seguridad

- **CSP estricta** en `<meta>`: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`
  (compilar WebAssembly sin permitir `eval` de JavaScript), `worker-src 'self' blob:` (libheif
  arranca su Worker desde un `blob:`), `object-src 'none'`,
  `base-uri 'self'`, `form-action 'none'` y sin orígenes externos en `connect-src`.
  `frame-ancestors` no se puede fijar desde `<meta>`; GitHub Pages no permite cabeceras
  propias.
- **El codificador WOFF2** (Emscripten + embind) genera funciones con `eval`. En lugar de
  relajar la CSP de la página, se ejecuta en un Worker sin acceso al DOM.
- **Documentos inertes.** El HTML de entrada se procesa con `DOMParser` (no ejecuta
  scripts ni carga recursos) y se eliminan `script`, `iframe`, `object`, manejadores `on*`
  y URLs `javascript:`. Las imágenes solo se incrustan si son `data:` o `blob:`: nunca se
  descarga nada desde un documento.
- **Nombres y mensajes** del usuario se insertan siempre con `textContent`.
- **CSV injection.** Opción para neutralizar celdas que empiezan por `=`, `+`, `-` o `@`.
- **Cadena de suministro.** Versiones exactas en `package-lock.json`, `npm ci
  --ignore-scripts`, Actions fijadas por commit y Dependabot para actualizaciones menores.
  `scripts/vendor.mjs` falla si algún módulo importa un paquete que no se haya copiado.
- **Privacidad.** Sin cookies ni analítica. `localStorage` solo guarda tema, ajustes y el
  último formato elegido por tipo; la contraseña de comprimidos nunca se guarda.

## Limitaciones conocidas

- **Tamaño.** ffmpeg.wasm (un hilo) es varias veces más lento que el nativo y tiene un
  límite práctico de ~2 GB por archivo. Para vídeos largos, usa «Copiar pistas sin
  recodificar» cuando solo cambies de contenedor (MP4 ↔ MKV ↔ MOV…).
- **PDF → Word/texto** extrae el texto con heurísticas (párrafos, encabezados por tamaño
  de letra); no reconstruye la maquetación ni hace OCR de escaneos (para eso, PDF → PNG).
- **PPTX** se convierte en un documento con el texto, tablas e imágenes de cada
  diapositiva, no en una reproducción visual.
- **Fuentes CJK y emoji** no están en DejaVu: en los PDF generados aparecen como `?`.
- **AVIF** se decodifica con el navegador (Chrome, Edge, Firefox, Safari 16+).
- **RAR**: solo lectura (el formato es propietario). Los **ZIP y 7Z cifrados** se abren con
  su contraseña (el 7Z con AES, mediante 7-Zip), pero no se crean archivos cifrados.

## Formatos

Además de lo que indica cada tabla, **cualquier archivo** (incluidos ejecutables, bases de
datos u otros formatos desconocidos) puede comprimirse en ZIP o GZIP y convertirse a
Base64, Data URI o volcado hexadecimal.

### Imagen

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| PNG | `.png` | PNG (recomprimir), JPG, WEBP, AVIF, GIF, BMP, ICO, TIFF, SVG (vectorizado), PDF |
| JPG | `.jpg` `.jpeg` `.jpe` `.jfif` | PNG, JPG (recomprimir), WEBP, AVIF, GIF, BMP, ICO, TIFF, SVG (vectorizado), PDF |
| WEBP | `.webp` | PNG, JPG, WEBP (recomprimir), AVIF, GIF, BMP, ICO, TIFF, SVG (vectorizado), PDF |
| AVIF | `.avif` | PNG, JPG, WEBP, AVIF (recomprimir), GIF, BMP, ICO, TIFF, SVG (vectorizado), PDF |
| GIF | `.gif` | PNG, JPG, WEBP, AVIF, BMP, ICO, TIFF, SVG (vectorizado), GIF (recomprimir), MP4 (H.264), WEBM (VP8), MKV, MOV, AVI, FLV, WMV, MPEG-2, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP), PDF |
| BMP | `.bmp` `.dib` | PNG, JPG, WEBP, AVIF, GIF, ICO, TIFF, SVG (vectorizado), PDF |
| ICO | `.ico` | PNG, JPG, WEBP, AVIF, GIF, BMP, TIFF, SVG (vectorizado), PDF |
| TIFF | `.tif` `.tiff` | PNG, JPG, WEBP, AVIF, GIF, BMP, ICO, SVG (vectorizado), PDF |
| SVG | `.svg` | PNG, JPG, WEBP, AVIF, GIF, BMP, ICO, TIFF, PDF |
| HEIC/HEIF | `.heic` `.heif` `.hif` | PNG, JPG, WEBP, AVIF, GIF, BMP, ICO, TIFF, SVG (vectorizado), PDF |
| PSD | `.psd` | PNG, JPG, WEBP, AVIF, GIF, BMP, ICO, TIFF, SVG (vectorizado), PDF |

### Audio

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| MP3 | `.mp3` | MP3 (recomprimir), WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 |
| WAV | `.wav` `.wave` | MP3, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 |
| OGG (Vorbis) | `.ogg` `.oga` | MP3, WAV, OGG (Vorbis) (recomprimir), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 |
| OPUS | `.opus` | MP3, WAV, OGG (Vorbis), OPUS (recomprimir), FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 |
| FLAC | `.flac` | MP3, WAV, OGG (Vorbis), OPUS, M4A (AAC), AAC, AIFF, WMA, AC3 |
| M4A (AAC) | `.m4a` `.m4b` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC) (recomprimir), AAC, AIFF, WMA, AC3 |
| AAC | `.aac` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC (recomprimir), AIFF, WMA, AC3 |
| AIFF | `.aiff` `.aif` `.aifc` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, WMA, AC3 |
| WMA | `.wma` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA (recomprimir), AC3 |
| AMR | `.amr` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 |
| AC3 | `.ac3` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 (recomprimir) |
| MKA | `.mka` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 |
| WEBA | `.weba` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 |
| CAF | `.caf` | MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3 |

### Vídeo

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| MP4 (H.264) | `.mp4` `.m4v` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264) (recomprimir), WEBM (VP8), MKV, MOV, AVI, FLV, WMV, MPEG-2, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| WEBM (VP8) | `.webm` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8) (recomprimir), MKV, MOV, AVI, FLV, WMV, MPEG-2, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| MKV | `.mkv` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV (recomprimir), MOV, AVI, FLV, WMV, MPEG-2, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| MOV | `.mov` `.qt` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV, AVI, FLV, WMV, MPEG-2, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| AVI | `.avi` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV, MOV, FLV, WMV, MPEG-2, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| FLV | `.flv` `.f4v` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV, MOV, AVI, WMV, MPEG-2, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| WMV | `.wmv` `.asf` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV, MOV, AVI, FLV, MPEG-2, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| MPEG-2 | `.mpg` `.mpeg` `.m2v` `.vob` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV, MOV, AVI, FLV, WMV, MPEG-TS, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| MPEG-TS | `.ts` `.mts` `.m2ts` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV, MOV, AVI, FLV, WMV, MPEG-2, 3GP, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| 3GP | `.3gp` `.3g2` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV, MOV, AVI, FLV, WMV, MPEG-2, MPEG-TS, OGV (Theora), WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |
| OGV (Theora) | `.ogv` | GIF animado, MP3, WAV, OGG (Vorbis), OPUS, FLAC, M4A (AAC), AAC, AIFF, WMA, AC3, MP4 (H.264), WEBM (VP8), MKV, MOV, AVI, FLV, WMV, MPEG-2, MPEG-TS, 3GP, WEBP animado, Miniatura JPG, Fotogramas PNG (ZIP) |

### Documento

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| PDF | `.pdf` | PNG (una imagen por página), JPG (una imagen por página), DOCX (Word), ODT (LibreOffice), RTF, EPUB, HTML, Markdown, Texto plano |
| DOCX (Word) | `.docx` `.docm` `.dotx` | PDF, ODT (LibreOffice), RTF, EPUB, HTML, Markdown, Texto plano, XLSX (tablas del documento), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV (tablas del documento), CSV para Excel en español (;), TSV, JSON |
| ODT (LibreOffice) | `.odt` | PDF, DOCX (Word), RTF, EPUB, HTML, Markdown, Texto plano, XLSX (tablas del documento), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV (tablas del documento), CSV para Excel en español (;), TSV, JSON |
| RTF | `.rtf` | PDF, DOCX (Word), ODT (LibreOffice), EPUB, HTML, Markdown, Texto plano |
| EPUB | `.epub` | PDF, DOCX (Word), ODT (LibreOffice), RTF, HTML, Markdown, Texto plano |
| PPTX (PowerPoint) | `.pptx` `.pptm` `.ppsx` | PDF, DOCX (Word), ODT (LibreOffice), RTF, EPUB, HTML, Markdown, Texto plano |
| HTML | `.html` `.htm` `.xhtml` | PDF, DOCX (Word), ODT (LibreOffice), RTF, EPUB, Markdown, Texto plano, XLSX (tablas del documento), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV (tablas del documento), CSV para Excel en español (;), TSV, JSON |
| Markdown | `.md` `.markdown` `.mdown` `.mkd` | PDF, DOCX (Word), ODT (LibreOffice), RTF, EPUB, HTML, Texto plano, XLSX (tablas del documento), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV (tablas del documento), CSV para Excel en español (;), TSV, JSON |
| Texto plano | `.txt` `.text` `.log` | PDF, DOCX (Word), ODT (LibreOffice), RTF, EPUB, HTML, Markdown |
| Jupyter Notebook | `.ipynb` | Script Python, PDF, DOCX (Word), ODT (LibreOffice), RTF, EPUB, HTML, Markdown, Texto plano |

### Hoja de cálculo

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| XLSX (Excel) | `.xlsx` `.xlsm` `.xltx` | HTML (tabla), Markdown (tabla), PDF, DOCX (Word), ODT (LibreOffice), Texto (tabla alineada), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV, CSV para Excel en español (;), TSV, DBF (dBase), SQL (INSERT), JSON, JSON Lines, YAML, TOML, XML |
| XLS (Excel 97-2003) | `.xls` | HTML (tabla), Markdown (tabla), PDF, DOCX (Word), ODT (LibreOffice), Texto (tabla alineada), XLSX (Excel), XLSB, ODS (LibreOffice), CSV, CSV para Excel en español (;), TSV, DBF (dBase), SQL (INSERT), JSON, JSON Lines, YAML, TOML, XML |
| XLSB | `.xlsb` | HTML (tabla), Markdown (tabla), PDF, DOCX (Word), ODT (LibreOffice), Texto (tabla alineada), XLSX (Excel), XLS (Excel 97-2003), ODS (LibreOffice), CSV, CSV para Excel en español (;), TSV, DBF (dBase), SQL (INSERT), JSON, JSON Lines, YAML, TOML, XML |
| ODS (LibreOffice) | `.ods` | HTML (tabla), Markdown (tabla), PDF, DOCX (Word), ODT (LibreOffice), Texto (tabla alineada), XLSX (Excel), XLS (Excel 97-2003), XLSB, CSV, CSV para Excel en español (;), TSV, DBF (dBase), SQL (INSERT), JSON, JSON Lines, YAML, TOML, XML |
| Numbers | `.numbers` | HTML (tabla), Markdown (tabla), PDF, DOCX (Word), ODT (LibreOffice), Texto (tabla alineada), XLSX (Excel), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV, CSV para Excel en español (;), TSV, DBF (dBase), SQL (INSERT), JSON, JSON Lines, YAML, TOML, XML |
| CSV | `.csv` | HTML (tabla), Markdown (tabla), PDF, DOCX (Word), ODT (LibreOffice), Texto (tabla alineada), XLSX (Excel), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV para Excel en español (;), TSV, DBF (dBase), SQL (INSERT), JSON, JSON Lines, YAML, TOML, XML |
| TSV | `.tsv` `.tab` | HTML (tabla), Markdown (tabla), PDF, DOCX (Word), ODT (LibreOffice), Texto (tabla alineada), XLSX (Excel), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV, CSV para Excel en español (;), DBF (dBase), SQL (INSERT), JSON, JSON Lines, YAML, TOML, XML |
| DBF (dBase) | `.dbf` | HTML (tabla), Markdown (tabla), PDF, DOCX (Word), ODT (LibreOffice), Texto (tabla alineada), XLSX (Excel), XLS (Excel 97-2003), XLSB, ODS (LibreOffice), CSV, CSV para Excel en español (;), TSV, SQL (INSERT), JSON, JSON Lines, YAML, TOML, XML |

### Datos

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| JSON | `.json` `.geojson` `.webmanifest` | Markdown (tabla), HTML (tabla), PDF (tabla), CSV, CSV para Excel en español (;), TSV, XLSX (Excel), ODS (LibreOffice), SQL (INSERT), JSON (formatear), JSON minificado, JSON Lines, YAML, TOML, XML, INI |
| JSON Lines | `.jsonl` `.ndjson` | Markdown (tabla), HTML (tabla), PDF (tabla), CSV, CSV para Excel en español (;), TSV, XLSX (Excel), ODS (LibreOffice), SQL (INSERT), JSON, JSON minificado, YAML, TOML, XML, INI |
| YAML | `.yaml` `.yml` | Markdown (tabla), HTML (tabla), PDF (tabla), CSV, CSV para Excel en español (;), TSV, XLSX (Excel), ODS (LibreOffice), SQL (INSERT), JSON, JSON minificado, JSON Lines, TOML, XML, INI |
| TOML | `.toml` | Markdown (tabla), HTML (tabla), PDF (tabla), CSV, CSV para Excel en español (;), TSV, XLSX (Excel), ODS (LibreOffice), SQL (INSERT), JSON, JSON minificado, JSON Lines, YAML, XML, INI |
| XML | `.xml` `.plist` `.rss` `.atom` | Markdown (tabla), HTML (tabla), PDF (tabla), CSV, CSV para Excel en español (;), TSV, XLSX (Excel), ODS (LibreOffice), SQL (INSERT), JSON, JSON minificado, JSON Lines, YAML, TOML, INI |
| INI | `.ini` `.cfg` | Markdown (tabla), HTML (tabla), PDF (tabla), CSV, CSV para Excel en español (;), TSV, XLSX (Excel), ODS (LibreOffice), SQL (INSERT), JSON, JSON minificado, JSON Lines, YAML, TOML, XML |

### Comprimido

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| ZIP | `.zip` | 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |
| 7Z | `.7z` | ZIP, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |
| RAR | `.rar` | ZIP, 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |
| TAR | `.tar` | ZIP, 7Z, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |
| TAR.GZ | `.tar.gz` `.tgz` | ZIP, 7Z, TAR, TAR.BZ2, TAR.XZ, Extraer archivos |
| TAR.BZ2 | `.tar.bz2` `.tbz2` `.tbz` | ZIP, 7Z, TAR, TAR.GZ, TAR.XZ, Extraer archivos |
| TAR.XZ | `.tar.xz` `.txz` | ZIP, 7Z, TAR, TAR.GZ, TAR.BZ2, Extraer archivos |
| GZIP | `.gz` `.gzip` | ZIP, 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |
| BZIP2 | `.bz2` | ZIP, 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |
| XZ | `.xz` | ZIP, 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |
| ISO | `.iso` | ZIP, 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |
| CAB | `.cab` | ZIP, 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, Extraer archivos |

### Fuente

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| TTF | `.ttf` | WOFF, WOFF2, CSS @font-face (Base64) |
| OTF | `.otf` | WOFF, WOFF2, CSS @font-face (Base64) |
| WOFF | `.woff` | TTF/OTF (escritorio), WOFF2, CSS @font-face (Base64) |
| WOFF2 | `.woff2` | TTF/OTF (escritorio), WOFF, CSS @font-face (Base64) |

### Subtítulos

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| SRT | `.srt` | SRT (ajustar tiempos), WebVTT, SBV (YouTube), ASS/SSA, Solo texto |
| WebVTT | `.vtt` | SRT, WebVTT (ajustar tiempos), SBV (YouTube), ASS/SSA, Solo texto |
| SBV (YouTube) | `.sbv` | SRT, WebVTT, SBV (ajustar tiempos), ASS/SSA, Solo texto |
| ASS/SSA | `.ass` `.ssa` | SRT, WebVTT, SBV (YouTube), ASS (ajustar tiempos), Solo texto |

### Codificación y otros

| Entrada | Extensiones | Se convierte a |
|---|---|---|
| Base64 | `.b64` `.base64` | Decodificar Base64 → archivo |

## Licencia

El código de Transmuta se publica bajo licencia MIT (ver `LICENSE`). Las librerías que se
copian a `vendor/` mantienen sus propias licencias; están listadas en
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). Ojo: el núcleo de ffmpeg es GPL.
