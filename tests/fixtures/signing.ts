// Made-up certificates and signed test files, for the tests and the fixture script
// (scripts/make-fixtures.mjs). Nothing here is anyone's real certificate.
import { PDFArray, PDFDocument, PDFHexString, PDFName, rgb, StandardFonts } from '@cantoo/pdf-lib';
import * as asn1js from 'asn1js';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import * as pkijs from 'pkijs';
import { buffer, certificateDer } from '../../src/engine/sign/certificate';
import { insertSignature, prepareSignature, signatureSpace } from '../../src/engine/sign/prepare';
import type { SignaturePlace, SignRequest } from '../../src/engine/sign/types';
import { issueCertificate } from '../../src/main/sign/makeCertificate';
import { makeSignature } from '../../src/main/sign/signer';

/** The password of the test certificate file, tests/fixtures/out/test-signer.pfx. */
export const TEST_PFX_PASSWORD = 'open the test key';

export interface Identity {
  key: KeyObject;
  /** The certificate first, then its issuers. */
  chain: pkijs.Certificate[];
}

const DAY = 86_400_000;

function rsa(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

/** A test root, people it vouches for, and some certificates with something wrong. */
export function testIdentities(now = new Date()) {
  const from = new Date(now.getTime() - DAY);
  const to = new Date(now.getTime() + 730 * DAY);
  const rootKeys = rsa();
  const root = issueCertificate({ subject: { name: 'ScribeForge Test Root', organisation: 'Example Test' }, ...rootKeys, notBefore: from, notAfter: new Date(now.getTime() + 3650 * DAY), ca: true });
  const byRoot = (name: string, notBefore = from, notAfter = to, extra: { ca?: boolean; usage?: 'sign' | 'ca' | 'any' } = {}): Identity => {
    const keys = rsa();
    const cert = issueCertificate({ subject: { name, organisation: 'Example Test' }, ...keys, issuer: { cert: root, key: rootKeys.privateKey }, notBefore, notAfter, ...extra });
    return { key: keys.privateKey, chain: [cert, root] };
  };
  const signer = byRoot('Alex Example');
  const expired = byRoot('Pat Expired', new Date('2020-01-01T00:00:00Z'), new Date('2021-01-01T00:00:00Z'));
  // A middle certificate that isn't allowed to issue others, and someone it "vouches" for.
  const middle = byRoot('Not A Certificate Authority', from, to, { ca: false, usage: 'any' });
  const rileyKeys = rsa();
  const riley = issueCertificate({
    subject: { name: 'Riley Example' },
    ...rileyKeys,
    issuer: { cert: middle.chain[0], key: middle.key },
    notBefore: from,
    notAfter: to,
  });
  const ecKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ec = issueCertificate({ subject: { name: 'Sam Example', email: 'sam@example.com' }, ...ecKeys, notBefore: from, notAfter: to });
  return {
    root: { key: rootKeys.privateKey, chain: [root] } as Identity,
    signer,
    expired,
    unallowed: { key: rileyKeys.privateKey, chain: [riley, middle.chain[0], root] } as Identity,
    ec: { key: ecKeys.privateKey, chain: [ec] } as Identity,
  };
}

const certificateBytes = (identity: Identity) => identity.chain.reduce((n, c) => n + certificateDer(c).length, 0);

/** "22 Oct 2026, 14:44", as the app shows it. */
export function shownTime(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export interface SignOptions {
  place?: SignaturePlace;
  reason?: string;
  location?: string;
  time?: Date;
  /** The older kind of signature other programs make, with a signing time inside it. */
  older?: boolean;
  /** Sign with SHA-1, which can be forged (only the older kind). */
  sha1?: boolean;
}

/** An older-style signature, as other programs make them: with a signing time, and optionally SHA-1. */
function olderSignature(digest: Uint8Array, data: Uint8Array, identity: Identity, time: Date, sha1: boolean): Uint8Array {
  const [leaf] = identity.chain;
  const hash = sha1 ? createHash('sha1').update(data).digest() : digest;
  const attributes = [
    new pkijs.Attribute({ type: '1.2.840.113549.1.9.3', values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })] }),
    new pkijs.Attribute({ type: '1.2.840.113549.1.9.5', values: [new asn1js.UTCTime({ valueDate: time })] }),
    new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [new asn1js.OctetString({ valueHex: buffer(new Uint8Array(hash)) })] }),
  ];
  const toSign = new Uint8Array(new asn1js.Set({ value: attributes.map((a) => a.toSchema()) }).toBER(false));
  const signature = sign(sha1 ? 'sha1' : 'sha256', toSign, identity.key);
  const digestAlgorithm = new pkijs.AlgorithmIdentifier({ algorithmId: sha1 ? '1.3.14.3.2.26' : '2.16.840.1.101.3.4.2.1' });
  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [digestAlgorithm],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    certificates: identity.chain,
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: leaf.issuer, serialNumber: leaf.serialNumber }),
        digestAlgorithm,
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes }),
        signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: '1.2.840.113549.1.1.1', algorithmParams: new asn1js.Null() }),
        signature: new asn1js.OctetString({ valueHex: buffer(new Uint8Array(signature)) }),
      }),
    ],
  });
  return new Uint8Array(new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: signedData.toSchema(true) }).toSchema().toBER(false));
}

