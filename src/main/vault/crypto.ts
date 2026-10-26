// The vault's encryption (docs/Plan_Phase3.md, section 4). Only in the main process.
//
// - A random vault key encrypts everything. The password, and the recovery code if there is one,
//   each unlock a copy of that key (scrypt, then AES-256-GCM). Argon2 isn't available in Electron
//   (A5), so scrypt it is.
// - Each kind of data gets its own key, worked out from the vault key (HKDF-SHA256), and each
//   sealed piece names what it is (the AES-GCM "additional data"), so pieces can't be swapped.
// - AES-256-GCM both hides the data and detects any change to it: a damaged or altered piece is
//   refused, never used.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** scrypt's cost: 2^17, about half a second (A5). Tests use a lower cost to run quickly. */
export const DEFAULT_COST = 17;

/** At the start of every sealed piece: what it is, and the format. */
const MAGIC = Buffer.from('SFV1');
const NONCE = 12;
const TAG = 16;

export class VaultCryptoError extends Error {}

export interface KdfSettings {
  name: 'scrypt';
  /** log2 of scrypt's N. */
  cost: number;
  r: number;
  p: number;
  /** base64 */
  salt: string;
}

export function newKdf(cost = DEFAULT_COST): KdfSettings {
  return { name: 'scrypt', cost, r: 8, p: 1, salt: randomBytes(16).toString('base64') };
}

/** The key a password (or recovery code) unlocks the vault key with. */
export function derive(secret: string, kdf: KdfSettings): Buffer {
  if (kdf.name !== 'scrypt' || !Number.isInteger(kdf.cost) || kdf.cost < 10 || kdf.cost > 20) throw new VaultCryptoError('Unknown key settings.');
  const N = 2 ** kdf.cost;
  return scryptSync(secret.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, { N, r: kdf.r, p: kdf.p, maxmem: 160 * N * kdf.r });
}

/** Seals `data` with `key`, naming it `label` so it can only be opened as what it is. */
export function seal(key: Buffer, label: string, data: Uint8Array): Buffer {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(label));
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, body, cipher.getAuthTag()]);
}

/** Opens a sealed piece; throws if it's damaged, altered, sealed as something else, or the key is wrong. */
export function unseal(key: Buffer, label: string, sealed: Uint8Array): Buffer {
  const bytes = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  if (bytes.length < MAGIC.length + NONCE + TAG || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new VaultCryptoError('Not a sealed vault file.');
  const nonce = bytes.subarray(MAGIC.length, MAGIC.length + NONCE);
  const tag = bytes.subarray(bytes.length - TAG);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(bytes.subarray(MAGIC.length + NONCE, bytes.length - TAG)), decipher.final()]);
  } catch {
    throw new VaultCryptoError("It doesn't open: it's damaged or altered, or the key is wrong.");
  }
}

/** The key for one kind of data, worked out from the vault key. */
export function subkey(vaultKey: Buffer, vaultId: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', vaultKey, Buffer.from(vaultId, 'base64'), purpose, 32));
}

/** One buffer for every piece read when checking files (this runs without pausing, so it's never shared). */
const scratch = Buffer.alloc(1024 * 1024);

/**
 * Checks a sealed file on disk without holding it in memory: it's decrypted a piece at a time and
 * the result thrown away, so only its seal is checked (stop 4a, restoring a backup).
 */
export function sealedFileSound(key: Buffer, label: string, file: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    if (size < MAGIC.length + NONCE + TAG) return false;
    const head = Buffer.alloc(MAGIC.length + NONCE);
    readSync(fd, head, 0, head.length, 0);
    const tag = Buffer.alloc(TAG);
    readSync(fd, tag, 0, TAG, size - TAG);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) return false;
    const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length));
    decipher.setAAD(Buffer.from(label));
    decipher.setAuthTag(tag);
    const piece = scratch;
    for (let at = head.length; at < size - TAG; ) {
      const n = readSync(fd, piece, 0, Math.min(piece.length, size - TAG - at), at);
      if (n === 0) return false;
      decipher.update(piece.subarray(0, n)).fill(0);
      at += n;
    }
    decipher.final();
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function hmac(key: Buffer, data: string | Uint8Array): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Letters and digits that can't be mistaken for each other (Crockford's base 32: no I, L, O or U). */
const CODE_LETTERS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A recovery code: 25 letters and digits in five groups (125 random bits), such as "7KQ2M-…". */
export function newRecoveryCode(): string {
  const chars = Array.from({ length: 25 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]);
  return [0, 5, 10, 15, 20].map((i) => chars.slice(i, i + 5).join('')).join('-');
}

/** A recovery code as typed: spaces and dashes don't matter, nor does case; O, I and L read as 0, 1 and 1. */
export function normaliseRecoveryCode(typed: string): string {
  const clean = typed.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return clean.length === 25 ? [0, 5, 10, 15, 20].map((i) => clean.slice(i, i + 5)).join('-') : clean;
}
