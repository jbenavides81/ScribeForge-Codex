// Checking the signatures a file has, without the internet (docs/Plan_Sign.md, section 5):
// 1. Has the file changed? The signature must cover the whole file up to itself, and its maths
//    must match those bytes (RFC 5652).
// 2. Was anything added after it? Only other signatures, or other changes (changes.ts).
// 3. Who signed? The certificate's name, and whether it leads back to a trusted certificate,
//    with ScribeForge's own checks on each certificate along the way (RFC 5280).
// 4. Was a safe method used? SHA-1 and MD5 can be forged, so those signatures aren't valid.
// Whether a certificate was cancelled can't be checked: that needs the internet.
import { PDFDict, PDFDocument, PDFHexString, PDFString, type PDFObject } from '@cantoo/pdf-lib';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { N, nameOf, resolve, textOf } from '../objects';
import { buffer, certificateDer, fromBase64, mayIssue, nameText, parseCertificate, selfIssued, summarise, validAt } from './certificate';
import { laterChanges } from './changes';
import { hasArea, signatureFields } from './fields';
import { signedBytes } from './prepare';
import type { ChainProblem, Identity, SignatureCheck, TrustAnchor } from './types';

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  signingTime: '1.2.840.113549.1.9.5',
  timeStampToken: '1.2.840.113549.1.9.16.2.14',
  sha1: '1.3.14.3.2.26',
  md5: '1.2.840.113549.2.5',
  sha1WithRsa: '1.2.840.113549.1.1.5',
  md5WithRsa: '1.2.840.113549.1.1.4',
  ecdsaWithSha1: '1.2.840.10045.4.1',
  dsaWithSha1: '1.2.840.10040.4.3',
};
const WEAK = new Set([OID.sha1, OID.md5, OID.sha1WithRsa, OID.md5WithRsa, OID.ecdsaWithSha1, OID.dsaWithSha1]);
/** Kinds of signature ScribeForge checks; the old SHA-1-only kinds count as weak. */
const DETACHED = new Set(['adbe.pkcs7.detached', 'ETSI.CAdES.detached']);
const SHA1_KINDS = new Set(['adbe.pkcs7.sha1', 'adbe.x509.rsa_sha1']);
/** Longest certificate chain followed. */
const MAX_CHAIN = 10;

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

function numberList(doc: PDFDocument, obj: PDFObject | undefined): number[] | undefined {
  const arr = resolve(doc, obj);
  if (!arr || !('asArray' in arr)) return undefined;
  const values = (arr as { asArray(): PDFObject[] }).asArray().map((v) => Number(resolve(doc, v)?.toString()));
  return values.every((v) => Number.isSafeInteger(v) && v >= 0) ? values : undefined;
}

