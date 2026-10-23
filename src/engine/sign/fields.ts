// Finding a file's signature fields: signed ones (their value is the signature) and empty ones
// (boxes waiting to be signed), with the page each is on.
import { PDFArray, PDFDict, PDFRef, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';
import { N, nameOf, resolve, textOf } from '../objects';

export interface SignatureField {
  /** Full name, such as "Signature1" or "Approvals.Manager". */
  name: string;
  field: PDFDict;
  fieldRef?: PDFRef;
  /** The box on the page (often the field itself). */
  widget?: PDFDict;
  widgetRef?: PDFRef;
  /** The signature, when it's signed. */
  value?: PDFDict;
  /** 0-based. */
  page?: number;
  rect?: number[];
}

const MAX_FIELDS = 10_000;

function rectOf(doc: PDFDocument, dict: PDFDict | undefined): number[] | undefined {
  const arr = resolve(doc, dict?.get(N('Rect')));
  if (!(arr instanceof PDFArray) || arr.size() !== 4) return undefined;
  const nums = arr.asArray().map((v) => Number(resolve(doc, v)?.toString()));
  return nums.every(Number.isFinite) ? nums : undefined;
}

export function hasArea(rect: number[] | undefined): boolean {
  return !!rect && Math.abs(rect[2] - rect[0]) > 0.5 && Math.abs(rect[3] - rect[1]) > 0.5;
}

/** Where each annotation is: its reference, as text, to its page (0-based). */
function annotPages(doc: PDFDocument): Map<string, number> {
  const where = new Map<string, number>();
  doc.getPages().forEach((page, index) => {
    for (const raw of page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray() ?? []) if (raw instanceof PDFRef) where.set(raw.toString(), index);
  });
  return where;
}

/** Every signature field in the file's form, in the form's order. */
export function signatureFields(doc: PDFDocument): SignatureField[] {
  const found: SignatureField[] = [];
  const form = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (!form) return found;
  const pages = annotPages(doc);
  const seen = new Set<PDFDict>();

  const walk = (list: PDFObject | undefined, prefix: string, inheritedType: string | undefined, depth: number) => {
    const arr = resolve(doc, list);
    if (!(arr instanceof PDFArray) || depth > 30) return;
    for (let i = 0; i < arr.size() && found.length < MAX_FIELDS; i++) {
      const raw = arr.get(i);
      const field = resolve(doc, raw);
      if (!(field instanceof PDFDict) || seen.has(field)) continue;
      seen.add(field);
      const part = textOf(resolve(doc, field.get(N('T'))));
      const name = part === undefined ? prefix : prefix ? `${prefix}.${part}` : part;
      const type = nameOf(field.get(N('FT'))) ?? inheritedType;
      const kids = field.lookupMaybe(N('Kids'), PDFArray);
      const kidFields = (kids?.asArray() ?? []).filter((k) => {
        const kid = resolve(doc, k);
        return kid instanceof PDFDict && kid.has(N('T'));
      });
      if (kidFields.length > 0) {
        walk(kids, name, type, depth + 1);
        continue;
      }
      if (type !== 'Sig') continue;
      // The box: the field itself when it's also the widget, or its first widget.
      let widgetRaw: PDFObject | undefined = nameOf(field.get(N('Subtype'))) === 'Widget' ? raw : kids?.get(0);
      const widget = resolve(doc, widgetRaw);
      if (!(widget instanceof PDFDict)) widgetRaw = undefined;
      const value = resolve(doc, field.get(N('V')));
      const widgetKey = widgetRaw instanceof PDFRef ? widgetRaw.toString() : undefined;
      let page = widgetKey !== undefined ? pages.get(widgetKey) : undefined;
      if (page === undefined && widget instanceof PDFDict) {
        const p = widget.get(N('P'));
        const index = p instanceof PDFRef ? doc.getPages().findIndex((pg) => pg.ref.toString() === p.toString()) : -1;
        if (index >= 0) page = index;
      }
      found.push({
        name: name || 'Signature',
        field,
        fieldRef: raw instanceof PDFRef ? raw : undefined,
        widget: widget instanceof PDFDict ? widget : undefined,
        widgetRef: widgetRaw instanceof PDFRef ? widgetRaw : undefined,
        value: value instanceof PDFDict ? value : undefined,
        page,
        rect: rectOf(doc, widget instanceof PDFDict ? widget : undefined),
      });
    }
  };
  walk(form.get(N('Fields')), '', undefined, 0);
  return found;
}
