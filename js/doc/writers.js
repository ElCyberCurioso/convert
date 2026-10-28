// Escritores de documentos (salvo PDF, que está en pdf-writer.js).

import { loadTurndown, loadGfm, loadDocx, loadFflate } from '../loaders.js';
import { hubBlocks, runsText, imageData, extForMime, escapeText } from './hub.js';
import { textBlob, escapeXml, dataURLToBytes } from '../util.js';

const HTML_CSS = `body{max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;font:17px/1.65 Georgia,'Iowan Old Style',serif;color:#1d1d1f;background:#fff}
h1,h2,h3,h4{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.25;margin:2rem 0 .75rem}
img{max-width:100%;height:auto}table{border-collapse:collapse;margin:1rem 0;font:15px/1.4 system-ui,sans-serif}
td,th{border:1px solid #d0d0d5;padding:.35rem .6rem;vertical-align:top}th{background:#f3f3f6;text-align:left}
pre{background:#f5f5f7;padding:1rem;overflow:auto;border-radius:6px}code{font:.9em ui-monospace,Menlo,Consolas,monospace}
blockquote{border-left:3px solid #c9c9d1;margin:1rem 0;padding:.1rem 1rem;color:#555}
[data-pagebreak]{break-after:page}@media print{[data-pagebreak]{border:0}}`;

// ---------------------------------------------------------------- HTML / MD / TXT

