// Signing a file (docs/Plan_Sign.md, S4): the signature is added as an update at the end of the
// file, so the file before it stays exactly as it was, byte for byte, and any signatures already
// in it stay valid (ISO 32000-1, sections 7.5.6 and 12.8).
//
// Three steps, so the certificate's key never comes near PDF content:
// 1. prepareSignature, here: add the signature field, its look and an empty space for the
//    signature, then work out the fingerprint (SHA-256) of every byte except that space.
// 2. The main process signs that fingerprint with the certificate (src/main/sign/signer.ts).
// 3. insertSignature, here: put the signature into its space.
import {
  beginText,
  endText,
  moveText,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setLineWidth,
  setStrokingRgbColor,
  showText,
  StandardFonts,
  stroke,
  type PDFFont,
  type PDFOperator,
} from '@cantoo/pdf-lib';
import { drawable, upright } from '../annotate';
import { N, resolve } from '../objects';
import type { Rotation } from '../types';
import { sha256 } from './certificate';
import { hasArea, signatureFields } from './fields';
import type { EmptySignatureField, PreparedSignature, SignRequest } from './types';

export { signatureSpace, soundForUpdate } from './space';

/** Stands in for the numbers of the signature's ByteRange until the file's length is known. */
const RANGE_PLACEHOLDER = '**********';
/** The look's text and border: document colours, not theme ones (they print). */
const INK: [number, number, number] = [0.1, 0.1, 0.1];
const BORDER: [number, number, number] = [0.35, 0.35, 0.35];

export class SigningError extends Error {}

/** The empty signature boxes in a file, which can be signed in. */
export async function emptySignatureFields(bytes: Uint8Array, password?: string): Promise<EmptySignatureField[]> {
  const doc = await PDFDocument.load(bytes, { password: password ?? '', updateMetadata: false });
  return signatureFields(doc)
    .filter((f) => !f.value)
    .map((f) => ({ name: f.name, page: f.page === undefined ? undefined : f.page + 1, visible: hasArea(f.rect) }));
}

/** The lines in the box: who, when, and why and where if given. */
function lookLines(req: SignRequest): string[] {
  return [`Signed by ${req.name}`, req.shownTime, ...(req.reason ? [`Reason: ${req.reason}`] : []), ...(req.location ? [`Place: ${req.location}`] : [])];
}

const round = (n: number) => Math.round(n * 100) / 100;
const quarterTurns = (angle: number) => ((((Math.round(angle / 90) * 90) % 360) + 360) % 360) as Rotation;

/** The signature's look: its lines of text in a thin border, as large as fits (up to 10 points). */
function look(doc: PDFDocument, font: PDFFont, lines: string[], width: number, height: number, matrix: number[]): PDFRef {
  const pad = Math.min(6, width / 10, height / 10);
  const text = lines.map((l) => drawable(l, font));
  const widest = Math.max(...text.map((l) => font.widthOfTextAtSize(l, 1)), 1);
  const size = Math.max(3, Math.min(10, (width - pad * 2) / widest, (height - pad * 2) / (text.length * 1.25)));
  const leading = size * 1.25;
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    setStrokingRgbColor(...BORDER),
    setLineWidth(0.75),
    rectangle(0.375, 0.375, round(width - 0.75), round(height - 0.75)),
    stroke(),
    beginText(),
    setFontAndSize('Helv', round(size)),
    setFillingRgbColor(...INK),
    moveText(round(pad), round(height - pad - size * 0.9)),
  ];
  text.forEach((line, i) => {
    if (i > 0) ops.push(moveText(0, round(-leading)));
    ops.push(showText(font.encodeText(line)));
  });
  ops.push(endText(), popGraphicsState());
  const stream = doc.context.formXObject(ops, { BBox: [0, 0, round(width), round(height)], Matrix: matrix, Resources: { Font: { Helv: font.ref } } });
  return doc.context.register(stream);
}

/** An empty look, for a signature with no box (some readers expect every widget to have one). */
function noLook(doc: PDFDocument): PDFRef {
  return doc.context.register(doc.context.formXObject([], { BBox: [0, 0, 0, 0] }));
}

