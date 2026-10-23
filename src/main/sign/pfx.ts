// Certificate files (.pfx, .p12; PKCS #12, RFC 7292): reading one with its password, and saving
// one (for "Make a certificate"). Only in the main process, which never reads PDFs; the key never
// leaves it (docs/Plan_Sign.md, section 6).
//
// pkijs reads files protected with AES (today's default). Older files protected with 3DES
// (Windows' older default) are unlocked here with Node's own crypto and the PKCS #12 key step
// (RFC 7292, appendix B.2). The oldest kind (RC2) can't be read in Electron, so it gets a plain
// message saying how to save the file again (S2).
import * as asn1js from 'asn1js';
import { createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, type KeyObject } from 'node:crypto';
import * as pkijs from 'pkijs';
import { buffer, certificateDer } from '../../engine/sign/certificate';

export type CertificateFileProblem = 'wrong-password' | 'old-format' | 'no-key' | 'unsupported' | 'unreadable';

export class CertificateFileError extends Error {
  readonly problem: CertificateFileProblem;
  constructor(problem: CertificateFileProblem) {
    super(problem);
    this.problem = problem;
  }
}

export interface UnlockedCertificate {
  key: KeyObject;
  /** The signer's certificate first, then the others in the file (its issuers). */
  chain: pkijs.Certificate[];
}

const BAG = { key: '1.2.840.113549.1.12.10.1.1', shroudedKey: '1.2.840.113549.1.12.10.1.2', cert: '1.2.840.113549.1.12.10.1.3' };
const CONTENT = { data: '1.2.840.113549.1.7.1', encrypted: '1.2.840.113549.1.7.6' };
const PBES2 = '1.2.840.113549.1.5.13';
const LEGACY: Record<string, { cipher: string; key: number; iv: number } | 'rc2'> = {
  '1.2.840.113549.1.12.1.3': { cipher: 'des-ede3-cbc', key: 24, iv: 8 }, // pbeWithSHAAnd3-KeyTripleDES-CBC
  '1.2.840.113549.1.12.1.4': { cipher: 'des-ede-cbc', key: 16, iv: 8 }, // pbeWithSHAAnd2-KeyTripleDES-CBC
  '1.2.840.113549.1.12.1.5': 'rc2', // pbeWithSHAAnd128BitRC2-CBC
  '1.2.840.113549.1.12.1.6': 'rc2', // pbeWithSHAAnd40BitRC2-CBC
};
const ATTR = { localKeyId: '1.2.840.113549.1.9.21', friendlyName: '1.2.840.113549.1.9.20' };

/** RFC 7292, appendix B.2: the PKCS #12 key step, with SHA-1 (u = 20, v = 64). */
export function pkcs12Key(password: string, salt: Uint8Array, id: 1 | 2 | 3, iterations: number, size: number): Buffer {
  const u = 20;
  const v = 64;
  // The password as big-endian UTF-16 with two zero bytes at the end.
  const pw = Buffer.alloc(password.length ? (password.length + 1) * 2 : 0);
  for (let i = 0; i < password.length; i++) pw.writeUInt16BE(password.charCodeAt(i), i * 2);
  const repeat = (src: Uint8Array) => {
    const len = v * Math.ceil(src.length / v);
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = src[i % src.length];
    return out;
  };
  const D = Buffer.alloc(v, id);
  const I = Buffer.concat([salt.length ? repeat(salt) : Buffer.alloc(0), pw.length ? repeat(pw) : Buffer.alloc(0)]);
  const out: Buffer[] = [];
  for (let have = 0; have < size; have += u) {
    let A = createHash('sha1').update(D).update(I).digest();
    for (let i = 1; i < iterations; i++) A = createHash('sha1').update(A).digest();
    out.push(A);
    const B = repeat(A).subarray(0, v);
    for (let j = 0; j < I.length; j += v) {
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const sum = I[j + k] + B[k] + carry;
        I[j + k] = sum & 0xff;
        carry = sum >> 8;
      }
    }
  }
  return Buffer.concat(out).subarray(0, size);
}

