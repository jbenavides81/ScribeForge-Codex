// What "scribeforge redact" marks, and the marked pages drawn as pictures: the same steps the app
// takes for Mark area, Find and mark and Redact. A plain function over pdf.js and a canvas, so the
// command line's hidden window and the unit tests (with Node's canvas) run the same code.
import type { PDFPageProxy } from 'pdfjs-dist';
import type { Rect, RedactedPage } from '../../../engine/types';
import type { RenderJob, RenderResult } from '../../../shared/cli';
import { burnPage, type MakeSurface } from '../redact/burn';
import { findTerm, pageGlyphs, pageMayContain, type PdfApi } from '../redact/glyphs';

export interface PdfPages {
  numPages: number;
  getPage(n: number): Promise<PDFPageProxy>;
}

export async function redactionPages(pdf: PdfPages, job: Omit<RenderJob, 'bytes' | 'password'>, api: PdfApi, make: MakeSurface): Promise<RenderResult> {
  const byPage = new Map<number, Rect[]>();
  const mark = (index: number, rects: Rect[]) => byPage.set(index, [...(byPage.get(index) ?? []), ...rects]);
  let marks = 0;

  for (const index of new Set(job.wholePages)) {
    const page = await pdf.getPage(index + 1);
    mark(index, [page.view.slice(0, 4) as Rect]);
    marks++;
  }

  // Areas are measured from the page's top-left corner as it's shown (with its own rotation).
  for (const area of job.areas) {
    const page = await pdf.getPage(area.page);
    const viewport = page.getViewport({ scale: 1 });
    const [x0, y0] = viewport.convertToPdfPoint(area.left, area.top);
    const [x1, y1] = viewport.convertToPdfPoint(area.right, area.bottom);
    mark(area.page - 1, [[Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]]);
    marks++;
  }

  const matches: Record<string, number> = {};
  const glyphs = new Map<number, ReturnType<typeof pageGlyphs>>();
  for (const term of job.find) {
    matches[term] = 0;
    for (let index = 0; index < pdf.numPages; index++) {
      const page = await pdf.getPage(index + 1);
      if (!(await pageMayContain(page, term))) continue;
      if (!glyphs.has(index)) glyphs.set(index, pageGlyphs(page, api));
      for (const match of findTerm(await glyphs.get(index)!, term)) {
        mark(index, match.boxes);
        matches[term]++;
        marks++;
      }
    }
  }

  const pages: Record<number, RedactedPage> = {};
  for (const [index, rects] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    pages[index] = await burnPage(await pdf.getPage(index + 1), rects, job.dpi, make, api.annotationsOff);
  }
  return { pages, marks, matches };
}
