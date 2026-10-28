// Documentos: PDF, DOCX, ODT, RTF, EPUB, PPTX, HTML, Markdown, TXT, Jupyter.
// Todos pasan por un HTML intermedio (ver doc/hub.js), así que cualquier
// entrada se puede escribir en cualquier salida.

import { readDocument, ipynbToPython } from '../doc/readers.js';
import { writeHtml, writeMarkdown, writeText, writeDocx, writeOdt, writeRtf, writeEpub } from '../doc/writers.js';
import { writePdf } from '../doc/pdf-writer.js';
import { openPdf } from '../loaders.js';
import { canvasToBlob, textBlob, fail } from '../util.js';

export const DOC_IN = ['pdf', 'docx', 'odt', 'rtf', 'epub', 'pptx', 'html', 'md', 'txt', 'ipynb'];
export const DOC_OUT = ['pdf', 'docx', 'odt', 'rtf', 'epub', 'html', 'md', 'txt'];

/** Escribe un hub en el formato pedido. Lo usan también hojas de cálculo y datos. */
export async function writeHub(hub, to, ctx, base = 'documento') {
  ctx.progress?.(null, 'Generando documento…');
  switch (to) {
    case 'html': return writeHtml(hub);
    case 'md': return writeMarkdown(hub, base);
    case 'txt': return writeText(hub);
    case 'docx': return writeDocx(hub);
    case 'odt': return writeOdt(hub);
    case 'rtf': return writeRtf(hub);
    case 'epub': return writeEpub(hub, base, ctx.opts);
    case 'pdf': return writePdf(hub, ctx.opts || {});
    default: return fail(`Salida de documento no soportada: ${to}`);
  }
}

async function pdfToImages(input, to, ctx) {
  const pdf = await openPdf((await input.bytes()).slice());
  const dpi = Number(ctx.opts.dpi || 150);
  const max = Math.min(pdf.numPages, Number(ctx.opts.maxPages || 500));
  const out = [];
  const digits = String(max).length;
  for (let p = 1; p <= max; p++) {
    if (ctx.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    ctx.progress((p - 1) / max, `Renderizando página ${p} de ${max}`);
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: c2d, viewport: vp }).promise;
    const blob = await canvasToBlob(canvas, to === 'jpg' ? 'image/jpeg' : 'image/png', Number(ctx.opts.quality ?? 0.9));
    out.push({ name: `${input.base}-p${String(p).padStart(digits, '0')}.${to}`, blob });
    page.cleanup();
  }
  await (pdf.loadingTask?.destroy?.() ?? pdf.destroy?.());
  return out;
}

export default {
  id: 'document',
  routes: [
    {
      from: ['pdf'],
      to: ['png', 'jpg'],
      labels: { png: 'PNG (una imagen por página)', jpg: 'JPG (una imagen por página)' },
      options: ['dpi', 'quality'],
      run: pdfToImages,
    },
    {
      from: ['ipynb'],
      to: ['py'],
      run: async (input) => textBlob(ipynbToPython(await input.text()), 'text/x-python'),
    },
    {
      from: DOC_IN,
      to: DOC_OUT,
      options: ['pdfPage', 'pdfOrientation'],
      async run(input, to, ctx) {
        ctx.progress(null, 'Leyendo documento…');
        const hub = await readDocument(input, ctx);
        if (!hub.title) hub.title = input.base;
        return writeHub(hub, to, ctx, input.base);
      },
    },
  ],
};
