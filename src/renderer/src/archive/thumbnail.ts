// A small picture of a PDF's first page, for the Archive's list. Drawn here, in the sandboxed
// window, so the main process never reads PDFs; it stores the picture encrypted with the document.
import { REDACTION_COLOURS } from '../../../shared/annotationColours';
import type { PdfDocument } from '../viewer/pdfjs';

const WIDTH = 120;

/** The first page as a PNG, about 120 pixels wide, or undefined if it can't be drawn. */
export async function firstPagePicture(pdf: PdfDocument): Promise<Uint8Array | undefined> {
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    // Pages are drawn on paper white, a document colour rather than a theme one.
    context.fillStyle = REDACTION_COLOURS.paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}
