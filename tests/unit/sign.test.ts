// Stop 2e's required checks for the engine (docs/Plan_Sign.md, section 9): every signed file
// passes a second, separate check made with Node's own crypto; a signed file starts with the
// original's exact bytes, and signing it again keeps the first signature valid; each result
// comes out right on a test file made for it; and new files made from a signed file carry no
// signature, field or look.
import { createCanvas } from '@napi-rs/canvas';
import { degrees, PDFDocument } from '@cantoo/pdf-lib';
import * as asn1js from 'asn1js';
import { createHash, createPublicKey, verify } from 'node:crypto';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf } from '../../src/engine/build';
import { inspectPdf } from '../../src/engine/inspect';
import { buffer, certificateDer, toBase64 } from '../../src/engine/sign/certificate';
import { checkSignatures } from '../../src/engine/sign/check';
import { emptySignatureFields, signedBytes, soundForUpdate } from '../../src/engine/sign/prepare';
import type { TrustAnchor } from '../../src/engine/sign/types';
import { changePageAfterSigning, signPdf, testIdentities, withEmptySignatureBox, type Identity } from '../fixtures/signing';
import { findEverywhere, fixture, ROOT } from './support/inspect';

const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
let ids: ReturnType<typeof testIdentities>;
beforeAll(() => {
  ids = testIdentities();
});

const trust = (identity: Identity, source: TrustAnchor['source'] = 'mine'): TrustAnchor => ({ der: toBase64(certificateDer(identity.chain.at(-1) as pkijs.Certificate)), source });

/** The signature's space and what it covers, read straight from the bytes. */
function lastSignature(bytes: Uint8Array): { range: number[]; der: Uint8Array } {
  const text = new TextDecoder('latin1').decode(bytes);
  const at = text.lastIndexOf('/ByteRange');
  const range = /\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text.slice(at))?.slice(1).map(Number) as number[];
  const hex = text.slice(range[1] + 1, range[2] - 1);
  return { range, der: new Uint8Array(Buffer.from(hex, 'hex')) };
}

/**
 * The second, separate check: Node's own crypto, not pkijs. The fingerprint of the covered bytes
 * must match the one signed, and the signer's public key must check the signature over the
 * signed attributes.
 */
function nodeCheck(bytes: Uint8Array): boolean {
  const { range, der } = lastSignature(bytes);
  const info = pkijs.ContentInfo.fromBER(buffer(der));
  const signed = new pkijs.SignedData({ schema: info.content });
  const signer = signed.signerInfos[0];
  const cert = signed.certificates?.[0] as pkijs.Certificate;
  const digest = createHash('sha256').update(signedBytes(bytes, range)).digest();
  const messageDigest = signer.signedAttrs?.attributes.find((a) => a.type === '1.2.840.113549.1.9.4')?.values[0] as asn1js.OctetString;
  if (!Buffer.from(messageDigest.valueBlock.valueHexView).equals(digest)) return false;
  // The signed attributes as signed: their encoding, tagged as a SET (RFC 5652, section 5.4).
  const attrs = new Uint8Array(signer.signedAttrs?.encodedValue ?? new ArrayBuffer(0));
  attrs[0] = 0x31;
  const key = createPublicKey({ key: Buffer.from(cert.subjectPublicKeyInfo.toSchema().toBER(false)), format: 'der', type: 'spki' });
  return verify('sha256', attrs, key, Buffer.from(signer.signature.valueBlock.valueHexView));
}

async function pixels(bytes: Uint8Array, n = 1) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  await doc.loadingTask.destroy();
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width };
}

