// Output file names and page ranges.

/** "page 2", "pages 1-3", "pages 1-3, 5, 7-9", or "12 pages" when the list would be too long. */
export function pageLabel(pageNumbers: number[]): string {
  if (pageNumbers.length === 1) return `page ${pageNumbers[0]}`;
  const runs: string[] = [];
  let start = pageNumbers[0];
  let prev = start;
  for (const n of [...pageNumbers.slice(1), Number.NaN]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  const label = `pages ${runs.join(', ')}`;
  return label.length > 40 ? `${pageNumbers.length} pages` : label;
}

/** A file name Windows accepts: no reserved characters, no trailing dots or spaces, not too long. */
export function safeFileName(name: string): string {
  let clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean)) clean = `_${clean}`;
  if (clean.length === 0) clean = 'document';
  return clean.length > 150 ? clean.slice(0, 150).trim() : clean;
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '');
}

export type OutputKind = 'edited' | 'merged' | 'redacted' | 'cleaned' | { pages: number[] };

/** "<name> (edited).pdf", "<name> (merged).pdf", "<name> (redacted).pdf" or "<name> (pages 1-3).pdf". */
export function outputName(sourceFileName: string, kind: OutputKind): string {
  const suffix = typeof kind === 'string' ? kind : pageLabel(kind.pages);
  return `${safeFileName(`${baseName(sourceFileName)} (${suffix})`)}.pdf`;
}

export type RangeResult = { ok: true; parts: number[][] } | { ok: false; error: string };

/**
 * Reads split ranges like "1-3, 4, 6-9" (page numbers 1..pageCount). Each comma-separated range
 * becomes one file.
 */
export function parseRanges(text: string, pageCount: number): RangeResult {
  const pieces = text.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (pieces.length === 0) return { ok: false, error: 'Type the page ranges, for example 1-3, 4, 5-9.' };
  const parts: number[][] = [];
  for (const piece of pieces) {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(piece);
    if (!m) return { ok: false, error: `"${piece}" isn't a page or a range. Use numbers like 4 or 1-3.` };
    const start = Number(m[1]);
    const end = m[2] === undefined ? start : Number(m[2]);
    if (start < 1) return { ok: false, error: 'Pages are numbered from 1.' };
    if (end > pageCount || start > pageCount) {
      return { ok: false, error: `"${piece}" goes past the last page, which is page ${pageCount}.` };
    }
    if (end < start) return { ok: false, error: `"${piece}" runs backwards. Write the lower page first, like ${end}-${start}.` };
    parts.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
  }
  return { ok: true, parts };
}

/** Groups of `size` pages: every N pages. */
export function splitEvery(pageCount: number, size: number): number[][] {
  const parts: number[][] = [];
  for (let start = 1; start <= pageCount; start += size) {
    parts.push(Array.from({ length: Math.min(size, pageCount - start + 1) }, (_, i) => start + i));
  }
  return parts;
}
