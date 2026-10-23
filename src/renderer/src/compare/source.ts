// A version opened with pdf.js, as the comparison reads it (stop 3c): each page's lines of text,
// its size, and the page drawn on paper white. Drawn here, in the sandboxed window.
import { textLines, type CompareSource, type Pixels } from '../../../engine/compare/compare';
import { REDACTION_COLOURS } from '../../../shared/annotationColours';
import type { PdfDocument } from '../viewer/pdfjs';

export function pdfSource(pdf: PdfDocument): CompareSource {
  // One canvas, drawn on again for each page.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return {
    pages: pdf.numPages,
    lines: async (n) => {
      try {
        return textLines((await (await pdf.getPage(n)).getTextContent()).items);
      } catch {
        return []; // a damaged page: compared by how it looks
      }
    },
    size: async (n) => {
      const v = (await pdf.getPage(n)).getViewport({ scale: 1 });
      return { width: v.width, height: v.height };
    },
    draw: async (n, scale): Promise<Pixels> => {
      if (!context) throw new Error('No canvas to draw on.');
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      context.fillStyle = REDACTION_COLOURS.paper;
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      return { data: image.data, width: image.width, height: image.height };
    },
  };
}

/** Draws a page into a canvas about `width` pixels wide, for showing it. */
export async function drawPage(pdf: PdfDocument, n: number, canvas: HTMLCanvasElement, width: number): Promise<void> {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: (width / base.width) * ratio });
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = REDACTION_COLOURS.paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
}
