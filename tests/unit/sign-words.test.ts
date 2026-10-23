// The plain words for signatures (docs/Plan_Sign.md, section 5), for the Sign screen and the
// command line.
import { describe, expect, it } from 'vitest';
import type { CertificateSummary, SignatureCheck } from '../../src/engine/sign/types';
import {
  boxTime,
  certificateWarnings,
  detailLines,
  identityLines,
  limitLines,
  newFileNote,
  signaturesSummary,
  signedLine,
  statusSentence,
  statusWord,
} from '../../src/renderer/src/sign/describe';

const cert: CertificateSummary = {
  name: 'Alex Example',
  issuer: 'Example CA',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2028-01-01T00:00:00.000Z',
  fingerprint: 'AB:CD',
  selfSigned: false,
  forSigning: true,
  der: 'MIIB',
};

const check = (over: Partial<SignatureCheck> = {}): SignatureCheck => ({
  field: 'Signature1',
  page: 1,
  visible: true,
  documentTimestamp: false,
  name: 'Alex Example',
  time: '2026-10-22T13:44:00.000Z',
  hasTimestamp: false,
  status: 'valid',
  certificate: cert,
  identity: 'unknown',
  certificateTime: 'ok',
  signedLength: 1000,
  laterSignatures: 0,
  ...over,
});

describe('what a signature check says', () => {
  it('gives the result in a word and a sentence', () => {
    expect([statusWord(check()), statusSentence(check())]).toEqual(['Valid', "The file hasn't changed since Alex Example signed it."]);
    expect([statusWord(check({ status: 'signed-after' })), statusSentence(check({ status: 'signed-after' }))]).toEqual(['Valid', 'Only other signatures were added after it.']);
    expect([statusWord(check({ status: 'changed' })), statusSentence(check({ status: 'changed' }))]).toEqual([
      'Changed after signing',
      'Alex Example signed an earlier version. Open the signed version to see what they signed.',
    ]);
    expect(statusSentence(check({ status: 'changed', name: undefined }))).toBe('The signer signed an earlier version. Open the signed version to see what they signed.');
    expect([statusWord(check({ status: 'not-valid', problem: 'mismatch' })), statusSentence(check({ status: 'not-valid', problem: 'mismatch' }))]).toEqual([
      'Not valid',
      "The file doesn't match this signature. It was changed, or the signature is damaged.",
    ]);
    expect(statusSentence(check({ status: 'not-valid', problem: 'weak' }))).toBe('It uses an old method (SHA-1 or MD5) that can be forged.');
    expect(statusWord(check({ status: 'cannot-check' }))).toBe("Can't be checked");
    expect(statusSentence(check({ status: 'cannot-check', documentTimestamp: true }))).toContain('time stamp');
  });

  it('says who signed, and whether their identity is confirmed', () => {
    expect(identityLines(check({ identity: 'windows', trustedBy: 'Example CA' }))).toEqual(['Certificate: Alex Example, issued by Example CA.', 'Windows on this PC trusts Example CA.']);
    expect(identityLines(check({ identity: 'mine', trustedBy: 'Alex Example' }))).toEqual(['Certificate: Alex Example, issued by Example CA.', 'You chose to trust this certificate.']);
    expect(identityLines(check({ identity: 'mine', trustedBy: 'Example CA' }))[1]).toBe('You chose to trust Example CA.');
    expect(identityLines(check({ certificate: { ...cert, selfSigned: true } }))).toEqual([
      'Certificate: Alex Example, which issued itself.',
      'Identity not confirmed. Anyone can make a certificate with any name.',
    ]);
    expect(identityLines(check({ chainProblem: 'issuer-not-allowed', certificateTime: 'expired' })).slice(2)).toEqual([
      "A certificate it relies on isn't allowed to vouch for others.",
      'The certificate had expired when it was signed.',
    ]);
  });

  it('says where its box is, and why and where it was signed', () => {
    expect(detailLines(check({ reason: 'Approved', location: 'Head office' }))).toEqual(['Reason: Approved', 'Place: Head office', 'Its box is on page 1.']);
    expect(detailLines(check({ visible: false }))).toEqual(['It has no box on the page.']);
    expect(signedLine(check({ time: undefined }))).toBe('Signed by Alex Example.');
  });

  it("always says what can't be checked without the internet, unless it isn't valid anyway", () => {
    expect(limitLines(check())).toEqual(['Not checked: whether the certificate was cancelled. That needs the internet.', "The signing time comes from the signer's computer clock."]);
    expect(limitLines(check({ hasTimestamp: true }))[1]).toContain("time stamp from a time-stamp service, which ScribeForge doesn't check yet");
    expect(limitLines(check({ status: 'not-valid' }))).toEqual([]);
  });

  it('sums up a file in a sentence', () => {
    expect(signaturesSummary([])).toBe('This file has no signatures.');
    expect(signaturesSummary([check({ identity: 'mine' })])).toBe("This file has 1 signature. It's valid.");
    expect(signaturesSummary([check({ identity: 'windows' }), check({ identity: 'mine', status: 'signed-after' })])).toBe('This file has 2 signatures. All are valid.');
    expect(signaturesSummary([check()])).toBe('This file has 1 signature: valid, identity not confirmed.');
    expect(signaturesSummary([check({ status: 'changed' }), check({ identity: 'mine' }), check({ status: 'not-valid' })])).toBe(
      'This file has 3 signatures: 1 changed after signing; 1 valid; 1 not valid.',
    );
  });
});

describe('signing', () => {
  it("writes the box's date in this PC's time", () => {
    expect(boxTime(new Date(2026, 9, 22, 14, 4))).toBe('22 Oct 2026, 14:04');
  });

  it('says when it makes a new file first, and why', () => {
    expect(newFileNote(null)).toBeNull();
    expect(newFileNote('changes')).toContain("Your changes aren't saved yet");
    expect(newFileNote('password')).toContain('without them');
    expect(newFileNote('damaged')).toContain('repaired copy');
  });

  it('warns about a certificate that has expired, is not for signing, or issued itself', () => {
    const now = new Date('2026-10-22T00:00:00Z');
    expect(certificateWarnings(cert, now)).toEqual([]);
    const warnings = certificateWarnings({ ...cert, validTo: '2026-01-02T00:00:00.000Z', forSigning: false, selfSigned: true }, now);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/^This certificate expired on/);
  });
});
