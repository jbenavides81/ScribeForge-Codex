// The sealed files the vault's backups are made of (stop 4a): a backup file (.sfbackup) and each
// backup in a backup folder (.sfsnap). Both are: a short label, the length of a list of contents,
// that list, each part in turn, and a seal (HMAC-SHA256 with the vault's backup key) over all of it.
// They're written and read a piece at a time, so a large vault never has to fit in memory
// (docs/Plan_Phase4.md, B3). Backups made by 1.6 to 1.8 have exactly this layout.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, renameSync, rmSync, writeSync } from 'node:fs';

const PIECE = 1024 * 1024;
/** One buffer for every piece read: all of this runs without pausing, one thing at a time, so it's never shared. */
const scratch = Buffer.alloc(PIECE);
const SEAL = 32;
/** The list of contents is small; anything bigger isn't a backup. */
const MAX_LIST = 64 * 1024 * 1024;

/** A part to write: from a file on disk, or from memory. */
export type PartSource = { name: string; file: string } | { name: string; bytes: Uint8Array };

export class ContainerError extends Error {
  readonly kind: 'not-backup' | 'damaged';
  constructor(kind: 'not-backup' | 'damaged') {
    super(kind);
    this.kind = kind;
  }
}

/**
 * Writes a sealed file at `target`: to a temporary file first, put in place only when complete.
 * `list` gets `files` added, naming each part and its size, in order.
 */
export function writeContainer(target: string, magic: Buffer, list: Record<string, unknown>, parts: PartSource[], sealKey: Buffer, sizes: (file: string) => number): void {
  const temp = `${target}.tmp`;
  const fd = openSync(temp, 'w');
  try {
    const mac = createHmac('sha256', sealKey);
    const put = (bytes: Uint8Array) => {
      mac.update(bytes);
      for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at, bytes.length - at);
    };
    const contents = Buffer.from(JSON.stringify({ ...list, files: parts.map((p) => ({ name: p.name, size: 'bytes' in p ? p.bytes.length : sizes(p.file) })) }));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(contents.length);
    put(magic);
    put(length);
    put(contents);
    const piece = scratch;
    for (const part of parts) {
      if ('bytes' in part) {
        put(part.bytes);
        continue;
      }
      const expected = sizes(part.file);
      const from = openSync(part.file, 'r');
      try {
        let done = 0;
        for (let n; (n = readSync(from, piece, 0, PIECE, done)) > 0; done += n) put(piece.subarray(0, n));
        if (done !== expected) throw new Error(`${part.name} changed while it was being backed up.`);
      } finally {
        closeSync(from);
      }
    }
    const seal = mac.digest();
    writeSync(fd, seal);
    closeSync(fd);
    renameSync(temp, target);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // Already closed.
    }
    rmSync(temp, { force: true });
    throw error;
  }
}