export function writeHtml(hub) {
  const title = escapeText(hub.title || 'Documento');
  const body = hub.doc.body.innerHTML.trim();
  return textBlob(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Converter">
<title>${title}</title>
<style>${HTML_CSS}</style>
</head>
<body>
${body}
</body>
</html>
`, 'text/html');
}

/** Markdown. Si hay imágenes incrustadas, devuelve un ZIP con el .md y la carpeta images/. */
export async function writeMarkdown(hub, base) {
  const TurndownService = await loadTurndown();
  const { gfm } = await loadGfm();
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---' });
  td.use(gfm);
  td.addRule('pagebreak', { filter: (n) => n.hasAttribute?.('data-pagebreak'), replacement: () => '\n\n' });
  const body = hub.doc.body.cloneNode(true);
  const images = {};
  let n = 0;
  for (const img of body.querySelectorAll('img[src^="data:"]')) {
    const d = dataURLToBytes(img.getAttribute('src'));
    if (!d) continue;
    const name = `images/imagen-${String(++n).padStart(3, '0')}.${extForMime(d.mime)}`;
    images[name] = d.bytes;
    img.setAttribute('src', name);
  }
  const md = td.turndown(body).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  if (!n) return textBlob(md, 'text/markdown');
  const { zipSync, strToU8 } = await loadFflate();
  const zip = zipSync({ [`${base}.md`]: strToU8(md), ...images });
  return { name: `${base}-markdown.zip`, blob: new Blob([zip], { type: 'application/zip' }) };
}

function blocksToText(blocks, indent = '') {
  const out = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'h': {
        const t = runsText(b.runs);
        out.push(b.level <= 2 ? `${t}\n${(b.level === 1 ? '=' : '-').repeat(Math.min(80, [...t].length))}` : t);
        break;
      }
      case 'p': out.push(indent + runsText(b.runs).replace(/\n/g, `\n${indent}`)); break;
      case 'list':
        out.push(b.items.map((item, i) => {
          const mark = b.ordered ? `${b.start + i}. ` : '• ';
          const inner = blocksToText(item, `${indent}${' '.repeat(mark.length)}`);
          return indent + mark + inner.trimStart();
        }).join('\n'));
        break;
      case 'code': out.push(b.text.split('\n').map((l) => `${indent}    ${l}`).join('\n')); break;
      case 'quote': out.push(blocksToText(b.blocks).split('\n').map((l) => `${indent}> ${l}`.trimEnd()).join('\n')); break;
      case 'hr': out.push(`${indent}${'─'.repeat(40)}`); break;
      case 'img': out.push(`${indent}[Imagen${b.alt ? `: ${b.alt}` : ''}]`); break;
      case 'table': {
        const rows = b.rows.map((r) => r.map((c) => runsText(c.runs).replace(/\n/g, ' ')));
        const cols = Math.max(...rows.map((r) => r.length));
        const w = Array.from({ length: cols }, (_, i) => Math.min(40, Math.max(...rows.map((r) => [...(r[i] || '')].length))));
        const line = (r) => indent + r.map((c, i) => (c || '').padEnd(w[i])).join(' │ ').trimEnd();
        const lines = rows.map(line);
        if (b.rows[0]?.every((c) => c.header)) lines.splice(1, 0, indent + w.map((x) => '─'.repeat(x)).join('─┼─'));
        out.push(lines.join('\n'));
        break;
      }
      default: break;
    }
  }
  return out.join(indent ? '\n' : '\n\n');
}

export function writeText(hub) {
  return textBlob(blocksToText(hubBlocks(hub)).replace(/\n{3,}/g, '\n\n').trim() + '\n');
}

// ---------------------------------------------------------------- DOCX

export async function writeDocx(hub) {
  const d = await loadDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, ExternalHyperlink, Table, TableRow,
    TableCell, WidthType, ShadingType, BorderStyle, PageBreak, LevelFormat, AlignmentType } = d;
  const H = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
  let listInstance = 0;

  const runs = (rs, extra = {}) => rs.map((r) => {
    if (r.br) return new TextRun({ break: 1 });
    const opts = {
      text: r.text, bold: r.b || extra.b, italics: r.i || extra.i, strike: r.s,
      underline: r.u ? {} : undefined, superScript: r.sup, subScript: r.sub,
      font: r.code ? 'Consolas' : undefined, color: extra.color,
    };
    if (r.href) return new ExternalHyperlink({ link: r.href, children: [new TextRun({ ...opts, style: 'Hyperlink' })] });
    return new TextRun(opts);
  });

  const out = [];
  const render = async (blocks, ctx = { level: 0, quote: false }) => {
    for (const b of blocks) {
      const indent = ctx.quote ? { left: 720 } : undefined;
      switch (b.t) {
        case 'h': out.push(new Paragraph({ heading: H[b.level - 1], children: runs(b.runs) })); break;
        case 'p': out.push(new Paragraph({ children: runs(b.runs, ctx.quote ? { i: true, color: '555555' } : {}), indent, spacing: { after: 120 } })); break;
        case 'list': {
          const instance = ++listInstance;
          for (const item of b.items) {
            let first = true;
            for (const ib of item) {
              if (ib.t === 'list') { await render([ib], { ...ctx, level: ctx.level + 1 }); continue; }
              if (first && (ib.t === 'p' || ib.t === 'h')) {
                out.push(new Paragraph({
                  children: runs(ib.runs),
                  numbering: { reference: b.ordered ? 'numeros' : 'vinetas', level: Math.min(8, ctx.level), instance },
                }));
                first = false;
              } else await render([ib], { ...ctx, level: ctx.level + 1 });
            }
          }
          break;
        }
        case 'code':
          for (const line of b.text.split('\n')) {
            out.push(new Paragraph({
              children: [new TextRun({ text: line.replace(/\t/g, '    ') || ' ', font: 'Consolas', size: 19 })],
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F3F5' }, spacing: { after: 0 },
            }));
          }
          out.push(new Paragraph({ children: [] }));
          break;
        case 'quote': await render(b.blocks, { ...ctx, quote: true }); break;
        case 'hr': out.push(new Paragraph({ thematicBreak: true, children: [] })); break;
        case 'pagebreak': out.push(new Paragraph({ children: [new PageBreak()] })); break;
        case 'img': {
          const img = await imageData(b.src, ['image/png', 'image/jpeg', 'image/gif', 'image/bmp']);
          if (!img) { out.push(new Paragraph({ children: [new TextRun({ text: `[Imagen${b.alt ? `: ${b.alt}` : ''}]`, italics: true })] })); break; }
          const k = Math.min(1, 600 / img.width, 800 / img.height);
          out.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({
              type: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' }[img.mime],
              data: img.bytes, transformation: { width: Math.round(img.width * k), height: Math.round(img.height * k) },
              altText: b.alt ? { name: b.alt.slice(0, 60), description: b.alt, title: b.alt.slice(0, 60) } : undefined,
            })],
          }));
          break;
        }
        case 'table': {
          const cols = Math.max(...b.rows.map((r) => r.length));
          const border = { style: BorderStyle.SINGLE, size: 4, color: 'C8C8D0' };
          out.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.rows.map((r) => new TableRow({
              tableHeader: r.every((c) => c.header),
              children: Array.from({ length: cols }, (_, i) => r[i] || { runs: [] }).map((c) => new TableCell({
                children: [new Paragraph({ children: runs(c.runs, c.header ? { b: true } : {}) })],
                shading: c.header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EFEFF3' } : undefined,
                borders: { top: border, bottom: border, left: border, right: border },
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
              })),
            })),
          }));
          out.push(new Paragraph({ children: [] }));
          break;
        }
        default: break;
      }
    }
  };
  await render(hubBlocks(hub));

  const levels = (ordered) => Array.from({ length: 9 }, (_, level) => ({
    level,
    format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : ['•', '◦', '▪'][level % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const doc = new Document({
    creator: 'Converter',
    title: hub.title || undefined,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: { config: [{ reference: 'vinetas', levels: levels(false) }, { reference: 'numeros', levels: levels(true) }] },
    sections: [{ children: out.length ? out : [new Paragraph({ children: [] })] }],
  });
  return Packer.toBlob(doc);
}

// ---------------------------------------------------------------- ODT

export async function writeOdt(hub) {
  const { zipSync, strToU8 } = await loadFflate();
  const blocks = hubBlocks(hub);
  const pictures = {};
  let picN = 0;
  const autoStyles = new Map(); // clave de formato -> nombre de estilo
  const textStyle = (r) => {
    const key = ['b', 'i', 'u', 's', 'code', 'sup', 'sub'].filter((k) => r[k]).join('+');
    if (!key) return null;
    if (!autoStyles.has(key)) autoStyles.set(key, `T${autoStyles.size + 1}`);
    return autoStyles.get(key);
  };
  const textXml = (s) => escapeXml(s)
    .replace(/\t/g, '<text:tab/>')
    .replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
  const runsXml = (rs) => rs.map((r) => {
    if (r.br) return '<text:line-break/>';
    let x = textXml(r.text);
    const st = textStyle(r);
    if (st) x = `<text:span text:style-name="${st}">${x}</text:span>`;
    if (r.href) x = `<text:a xlink:type="simple" xlink:href="${escapeXml(r.href)}">${x}</text:a>`;
    return x;
  }).join('');

  const body = [];
  const render = async (bs, pStyle = 'Standard') => {
    for (const b of bs) {
      switch (b.t) {
        case 'h': body.push(`<text:h text:style-name="Heading_20_${b.level}" text:outline-level="${b.level}">${runsXml(b.runs)}</text:h>`); break;
        case 'p': body.push(`<text:p text:style-name="${pStyle}">${runsXml(b.runs)}</text:p>`); break;
        case 'list': {
          body.push(`<text:list text:style-name="${b.ordered ? 'LNum' : 'LBul'}">`);
          for (const item of b.items) {
            body.push('<text:list-item>');
            await render(item, 'List_20_Paragraph');
            body.push('</text:list-item>');
          }
          body.push('</text:list>');
          break;
        }
        case 'code':
          for (const line of b.text.split('\n')) body.push(`<text:p text:style-name="Preformatted_20_Text">${textXml(line.replace(/^ /, ' '))}</text:p>`);
          break;
        case 'quote': await render(b.blocks, 'Quotations'); break;
        case 'hr': body.push('<text:p text:style-name="Horizontal_20_Line"/>'); break;
        case 'pagebreak': body.push('<text:p text:style-name="PageBreak"/>'); break;
        case 'img': {
          const img = await imageData(b.src, ['image/png', 'image/jpeg', 'image/gif']);
          if (!img) break;
          const name = `Pictures/img${++picN}.${extForMime(img.mime)}`;
          pictures[name] = { bytes: img.bytes, mime: img.mime };
          const k = Math.min(1, 16 / ((img.width / 96) * 2.54));
          const w = ((img.width / 96) * 2.54 * k).toFixed(2), h = ((img.height / 96) * 2.54 * k).toFixed(2);
          body.push(`<text:p text:style-name="Center"><draw:frame draw:name="img${picN}" text:anchor-type="as-char" svg:width="${w}cm" svg:height="${h}cm"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`);
          break;
        }
        case 'table': {
          const cols = Math.max(...b.rows.map((r) => r.length));
          body.push(`<table:table table:style-name="Tabla"><table:table-column table:number-columns-repeated="${cols}"/>`);
          for (const r of b.rows) {
            body.push('<table:table-row>');
            for (let i = 0; i < cols; i++) {
              const c = r[i] || { runs: [] };
              body.push(`<table:table-cell table:style-name="Celda" office:value-type="string"><text:p text:style-name="${c.header ? 'Table_20_Heading' : 'Table_20_Contents'}">${runsXml(c.runs)}</text:p></table:table-cell>`);
            }
            body.push('</table:table-row>');
          }
          body.push('</table:table>');
          break;
        }
        default: break;
      }
    }
  };
  await render(blocks);

  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" office:version="1.3"';
  const tprops = (key) => {
    const k = key.split('+');
    const p = [];
    if (k.includes('b')) p.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"');
    if (k.includes('i')) p.push('fo:font-style="italic" style:font-style-asian="italic"');
    if (k.includes('u')) p.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
    if (k.includes('s')) p.push('style:text-line-through-style="solid"');
    if (k.includes('code')) p.push('style:font-name="Liberation Mono" fo:font-family="\'Liberation Mono\', Consolas, monospace"');
    if (k.includes('sup')) p.push('style:text-position="super 58%"');
    if (k.includes('sub')) p.push('style:text-position="sub 58%"');
    return p.join(' ');
  };
  const listStyle = (name, ordered) => `<text:list-style style:name="${name}">${Array.from({ length: 10 }, (_, i) => (ordered
    ? `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * (i + 2)).toFixed(3)}cm"/></style:list-level-properties></text:list-level-style-number>`
    : `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${['•', '◦', '▪'][i % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * (i + 2)).toFixed(3)}cm"/></style:list-level-properties></text:list-level-style-bullet>`)).join('')}</text:list-style>`;

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${ns}>
<office:font-face-decls><style:font-face style:name="Liberation Mono" svg:font-family="'Liberation Mono'" style:font-family-generic="modern" style:font-pitch="fixed"/></office:font-face-decls>
<office:automatic-styles>
${[...autoStyles].map(([k, n]) => `<style:style style:name="${n}" style:family="text"><style:text-properties ${tprops(k)}/></style:style>`).join('\n')}
<style:style style:name="PageBreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="Center" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="Tabla" style:family="table"><style:table-properties style:width="17cm" table:align="margins" fo:margin-bottom="0.3cm"/></style:style>
<style:style style:name="Celda" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #b0b0b8"/></style:style>
${listStyle('LBul', false)}
${listStyle('LNum', true)}
</office:automatic-styles>
<office:body><office:text>
${body.join('\n') || '<text:p/>'}
</office:text></office:body>
</office:document-content>`;

  const heading = (n, size) => `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:default-outline-level="${n}" style:class="text"><style:text-properties fo:font-size="${size}pt" fo:font-weight="bold"/></style:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${ns}>
<office:font-face-decls><style:font-face style:name="Liberation Mono" svg:font-family="'Liberation Mono'" style:font-family-generic="modern" style:font-pitch="fixed"/></office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.21cm"/><style:text-properties fo:font-size="11pt" fo:language="es" fo:country="ES"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.21cm" fo:keep-with-next="always"/></style:style>
${heading(1, 20)}${heading(2, 16)}${heading(3, 14)}${heading(4, 12)}${heading(5, 11)}${heading(6, 11)}
<style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.1cm"/></style:style>
<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0cm" fo:background-color="#f3f3f5"/><style:text-properties style:font-name="Liberation Mono" fo:font-size="9.5pt"/></style:style>
<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="1cm" fo:border-left="1.5pt solid #c9c9d1" fo:padding-left="0.3cm"/><style:text-properties fo:font-style="italic" fo:color="#555555"/></style:style>
<style:style style:name="Horizontal_20_Line" style:display-name="Horizontal Line" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border-bottom="0.5pt solid #999999" fo:padding="0cm"/><style:text-properties fo:font-size="6pt"/></style:style>
<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0cm"/></style:style>
<style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents"><style:text-properties fo:font-weight="bold"/></style:style>
</office:styles>
<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>
</office:document-styles>`;

  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${ns}><office:meta><meta:generator>Converter</meta:generator>${hub.title ? `<dc:title>${escapeXml(hub.title)}</dc:title>` : ''}<dc:date>${new Date().toISOString().slice(0, 19)}</dc:date></office:meta></office:document-meta>`;

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
${Object.entries(pictures).map(([p, v]) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${v.mime}"/>`).join('\n')}
</manifest:manifest>`;

  const zip = zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': strToU8(content),
    'styles.xml': strToU8(styles),
    'meta.xml': strToU8(meta),
    'META-INF/manifest.xml': strToU8(manifest),
    ...Object.fromEntries(Object.entries(pictures).map(([p, v]) => [p, [v.bytes, { level: 0 }]])),
  });
  return new Blob([zip], { type: 'application/vnd.oasis.opendocument.text' });
}

// ---------------------------------------------------------------- RTF

const rtfEsc = (s) => {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (ch === '\t') out += '\\tab ';
    else if (ch === '\n') out += '\\line ';
    else if (c < 128) out += ch;
    else if (c < 0x10000) out += `\\u${c > 32767 ? c - 65536 : c}?`;
    else {
      // fuera del BMP: par sustituto
      const hi = Math.floor((c - 0x10000) / 0x400) + 0xd800, lo = ((c - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${hi - 65536}?\\u${lo - 65536}?`;
    }
  }
  return out;
};
const hex = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) { s += bytes[i].toString(16).padStart(2, '0'); if (i % 64 === 63) s += '\n'; } return s; };