/** Decrypts with one of PKCS #12's own older methods (3DES); RC2 can't be read here. */
function legacyDecrypt(algorithm: pkijs.AlgorithmIdentifier, data: Uint8Array, password: string): Uint8Array {
  const method = LEGACY[algorithm.algorithmId];
  if (method === 'rc2') throw new CertificateFileError('old-format');
  if (!method) throw new CertificateFileError('unsupported');
  const params = algorithm.algorithmParams as asn1js.Sequence;
  const [saltBlock, countBlock] = params.valueBlock.value as [asn1js.OctetString, asn1js.Integer];
  const salt = saltBlock.valueBlock.valueHexView;
  const iterations = countBlock.valueBlock.valueDec;
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 10_000_000) throw new CertificateFileError('unreadable');
  const decipher = createDecipheriv(method.cipher, pkcs12Key(password, salt, 1, iterations, method.key), pkcs12Key(password, salt, 2, iterations, method.iv));
  try {
    return new Uint8Array(Buffer.concat([decipher.update(data), decipher.final()]));
  } catch {
    throw new CertificateFileError('wrong-password');
  }
}

/** Opens a certificate file with its password. */
export async function readPfx(bytes: Uint8Array, password: string): Promise<UnlockedCertificate> {
  const pw = buffer(new TextEncoder().encode(password));
  let pfx: pkijs.PFX;
  try {
    pfx = pkijs.PFX.fromBER(buffer(bytes));
  } catch {
    throw new CertificateFileError('unreadable');
  }
  try {
    await pfx.parseInternalValues({ password: pw, checkIntegrity: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CertificateFileError(/integrity|mac/i.test(message) ? 'wrong-password' : 'unsupported');
  }
  const safes = pfx.parsedValue?.authenticatedSafe;
  if (!safes) throw new CertificateFileError('unsupported');

  const keys: Uint8Array[] = [];
  const certs: pkijs.Certificate[] = [];
  for (const info of safes.safeContents) {
    let contents: Uint8Array;
    if (info.contentType === CONTENT.data) {
      contents = new Uint8Array((info.content as asn1js.OctetString).getValue());
    } else if (info.contentType === CONTENT.encrypted) {
      const encrypted = new pkijs.EncryptedData({ schema: info.content });
      const algorithm = encrypted.encryptedContentInfo.contentEncryptionAlgorithm;
      if (algorithm.algorithmId === PBES2) {
        try {
          contents = new Uint8Array(await encrypted.decrypt({ password: pw }));
        } catch {
          throw new CertificateFileError('wrong-password');
        }
      } else contents = legacyDecrypt(algorithm, new Uint8Array(encrypted.encryptedContentInfo.getEncryptedContent()), password);
    } else throw new CertificateFileError('unsupported');

    let bags: pkijs.SafeContents;
    try {
      bags = pkijs.SafeContents.fromBER(buffer(contents));
    } catch {
      throw new CertificateFileError('wrong-password');
    }
    for (const bag of bags.safeBags) {
      if (bag.bagId === BAG.cert) {
        const certBag = bag.bagValue as pkijs.CertBag;
        if (certBag.parsedValue instanceof pkijs.Certificate) certs.push(certBag.parsedValue);
      } else if (bag.bagId === BAG.key) {
        keys.push(new Uint8Array((bag.bagValue as pkijs.PrivateKeyInfo).toSchema().toBER(false)));
      } else if (bag.bagId === BAG.shroudedKey) {
        const shrouded = bag.bagValue as pkijs.PKCS8ShroudedKeyBag;
        const algorithm = shrouded.encryptionAlgorithm;
        if (algorithm.algorithmId === PBES2) {
          try {
            // Marked protected in pkijs's types, but it's how pkijs itself opens a key bag.
            await (shrouded as unknown as { parseInternalValues(p: { password: ArrayBuffer }): Promise<void> }).parseInternalValues({ password: pw });
          } catch {
            throw new CertificateFileError('wrong-password');
          }
          if (shrouded.parsedValue) keys.push(new Uint8Array(shrouded.parsedValue.toSchema().toBER(false)));
        } else keys.push(legacyDecrypt(algorithm, shrouded.encryptedData.valueBlock.valueHexView, password));
      }
    }
  }
  if (keys.length === 0 || certs.length === 0) throw new CertificateFileError('no-key');

  // The signer's certificate is the one whose public key matches the private key.
  for (const der of keys) {
    let key: KeyObject;
    try {
      key = createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
    } catch {
      throw new CertificateFileError('wrong-password');
    }
    const publicDer = createPublicKey(key).export({ type: 'spki', format: 'der' });
    const leaf = certs.find((c) => Buffer.from(c.subjectPublicKeyInfo.toSchema().toBER(false)).equals(publicDer));
    if (leaf) return { key, chain: [leaf, ...orderIssuers(leaf, certs.filter((c) => c !== leaf))] };
  }
  throw new CertificateFileError('no-key');
}

/** The other certificates, issuer first, then its issuer, and so on; anything else after. */
function orderIssuers(leaf: pkijs.Certificate, others: pkijs.Certificate[]): pkijs.Certificate[] {
  const ordered: pkijs.Certificate[] = [];
  let current = leaf;
  const left = [...others];
  for (;;) {
    const i = left.findIndex((c) => c.subject.isEqual(current.issuer) && !c.subject.isEqual(current.subject));
    if (i < 0) break;
    current = left.splice(i, 1)[0];
    ordered.push(current);
  }
  return [...ordered, ...left];
}

/**
 * A certificate file protected by `password`: AES-256 and PBKDF2 with SHA-256 for the key and the
 * certificates, and a SHA-256 check that the file is whole. Readable by Windows and OpenSSL 3.
 */
export async function writePfx(key: KeyObject, chain: pkijs.Certificate[], password: string, friendlyName: string): Promise<Uint8Array> {
  const pw = buffer(new TextEncoder().encode(password));
  const keyId = new Uint8Array(createHash('sha1').update(certificateDer(chain[0])).digest());
  const attributes = [
    new pkijs.Attribute({ type: ATTR.localKeyId, values: [new asn1js.OctetString({ valueHex: buffer(keyId) })] }),
    new pkijs.Attribute({ type: ATTR.friendlyName, values: [new asn1js.BmpString({ value: friendlyName })] }),
  ];
  const keyInfo = pkijs.PrivateKeyInfo.fromBER(buffer(new Uint8Array(key.export({ type: 'pkcs8', format: 'der' }))));
  const keyBag = new pkijs.PKCS8ShroudedKeyBag({ parsedValue: keyInfo });
  // Each encryption gets its own random starting block.
  const encryption = () => ({
    contentEncryptionAlgorithm: { name: 'AES-CBC', length: 256, iv: randomBytes(16) } as pkijs.ContentEncryptionAlgorithm,
    hmacHashAlgorithm: 'SHA-256',
    iterationCount: 100_000,
  });
  await keyBag.makeInternalValues({ password: pw, ...encryption() });
  const pfx = new pkijs.PFX({
    parsedValue: {
      integrityMode: 0,
      authenticatedSafe: new pkijs.AuthenticatedSafe({
        parsedValue: {
          safeContents: [
            { privacyMode: 0, value: new pkijs.SafeContents({ safeBags: [new pkijs.SafeBag({ bagId: BAG.shroudedKey, bagValue: keyBag, bagAttributes: attributes })] }) },
            {
              privacyMode: 1,
              value: new pkijs.SafeContents({
                safeBags: chain.map(
                  (cert, i) => new pkijs.SafeBag({ bagId: BAG.cert, bagValue: new pkijs.CertBag({ parsedValue: cert }), bagAttributes: i === 0 ? attributes : undefined }),
                ),
              }),
            },
          ],
        },
      }),
    },
  });
  await pfx.parsedValue?.authenticatedSafe?.makeInternalValues({ safeContents: [{}, { password: pw, ...encryption() }] });
  await pfx.makeInternalValues({ password: pw, iterations: 100_000, pbkdf2HashAlgorithm: 'SHA-256', hmacHashAlgorithm: 'SHA-256' });
  return new Uint8Array(pfx.toSchema().toBER(false));
}

/** A random serial number for a new certificate: 16 bytes, positive. */
export function serialNumber(): asn1js.Integer {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  bytes[0] |= 0x01;
  return new asn1js.Integer({ valueHex: buffer(new Uint8Array(bytes)) });
}
