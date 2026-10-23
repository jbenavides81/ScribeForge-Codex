// Making certificates: "Make a certificate…" (a certificate in your own name, which issues
// itself), and the made-up test certificates the fixture script and tests use.
import * as asn1js from 'asn1js';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import * as pkijs from 'pkijs';
import { buffer } from '../../engine/sign/certificate';
import { serialNumber } from './pfx';

const OID = {
  commonName: '2.5.4.3',
  organisation: '2.5.4.10',
  email: '1.2.840.113549.1.9.1',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  subjectKeyId: '2.5.29.14',
  authorityKeyId: '2.5.29.35',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  emailProtection: '1.3.6.1.5.5.7.3.4',
  documentSigning: '1.3.6.1.4.1.311.10.3.12',
};

/** Key usage bits (RFC 5280, section 4.2.1.3). */
const USAGE = { sign: 0x80 | 0x40, ca: 0x04 | 0x02 };

export interface Subject {
  name: string;
  email?: string;
  organisation?: string;
}

export interface IssueOptions {
  subject: Subject;
  /** The new certificate's key pair. */
  publicKey: KeyObject;
  /** Who issues it: another certificate and its key, or nobody (it issues itself, with `privateKey`). */
  issuer?: { cert: pkijs.Certificate; key: KeyObject };
  privateKey: KeyObject;
  notBefore: Date;
  notAfter: Date;
  /** May issue other certificates. */
  ca?: boolean;
  /** What its key may be used for: signing documents (the default), issuing certificates, or anything (no limit given). */
  usage?: 'sign' | 'ca' | 'any';
}

function name(subject: Subject): pkijs.RelativeDistinguishedNames {
  const values = [new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: subject.name }) })];
  if (subject.organisation) values.push(new pkijs.AttributeTypeAndValue({ type: OID.organisation, value: new asn1js.Utf8String({ value: subject.organisation }) }));
  if (subject.email) values.push(new pkijs.AttributeTypeAndValue({ type: OID.email, value: new asn1js.IA5String({ value: subject.email }) }));
  return new pkijs.RelativeDistinguishedNames({ typesAndValues: values });
}

function extension(id: string, critical: boolean, value: asn1js.BaseBlock): pkijs.Extension {
  return new pkijs.Extension({ extnID: id, critical, extnValue: value.toBER(false) });
}

/** A key usage bit string, with the unused bits at the end counted as DER asks. */
function usageBits(bits: number): asn1js.BitString {
  let unused = 0;
  while (unused < 7 && !(bits & (1 << unused))) unused++;
  return new asn1js.BitString({ valueHex: buffer(new Uint8Array([bits])), unusedBits: unused });
}

function keyIdentifier(cert: pkijs.Certificate): Uint8Array {
  return new Uint8Array(createHash('sha1').update(cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView).digest());
}

/** A new certificate, signed by its issuer's key (or its own). */
export function issueCertificate(options: IssueOptions): pkijs.Certificate {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = serialNumber();
  cert.subject = name(options.subject);
  cert.issuer = options.issuer ? options.issuer.cert.subject : cert.subject;
  cert.notBefore.value = options.notBefore;
  cert.notAfter.value = options.notAfter;
  cert.subjectPublicKeyInfo = pkijs.PublicKeyInfo.fromBER(buffer(new Uint8Array(options.publicKey.export({ type: 'spki', format: 'der' }))));

  const usage = options.usage ?? (options.ca ? 'ca' : 'sign');
  const extensions = [extension(OID.basicConstraints, true, new pkijs.BasicConstraints({ cA: options.ca === true }).toSchema())];
  if (usage !== 'any') extensions.push(extension(OID.keyUsage, true, usageBits(usage === 'ca' ? USAGE.ca : USAGE.sign)));
  if (usage === 'sign') extensions.push(extension(OID.extKeyUsage, false, new pkijs.ExtKeyUsage({ keyPurposes: [OID.emailProtection, OID.documentSigning] }).toSchema()));
  extensions.push(extension(OID.subjectKeyId, false, new asn1js.OctetString({ valueHex: buffer(keyIdentifier(cert)) })));
  if (options.issuer) {
    const id = keyIdentifier(options.issuer.cert);
    extensions.push(extension(OID.authorityKeyId, false, new pkijs.AuthorityKeyIdentifier({ keyIdentifier: new asn1js.OctetString({ valueHex: buffer(id) }) }).toSchema()));
  }
  cert.extensions = extensions;

  const signer = options.issuer?.key ?? options.privateKey;
  const rsa = signer.asymmetricKeyType === 'rsa';
  const algorithm = new pkijs.AlgorithmIdentifier({ algorithmId: rsa ? OID.sha256WithRsa : OID.ecdsaWithSha256, algorithmParams: rsa ? new asn1js.Null() : undefined });
  cert.signature = algorithm;
  cert.signatureAlgorithm = algorithm;
  const tbs = new Uint8Array(cert.encodeTBS().toBER(false));
  cert.tbsView = tbs;
  const signature = sign('sha256', tbs, rsa ? signer : { key: signer, dsaEncoding: 'der' });
  cert.signatureValue = new asn1js.BitString({ valueHex: buffer(new Uint8Array(signature)) });
  // Read back, so it's exactly as it will be saved.
  return pkijs.Certificate.fromBER(cert.toSchema(false).toBER(false));
}

/** "Make a certificate": a new key and a certificate in your name, valid for five years, that issues itself. */
export function makeOwnCertificate(subject: Subject, now = new Date()): { key: KeyObject; cert: pkijs.Certificate } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + 5);
  return { key: privateKey, cert: issueCertificate({ subject, publicKey, privateKey, notBefore, notAfter }) };
}
