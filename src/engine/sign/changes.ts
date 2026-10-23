// What was added to a file after a signature (docs/Plan_Sign.md, section 5). A later addition
// counts as "only another signature" when everything it adds or changes is a signature: the
// signature itself, its field and box, the box's look, and the lists that point to them (the
// page's annotations, the form's fields, and the catalog's form entry). Anything else counts as
// a change, however small, because known attacks hide a change to a page inside a later update.
// This is stricter than some readers, which also allow form filling and comments.
import { PDFArray, PDFDict, PDFDocument, PDFRawStream, PDFRef, PDFStream, type PDFObject } from '@cantoo/pdf-lib';
import { N, nameOf } from '../objects';

export interface LaterChanges {
  /** Everything added after the signature is another signature (or nothing at all). */
  onlySignatures: boolean;
  /** How many signatures were added after it. */
  signatures: number;
}

const CHANGED: LaterChanges = { onlySignatures: false, signatures: 0 };

const key = (obj: PDFObject | undefined) => (obj instanceof PDFRef ? obj.toString() : '');

function contents(obj: PDFStream): Uint8Array {
  return obj instanceof PDFRawStream ? obj.contents : obj.getContents();
}

/** The same object, written the same way. */
function same(a: PDFObject, b: PDFObject): boolean {
  if (a instanceof PDFStream || b instanceof PDFStream) {
    if (!(a instanceof PDFStream && b instanceof PDFStream) || a.dict.toString() !== b.dict.toString()) return false;
    const x = contents(a);
    const y = contents(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return a.constructor === b.constructor && a.toString() === b.toString();
}

/** The keys whose values differ between two dictionaries (all of `b`'s when there's no `a`). */
function changedKeys(a: PDFDict | undefined, b: PDFDict): string[] {
  const keys = new Set([...(a?.keys() ?? []), ...b.keys()].map((k) => k.decodeText()));
  return [...keys].filter((k) => {
    const x = a?.get(N(k));
    const y = b.get(N(k));
    return !(x && y ? same(x, y) : !x && !y);
  });
}

/** Every reference an object points to, through its dictionaries and arrays. */
function refsIn(obj: PDFObject | undefined, out: PDFRef[]): void {
  if (obj instanceof PDFRef) out.push(obj);
  else if (obj instanceof PDFArray) for (const v of obj.asArray()) refsIn(v, out);
  else if (obj instanceof PDFStream) refsIn(obj.dict, out);
  else if (obj instanceof PDFDict) for (const [, v] of obj.entries()) refsIn(v, out);
}

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });

/**
 * What was added after the first `signedLength` bytes of `bytes` (the version a signature
 * covers). Conservative: anything it can't account for counts as a change.
 */
