// Bookmarks (the PDF "outline"). Copying pages never brings bookmarks along, so the engine reads
// each source's bookmarks first and writes new ones that point at pages in the new file.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, type PDFObject, type PDFRef } from '@cantoo/pdf-lib';
import { destinationTarget, N, nameOf, resolve, textOf, type DestTarget } from './objects';

export interface OutlineNode {
  title: string;
  /** Undefined for a heading with no page of its own. */
  target?: DestTarget;
  children: OutlineNode[];
}

const MAX_ITEMS = 10_000;

export function readOutline(doc: PDFDocument): OutlineNode[] {
  const root = doc.catalog.lookupMaybe(N('Outlines'), PDFDict);
  if (!root) return [];
  const pageIndexByRef = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const seen = new Set<PDFDict>();

  const readLevel = (first: PDFObject | undefined, depth: number): OutlineNode[] => {
    const nodes: OutlineNode[] = [];
    let item = resolve(doc, first);
    while (item instanceof PDFDict && !seen.has(item) && seen.size < MAX_ITEMS && depth < 50) {
      seen.add(item);
      let dest = item.get(N('Dest'));
      const action = resolve(doc, item.get(N('A')));
      if (!dest && action instanceof PDFDict && nameOf(action.get(N('S'))) === 'GoTo') dest = action.get(N('D'));
      nodes.push({
        title: textOf(resolve(doc, item.get(N('Title')))) ?? '',
        target: dest ? destinationTarget(doc, dest, pageIndexByRef) : undefined,
        children: readLevel(item.get(N('First')), depth + 1),
      });
      item = resolve(doc, item.get(N('Next')));
    }
    return nodes;
  };
  return readLevel(root.get(N('First')), 0);
}

/** A bookmark ready to write: its page is already a page of the new document. */
export interface PlacedBookmark {
  title: string;
  page?: PDFRef;
  rest?: PDFObject[];
  children: PlacedBookmark[];
}

/** Writes `items` as the new document's bookmarks. Sub-bookmarks start closed. */
export function writeOutline(doc: PDFDocument, items: PlacedBookmark[]): void {
  if (items.length === 0) return;
  const ctx = doc.context;
  const rootRef = ctx.nextRef();

  const writeLevel = (level: PlacedBookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = level.map(() => ctx.nextRef());
    let count = 0;
    level.forEach((item, i) => {
      const dict = ctx.obj({}) as PDFDict;
      dict.set(N('Title'), PDFHexString.fromText(item.title));
      dict.set(N('Parent'), parent);
      if (i > 0) dict.set(N('Prev'), refs[i - 1]);
      if (i < refs.length - 1) dict.set(N('Next'), refs[i + 1]);
      if (item.page) {
        const rest = item.rest && item.rest.length > 0 ? item.rest : [PDFName.of('Fit')];
        dict.set(N('Dest'), ctx.obj([item.page, ...rest]) as PDFArray);
      }
      if (item.children.length > 0) {
        const kids = writeLevel(item.children, refs[i]);
        dict.set(N('First'), kids.first);
        dict.set(N('Last'), kids.last);
        dict.set(N('Count'), ctx.obj(-kids.count));
      }
      ctx.assign(refs[i], dict);
      count++;
    });
    return { first: refs[0], last: refs[refs.length - 1], count };
  };

  const top = writeLevel(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
  doc.catalog.set(N('Outlines'), rootRef);
  doc.catalog.set(N('PageMode'), PDFName.of('UseOutlines'));
}