export async function writeRtf(hub) {
  const runs = (rs) => rs.map((r) => {
    if (r.br) return '\\line ';
    let open = '', close = '';
    if (r.b) { open += '\\b '; close = '\\b0 ' + close; }
    if (r.i) { open += '\\i '; close = '\\i0 ' + close; }
    if (r.u || r.href) { open += '\\ul '; close = '\\ulnone ' + close; }
    if (r.s) { open += '\\strike '; close = '\\strike0 ' + close; }
    if (r.code) { open += '\\f1 '; close = '\\f0 ' + close; }
    if (r.sup) { open += '\\super '; close = '\\nosupersub ' + close; }
    if (r.sub) { open += '\\sub '; close = '\\nosupersub ' + close; }
    const text = `{${open}${r.href ? '\\cf1 ' : ''}${rtfEsc(r.text)}${close}}`;
    if (r.href) return `{\\field{\\*\\fldinst{HYPERLINK "${rtfEsc(r.href).replace(/"/g, '')}"}}{\\fldrslt${text}}}`;
    return text;
  }).join('');
  const SIZES = [0, 36, 30, 26, 24, 22, 22];
  const out = [];
  const render = async (blocks, ind = 0) => {
    for (const b of blocks) {
      switch (b.t) {
        case 'h': out.push(`\\pard\\sb240\\sa120\\keepn\\outlinelevel${b.level - 1}\\b\\fs${SIZES[b.level]} ${runs(b.runs)}\\b0\\fs22\\par`); break;
        case 'p': out.push(`\\pard\\li${ind}\\sa120 ${runs(b.runs)}\\par`); break;
        case 'list':
          for (const [i, item] of b.items.entries()) {
            const mark = b.ordered ? `${b.start + i}.` : '\\u8226?';
            const li = ind + 720;
            const [first, ...rest] = item;
            if (first?.runs) out.push(`\\pard\\li${li}\\fi-360\\sa60 ${mark}\\tab ${runs(first.runs)}\\par`);
            else if (first) rest.unshift(first);
            await render(rest, li);
          }
          break;
        case 'code':
          out.push(...b.text.split('\n').map((l) => `\\pard\\li${ind}\\sa0\\f1\\fs19\\cbpat2 ${rtfEsc(l) || ' '}\\f0\\fs22\\par`));
          out.push('\\pard\\sa120\\par');
          break;
        case 'quote': await render(b.blocks, ind + 720); break;
        case 'hr': out.push('\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par'); break;
        case 'pagebreak': out.push('\\page'); break;
        case 'img': {
          const img = await imageData(b.src);
          if (!img) break;
          const k = Math.min(1, 600 / img.width);
          const tw = Math.round(img.width * k * 15), th = Math.round(img.height * k * 15);
          out.push(`\\pard\\qc{\\pict\\${img.mime === 'image/png' ? 'pngblip' : 'jpegblip'}\\picw${img.width}\\pich${img.height}\\picwgoal${tw}\\pichgoal${th}\n${hex(img.bytes)}}\\par`);
          break;
        }
        case 'table': {
          const cols = Math.max(...b.rows.map((r) => r.length));
          const w = Math.floor(9600 / cols);
          for (const r of b.rows) {
            out.push(`\\trowd\\trgaph80${Array.from({ length: cols }, (_, i) => `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${w * (i + 1)}`).join('')}`);
            out.push(Array.from({ length: cols }, (_, i) => {
              const c = r[i] || { runs: [] };
              return `\\pard\\intbl ${c.header ? '\\b ' : ''}${runs(c.runs)}${c.header ? '\\b0 ' : ''}\\cell`;
            }).join(''));
            out.push('\\row');
          }
          out.push('\\pard\\par');
          break;
        }
        default: break;
      }
    }
  };
  await render(hubBlocks(hub));
  const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1
{\\fonttbl{\\f0\\fswiss\\fcharset0 Calibri;}{\\f1\\fmodern\\fcharset0 Consolas;}}
{\\colortbl;\\red5\\green99\\blue193;\\red243\\green243\\blue245;}
{\\info${hub.title ? `{\\title ${rtfEsc(hub.title)}}` : ''}{\\doccomm Converter}}
\\paperw11906\\paperh16838\\margl1134\\margr1134\\margt1134\\margb1134\\fs22
${out.join('\n')}
}`;
  return new Blob([rtf], { type: 'application/rtf' });
}

// ---------------------------------------------------------------- EPUB

export async function writeEpub(hub, base, opts = {}) {
  const { zipSync, strToU8 } = await loadFflate();
  const title = hub.title || base;
  const lang = opts.lang || 'es';
  const body = hub.doc.body.cloneNode(true);
  body.querySelectorAll('[data-pagebreak]').forEach((n) => n.remove());

  // Imágenes incrustadas -> archivos
  const images = {};
  let n = 0;
  for (const img of body.querySelectorAll('img')) {
    const d = dataURLToBytes(img.getAttribute('src') || '');
    if (!d || !/^image\/(png|jpeg|gif|svg\+xml|webp)$/.test(d.mime)) { img.remove(); continue; }
    const name = `images/img${++n}.${extForMime(d.mime)}`;
    images[name] = d;
    img.setAttribute('src', name);
    if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
  }

  // Capítulos: se corta por h1 (o h2) si hay varios
  const level = body.querySelectorAll('h1').length > 1 ? 'H1' : body.querySelectorAll('h2').length > 1 ? 'H2' : null;
  const chapters = [];
  let cur = { title: '', nodes: [] };
  for (const node of [...body.childNodes]) {
    if (level && node.nodeType === 1 && node.tagName === level && cur.nodes.some((x) => x.textContent.trim() || x.nodeName === 'IMG')) {
      chapters.push(cur); cur = { title: '', nodes: [] };
    }
    if (level && node.nodeType === 1 && node.tagName === level && !cur.title) cur.title = node.textContent.trim();
    cur.nodes.push(node);
  }
  chapters.push(cur);
  chapters.forEach((c, i) => { c.title ||= i === 0 ? title : `Capítulo ${i + 1}`; c.file = `capitulo-${String(i + 1).padStart(3, '0')}.xhtml`; });

  const ser = new XMLSerializer();
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const chapterXml = (c) => {
    const doc = document.implementation.createDocument(XHTML, 'html', null);
    const html = doc.documentElement;
    html.setAttribute('xml:lang', lang); html.setAttribute('lang', lang);
    const head = doc.createElementNS(XHTML, 'head');
    const t = doc.createElementNS(XHTML, 'title'); t.textContent = c.title;
    const link = doc.createElementNS(XHTML, 'link'); link.setAttribute('rel', 'stylesheet'); link.setAttribute('href', 'style.css'); link.setAttribute('type', 'text/css');
    head.append(t, link);
    const b = doc.createElementNS(XHTML, 'body');
    for (const node of c.nodes) b.append(doc.importNode(node, true));
    html.append(head, b);
    return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n${ser.serializeToString(doc)}`;
  };

  const uid = `urn:uuid:${crypto.randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier>
<dc:title>${escapeXml(title)}</dc:title>
<dc:language>${lang}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
<meta name="generator" content="Converter"/>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c, i) => `<item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
${Object.entries(images).map(([p, d], i) => `<item id="img${i + 1}" href="${p}" media-type="${d.mime}"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('\n')}
</spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><title>Índice</title></head>
<body><nav epub:type="toc" id="toc"><h1>Índice</h1><ol>
${chapters.map((c) => `<li><a href="${c.file}">${escapeXml(c.title)}</a></li>`).join('\n')}
</ol></nav></body></html>`;
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uid}"/></head>
<docTitle><text>${escapeXml(title)}</text></docTitle>
<navMap>${chapters.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`).join('')}</navMap>
</ncx>`;
  const css = 'body{font-family:serif;line-height:1.5;margin:0 5%}h1,h2,h3{font-family:sans-serif;line-height:1.2}img{max-width:100%}pre{white-space:pre-wrap;font-size:.85em;background:#f3f3f5;padding:.5em}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.2em .4em}blockquote{margin-left:1em;padding-left:1em;border-left:2px solid #bbb}';
  const zip = zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/toc.ncx': strToU8(ncx),
    'OEBPS/style.css': strToU8(css),
    ...Object.fromEntries(chapters.map((c) => [`OEBPS/${c.file}`, strToU8(chapterXml(c))])),
    ...Object.fromEntries(Object.entries(images).map(([p, d]) => [`OEBPS/${p}`, [d.bytes, { level: 0 }]])),
  });
  return new Blob([zip], { type: 'application/epub+zip' });
}