export async function laterChanges(bytes: Uint8Array, signedLength: number): Promise<LaterChanges> {
  if (signedLength >= bytes.length) return { onlySignatures: true, signatures: 0 };
  let before: PDFDocument;
  let after: PDFDocument;
  try {
    before = await load(bytes.subarray(0, signedLength));
    after = await load(bytes);
  } catch {
    return CHANGED;
  }

  // The same document must be shown: the same catalog, and the same encryption.
  const tb = before.context.trailerInfo;
  const ta = after.context.trailerInfo;
  if (key(tb.Root) !== key(ta.Root) || key(tb.Encrypt) !== key(ta.Encrypt)) return CHANGED;

  // An object written twice in the same update could be read differently by different readers.
  // (Each later update may rewrite an object an earlier one wrote, such as the form's list of fields.)
  const later = new TextDecoder('latin1').decode(bytes.subarray(signedLength));
  for (const update of later.split('%%EOF')) {
    const written = new Set<string>();
    for (const m of update.matchAll(/(?:^|[\s>\]])(\d+)\s+(\d+)\s+obj\b/g)) {
      const id = `${Number(m[1])} ${Number(m[2])} R`;
      if (written.has(id)) return CHANGED;
      written.add(id);
    }
  }

  // What differs between the signed version and the file now.
  const touched: [PDFRef, PDFObject, PDFObject | undefined][] = [];
  for (const [ref, obj] of after.context.enumerateIndirectObjects()) {
    const old = before.context.lookup(ref);
    if (old && same(obj, old)) continue;
    if (obj instanceof PDFStream && ['XRef', 'ObjStm'].includes(nameOf(obj.dict.get(N('Type'))) ?? '')) continue;
    touched.push([ref, obj, old]);
  }
  if (touched.length === 0) return { onlySignatures: true, signatures: 0 };

  const isNew = (obj: PDFObject | undefined) => obj instanceof PDFRef && !before.context.lookup(obj);
  const lookup = (obj: PDFObject | undefined) => (obj instanceof PDFRef ? after.context.lookup(obj) : obj);
  const typeOf = (obj: PDFObject | undefined) => {
    const d = lookup(obj);
    return d instanceof PDFDict ? nameOf(d.get(N('Type'))) : undefined;
  };
  /** A field's entry, its own or inherited from the fields above it. */
  const inherited = (dict: PDFDict, name: string): PDFObject | undefined => {
    let d: PDFDict | undefined = dict;
    for (let i = 0; d && i < 30; i++) {
      const v = d.get(N(name));
      if (v !== undefined) return v;
      const parent = lookup(d.get(N('Parent')));
      d = parent instanceof PDFDict ? parent : undefined;
    }
    return undefined;
  };
  const fieldType = (dict: PDFDict) => nameOf(inherited(dict, 'FT'));
  const signatureOf = (dict: PDFDict) => inherited(dict, 'V');

  // New signatures, and the new (or newly signed) signature fields and boxes that hold them.
  let signatures = 0;
  const allowed = new Set<string>();
  const signatureFields = new Set<string>();
  const roots: PDFObject[] = [];
  for (const [ref, obj, old] of touched) {
    if (!(obj instanceof PDFDict) || obj instanceof PDFStream) continue;
    const type = nameOf(obj.get(N('Type')));
    if (!old && (type === 'Sig' || type === 'DocTimeStamp')) {
      allowed.add(key(ref));
      signatures++;
    } else if (!old && type === 'DSS') {
      // Certificates and revocation answers kept for checking signatures later.
      allowed.add(key(ref));
      roots.push(obj);
    } else if (fieldType(obj) === 'Sig') {
      // It must hold a new signature (its own, or its field's when it's one of the field's boxes):
      // a new box with no signature could draw anything on the page.
      const value = signatureOf(obj);
      if (!(isNew(value) && ['Sig', 'DocTimeStamp'].includes(typeOf(value) ?? ''))) continue;
      // An empty field being signed: only its value, look and flags may change.
      if (old instanceof PDFDict && (old.has(N('V')) || !changedKeys(old, obj).every((k) => ['V', 'AP', 'AS', 'F', 'MK'].includes(k)))) continue;
      allowed.add(key(ref));
      signatureFields.add(key(ref));
      roots.push(obj);
    }
  }

  const root = key(ta.Root);
  const formRef = after.catalog.get(N('AcroForm'));
  const form = after.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  const oldForm = before.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (form && !oldForm) roots.push(form.get(N('DR')) ?? form); // a new form's fonts

  // New objects reachable only through what's allowed: the boxes' looks, their fonts and pictures.
  const reachable = new Set<string>();
  const queue: PDFRef[] = [];
  for (const r of roots) refsIn(r, queue);
  while (queue.length > 0) {
    const ref = queue.pop() as PDFRef;
    const id = key(ref);
    if (reachable.has(id) || !isNew(ref)) continue;
    reachable.add(id);
    refsIn(after.context.lookup(ref), queue);
  }

  /** A list that only gained signature fields (a page's annotations, or the form's fields). */
  const gainsOnlySignatures = (was: PDFObject | undefined, now: PDFObject | undefined) => {
    const a = lookup(was);
    const b = lookup(now);
    if (!(b instanceof PDFArray)) return false;
    const old = a instanceof PDFArray ? a.asArray().map(key) : [];
    const current = b.asArray().map(key);
    if (old.some((id) => id === '' || !current.includes(id))) return false;
    return current.filter((id) => !old.includes(id)).every((id) => signatureFields.has(id));
  };
  /** The form: it may only gain signature fields and say it's signed (a new one may also bring fonts). */
  const formOk = (now: PDFDict) =>
    changedKeys(oldForm, now).every(
      (k) => k === 'SigFlags' || (k === 'Fields' && gainsOnlySignatures(oldForm?.get(N('Fields')), now.get(N('Fields')))) || (!oldForm && (k === 'DA' || k === 'DR')),
    );

  const pageOf = new Map<string, PDFDict>();
  const annotsArrays = new Set<string>();
  for (const page of after.getPages()) {
    pageOf.set(key(page.ref), page.node);
    const raw = page.node.get(N('Annots'));
    if (raw instanceof PDFRef) annotsArrays.add(key(raw));
  }

  for (const [ref, obj, old] of touched) {
    const id = key(ref);
    if (allowed.has(id) || (!old && reachable.has(id))) continue;
    if (obj instanceof PDFArray && (annotsArrays.has(id) || id === key(form?.get(N('Fields')))) && gainsOnlySignatures(old, obj)) continue;
    if (id === key(formRef) && obj instanceof PDFDict && formOk(obj)) continue;
    if (!old) return CHANGED; // anything else new: something other than a signature was added
    if (id === root && obj instanceof PDFDict && old instanceof PDFDict) {
      // The catalog: only its form (and the signatures' validation data) may change.
      if (changedKeys(old, obj).every((k) => k === 'AcroForm' || k === 'DSS')) continue;
      return CHANGED;
    }
    const page = pageOf.get(id);
    if (page && old instanceof PDFDict && changedKeys(old, page).every((k) => k === 'Annots' && gainsOnlySignatures(old.get(N('Annots')), page.get(N('Annots'))))) continue;
    return CHANGED;
  }
  // A form kept inside the catalog itself is checked here.
  if (form && !(formRef instanceof PDFRef) && !formOk(form)) return CHANGED;
  return { onlySignatures: true, signatures };
}