function hexBytes(text: string): Uint8Array | null {
  const hex = text.replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
  const even = hex.length % 2 ? `${hex}0` : hex;
  const out = new Uint8Array(even.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(even.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The text of a signature's own entry (its name, reason, place). */
function entry(doc: PDFDocument, dict: PDFDict, key: string): string | undefined {
  const v = textOf(resolve(doc, dict.get(N(key))))?.trim();
  return v ? v : undefined;
}

/** "D:20261022144400+01'00'" as an ISO date. */
function pdfDate(doc: PDFDocument, dict: PDFDict): string | undefined {
  const v = resolve(doc, dict.get(N('M')));
  if (!(v instanceof PDFString || v instanceof PDFHexString)) return undefined;
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(v.decodeText().trim());
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh = '00', om = '00'] = m;
  const zone = !sign || sign.toUpperCase() === 'Z' ? 'Z' : `${sign}${oh}:${om}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

interface Anchor {
  cert: pkijs.Certificate;
  der: string;
  source: 'windows' | 'mine';
}

const derKey = (cert: pkijs.Certificate) => latin1(certificateDer(cert));

async function signs(issuer: pkijs.Certificate, cert: pkijs.Certificate): Promise<boolean> {
  try {
    return await cert.verify(issuer);
  } catch {
    return false;
  }
}

/**
 * Who vouches for a certificate: follows issuers (from the signature's own certificates and the
 * trusted ones) until it reaches a trusted certificate, checking at each step that the issuer
 * may issue certificates and was valid when the signature was made.
 */
async function identityOf(
  leaf: pkijs.Certificate,
  pool: pkijs.Certificate[],
  anchors: Anchor[],
  when: Date,
): Promise<{ identity: Identity; trustedBy?: string; problem?: ChainProblem }> {
  const anchorFor = (cert: pkijs.Certificate) => anchors.find((a) => a.der === derKey(cert));
  const direct = anchorFor(leaf);
  if (direct) return { identity: direct.source, trustedBy: nameText(leaf.subject) };
  let problem: ChainProblem | undefined;
  let current = leaf;
  const used = new Set([derKey(leaf)]);
  for (let depth = 0; depth < MAX_CHAIN; depth++) {
    if (selfIssued(current) && depth > 0) break;
    const candidates = [...anchors.map((a) => a.cert), ...pool].filter((c) => !used.has(derKey(c)) && c.subject.isEqual(current.issuer));
    let issuer: pkijs.Certificate | undefined;
    for (const c of candidates) {
      if (await signs(c, current)) {
        issuer = c;
        break;
      }
    }
    if (!issuer) break;
    used.add(derKey(issuer));
    const anchor = anchorFor(issuer);
    const may = mayIssue(issuer);
    if (may === false || (may === 'unknown' && !anchor)) {
      problem = 'issuer-not-allowed';
      break;
    }
    if (validAt(issuer, when) !== 'ok') {
      problem = 'issuer-out-of-date';
      break;
    }
    if (anchor) return { identity: anchor.source, trustedBy: nameText(issuer.subject) };
    current = issuer;
  }
  return { identity: 'unknown', problem };
}

/** The signature's CMS structure, from its space in the file. */
function readCms(contents: Uint8Array): pkijs.SignedData | null {
  try {
    const parsed = asn1js.fromBER(buffer(contents));
    if (parsed.offset === -1) return null;
    const info = new pkijs.ContentInfo({ schema: parsed.result });
    if (info.contentType !== OID.signedData) return null;
    return new pkijs.SignedData({ schema: info.content });
  } catch {
    return null;
  }
}

/** Whether `bytes` contain `text` (plain ASCII), without making one huge string of a large file. */
function containsText(bytes: Uint8Array, text: string): boolean {
  const codes = [...text].map((c) => c.charCodeAt(0));
  outer: for (let i = bytes.indexOf(codes[0]); i >= 0 && i <= bytes.length - codes.length; i = bytes.indexOf(codes[0], i + 1)) {
    for (let k = 1; k < codes.length; k++) if (bytes[i + k] !== codes[k]) continue outer;
    return true;
  }
  return false;
}

/** Checks every signature in the file, in the order they were added. */
export async function checkSignatures(bytes: Uint8Array, trusted: TrustAnchor[], password?: string): Promise<SignatureCheck[]> {
  // Every signature says what it covers in plain bytes (its ByteRange), so a file without one has none: no need to read it all.
  if (!containsText(bytes, '/ByteRange')) return [];
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { password: password ?? '', updateMetadata: false });
  } catch {
    try {
      // A protected file opened without its password: the signatures' own bytes are never encrypted.
      doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    } catch {
      return [];
    }
  }
  const anchors: Anchor[] = [];
  for (const t of trusted) {
    try {
      const cert = parseCertificate(fromBase64(t.der));
      anchors.push({ cert, der: derKey(cert), source: t.source });
    } catch {
      // A trusted certificate that can't be read is skipped.
    }
  }
  // "Mine" first: when both lists have a certificate, the person's own choice is the reason given.
  anchors.sort((a, b) => (a.source === b.source ? 0 : a.source === 'mine' ? -1 : 1));

  const results: SignatureCheck[] = [];
  for (const field of signatureFields(doc)) {
    if (!field.value) continue;
    results.push(await checkOne(bytes, doc, field.name, field.value, field.page, hasArea(field.rect), anchors));
  }
  results.sort((a, b) => a.signedLength - b.signedLength);
  return results;
}

async function checkOne(
  bytes: Uint8Array,
  doc: PDFDocument,
  name: string,
  value: PDFDict,
  page: number | undefined,
  visible: boolean,
  anchors: Anchor[],
): Promise<SignatureCheck> {
  const subFilter = nameOf(value.get(N('SubFilter'))) ?? '';
  const result: SignatureCheck = {
    field: name,
    page: page === undefined ? undefined : page + 1,
    visible,
    documentTimestamp: nameOf(value.get(N('Type'))) === 'DocTimeStamp' || subFilter === 'ETSI.RFC3161',
    name: entry(doc, value, 'Name'),
    reason: entry(doc, value, 'Reason'),
    location: entry(doc, value, 'Location'),
    time: pdfDate(doc, value),
    hasTimestamp: false,
    status: 'not-valid',
    identity: 'unknown',
    signedLength: 0,
    laterSignatures: 0,
  };
  const fail = (problem: SignatureCheck['problem'], status: SignatureCheck['status'] = 'not-valid') => ({ ...result, status, problem });

  // What it covers: from the start of the file, around its own space, to the end of its version.
  const range = numberList(doc, value.get(N('ByteRange')));
  if (!range || range.length !== 4) return fail('coverage');
  const [a, b, c, d] = range;
  if (a !== 0 || c <= b || c + d > bytes.length || b < 9) return fail('coverage');
  result.signedLength = c + d;
  const space = latin1(bytes.subarray(b, c));
  // The space must hold only the signature, right after the signature's /Contents.
  if (!/^<[0-9a-fA-F\s]*>$/.test(space) || !/\/Contents\s*$/.test(latin1(bytes.subarray(Math.max(0, b - 32), b)))) return fail('coverage');
  // Its version must end where a version of a PDF ends.
  if (!/%%EOF\s*$/.test(latin1(bytes.subarray(Math.max(0, c + d - 64), c + d)))) return fail('coverage');
  const contents = hexBytes(space.slice(1, -1));
  if (!contents) return fail('coverage');

  if (result.documentTimestamp) return fail('unsupported', 'cannot-check');
  if (SHA1_KINDS.has(subFilter)) return fail('weak');
  if (!DETACHED.has(subFilter)) return fail('unsupported', 'cannot-check');

  const cms = readCms(contents);
  const signer = cms?.signerInfos[0];
  if (!cms || !signer || cms.signerInfos.length !== 1) return fail('damaged');

  const signingTime = signer.signedAttrs?.attributes.find((x) => x.type === OID.signingTime)?.values[0] as asn1js.UTCTime | asn1js.GeneralizedTime | undefined;
  if (signingTime?.toDate) result.time = signingTime.toDate().toISOString();
  result.hasTimestamp = !!signer.unsignedAttrs?.attributes.some((x) => x.type === OID.timeStampToken);
  const pool = (cms.certificates ?? []).filter((x): x is pkijs.Certificate => x instanceof pkijs.Certificate);

  // 1. The maths: does the signature match the bytes it covers? (This also finds the signer's certificate.)
  let leaf: pkijs.Certificate | undefined;
  let mismatch = false;
  try {
    const verified = await cms.verify({ signer: 0, data: buffer(signedBytes(bytes, range)), checkChain: false, extendedMode: true });
    leaf = verified.signerCertificate ?? undefined;
    mismatch = !verified.signatureVerified;
  } catch (error) {
    const e = error as { message?: unknown; signerCertificate?: pkijs.Certificate };
    const message = String(e?.message ?? error);
    leaf = e?.signerCertificate ?? undefined;
    if (/unable to find signer certificate/i.test(message)) return fail('damaged');
    if (!/digest doesn't match|signature.*(not )?verified|verification failed/i.test(message)) return fail('unsupported', 'cannot-check');
    mismatch = true;
  }
  if (leaf) {
    result.certificate = await summarise(leaf);
    result.name = result.certificate.name;
  }
  // Methods that can be forged count as not valid, whatever the maths says.
  if (WEAK.has(signer.digestAlgorithm.algorithmId) || WEAK.has(signer.signatureAlgorithm.algorithmId)) return fail('weak');
  if (mismatch) return fail('mismatch');
  if (!leaf) return fail('damaged');

  // 2. Anything after it?
  if (c + d < bytes.length) {
    const later = await laterChanges(bytes, c + d);
    result.status = later.onlySignatures ? (later.signatures > 0 ? 'signed-after' : 'valid') : 'changed';
    result.laterSignatures = later.signatures;
  } else result.status = 'valid';

  // 3. Who: the certificate's dates at the signing time, and who vouches for it.
  const when = result.time ? new Date(result.time) : new Date();
  result.certificateTime = validAt(leaf, when);
  const chain = await identityOf(leaf, pool, anchors, when);
  result.identity = chain.identity;
  result.trustedBy = chain.trustedBy;
  result.chainProblem = chain.problem;
  if (!result.certificate?.forSigning) {
    result.identity = 'unknown';
    result.trustedBy = undefined;
    result.chainProblem = 'not-for-signing';
  }
  return result;
}
