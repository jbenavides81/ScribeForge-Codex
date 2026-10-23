// Plain words for signatures and what ScribeForge found when checking them (docs/Plan_Sign.md,
// section 5). No screen code, so the unit tests can check every sentence; the command line uses
// the same words.
import type { CertificateSummary, SignatureCheck } from '../../../engine/sign/types';
import { formatDate } from '../details/describe';
import { plural } from '../words';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The date in a signature's box: "22 Oct 2026, 14:44", in this PC's time. */
export function boxTime(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Valid (and only signatures after it): the file is as it was signed. */
export const isIntact = (c: SignatureCheck) => c.status === 'valid' || c.status === 'signed-after';

/** Valid, and its identity confirmed: the only result with nothing to worry about. */
export const isConfirmed = (c: SignatureCheck) => isIntact(c) && c.identity !== 'unknown';

/** The result in a word or two. */
export function statusWord(c: SignatureCheck): string {
  switch (c.status) {
    case 'valid':
    case 'signed-after':
      return 'Valid';
    case 'changed':
      return 'Changed after signing';
    case 'not-valid':
      return 'Not valid';
    case 'cannot-check':
      return "Can't be checked";
  }
}

const who = (c: SignatureCheck) => c.name ?? 'the signer';

/** The result in a sentence. */
export function statusSentence(c: SignatureCheck): string {
  switch (c.status) {
    case 'valid':
      return `The file hasn't changed since ${who(c)} signed it.`;
    case 'signed-after':
      return 'Only other signatures were added after it.';
    case 'changed':
      return `${who(c).replace(/^the/, 'The')} signed an earlier version. Open the signed version to see what they signed.`;
    case 'not-valid':
      if (c.problem === 'weak') return 'It uses an old method (SHA-1 or MD5) that can be forged.';
      if (c.problem === 'coverage') return "It doesn't cover the file the way a signature should, so the file may have been changed.";
      return "The file doesn't match this signature. It was changed, or the signature is damaged.";
    case 'cannot-check':
      if (c.documentTimestamp) return "It's a time stamp from a time-stamp service, which ScribeForge doesn't check yet.";
      return "ScribeForge can't read this kind of signature.";
  }
}

/** "Signed by Alex Example, 22 October 2026 at 14:44." */
export function signedLine(c: SignatureCheck): string {
  if (c.documentTimestamp) return c.time ? `Time stamp, ${formatDate(c.time)}.` : 'Time stamp.';
  return `Signed by ${who(c)}${c.time ? `, ${formatDate(c.time)}` : ''}.`;
}

/** Why and where it was signed, and where its box is. */
export function detailLines(c: SignatureCheck): string[] {
  return [
    ...(c.reason ? [`Reason: ${c.reason}`] : []),
    ...(c.location ? [`Place: ${c.location}`] : []),
    c.visible && c.page ? `Its box is on page ${c.page}.` : 'It has no box on the page.',
  ];
}

function certificateLine(cert: CertificateSummary): string {
  return cert.selfSigned ? `Certificate: ${cert.name}, which issued itself.` : `Certificate: ${cert.name}, issued by ${cert.issuer}.`;
}

/** Who signed: the certificate, and whether its identity is confirmed. */
export function identityLines(c: SignatureCheck): string[] {
  if (!c.certificate) return [];
  const lines = [certificateLine(c.certificate)];
  if (c.identity === 'windows') lines.push(`Windows on this PC trusts ${c.trustedBy}.`);
  else if (c.identity === 'mine') lines.push(c.trustedBy === c.certificate.name ? 'You chose to trust this certificate.' : `You chose to trust ${c.trustedBy}.`);
  else {
    lines.push('Identity not confirmed. Anyone can make a certificate with any name.');
    if (c.chainProblem === 'not-for-signing') lines.push("Its certificate isn't meant for signing documents.");
    if (c.chainProblem === 'issuer-not-allowed') lines.push("A certificate it relies on isn't allowed to vouch for others.");
    if (c.chainProblem === 'issuer-out-of-date') lines.push("A certificate it relies on wasn't valid when it was signed.");
  }
  if (c.certificateTime === 'expired') lines.push('The certificate had expired when it was signed.');
  if (c.certificateTime === 'not-yet') lines.push("The certificate wasn't valid yet when it was signed.");
  return lines;
}

/** What ScribeForge can't check without the internet. */
export function limitLines(c: SignatureCheck): string[] {
  if (c.status === 'not-valid' || c.status === 'cannot-check') return [];
  return [
    'Not checked: whether the certificate was cancelled. That needs the internet.',
    c.hasTimestamp
      ? "It has a time stamp from a time-stamp service, which ScribeForge doesn't check yet. Until then, the signing time comes from the signer's computer clock."
      : "The signing time comes from the signer's computer clock.",
  ];
}

/** One signature's result, as a few words for a list. */
function shortResult(c: SignatureCheck): string {
  if (isConfirmed(c)) return 'valid';
  if (isIntact(c)) return 'valid, identity not confirmed';
  if (c.status === 'changed') return 'changed after signing';
  if (c.status === 'not-valid') return 'not valid';
  return "can't be checked";
}

/** "This file has 2 signatures. All are valid." or "This file has 2 signatures: 1 valid; 1 not valid." */
export function signaturesSummary(checks: SignatureCheck[]): string {
  const head = `This file has ${plural(checks.length, 'signature')}`;
  if (checks.length === 0) return 'This file has no signatures.';
  if (checks.every(isConfirmed)) return `${head}. ${checks.length === 1 ? "It's valid." : 'All are valid.'}`;
  const counts = new Map<string, number>();
  for (const c of checks) counts.set(shortResult(c), (counts.get(shortResult(c)) ?? 0) + 1);
  if (checks.length === 1) return `${head}: ${shortResult(checks[0])}.`;
  return `${head}: ${[...counts].map(([text, n]) => `${n} ${text}`).join('; ')}.`;
}

/** Everything about one signature, as lines of text (for the command line). */
export function signatureText(c: SignatureCheck): string[] {
  return [`${c.field}: ${statusWord(c)}. ${statusSentence(c)}`, `  ${signedLine(c)}`, ...detailLines(c).map((l) => `  ${l}`), ...identityLines(c).map((l) => `  ${l}`), ...limitLines(c).map((l) => `  ${l}`)];
}

/** Why signing makes a new file first, in a sentence. */
export function newFileNote(reason: 'changes' | 'password' | 'damaged' | null): string | null {
  switch (reason) {
    case 'changes':
      return "Your changes aren't saved yet, so ScribeForge makes the new file first, as Save does, and signs that.";
    case 'password':
      return 'This file has a password or restrictions. ScribeForge signs a new copy without them, as Save makes it.';
    case 'damaged':
      return "This file's structure is damaged, so ScribeForge signs a repaired copy, as Save makes it.";
    default:
      return null;
  }
}

/** What went wrong opening a certificate file, in plain words. */
export const UNLOCK_PROBLEMS: Record<'wrong-password' | 'old-format' | 'no-key' | 'unsupported' | 'unreadable' | 'not-found', string> = {
  'wrong-password': "That password didn't work. Try again.",
  'old-format': "This certificate file uses an old kind of protection that ScribeForge can't read. Open it in Windows (double-click it), then export it again with AES256-SHA256.",
  'no-key': "This file has no certificate with its key, so it can't sign. A certificate on its own (a .cer file) can only be trusted.",
  unsupported: "ScribeForge can't read this kind of certificate file.",
  unreadable: "This file couldn't be read as a certificate file.",
  'not-found': "The certificate file couldn't be found. It may have been moved or deleted.",
};

/** Warnings about a certificate before signing with it. */
export function certificateWarnings(cert: CertificateSummary, now = new Date()): string[] {
  const lines: string[] = [];
  if (new Date(cert.validTo) < now) lines.push(`This certificate expired on ${formatDate(cert.validTo)}. Readers will say so.`);
  if (new Date(cert.validFrom) > now) lines.push(`This certificate isn't valid until ${formatDate(cert.validFrom)}. Readers will say so.`);
  if (!cert.forSigning) lines.push("This certificate isn't meant for signing documents, so readers may not accept the signature.");
  if (cert.selfSigned) lines.push("It issued itself, so other people's readers will say its identity isn't confirmed, unless they choose to trust it.");
  return lines;
}