/** "Signature1", "Signature2" and so on: the first name not already used by a field. */
function newFieldName(used: Set<string>): string {
  for (let n = 1; ; n++) if (!used.has(`Signature${n}`)) return `Signature${n}`;
}

/**
 * Step 1: the file with the signature's field, look and empty space added at its end, ready to be
 * signed. The file given is never changed; the result starts with exactly its bytes.
 */
export async function prepareSignature(original: Uint8Array, req: SignRequest): Promise<PreparedSignature> {
  const doc = await PDFDocument.load(original, { forIncrementalUpdate: true, updateMetadata: false });
  if (doc.isEncrypted) throw new SigningError('A password-protected file is signed as a new copy without the password.');
  const snapshot = doc.takeSnapshot();
  const ctx = doc.context;
  const pages = doc.getPages();
  const markSaved = (obj: unknown) => {
    if (obj instanceof PDFRef) snapshot.markRefForSave(obj);
  };

  const signature = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: req.subFilter ?? 'ETSI.CAdES.detached',
    ByteRange: [0, PDFName.of(RANGE_PLACEHOLDER), PDFName.of(RANGE_PLACEHOLDER), PDFName.of(RANGE_PLACEHOLDER)],
    Contents: PDFHexString.of('0'.repeat(req.space * 2)),
    M: PDFString.fromDate(new Date(req.time)),
    Name: PDFHexString.fromText(req.name),
  });
  if (req.reason) signature.set(N('Reason'), PDFHexString.fromText(req.reason));
  if (req.location) signature.set(N('Location'), PDFHexString.fromText(req.location));
  if (req.producer) signature.set(N('Prop_Build'), ctx.obj({ App: { Name: PDFName.of('ScribeForge'), REx: PDFString.of(req.producer) } }));
  const signatureRef = ctx.register(signature);

  // The form, made if the file has none; it says the file is signed and must be updated by adding to it (SigFlags 3).
  let form = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (!form) {
    form = ctx.obj({ Fields: [] });
    doc.catalog.set(N('AcroForm'), ctx.register(form));
  } else markSaved(doc.catalog.get(N('AcroForm')));
  markSaved(ctx.trailerInfo.Root);
  form.set(N('SigFlags'), PDFNumber.of(3));

  // The font only when a box is drawn: the update must add nothing that isn't part of the signature (changes.ts).
  const lines = lookLines(req);
  const drawLook = async (width: number, height: number, rotation: Rotation) => look(doc, await doc.embedFont(StandardFonts.Helvetica), lines, width, height, upright(rotation));

  if (req.place.kind === 'field') {
    const target = req.place.field;
    const field = signatureFields(doc).find((f) => f.name === target && !f.value);
    if (!field) throw new SigningError(`The file has no empty signature box called ${target}.`);
    field.field.set(N('V'), signatureRef);
    markSaved(field.fieldRef);
    if (field.widget) {
      const rect = field.rect ?? [0, 0, 0, 0];
      const rotation = field.page === undefined ? 0 : quarterTurns(pages[field.page].getRotation().angle);
      const turned = rotation === 90 || rotation === 270;
      const w = Math.abs(rect[2] - rect[0]);
      const h = Math.abs(rect[3] - rect[1]);
      field.widget.set(N('AP'), ctx.obj({ N: hasArea(rect) ? await drawLook(turned ? h : w, turned ? w : h, rotation) : noLook(doc) }));
      markSaved(field.widgetRef);
    }
  } else {
    const used = new Set(signatureFields(doc).map((f) => f.name));
    // Every top-level field name, signatures or not, so the new one is unique.
    for (const raw of form.lookupMaybe(N('Fields'), PDFArray)?.asArray() ?? []) {
      const f = resolve(doc, raw);
      const t = f instanceof PDFDict ? f.get(N('T')) : undefined;
      if (t instanceof PDFString || t instanceof PDFHexString) used.add(t.decodeText());
    }
    const pageIndex = req.place.kind === 'box' ? req.place.page : 0;
    const page = pages[pageIndex];
    if (!page) throw new SigningError(`The file has no page ${pageIndex + 1}.`);
    let rect = [0, 0, 0, 0];
    let appearance: PDFRef;
    if (req.place.kind === 'box') {
      rect = req.place.rect.map(round);
      const turned = req.place.rotation === 90 || req.place.rotation === 270;
      const w = rect[2] - rect[0];
      const h = rect[3] - rect[1];
      appearance = await drawLook(turned ? h : w, turned ? w : h, req.place.rotation);
    } else appearance = noLook(doc);
    const widget = ctx.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFHexString.fromText(newFieldName(used)),
      V: signatureRef,
      Rect: rect,
      F: 4 | 128, // printed, and locked in place
      P: page.ref,
      AP: { N: appearance },
    });
    const widgetRef = ctx.register(widget);
    markSaved(page.ref);
    const annots = page.node.lookup(N('Annots'));
    if (annots instanceof PDFArray) {
      annots.push(widgetRef);
      markSaved(page.node.get(N('Annots')));
    } else page.node.set(N('Annots'), ctx.obj([widgetRef]));
    const fields = form.lookup(N('Fields'));
    if (fields instanceof PDFArray) {
      fields.push(widgetRef);
      markSaved(form.get(N('Fields')));
    } else form.set(N('Fields'), ctx.obj([widgetRef]));
  }

  // Classic cross-reference tables, never object streams: the signature's space must be plain bytes in the file.
  const update = await doc.saveIncremental(snapshot, { useObjectStreams: false });
  const bytes = new Uint8Array(original.length + update.length);
  bytes.set(original, 0);
  bytes.set(update, original.length);
  const byteRange = fillByteRange(bytes, original.length, req.space);
  const digest = await sha256(signedBytes(bytes, byteRange));
  return { bytes, byteRange, digest };
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** The bytes a signature covers: everything but its own space. */
export function signedBytes(bytes: Uint8Array, range: readonly number[]): Uint8Array {
  const out = new Uint8Array(range[1] + range[3]);
  out.set(bytes.subarray(range[0], range[0] + range[1]), 0);
  out.set(bytes.subarray(range[2], range[2] + range[3]), range[1]);
  return out;
}

