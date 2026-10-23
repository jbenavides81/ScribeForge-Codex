// Certificate files (docs/Plan_Sign.md, S2 and section 3): files protected with AES (today's
// default) and 3DES (Windows' older default), holding RSA or EC keys, all open; a wrong password
// and the oldest kind (RC2) each give their own answer; and "Make a certificate" makes a file that
// opens again with its password.
import * as asn1js from 'asn1js';
import { createCipheriv, createHmac, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buffer, certificateDer, summarise } from '../../src/engine/sign/certificate';
import { makeOwnCertificate } from '../../src/main/sign/makeCertificate';
import { CertificateFileError, pkcs12Key, readPfx, writePfx } from '../../src/main/sign/pfx';
import { testIdentities } from '../fixtures/signing';

let ids: ReturnType<typeof testIdentities>;
beforeAll(() => {
  ids = testIdentities();
});

const OID = {
  data: '1.2.840.113549.1.7.1',
  encrypted: '1.2.840.113549.1.7.6',
  tripleDes: '1.2.840.113549.1.12.1.3',
  rc2: '1.2.840.113549.1.12.1.6',
  shroudedKey: '1.2.840.113549.1.12.10.1.2',
  cert: '1.2.840.113549.1.12.10.1.3',
  sha1: '1.3.14.3.2.26',
};

/** Encrypts with PKCS #12's own 3DES method (RFC 7292, appendix B and C), as older programs do. */
function tripleDes(data: Uint8Array, password: string): { algorithm: pkijs.AlgorithmIdentifier; encrypted: Uint8Array } {
  const salt = randomBytes(8);
  const iterations = 2048;
  const cipher = createCipheriv('des-ede3-cbc', pkcs12Key(password, salt, 1, iterations, 24), pkcs12Key(password, salt, 2, iterations, 8));
  const encrypted = new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
  const params = new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: buffer(new Uint8Array(salt)) }), new asn1js.Integer({ value: iterations })] });
  return { algorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.tripleDes, algorithmParams: params }), encrypted };
}

/**
 * A certificate file the old way: the key and the certificates protected with 3DES, and a SHA-1
 * check that the file is whole. With `certificatesAs: 'rc2'`, the certificates are marked as
 * protected with RC2 instead (the oldest kind), as OpenSSL before version 3 made them.
 */
function legacyPfx(key: KeyObject, chain: pkijs.Certificate[], password: string, certificatesAs: '3des' | 'rc2' = '3des'): Uint8Array {
  const keyDer = new Uint8Array(key.export({ type: 'pkcs8', format: 'der' }));
  const shroudedKey = tripleDes(keyDer, password);
  const keyBag = new pkijs.PKCS8ShroudedKeyBag({ encryptionAlgorithm: shroudedKey.algorithm, encryptedData: new asn1js.OctetString({ valueHex: buffer(shroudedKey.encrypted) }) });
  const keySafe = new pkijs.SafeContents({ safeBags: [new pkijs.SafeBag({ bagId: OID.shroudedKey, bagValue: keyBag })] });
  const certSafe = new pkijs.SafeContents({ safeBags: chain.map((cert) => new pkijs.SafeBag({ bagId: OID.cert, bagValue: new pkijs.CertBag({ parsedValue: cert }) })) });
  const certs = tripleDes(new Uint8Array(certSafe.toSchema().toBER(false)), password);
  if (certificatesAs === 'rc2') certs.algorithm.algorithmId = OID.rc2;
  const encryptedData = new pkijs.EncryptedData({
    version: 0,
    encryptedContentInfo: new pkijs.EncryptedContentInfo({
      contentType: OID.data,
      contentEncryptionAlgorithm: certs.algorithm,
      encryptedContent: new asn1js.OctetString({ valueHex: buffer(certs.encrypted) }),
    }),
  });
  const authSafe = new asn1js.Sequence({
    value: [
      new pkijs.ContentInfo({ contentType: OID.data, content: new asn1js.OctetString({ valueHex: keySafe.toSchema().toBER(false) }) }).toSchema(),
      new pkijs.ContentInfo({ contentType: OID.encrypted, content: encryptedData.toSchema() }).toSchema(),
    ],
  });
  const authSafeDer = new Uint8Array(authSafe.toBER(false));
  const macSalt = randomBytes(8);
  const mac = createHmac('sha1', pkcs12Key(password, macSalt, 3, 2048, 20)).update(authSafeDer).digest();
  const pfx = new pkijs.PFX({
    version: 3,
    authSafe: new pkijs.ContentInfo({ contentType: OID.data, content: new asn1js.OctetString({ valueHex: buffer(authSafeDer) }) }),
    macData: new pkijs.MacData({
      mac: new pkijs.DigestInfo({ digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha1, algorithmParams: new asn1js.Null() }), digest: new asn1js.OctetString({ valueHex: buffer(new Uint8Array(mac)) }) }),
      macSalt: new asn1js.OctetString({ valueHex: buffer(new Uint8Array(macSalt)) }),
      iterations: 2048,
    }),
  });
  return new Uint8Array(pfx.toSchema().toBER(false));
}

const problemOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'opened';
  } catch (error) {
    return error instanceof CertificateFileError ? error.problem : String(error);
  }
};

describe('certificate files', () => {
  it('open when protected with AES, with an RSA key and its issuer, signer first', async () => {
    const file = await writePfx(ids.signer.key, [ids.signer.chain[1], ids.signer.chain[0]], 'a password', 'Alex Example');
    const { key, chain } = await readPfx(file, 'a password');
    expect(key.asymmetricKeyType).toBe('rsa');
    expect(chain.map((c) => certificateDer(c).length)).toEqual(ids.signer.chain.map((c) => certificateDer(c).length));
    expect((await summarise(chain[0])).name).toBe('Alex Example');
  });

  it('open with an EC key', async () => {
    const { key, chain } = await readPfx(await writePfx(ids.ec.key, ids.ec.chain, 'a password', 'Sam Example'), 'a password');
    expect(key.asymmetricKeyType).toBe('ec');
    expect((await summarise(chain[0])).email).toBe('sam@example.com');
  });

  it("open when protected the older way (3DES), as Windows' older default made them", async () => {
    const { key, chain } = await readPfx(legacyPfx(ids.signer.key, ids.signer.chain, 'old password'), 'old password');
    expect(key.asymmetricKeyType).toBe('rsa');
    expect(chain).toHaveLength(2);
  });

  it('say when the password is wrong, for every kind', async () => {
    expect(await problemOf(readPfx(await writePfx(ids.signer.key, ids.signer.chain, 'right', 'x'), 'wrong'))).toBe('wrong-password');
    expect(await problemOf(readPfx(legacyPfx(ids.signer.key, ids.signer.chain, 'right'), 'wrong'))).toBe('wrong-password');
  });

  it("say the oldest kind (RC2) can't be read, so it can be saved again", async () => {
    expect(await problemOf(readPfx(legacyPfx(ids.signer.key, ids.signer.chain, 'pw', 'rc2'), 'pw'))).toBe('old-format');
  });

  it("say when a file isn't a certificate file, or has no key", async () => {
    expect(await problemOf(readPfx(new Uint8Array([1, 2, 3, 4]), 'pw'))).toBe('unreadable');
    const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(await problemOf(readPfx(await writePfx(otherKey, ids.signer.chain, 'pw', 'x'), 'pw'))).toBe('no-key');
  });
});

describe('making a certificate', () => {
  it('is in your name, issued by itself, for signing, valid for five years, and opens with its password', async () => {
    const now = new Date('2026-10-22T12:00:00Z');
    const { key, cert } = makeOwnCertificate({ name: 'Pat Tester', email: 'pat@example.com' }, now);
    const summary = await summarise(cert);
    expect(summary).toMatchObject({ name: 'Pat Tester', email: 'pat@example.com', issuer: 'Pat Tester', selfSigned: true, forSigning: true });
    expect(new Date(summary.validTo).getUTCFullYear()).toBe(2031);
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(3072);
    expect(await cert.verify()).toBe(true);
    const back = await readPfx(await writePfx(key, [cert], 'made here', 'Pat Tester'), 'made here');
    expect(certificateDer(back.chain[0])).toEqual(certificateDer(cert));
  });
});
