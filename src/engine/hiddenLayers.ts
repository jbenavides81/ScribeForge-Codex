// Taking what's on hidden layers out of a page (Phase 2 plan, 2d and F6). A layer that's hidden
// when the file opens still has its content in the page; clean-up removes it, so the page looks
// the same but the hidden text, pictures and drawings are gone from the file.
//
// Only what draws is removed: text, shapes, pictures and shadings inside a hidden section.
// Settings inside it (position, colour, font, line width) are kept, because what comes after the
// section may rely on them. One case is left alone: hidden text in the middle of a line whose
// visible text carries on straight after it, since taking it out would move the visible text.
import { decodePDFRawStream, PDFArray, PDFDict, PDFRawStream, PDFRef, PDFStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';
import { parseContent, writeContent, type Op } from './content';
import { N, nameOf, resolve } from './objects';

/** The layers that are hidden when the file opens, by reference (as text). */
export function hiddenLayers(doc: PDFDocument): Set<string> {
  const oc = doc.catalog.lookupMaybe(N('OCProperties'), PDFDict);
  const groups = oc?.lookupMaybe(N('OCGs'), PDFArray);
  const config = oc?.lookupMaybe(N('D'), PDFDict);
  const listed = (key: string) => new Set((config?.lookupMaybe(N(key), PDFArray)?.asArray() ?? []).map(String));
  const off = listed('OFF');
  const on = listed('ON');
  const baseOff = nameOf(config?.get(N('BaseState'))) === 'OFF';
  return new Set((groups?.asArray() ?? []).map(String).filter((ref) => off.has(ref) || (baseOff && !on.has(ref))));
}

/**
 * Whether content tagged with this optional-content entry is hidden: a layer, or a combination
 * of layers (an OCMD). Combinations written as expressions (VE) count as shown, so nothing is
 * removed that might be showing.
 */
export function isHiddenEntry(doc: PDFDocument, entry: PDFObject | undefined, hidden: Set<string>): boolean {
  if (!entry) return false;
  const dict = resolve(doc, entry);
  if (!(dict instanceof PDFDict)) return false;
  const type = nameOf(dict.get(N('Type')));
  if (type === 'OCG') return hidden.has(String(entry));
  if (type !== 'OCMD' || dict.has(N('VE'))) return false;
  const groups = dict.get(N('OCGs'));
  const list = groups instanceof PDFRef ? (resolve(doc, groups) instanceof PDFArray ? (resolve(doc, groups) as PDFArray).asArray() : [groups]) : groups instanceof PDFArray ? groups.asArray() : [];
  if (list.length === 0) return false;
  const shown = list.map((g) => !hidden.has(String(g)));
  switch (nameOf(dict.get(N('P'))) ?? 'AnyOn') {
    case 'AllOn':
      return !shown.every(Boolean);
    case 'AnyOff':
      return !shown.some((s) => !s);
    case 'AllOff':
      return !shown.every((s) => !s);
    default:
      return !shown.some(Boolean);
  }
}

const SHOW_TEXT = new Set(['Tj', 'TJ', "'", '"']);
const PATH = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
const MOVES_TEXT = new Set(['Td', 'TD', 'Tm', 'T*', "'", '"', 'BT']);

function decoded(stream: PDFStream): Uint8Array {
  return stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : (stream as unknown as { getContents(): Uint8Array }).getContents();
}

interface Stripped {
  ops: Op[];
  /** XObjects to use instead in this content's resources: copies of forms with their hidden parts taken out. */
  swaps: Map<string, PDFRef>;
  removed: number;
  /** Hidden text left in place, because taking it out would move visible text on the same line. */
  unsafe: boolean;
}

function strip(doc: PDFDocument, ops: Op[], resources: PDFDict | undefined, hidden: Set<string>, depth: number): Stripped {
  const properties = resources?.lookupMaybe(N('Properties'), PDFDict);
  const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
  const out: Op[] = [];
  const swaps = new Map<string, PDFRef>();
  let removed = 0;
  let unsafe = false;
  const sections: boolean[] = []; // for each open marked section: whether it (or one around it) is hidden
  let path: Op[] = [];
  // Hidden text was taken out of this line, and nothing has moved the text position since.
  let shifted = false;
  const inHidden = () => sections.length > 0 && sections[sections.length - 1];

  for (const o of ops) {
    if (o.op === 'BDC' || o.op === 'BMC') {
      const tag = o.args[0]?.kind === 'name' ? o.args[0].value : '';
      const prop = o.args[1];
      const entry = tag === 'OC' && prop?.kind === 'name' ? properties?.get(N(prop.value)) : undefined;
      const starts = !inHidden() && isHiddenEntry(doc, entry, hidden);
      if (starts) removed++;
      sections.push(inHidden() || starts);
      if (!inHidden()) out.push(o);
      continue;
    }
    if (o.op === 'EMC') {
      const was = sections.pop() ?? false;
      if (!was) out.push(o);
      continue;
    }
    if (MOVES_TEXT.has(o.op) && !SHOW_TEXT.has(o.op)) shifted = false;

    if (inHidden()) {
      // What draws goes; settings stay. ' and " move to the next line before drawing: the move stays.
      if (SHOW_TEXT.has(o.op)) {
        if (o.op === '"') out.push({ op: 'Tw', args: [o.args[0]] }, { op: 'Tc', args: [o.args[1]] });
        if (o.op === "'" || o.op === '"') out.push({ op: 'T*', args: [] });
        shifted = true;
      } else if (PATH.has(o.op) || o.op === 'W' || o.op === 'W*') path.push(o);
      else if (PAINT.has(o.op)) {
        // A clipping path limits what's drawn after it, so it stays; a painted one goes.
        if (o.op === 'n' && path.some((p) => p.op === 'W' || p.op === 'W*')) out.push(...path, o);
        path = [];
      } else if (o.op === 'Do' || o.op === 'sh' || o.op === 'BI' || o.op === 'MP' || o.op === 'DP') {
        // Pictures, drawings, shadings and inline pictures on the layer.
      } else out.push(o);
      continue;
    }

    if (SHOW_TEXT.has(o.op) && shifted && o.op !== "'" && o.op !== '"') unsafe = true;
    if (SHOW_TEXT.has(o.op)) shifted = false;

    if (o.op === 'Do' && o.args[0]?.kind === 'name') {
      const name = o.args[0].value;
      const ref = xobjects?.get(N(name));
      const xobject = ref ? doc.context.lookup(ref) : undefined;
      if (xobject instanceof PDFStream) {
        // A picture or drawing that's on a hidden layer as a whole.
        if (isHiddenEntry(doc, xobject.dict.get(N('OC')), hidden)) {
          removed++;
          continue;
        }
        // A drawing with hidden parts inside it: a copy without them, for this page only.
        if (nameOf(xobject.dict.get(N('Subtype'))) === 'Form' && depth < 12) {
          const formResources = xobject.dict.lookupMaybe(N('Resources'), PDFDict) ?? resources;
          const inner = strip(doc, parseContent(decoded(xobject)), formResources, hidden, depth + 1);
          unsafe ||= inner.unsafe;
          if (inner.removed > 0 && !inner.unsafe) {
            const copy = doc.context.flateStream(writeContent(inner.ops));
            for (const [key, value] of xobject.dict.entries()) {
              if (!['Length', 'Filter', 'DecodeParms', 'Resources'].includes(key.decodeText())) copy.dict.set(key, value);
            }
            if (formResources) copy.dict.set(N('Resources'), withSwaps(doc, formResources, inner.swaps));
            swaps.set(name, doc.context.register(copy));
            removed += inner.removed;
          }
        }
      }
    }
    out.push(o);
  }
  return { ops: out, swaps, removed, unsafe };
}

/** A copy of a resources dictionary with some XObjects swapped. */
function withSwaps(doc: PDFDocument, resources: PDFDict, swaps: Map<string, PDFRef>): PDFDict {
  const copy = resources.clone(doc.context);
  if (swaps.size === 0) return copy;
  const xobjects = (resources.lookupMaybe(N('XObject'), PDFDict) ?? doc.context.obj({})).clone(doc.context);
  for (const [name, ref] of swaps) xobjects.set(N(name), ref);
  copy.set(N('XObject'), xobjects);
  return copy;
}

/**
 * Takes what's on hidden layers out of one page (of the loaded copy of a source), and removes
 * annotations that are on a hidden layer. Returns how many hidden sections were removed, or null
 * when they were left in place because taking them out would move visible text.
 */
export function removeHiddenContent(doc: PDFDocument, pageIndex: number, hidden: Set<string>): number | null {
  if (hidden.size === 0) return 0;
  const page = doc.getPage(pageIndex);
  const node = page.node;
  let removed = 0;

  const annots = node.lookupMaybe(N('Annots'), PDFArray);
  if (annots) {
    const kept = annots.asArray().filter((raw) => {
      const annot = resolve(doc, raw);
      const gone = annot instanceof PDFDict && isHiddenEntry(doc, annot.get(N('OC')), hidden);
      if (gone) removed++;
      return !gone;
    });
    if (removed > 0) node.set(N('Annots'), doc.context.obj(kept));
  }

  const contents = node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => resolve(doc, r)) : contents ? [contents] : [];
  const parts = streams.filter((s): s is PDFStream => s instanceof PDFStream).map(decoded);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    all[at + p.length] = 10;
    at += p.length + 1;
  }
  const resources = node.Resources();
  const result = strip(doc, parseContent(all), resources, hidden, 0);
  if (result.unsafe) return null;
  if (result.removed > 0) {
    node.set(N('Contents'), doc.context.register(doc.context.flateStream(writeContent(result.ops))));
    if (resources) {
      // The page's own copy of its resources, without the swapped drawings' originals or the
      // hidden layers' entries (nothing on the page uses them now).
      const own = withSwaps(doc, resources, result.swaps);
      const properties = resources.lookupMaybe(N('Properties'), PDFDict);
      if (properties) {
        const shown = properties.clone(doc.context);
        for (const [key, value] of properties.entries()) if (isHiddenEntry(doc, value, hidden)) shown.delete(key);
        own.set(N('Properties'), shown);
      }
      node.set(N('Resources'), own);
    }
  }
  return removed + result.removed;
}