/** Writes the real ByteRange over the placeholder, in the update only (from `from`), padded to the same length. */
function fillByteRange(bytes: Uint8Array, from: number, space: number): [number, number, number, number] {
  const text = latin1(bytes.subarray(from));
  const at = text.lastIndexOf(`/ByteRange [ 0 /${RANGE_PLACEHOLDER}`);
  if (at < 0) throw new SigningError("The signature's space couldn't be found in the file.");
  const open = text.indexOf('[', at);
  const close = text.indexOf(']', open) + 1;
  const end = text.indexOf('endobj', at);
  const lt = text.indexOf(`<${'0'.repeat(64)}`, text.lastIndexOf('/Contents', end) - 1);
  const gt = text.indexOf('>', lt) + 1;
  if (lt < 0 || gt <= lt || gt > end || gt - lt !== space * 2 + 2) throw new SigningError("The signature's space couldn't be found in the file.");
  const range: [number, number, number, number] = [0, from + lt, from + gt, bytes.length - (from + gt)];
  const written = `[${range.join(' ')}]`;
  if (written.length > close - open) throw new SigningError("The signature's space couldn't be found in the file.");
  bytes.set(new TextEncoder().encode(written.padEnd(close - open, ' ')), from + open);
  return range;
}

/** Step 3: the signed file, with the signature (DER) in the space kept for it. */
export function insertSignature(prepared: PreparedSignature, signature: Uint8Array): Uint8Array {
  const [, start, end] = prepared.byteRange;
  const room = end - start - 2;
  if (signature.length * 2 > room) throw new SigningError('The signature is larger than the space kept for it, so nothing was saved.');
  let hex = '';
  for (const b of signature) hex += b.toString(16).padStart(2, '0');
  const bytes = prepared.bytes.slice();
  bytes.set(new TextEncoder().encode(hex.padEnd(room, '0')), start + 1);
  return bytes;
}
