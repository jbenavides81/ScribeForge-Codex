// Reading certificates: who they're for, who issued them, when they're valid, and what they may
// be used for. Uses pkijs and the browser's own crypto, so it runs in the app's worker, the main
// process and the unit tests alike.
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { CertificateSummary } from './types';

const OID = {
  commonName: '2.5.4.3',
  organisation: '2.5.4.10',
  email: '1.2.840.113549.1.9.1',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
};

/** Key usage bits (RFC 5280, section 4.2.1.3), in the first byte of the bit string. */
const USAGE = { digitalSignature: 0x80, nonRepudiation: 0x40, keyCertSign: 0x04 };

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** A plain copy of the bytes, as the ArrayBuffer pkijs and the browser's crypto expect. */
export function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

export function parseCertificate(der: Uint8Array): pkijs.Certificate {
  return pkijs.Certificate.fromBER(buffer(der));
}

export function certificateDer(cert: pkijs.Certificate): Uint8Array {
  return new Uint8Array(cert.toSchema(true).toBER(false));
}

function nameValue(name: pkijs.RelativeDistinguishedNames, type: string): string | undefined {
  const found = name.typesAndValues.find((t) => t.type === type);
  const value = found?.value?.valueBlock?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** A name to show for a certificate's subject or issuer. */
export function nameText(name: pkijs.RelativeDistinguishedNames): string {
  return (
    nameValue(name, OID.commonName) ??
    nameValue(name, OID.organisation) ??
    nameValue(name, OID.email) ??
    (name.typesAndValues
      .map((t) => t.value?.valueBlock?.value)
      .filter((v): v is string => typeof v === 'string')
      .join(', ') ||
      'unnamed')
  );
}

function extension(cert: pkijs.Certificate, oid: string): pkijs.Extension | undefined {
  return cert.extensions?.find((e) => e.extnID === oid);
}

/** The key usage bits, or null when the certificate doesn't limit them. */
function keyUsage(cert: pkijs.Certificate): number | null {
  const ext = extension(cert, OID.keyUsage);
  if (!ext) return null;
  const bits = ext.parsedValue instanceof asn1js.BitString ? ext.parsedValue.valueBlock.valueHexView : undefined;
  return bits && bits.length > 0 ? bits[0] : 0;
}

/** May sign documents: its key usage allows signing, or it doesn't limit it. */
export function forSigning(cert: pkijs.Certificate): boolean {
  const usage = keyUsage(cert);
  return usage === null || (usage & (USAGE.digitalSignature | USAGE.nonRepudiation)) !== 0;
}

/**
 * May issue other certificates: it says it's a certificate authority, and its key usage (if
 * given) allows signing certificates. An old certificate with no extensions at all can only be a
 * trusted one's own issuer when it's trusted itself, which the caller decides.
 */
export function mayIssue(cert: pkijs.Certificate): boolean | 'unknown' {
  const constraints = extension(cert, OID.basicConstraints);
  if (!constraints) return cert.extensions?.length ? false : 'unknown';
  const parsed = constraints.parsedValue as pkijs.BasicConstraints | undefined;
  if (!parsed?.cA) return false;
  const usage = keyUsage(cert);
  return usage === null || (usage & USAGE.keyCertSign) !== 0;
}

export function selfIssued(cert: pkijs.Certificate): boolean {
  return cert.subject.isEqual(cert.issuer);
}

export function validAt(cert: pkijs.Certificate, when: Date): 'ok' | 'expired' | 'not-yet' {
  if (when < cert.notBefore.value) return 'not-yet';
  if (when > cert.notAfter.value) return 'expired';
  return 'ok';
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buffer(bytes)));
}

export async function fingerprintOf(der: Uint8Array): Promise<string> {
  const hash = await sha256(der);
  return [...hash].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export async function summarise(cert: pkijs.Certificate): Promise<CertificateSummary> {
  const der = certificateDer(cert);
  return {
    name: nameText(cert.subject),
    email: nameValue(cert.subject, OID.email),
    issuer: nameText(cert.issuer),
    validFrom: cert.notBefore.value.toISOString(),
    validTo: cert.notAfter.value.toISOString(),
    fingerprint: await fingerprintOf(der),
    selfSigned: selfIssued(cert),
    forSigning: forSigning(cert),
    der: toBase64(der),
  };
}
