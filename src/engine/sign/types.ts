// Signing and checking signatures (codename Sealkeeper; docs/Plan_Sign.md): the engine's inputs
// and outputs. Plain data, so it passes between the app's parts and into the unit tests as it is.
import type { Rect, Rotation } from '../types';

/** Where a new signature goes. */
export type SignaturePlace =
  | { kind: 'invisible' }
  /** A box drawn on a page (0-based), in the page's own space, shown upright on a turned page. */
  | { kind: 'box'; page: number; rect: Rect; rotation: Rotation }
  /** An empty signature box the file already has, by its full field name. */
  | { kind: 'field'; field: string };

export interface SignRequest {
  place: SignaturePlace;
  /** The name on the certificate, shown in the box and saved with the signature. */
  name: string;
  reason?: string;
  location?: string;
  /** When it's signed (this PC's clock), as ISO. */
  time: string;
  /** The date as shown in the box, such as "22 Oct 2026, 14:44". */
  shownTime: string;
  /** Bytes kept for the signature itself, worked out from the size of the certificates. */
  space: number;
  /** Written into the signature as the program that made it, such as "ScribeForge 1.5.0". */
  producer?: string;
  /** The kind of signature: PAdES (the default), or the older kind other programs make (for the tests). */
  subFilter?: 'ETSI.CAdES.detached' | 'adbe.pkcs7.detached';
}

/** A file ready to sign: everything is in place except the signature itself. */
export interface PreparedSignature {
  bytes: Uint8Array;
  /** What the signature covers: [start, length, start, length], around the space kept for it. */
  byteRange: [number, number, number, number];
  /** SHA-256 of the bytes covered, which is what gets signed. */
  digest: Uint8Array;
}

/** An empty signature box in a file, which can be signed. */
export interface EmptySignatureField {
  name: string;
  /** 1-based, when it's on a page. */
  page?: number;
  visible: boolean;
}

/** A certificate, as ScribeForge describes it. */
export interface CertificateSummary {
  /** The person or organisation it's for: its common name, or failing that its organisation. */
  name: string;
  email?: string;
  /** Who issued it, by name. The same as `name` for a certificate that issued itself. */
  issuer: string;
  /** ISO dates. */
  validFrom: string;
  validTo: string;
  /** SHA-256 of the certificate, as pairs of hex digits separated by colons. */
  fingerprint: string;
  /** It issued itself (no company vouches for it). */
  selfSigned: boolean;
  /** Its key may be used to sign documents (or it doesn't say). */
  forSigning: boolean;
  /** The certificate itself (DER, base64), so it can be trusted. */
  der: string;
}

/**
 * A signature's result, the first thing ScribeForge says about it:
 * - valid: the file hasn't changed since it was signed;
 * - signed-after: valid, and only other signatures were added after it;
 * - changed: valid for an earlier version, but the file was changed after it;
 * - not-valid: the file doesn't match it, it's damaged, or it uses a method that can be forged;
 * - cannot-check: a kind of signature ScribeForge can't read.
 */
export type SignatureStatus = 'valid' | 'signed-after' | 'changed' | 'not-valid' | 'cannot-check';

/** Why a signature isn't valid, or can't be checked. */
export type SignatureProblem = 'mismatch' | 'damaged' | 'coverage' | 'weak' | 'unsupported';

/** Whether the certificate leads back to one that's trusted, and which list trusts it. */
export type Identity = 'windows' | 'mine' | 'unknown';

/** Why a certificate doesn't lead back to a trusted one, when it could have. */
export type ChainProblem = 'not-for-signing' | 'issuer-not-allowed' | 'issuer-out-of-date';

export interface SignatureCheck {
  field: string;
  /** 1-based page its box is on. */
  page?: number;
  visible: boolean;
  /** A time stamp for the whole file from a time-stamp service, rather than a person's signature. */
  documentTimestamp: boolean;
  /** The certificate's name, or the name saved with the signature. */
  name?: string;
  reason?: string;
  location?: string;
  /** When it was signed, according to the signer's clock (ISO). */
  time?: string;
  /** It carries a time stamp from a time-stamp service (not checked yet). */
  hasTimestamp: boolean;
  status: SignatureStatus;
  problem?: SignatureProblem;
  certificate?: CertificateSummary;
  identity: Identity;
  /** The trusted certificate it leads back to, by name. */
  trustedBy?: string;
  chainProblem?: ChainProblem;
  /** Whether the signer's certificate was valid at the signing time. */
  certificateTime?: 'ok' | 'expired' | 'not-yet';
  /** How many bytes it covers: the start of the file up to here is exactly what was signed. */
  signedLength: number;
  /** How many signatures were added after it (for "signed-after"). */
  laterSignatures: number;
}

/** A certificate ScribeForge trusts, and why. */
export interface TrustAnchor {
  /** DER, base64. */
  der: string;
  source: 'windows' | 'mine';
}