/** A small sealed file built in memory (a backup in a backup folder: the database, index and key file). */
export function buildContainer(magic: Buffer, list: Record<string, unknown>, parts: { name: string; bytes: Uint8Array }[], sealKey: Buffer): Buffer {
  const contents = Buffer.from(JSON.stringify({ ...list, files: parts.map((p) => ({ name: p.name, size: p.bytes.length })) }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(contents.length);
  const body = Buffer.concat([magic, length, contents, ...parts.map((p) => p.bytes)]);
  return Buffer.concat([body, createHmac('sha256', sealKey).update(body).digest()]);
}

/** Reads a sealed file a piece at a time. Close it when done. */
export class ContainerReader {
  readonly list: Record<string, unknown> & { files: { name: string; size: number }[] };
  private readonly at = new Map<string, { offset: number; size: number }>();
  private readonly fd: number;
  private readonly size: number;

  constructor(file: string, magic: Buffer, allowed: (name: string) => boolean) {
    this.fd = openSync(file, 'r');
    try {
      this.size = fstatSync(this.fd).size;
      const head = this.bytes(0, Math.min(this.size, magic.length + 4));
      if (head.length < magic.length + 4 || !head.subarray(0, magic.length).equals(magic) || this.size < magic.length + 4 + SEAL) throw new ContainerError('not-backup');
      const listLength = head.readUInt32BE(magic.length);
      const listStart = magic.length + 4;
      if (listLength > MAX_LIST || listStart + listLength > this.size - SEAL) throw new ContainerError('damaged');
      let list: unknown;
      try {
        list = JSON.parse(this.bytes(listStart, listLength).toString('utf8'));
      } catch {
        throw new ContainerError('damaged');
      }
      const files = (list as { files?: unknown })?.files;
      if (!Array.isArray(files)) throw new ContainerError('damaged');
      let offset = listStart + listLength;
      for (const f of files as { name?: unknown; size?: unknown }[]) {
        if (typeof f?.name !== 'string' || !allowed(f.name) || this.at.has(f.name) || !Number.isSafeInteger(f.size) || (f.size as number) < 0) throw new ContainerError('damaged');
        if (offset + (f.size as number) > this.size - SEAL) throw new ContainerError('damaged');
        this.at.set(f.name, { offset, size: f.size as number });
        offset += f.size as number;
      }
      if (offset !== this.size - SEAL) throw new ContainerError('damaged');
      this.list = list as ContainerReader['list'];
    } catch (error) {
      closeSync(this.fd);
      throw error;
    }
  }

  private bytes(offset: number, length: number): Buffer {
    const out = Buffer.alloc(length);
    for (let done = 0; done < length; ) {
      const n = readSync(this.fd, out, done, length - done, offset + done);
      if (n === 0) throw new ContainerError('damaged');
      done += n;
    }
    return out;
  }

  has(name: string): boolean {
    return this.at.has(name);
  }

  names(): string[] {
    return [...this.at.keys()];
  }

  /** A part, read into memory: only for the small ones (the key file, the database, the index). */
  read(name: string): Buffer {
    const part = this.at.get(name);
    if (!part) throw new ContainerError('damaged');
    return this.bytes(part.offset, part.size);
  }

  /** Checks the seal over everything before it, reading a piece at a time. */
  sealed(sealKey: Buffer): boolean {
    const mac = createHmac('sha256', sealKey);
    const piece = scratch;
    const end = this.size - SEAL;
    for (let done = 0; done < end; ) {
      const n = readSync(this.fd, piece, 0, Math.min(PIECE, end - done), done);
      if (n === 0) return false;
      mac.update(piece.subarray(0, n));
      done += n;
    }
    return timingSafeEqual(mac.digest(), this.bytes(end, SEAL));
  }

  /**
   * Copies parts out to files and checks the seal, in one pass through the file: every byte is
   * read once, so what's written is exactly what was sealed. `target` names where each part goes,
   * or null to leave it. False (and the files written may be thrown away) when the seal is wrong.
   */
  extract(sealKey: Buffer, target: (name: string) => string | null): boolean {
    const mac = createHmac('sha256', sealKey);
    const piece = scratch;
    const end = this.size - SEAL;
    const parts = [...this.at.entries()].sort((a, b) => a[1].offset - b[1].offset);
    let next = 0;
    let out: number | null = null;
    try {
      for (let done = 0; done < end; ) {
        // Where the next part starts or ends, so each read stays within one part (or the header).
        while (next < parts.length && parts[next][1].offset + parts[next][1].size <= done) {
          if (out !== null) closeSync(out);
          out = null;
          next++;
        }
        const current = parts[next];
        const inPart = current && done >= current[1].offset;
        if (inPart && out === null && done === current[1].offset) {
          const file = target(current[0]);
          out = file === null ? null : openSync(file, 'w');
        }
        const limit = !current ? end : inPart ? current[1].offset + current[1].size : current[1].offset;
        const n = readSync(this.fd, piece, 0, Math.min(PIECE, limit - done), done);
        if (n === 0) return false;
        mac.update(piece.subarray(0, n));
        if (inPart && out !== null) for (let w = 0; w < n; ) w += writeSync(out, piece, w, n - w);
        done += n;
      }
    } finally {
      if (out !== null) closeSync(out);
    }
    return timingSafeEqual(mac.digest(), this.bytes(end, SEAL));
  }

  close(): void {
    closeSync(this.fd);
  }
}