/** Pixels that differ inside a box given in PDF points (on a 792-point-high, unturned page). */
function changedIn(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, [x1, y1, x2, y2]: number[]): number {
  let n = 0;
  for (let y = Math.floor(792 - y2); y < Math.ceil(792 - y1); y++)
    for (let x = Math.floor(x1); x < Math.ceil(x2); x++) {
      const i = (y * width + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
    }
  return n;
}

describe('signing a file', () => {
  it('adds the signature at the end: the signed file starts with the original, and passes a separate check', async () => {
    const original = fixture('normal.pdf');
    const signed = await signPdf(original, ids.signer, { reason: 'I approve this document', location: 'Head office' });
    expect(Buffer.from(signed.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    expect(nodeCheck(signed)).toBe(true);
    const [check] = await checkSignatures(signed, [trust(ids.signer)]);
    expect(check).toMatchObject({
      status: 'valid',
      identity: 'mine',
      trustedBy: 'ScribeForge Test Root',
      name: 'Alex Example',
      reason: 'I approve this document',
      location: 'Head office',
      certificateTime: 'ok',
      visible: false,
      signedLength: signed.length,
      hasTimestamp: false,
    });
    expect(check.certificate).toMatchObject({ name: 'Alex Example', issuer: 'ScribeForge Test Root', forSigning: true, selfSigned: false });
    // The file the signature covers is what pdf.js opens: the same three pages.
    const reopened = await PDFDocument.load(signed);
    expect(reopened.getPageCount()).toBe(3);
  });

  it('signs with an EC key too, and a certificate that issued itself is trusted when it is itself trusted', async () => {
    const signed = await signPdf(fixture('normal.pdf'), ids.ec);
    expect(nodeCheck(signed)).toBe(true);
    const [untrusted] = await checkSignatures(signed, []);
    expect(untrusted).toMatchObject({ status: 'valid', identity: 'unknown', name: 'Sam Example' });
    expect(untrusted.certificate?.selfSigned).toBe(true);
    const [trusted] = await checkSignatures(signed, [trust(ids.ec)]);
    expect(trusted).toMatchObject({ identity: 'mine', trustedBy: 'Sam Example' });
  });

  it('keeps the first signature valid when the file is signed again: only another signature was added', async () => {
    const once = await signPdf(fixture('normal.pdf'), ids.signer, { place: { kind: 'box', page: 0, rect: [60, 60, 300, 130], rotation: 0 } });
    const twice = await signPdf(once, ids.ec, { place: { kind: 'box', page: 1, rect: [300, 60, 540, 130], rotation: 0 } });
    expect(Buffer.from(twice.subarray(0, once.length)).equals(Buffer.from(once))).toBe(true);
    const checks = await checkSignatures(twice, [trust(ids.signer)]);
    expect(checks.map((c) => [c.name, c.status, c.laterSignatures, c.page])).toEqual([
      ['Alex Example', 'signed-after', 1, 1],
      ['Sam Example', 'valid', 0, 2],
    ]);
    expect(checks[0].signedLength).toBe(once.length);
    // A third, invisible one adds nothing but the signature (no font it doesn't use), so both earlier ones still hold.
    const thrice = await signPdf(twice, ids.signer);
    expect((await checkSignatures(thrice, [])).map((c) => [c.status, c.laterSignatures])).toEqual([
      ['signed-after', 2],
      ['signed-after', 1],
      ['valid', 0],
    ]);
  });

  it('says a file was changed after signing when a page changes, even with a later signature after the change', async () => {
    const once = await signPdf(fixture('normal.pdf'), ids.signer);
    const changed = await changePageAfterSigning(once);
    const [first] = await checkSignatures(changed, [trust(ids.signer)]);
    expect(first.status).toBe('changed');
    // A hidden change, then another signature: the second is valid, but the first was changed after.
    const resigned = await signPdf(changed, ids.ec);
    const checks = await checkSignatures(resigned, []);
    expect(checks.map((c) => c.status)).toEqual(['changed', 'valid']);
  });

  it('finds one changed byte: the file no longer matches the signature', async () => {
    const original = fixture('normal.pdf');
    const signed = await signPdf(original, ids.signer);
    const tampered = signed.slice();
    tampered[Math.floor(original.length / 2)] ^= 1;
    expect(nodeCheck(tampered)).toBe(false);
    const [check] = await checkSignatures(tampered, [trust(ids.signer)]);
    expect(check).toMatchObject({ status: 'not-valid', problem: 'mismatch' });
  });

  it("doesn't vouch for a certificate at a time it wasn't valid yet", async () => {
    const signed = await signPdf(fixture('normal.pdf'), ids.signer, { older: true, time: new Date('2026-03-04T05:06:07Z') });
    const [check] = await checkSignatures(signed, [trust(ids.signer)]);
    expect(check).toMatchObject({ status: 'valid', certificateTime: 'not-yet', identity: 'unknown', chainProblem: 'issuer-out-of-date' });
  });

  it('says when the certificate had expired at the signing time', async () => {
    const signed = await signPdf(fixture('normal.pdf'), ids.expired);
    const [check] = await checkSignatures(signed, [trust(ids.expired)]);
    expect(check).toMatchObject({ status: 'valid', certificateTime: 'expired', identity: 'mine' });
  });

  it("doesn't trust a chain whose middle certificate isn't allowed to issue certificates", async () => {
    const signed = await signPdf(fixture('normal.pdf'), ids.unallowed);
    const [check] = await checkSignatures(signed, [trust(ids.unallowed)]);
    expect(check).toMatchObject({ status: 'valid', identity: 'unknown', chainProblem: 'issuer-not-allowed' });
  });

  it('trusts through Windows when the root is in Windows list, and prefers your own list', async () => {
    const signed = await signPdf(fixture('normal.pdf'), ids.signer);
    expect((await checkSignatures(signed, [trust(ids.signer, 'windows')]))[0].identity).toBe('windows');
    expect((await checkSignatures(signed, [trust(ids.signer, 'windows'), trust(ids.signer, 'mine')]))[0].identity).toBe('mine');
    expect((await checkSignatures(signed, [trust(ids.ec, 'windows')]))[0].identity).toBe('unknown');
  });

  it('reads the older kind other programs make, with its signing time', async () => {
    // An hour ago, to the second (as the signing time is saved).
    const when = new Date(Math.floor(Date.now() / 1000) * 1000 - 3_600_000);
    const signed = await signPdf(fixture('normal.pdf'), ids.signer, { older: true, time: when });
    const [check] = await checkSignatures(signed, [trust(ids.signer)]);
    expect(check).toMatchObject({ status: 'valid', identity: 'mine', time: when.toISOString() });
  });

  it('counts SHA-1 signatures as not valid: they can be forged', async () => {
    const signed = await signPdf(fixture('normal.pdf'), ids.signer, { older: true, sha1: true });
    const [check] = await checkSignatures(signed, [trust(ids.signer)]);
    expect(check).toMatchObject({ status: 'not-valid', problem: 'weak' });
  });

  it('draws the visible box, which pdf.js shows, and nothing for an invisible signature', async () => {
    const original = fixture('normal.pdf');
    const box = [60, 60, 300, 130];
    const visible = await signPdf(original, ids.signer, { place: { kind: 'box', page: 0, rect: box as [number, number, number, number], rotation: 0 }, reason: 'Approved' });
    const invisible = await signPdf(original, ids.signer);
    const before = await pixels(original);
    expect(changedIn(before.data, (await pixels(visible)).data, before.width, box)).toBeGreaterThan(500);
    expect(changedIn(before.data, (await pixels(invisible)).data, before.width, [0, 0, 612, 792])).toBe(0);
    const [check] = await checkSignatures(visible, []);
    expect(check).toMatchObject({ visible: true, page: 1 });
  });

  it('draws the box upright, inside the box drawn, on a turned page', async () => {
    const doc = await PDFDocument.load(fixture('normal.pdf'));
    doc.getPage(0).setRotation(degrees(90));
    const turned = await doc.save({ useObjectStreams: false });
    const rect: [number, number, number, number] = [100, 200, 160, 440]; // as shown upright: 240 wide, 60 high
    const signed = await signPdf(turned, ids.signer, { place: { kind: 'box', page: 0, rect, rotation: 90 } });
    const draw = async (bytes: Uint8Array) => {
      const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
      const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
      const box = { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
      await pdf.loadingTask.destroy();
      return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, box };
    };
    const before = await draw(turned);
    const after = await draw(signed);
    // On screen the box is wide, as drawn: the page turned a quarter makes 60 x 240 points 240 x 60.
    expect(Math.round(after.box.right - after.box.left)).toBe(240);
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < after.height; y++)
      for (let x = 0; x < after.width; x++) {
        const i = (y * after.width + x) * 4;
        if (before.data[i] === after.data[i] && before.data[i + 1] === after.data[i + 1]) continue;
        const within = x >= after.box.left - 1 && x <= after.box.right + 1 && y >= after.box.top - 1 && y <= after.box.bottom + 1;
        if (within) inside++;
        else outside++;
      }
    expect(inside).toBeGreaterThan(300);
    expect(outside).toBe(0);
  });

  it('signs in an empty signature box the file already has', async () => {
    const form = await withEmptySignatureBox(fixture('normal.pdf'), 'Manager', [300, 60, 540, 120]);
    expect(await emptySignatureFields(form)).toEqual([{ name: 'Manager', page: 1, visible: true }]);
    const signed = await signPdf(form, ids.signer, { place: { kind: 'field', field: 'Manager' } });
    expect(await emptySignatureFields(signed)).toEqual([]);
    const [check] = await checkSignatures(signed, [trust(ids.signer)]);
    expect(check).toMatchObject({ field: 'Manager', status: 'valid', visible: true, page: 1 });
    const carries = (await inspectPdf({ id: 's', name: 's.pdf', bytes: signed })).carries;
    expect(carries.signatures).toEqual([{ name: 'Manager', signed: true }]);
    expect(carries.formFields).toEqual([]);
  });

  it('can only add to a file whose structure is where the file says', () => {
    expect(soundForUpdate(fixture('normal.pdf'))).toBe(true);
    expect(soundForUpdate(fixture('damaged-xref.pdf'))).toBe(false);
  });
});

describe('new files made from a signed file', () => {
  it('leave out the signature completely: no signature data, field or look', async () => {
    const box = [60, 60, 300, 130];
    const signed = await signPdf(fixture('normal.pdf'), ids.signer, { place: { kind: 'box', page: 0, rect: box as [number, number, number, number], rotation: 0 } });
    const { bytes, report } = await buildPdf([{ id: 's', name: 's.pdf', bytes: signed }], [0, 1, 2].map((index) => ({ kind: 'page', source: 's', index, rotate: 0 })));
    expect(report.signaturesLeftOut).toBe(1);
    expect(await findEverywhere(bytes, 'ByteRange')).toEqual([]);
    expect(await findEverywhere(bytes, 'Signed by Alex Example')).toEqual([]);
    expect(await checkSignatures(bytes, [])).toEqual([]);
    const before = await pixels(fixture('normal.pdf'));
    expect(changedIn(before.data, (await pixels(bytes)).data, before.width, box)).toBe(0);
    expect((await inspectPdf({ id: 'n', name: 'n.pdf', bytes })).carries.signatures).toEqual([]);
  });
});