/** Signs a PDF the way the app does: prepare, sign the fingerprint, put the signature in. */
export async function signPdf(bytes: Uint8Array, identity: Identity, options: SignOptions = {}): Promise<Uint8Array> {
  const time = options.time ?? new Date();
  const name = identity.chain[0].subject.typesAndValues.find((t) => t.type === '2.5.4.3')?.value.valueBlock.value as string;
  const request: SignRequest = {
    place: options.place ?? { kind: 'invisible' },
    name,
    reason: options.reason,
    location: options.location,
    time: time.toISOString(),
    shownTime: shownTime(time),
    space: signatureSpace(certificateBytes(identity)),
    producer: 'ScribeForge tests',
    subFilter: options.older ? 'adbe.pkcs7.detached' : undefined,
  };
  const prepared = await prepareSignature(bytes, request);
  if (!options.older) return insertSignature(prepared, makeSignature(prepared.digest, identity.key, identity.chain));
  const [, b, c, d] = prepared.byteRange;
  const data = new Uint8Array(b + d);
  data.set(prepared.bytes.subarray(0, b), 0);
  data.set(prepared.bytes.subarray(c, c + d), b);
  return insertSignature(prepared, olderSignature(prepared.digest, data, identity, time, options.sha1 === true));
}

/** Changes page 1 after signing (adds a line of text), as an update at the end of the file. */
export async function changePageAfterSigning(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  const snapshot = doc.takeSnapshot();
  const page = doc.getPage(0);
  snapshot.markRefForSave(page.ref);
  page.drawText('PAY 1,000,000 TO MALLORY', { x: 54, y: 300, size: 14, font: await doc.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) });
  const update = await doc.saveIncremental(snapshot, { useObjectStreams: false });
  const out = new Uint8Array(bytes.length + update.length);
  out.set(bytes, 0);
  out.set(update, bytes.length);
  return out;
}

/** A copy with an empty signature box on page 1, named `name`, as forms with "sign here" have. */
export async function withEmptySignatureBox(bytes: Uint8Array, name: string, rect: [number, number, number, number], label?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(0);
  if (label) page.drawText(label, { x: rect[0], y: rect[3] + 8, size: 11, font: await doc.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) });
  const widget = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(name), Rect: rect, F: 4, P: page.ref, MK: { BC: [0.4, 0.4, 0.4] } }),
  );
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(widget);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([widget]));
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [widget] }));
  return doc.save({ useObjectStreams: false });
}
