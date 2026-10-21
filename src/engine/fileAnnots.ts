// Changes to annotations that were already in a source file: new comments, a new look, deleting
// them, and marking them to be burned in or replied to. Applied to the loaded copy of the source
// before its pages are copied; the file itself is only ever read.
import { PDFArray, PDFDict, PDFHexString, PDFRef, PDFString, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';
import { buildAnnotation, FLATTEN_MARK, type Fonts } from './annotate';
import { N } from './objects';
import { parseAnnotationRef, type AnnotationInput, type BuildReport, type FileAnnotationChange } from './types';

/** Marks an annotation that something in the new file points at; read and removed after copying. */
export const REF_MARK = 'ScribeForgeRef';

/** What a redrawn annotation takes from ScribeForge's version: its look, colour, text and shape. */
const REDRAWN_KEYS = ['Rect', 'C', 'IC', 'AP', 'Contents', 'DA', 'BS', 'QuadPoints', 'InkList', 'L', 'LE', 'Name'];

/**
 * Applies the changes for one source. `replyTargets` are pdf.js ids of this source's annotations
 * that new replies answer. Returns nothing; counts go in the report.
 */
export async function applyFileChanges(
  doc: PDFDocument,
  sourceId: string,
  changes: FileAnnotationChange[],
  replyTargets: Set<string>,
  report: BuildReport,
): Promise<void> {
  const pages = doc.getPages();
  const fonts: Fonts = {};
  const deleted = new Map<number, Set<string>>(); // page index → refs (as text) to remove

  const find = (index: number, id: string): { ref: PDFRef; dict: PDFDict } | undefined => {
    const parsed = parseAnnotationRef(id);
    const annots = pages[index]?.node.lookupMaybe(N('Annots'), PDFArray);
    if (!parsed || !annots) return undefined;
    const ref = PDFRef.of(parsed.num, parsed.gen);
    // Only an annotation that's really on that page.
    if (!annots.asArray().some((r) => r instanceof PDFRef && r === ref)) return undefined;
    const dict = doc.context.lookup(ref);
    return dict instanceof PDFDict ? { ref, dict } : undefined;
  };

  for (const change of changes) {
    if (change.source !== sourceId) continue;
    const found = find(change.index, change.ref);
    if (!found) continue;
    const { ref, dict } = found;
    if (change.deleted) {
      const set = deleted.get(change.index) ?? new Set<string>();
      set.add(String(ref));
      deleted.set(change.index, set);
      report.annotationsDeleted++;
      continue;
    }
    let changed = false;
    if (change.redraw && change.redraw.kind !== 'reply') {
      const fresh = await buildAnnotation(doc, pages[change.index], change.redraw as Exclude<AnnotationInput, { kind: 'reply' }>, fonts);
      for (const key of REDRAWN_KEYS) {
        const value = fresh.get(N(key));
        // A note keeps its own icon style (Note, Comment, Key…).
        if (key === 'Name' && dict.has(N('Name'))) continue;
        if (value !== undefined) dict.set(N(key), value);
        // A note has no drawing of its own: readers draw the icon, in the new colour.
        else if (key === 'IC' || key === 'Contents' || key === 'AP') dict.delete(N(key));
      }
      changed = true;
    }
    if (change.comment !== undefined) {
      if (change.comment) dict.set(N('Contents'), PDFHexString.fromText(change.comment));
      else dict.delete(N('Contents'));
      changed = true;
    }
    if (changed) {
      dict.set(N('M'), PDFString.fromDate(new Date()));
      report.annotationsChanged++;
    }
    if (change.flatten) dict.set(N(FLATTEN_MARK), doc.context.obj(true));
  }

  // Deleting an annotation also deletes its pop-up and the replies to it (and replies to those).
  for (const [index, refs] of deleted) {
    const annots = pages[index].node.lookupMaybe(N('Annots'), PDFArray);
    if (!annots) continue;
    const list = annots.asArray();
    let grew = true;
    while (grew) {
      grew = false;
      for (const raw of list) {
        const dict = doc.context.lookup(raw);
        if (refs.has(String(raw)) || !(dict instanceof PDFDict)) continue;
        const parent = dict.get(N('Parent')) ?? dict.get(N('IRT'));
        if (parent && refs.has(String(parent))) {
          refs.add(String(raw));
          grew = true;
        }
      }
    }
    pages[index].node.set(N('Annots'), doc.context.obj(list.filter((raw: PDFObject) => !refs.has(String(raw)))));
  }

  for (const id of replyTargets) {
    const parsed = parseAnnotationRef(id);
    const dict = parsed ? doc.context.lookup(PDFRef.of(parsed.num, parsed.gen)) : undefined;
    if (dict instanceof PDFDict) dict.set(N(REF_MARK), PDFString.of(`${sourceId}:${id}`));
  }
}

/** After copying: where each marked annotation is in the new file, by "source:id". The marks are removed. */
export function collectMarked(doc: PDFDocument, annots: PDFArray | undefined, into: Map<string, PDFRef>): void {
  for (const raw of annots?.asArray() ?? []) {
    const dict = doc.context.lookup(raw);
    if (!(dict instanceof PDFDict) || !(raw instanceof PDFRef)) continue;
    const mark = dict.get(N(REF_MARK));
    if (mark instanceof PDFString) {
      into.set(mark.decodeText(), raw);
      dict.delete(N(REF_MARK));
    }
  }
}
