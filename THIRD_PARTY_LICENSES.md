# Licencias de terceros

Converter se apoya en estas librerías libres. Se copian sin modificar desde
`node_modules/` a `vendor/` con `npm run vendor`, salvo los ajustes mínimos de
carga que se indican (no alteran su funcionamiento).

| Componente | Versión | Licencia | Uso en Converter |
|---|---|---|---|
| [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (`@ffmpeg/ffmpeg`, `@ffmpeg/util`) | 0.12.15 / 0.12.2 | MIT | Envoltorio de ffmpeg en el navegador |
| [ffmpeg-core](https://github.com/ffmpegwasm/ffmpeg.wasm) (`@ffmpeg/core`) | 0.12.10 | **GPL-2.0-or-later** (incluye x264, x265, LAME, libvpx, Opus, Vorbis, Theora, libwebp) | Audio y vídeo |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | Lectura de PDF (texto y páginas) |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | Creación de PDF |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT | Fuentes en PDF (su import de `pako` se sustituye por fflate) |
| [DejaVu Fonts](https://dejavu-fonts.github.io/) | 2.37 | Bitstream Vera / dominio público (ver `vendor/fonts/LICENSE-DejaVu`) | Tipografía de los PDF generados |
| [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) · [IBM Plex Mono](https://github.com/IBM/plex) (vía Fontsource) | 5.3.0 | OFL-1.1 | Tipografía de la interfaz |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) | 1.13.0 | BSD-2-Clause | Lectura de DOCX |
| [docx](https://github.com/dolanmiu/docx) | 9.15.0 | MIT | Creación de DOCX |
| [marked](https://github.com/markedjs/marked) | 18.1.2 | MIT | Markdown → HTML |
| [Turndown](https://github.com/mixmark-io/turndown) + [plugin GFM](https://github.com/laurent22/joplin-turndown-plugin-gfm) | 7.2.4 / 1.0.68 | MIT | HTML → Markdown (el plugin se convierte de CommonJS a ESM) |
| [SheetJS CE](https://sheetjs.com/) (`@e965/xlsx`, réplica en npm de la 0.20.3 oficial) | 0.20.3 | Apache-2.0 | Hojas de cálculo |
| [js-yaml](https://github.com/nodeca/js-yaml) | 5.5.0 | MIT | YAML |
| [smol-toml](https://github.com/squirrelchat/smol-toml) | 1.9.1 | BSD-3-Clause | TOML |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) | 5.11.2 | MIT | XML |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | ZIP, GZIP, zlib |
| [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) | 2.0.2 | MIT (libarchive: BSD-2-Clause) | Lectura de ZIP, 7Z, RAR, TAR, ISO, CAB… |
| [7z-wasm](https://github.com/use-strict/7z-wasm) (7-Zip 24.09) | 1.2.0 | LGPL-2.1 + restricción unRAR (ver `vendor/7z/License.txt`) | Creación de 7Z y TAR.* |
| [bz2](https://github.com/sheetjs/bz2) | 1.0.1 | MIT | Descompresión BZIP2 |
| [xz-decompress](https://github.com/httptoolkit/xz-decompress) | 0.2.3 | MIT (xz-embedded: dominio público) | Descompresión XZ |
| [gifenc](https://github.com/mattdesl/gifenc) | 1.0.3 | MIT | GIF |
| [UTIF.js](https://github.com/photopea/UTIF.js) (`utif2`) | 4.1.0 | MIT | TIFF |
| [heic-to](https://github.com/hoppergee/heic-to) (libheif) | 1.6.7 | LGPL-3.0 | Lectura de HEIC/HEIF |
| [ImageTracer.js](https://github.com/jankovicsandras/imagetracerjs) | 1.2.6 | Unlicense (dominio público) | Vectorizado a SVG |
| [ag-psd](https://github.com/Agamnentzar/ag-psd) | 33.0.0 | MIT | Lectura de PSD |
| [jSquash AVIF](https://github.com/jamsinclair/jSquash) (libaom) | 2.1.1 | Apache-2.0 (libaom: BSD-2-Clause) | Codificación AVIF (se fuerza la versión de un hilo) |
| [woff2-encoder](https://github.com/itskyedo/woff2-encoder) (Google WOFF2) | 2.0.0 | MIT (woff2: MIT) | WOFF2 |

## Nota sobre la GPL

`ffmpeg-core.wasm` está compilado con `--enable-gpl`. Al publicar el sitio
distribuyes ese binario, así que se aplican las condiciones de la GPL a ese
componente: su código fuente y las instrucciones de compilación están en
<https://github.com/ffmpegwasm/ffmpeg.wasm>. El resto de Converter se comunica
con él a través de un Worker y no lo modifica.

*Esto no es asesoramiento legal; si el proyecto va a tener uso comercial, revisa
las licencias con alguien especializado.*
