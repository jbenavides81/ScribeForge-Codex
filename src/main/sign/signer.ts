// Making the signature itself, in the main process: a CMS signature (RFC 5652) of the kind PDFs
// call ETSI.CAdES.detached, PAdES baseline B-B (ETSI EN 319 142-1). It signs the fingerprint
// (SHA-256) of the file's bytes, worked out by the PDF side of the app, which never sees the key.
//
// Signed with it, as PAdES asks: the kind of content, its fingerprint, and the fingerprint of
// the signer's certificate (signing-certificate-v2, RFC 5035). The signing time goes in the PDF's
// own signature entry instead (/M), as PAdES asks.
import * as asn1js from 'asn1js';
import { createHash, sign, type KeyObject } from 'node:crypto';
import * as pkijs from 'pkijs';
import { buffer, certificateDer } from '../../engine/sign/certificate';

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
};

export class SignerError extends Error {}

/** Compares encodings as DER asks for a SET OF: as byte strings, the shorter padded with zeros (X.690, 11.6). */
function derOrder(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The kinds of key ScribeForge signs with, and the matching signature method. */
function methodFor(key: KeyObject): { oid: string; params?: asn1js.Null; options: KeyObject | { key: KeyObject; dsaEncoding: 'der' } } {
  if (key.asymmetricKeyType === 'rsa') return { oid: OID.sha256WithRsa, params: new asn1js.Null(), options: key };
  if (key.asymmetricKeyType === 'ec') return { oid: OID.ecdsaWithSha256, options: { key, dsaEncoding: 'der' } };
  throw new SignerError(`ScribeForge can't sign with this kind of key (${key.asymmetricKeyType ?? 'unknown'}). It signs with RSA and EC keys.`);
}

/**
 * The signature (DER) for a file whose bytes have the SHA-256 fingerprint `digest`, made with
 * `key` and carrying `chain` (the signer's certificate first) so readers can see who signed.
 */
export function makeSignature(digest: Uint8Array, key: KeyObject, chain: pkijs.Certificate[]): Uint8Array {
  if (digest.length !== 32) throw new SignerError('The file to sign was not prepared properly.');
  const leaf = chain[0];
  const method = methodFor(key);
  const certHash = createHash('sha256').update(certificateDer(leaf)).digest();
  // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }, each with SHA-256 (the default, so left out) and the hash.
  const essCertIdV2 = new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: buffer(new Uint8Array(certHash)) })] })] })] });
  const attributes = [
    new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
    new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: buffer(digest) })] }),
    new pkijs.Attribute({ type: OID.signingCertificateV2, values: [essCertIdV2] }),
  ]
    .map((attribute) => ({ attribute, der: new Uint8Array(attribute.toSchema().toBER(false)) }))
    .sort((a, b) => derOrder(a.der, b.der));

  // What's signed: the attributes, encoded as a SET (RFC 5652, section 5.4).
  const set = new asn1js.Set({ value: attributes.map((a) => a.attribute.toSchema()) });
  const toSign = new Uint8Array(set.toBER(false));
  const signature = sign('sha256', toSign, method.options);

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: leaf.issuer, serialNumber: leaf.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: attributes.map((a) => a.attribute) }),
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: method.oid, algorithmParams: method.params }),
    signature: new asn1js.OctetString({ valueHex: buffer(new Uint8Array(signature)) }),
  });
  const seen = new Set<string>();
  const certificates = chain.filter((c) => {
    const id = Buffer.from(certificateDer(c)).toString('base64');
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    certificates,
    signerInfos: [signerInfo],
  });
  const info = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
  return new Uint8Array(info.toSchema().toBER(false));
}
