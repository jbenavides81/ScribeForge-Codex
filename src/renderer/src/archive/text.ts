// Each page's text, for the Archive's search index (stop 3b). Read here, with pdf.js in the
// sandboxed window, as Find reads it; the main process never reads PDFs.
import type { PdfDocument } from '../viewer/pdfjs';

/** The text of every page, in order; an empty string for a page with none (usually a scan). */
export async function pageTexts(pdf: PdfDocument, onPage?: (n: number, of: number) => void): Promise<string[]> {
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    try {
      const content = await (await pdf.getPage(n)).getTextContent();
      const text = content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join('');
      texts.push(text.replace(/\s+/g, ' ').trim());
    } catch {
      texts.push(''); // a damaged page: nothing to search on it
    }
    onPage?.(n, pdf.numPages);
  }
  return texts;
}
