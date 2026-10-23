// The vault (codenames Niko's Archive and Beloved Codex; docs/Plan_Phase3.md, section 4). Plain
// Node, so the unit tests use it directly; src/main/archive.ts connects it to the app.
//
// On disk, in one folder:
//   vault.json       how the vault key is protected (scrypt settings and the locked copies of the key)
//   archive.sealed   the database: documents, versions, labels, notes and the history (encrypted)
//   files\*.sealed   one encrypted file per stored PDF, with a random name
// While unlocked, the database lives in memory (Electron's own SQLite, A1) and is saved, encrypted,
// after every change. Locking clears the key and the database from memory. This never reads PDFs:
// page counts, titles and pictures of first pages come from the sandboxed window.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeSafely } from '../fileWrite';
import {
  DEFAULT_COST,
  derive,
  hmac,
  newKdf,
  newRecoveryCode,
  normaliseRecoveryCode,
  sameBytes,
  seal,
  subkey,
  unseal,
  VaultCryptoError,
  type KdfSettings,
} from './crypto';
import type { HistoryAction, HistoryCheck, HistoryEntry, NewDocument, VaultDocument } from '../../shared/vault';

export type { HistoryAction, HistoryCheck, HistoryEntry, NewDocument, VaultDocument };

export { MIN_VAULT_PASSWORD as MIN_PASSWORD } from '../../shared/vault';
import { MIN_VAULT_PASSWORD as MIN_PASSWORD } from '../../shared/vault';
const LIMITS = { title: 300, label: 50, labels: 20, note: 5000, reason: 500, fileName: 255 };

/** What the vault is asked to do when it can't: locked, damaged, or a mistake in the request. */
export class VaultError extends Error {
  readonly kind: 'locked' | 'damaged' | 'missing' | 'invalid' | 'exists';
  constructor(kind: VaultError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

interface KeyCopy {
  kdf: KdfSettings;
  /** The vault key, sealed with the key this secret makes (base64). */
  key: string;
}

interface VaultFile {
  format: 'ScribeForge vault';
  version: 1;
  /** Random; makes each vault's keys its own. */
  id: string;
  created: string;
  password: KeyCopy;
  recovery: KeyCopy | null;
}

/** The database's tables, one step per version; never changed once released, only added to. */
const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE documents (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, file_name TEXT NOT NULL, added TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '', voided_at TEXT, void_reason TEXT);
   CREATE TABLE versions (
     id TEXT PRIMARY KEY, document TEXT NOT NULL REFERENCES documents(id), added TEXT NOT NULL,
     file TEXT NOT NULL, size INTEGER NOT NULL, pages INTEGER NOT NULL, sha256 TEXT NOT NULL,
     thumbnail BLOB, note TEXT NOT NULL DEFAULT '');
   CREATE INDEX versions_document ON versions(document);
   CREATE TABLE labels (document TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY (document, label));
   CREATE TABLE history (
     seq INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, document TEXT, title TEXT,
     details TEXT NOT NULL, seal TEXT NOT NULL);
   CREATE TRIGGER history_no_update BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT, 'The history can''t be changed.'); END;
   CREATE TRIGGER history_no_delete BEFORE DELETE ON history BEGIN SELECT RAISE(ABORT, 'The history can''t be changed.'); END;`,
];

const FILE_NAME = /^[0-9a-f-]{36}\.sealed$/;
const BACKUP_MAGIC = Buffer.from('SFBACKUP1\n');

function clean(text: unknown, max: number): string {
  return typeof text === 'string' ? text.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** A note keeps its line breaks; other control characters go. */
function cleanNote(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ').trim().slice(0, LIMITS.note) : '';
}

export class Vault {
  readonly dir: string;
  private readonly cost: number;
  private readonly now: () => Date;
  private key: Buffer | null = null;
  private db: DatabaseSync | null = null;
  private info: VaultFile | null = null;

  constructor(dir: string, options: { cost?: number; now?: () => Date } = {}) {
    this.dir = dir;
    this.cost = options.cost ?? DEFAULT_COST;
    this.now = options.now ?? (() => new Date());
  }

  private get infoFile() {
    return path.join(this.dir, 'vault.json');
  }

  private get archiveFile() {
    return path.join(this.dir, 'archive.sealed');
  }

  private filePath(file: string) {
    return path.join(this.dir, 'files', `${file}.sealed`);
  }

  exists(): boolean {
    return existsSync(this.infoFile);
  }

  get unlocked(): boolean {
    return this.key !== null && this.db !== null;
  }

  /** Whether a recovery code can open it (readable while locked: it's in vault.json). */
  hasRecoveryCode(): boolean {
    return !!this.readInfo().recovery;
  }

  private readInfo(): VaultFile {
    if (this.info) return this.info;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.infoFile, 'utf8'));
    } catch {
      throw new VaultError(this.exists() ? 'damaged' : 'missing', this.exists() ? "The vault's key file can't be read." : 'There is no vault yet.');
    }
    const info = raw as VaultFile;
    if (info?.format !== 'ScribeForge vault' || info.version !== 1 || typeof info.id !== 'string' || !info.password?.kdf) {
      throw new VaultError('damaged', "The vault's key file can't be read.");
    }
    this.info = info;
    return info;
  }

  private writeInfo(info: VaultFile): void {
    writeSafely(this.infoFile, new TextEncoder().encode(JSON.stringify(info, null, 2)));
    this.info = info;
  }

  private keyCopy(vaultKey: Buffer, secret: string, label: 'password' | 'recovery', id: string): KeyCopy {
    const kdf = newKdf(this.cost);
    return { kdf, key: seal(derive(secret, kdf), `vault-key:${label}:${id}`, vaultKey).toString('base64') };
  }

  private openCopy(copy: KeyCopy, secret: string, label: 'password' | 'recovery', id: string): Buffer | null {
    try {
      return unseal(derive(secret, copy.kdf), `vault-key:${label}:${id}`, Buffer.from(copy.key, 'base64'));
    } catch (error) {
      if (error instanceof VaultCryptoError) return null;
      throw error;
    }
  }

  private requireUnlocked(): { key: Buffer; db: DatabaseSync; info: VaultFile } {
    if (!this.key || !this.db || !this.info) throw new VaultError('locked', 'The vault is locked.');
    return { key: this.key, db: this.db, info: this.info };
  }

  /** Makes a new, empty vault and leaves it unlocked. Returns the recovery code, if one was asked for. */
  create(password: string, withRecoveryCode: boolean): string | undefined {
    if (this.exists()) throw new VaultError('exists', 'There is already a vault.');
    if (password.length < MIN_PASSWORD) throw new VaultError('invalid', `The password needs at least ${MIN_PASSWORD} characters.`);
    mkdirSync(path.join(this.dir, 'files'), { recursive: true });
    const key = randomBytes(32);
    const id = randomBytes(16).toString('base64');
    const code = withRecoveryCode ? newRecoveryCode() : undefined;
    const info: VaultFile = {
      format: 'ScribeForge vault',
      version: 1,
      id,
      created: this.now().toISOString(),
      password: this.keyCopy(key, password, 'password', id),
      recovery: code ? this.keyCopy(key, code, 'recovery', id) : null,
    };
    this.key = key;
    this.info = info;
    this.db = new DatabaseSync(':memory:');
    this.migrate(this.db);
    this.record('vault-made', null, null, code ? { recovery: 'yes' } : {});
    this.save();
    this.writeInfo(info);
    return code;
  }

  /**
   * Unlocks with the password, or the recovery code. False when it's wrong; throws when the vault
   * is damaged (it's never used then).
   */
  unlock(secret: string, kind: 'password' | 'recovery' = 'password'): boolean {
    this.lock();
    const info = this.readInfo();
    const copy = kind === 'password' ? info.password : info.recovery;
    if (!copy) return false;
    const key = this.openCopy(copy, kind === 'recovery' ? normaliseRecoveryCode(secret) : secret, kind, info.id);
    if (!key) return false;
    let db: DatabaseSync;
    try {
      const plain = unseal(subkey(key, info.id, 'archive'), 'archive', readFileSync(this.archiveFile));
      db = new DatabaseSync(':memory:');
      db.deserialize(plain);
      plain.fill(0);
      this.migrate(db);
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError('damaged', "The vault's database is damaged or has been altered, so it wasn't opened.");
    }
    this.key = key;
    this.db = db;
    if (kind === 'recovery') {
      this.record('recovery-used', null, null, {});
      this.save();
    }
    return true;
  }

  /** Clears the key and the database from memory. */
  lock(): void {
    this.key?.fill(0);
    this.key = null;
    this.db?.close();
    this.db = null;
  }

  private migrate(db: DatabaseSync): void {
    db.exec('PRAGMA secure_delete = ON; PRAGMA foreign_keys = ON;');
    const hasMeta = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() as { n: number };
    let version = hasMeta.n ? Number((db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined)?.value ?? 0) : 0;
    if (version > MIGRATIONS.length) throw new VaultError('damaged', 'This vault was made by a newer ScribeForge. Update ScribeForge to open it.');
    for (; version < MIGRATIONS.length; version++) {
      db.exec(MIGRATIONS[version]);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(String(version + 1));
    }
  }

  /** Saves the database, encrypted. */
  private save(): void {
    const { key, db, info } = this.requireUnlocked();
    const image = db.serialize();
    try {
      writeSafely(this.archiveFile, seal(subkey(key, info.id, 'archive'), 'archive', image));
    } finally {
      image.fill(0);
    }
  }

  /** Adds an entry to the history, sealed to the one before it. */
  private record(action: HistoryAction, document: string | null, title: string | null, details: Record<string, string>): void {
    const { key, db, info } = this.requireUnlocked();
    const last = db.prepare('SELECT seq, seal FROM history ORDER BY seq DESC LIMIT 1').get() as { seq: number; seal: string } | undefined;
    const seq = (last?.seq ?? 0) + 1;
    const at = this.now().toISOString();
    const body = JSON.stringify([seq, at, action, document, title, details]);
    const sealed = hmac(subkey(key, info.id, 'history'), `${last?.seal ?? ''}\n${body}`).toString('base64');
    db.prepare('INSERT INTO history (seq, at, action, document, title, details, seal) VALUES (?, ?, ?, ?, ?, ?, ?)').run(seq, at, action, document, title, JSON.stringify(details), sealed);
  }

  /** The history, oldest first, and whether every entry checks out. */
  history(): HistoryCheck {
    const { key, db, info } = this.requireUnlocked();
    const historyKey = subkey(key, info.id, 'history');
    const rows = db.prepare('SELECT seq, at, action, document, title, details, seal FROM history ORDER BY seq').all() as {
      seq: number;
      at: string;
      action: HistoryAction;
      document: string | null;
      title: string | null;
      details: string;
      seal: string;
    }[];
    let previous = '';
    let brokenAt: number | undefined;
    const entries: HistoryEntry[] = [];
    rows.forEach((row, i) => {
      let details: Record<string, string> = {};
      try {
        details = JSON.parse(row.details);
      } catch {
        brokenAt ??= row.seq;
      }
      const body = JSON.stringify([row.seq, row.at, row.action, row.document, row.title, details]);
      const expected = hmac(historyKey, `${previous}\n${body}`);
      if (row.seq !== i + 1 || !sameBytes(expected, Buffer.from(row.seal, 'base64'))) brokenAt ??= row.seq;
      previous = row.seal;
      entries.push({ seq: row.seq, at: row.at, action: row.action, document: row.document, title: row.title, details });
    });
    return { entries, intact: brokenAt === undefined, brokenAt };
  }

  /** Every document (voided ones too), newest first. */
  documents(): VaultDocument[] {
    const { db } = this.requireUnlocked();
    const rows = db
      .prepare(
        `SELECT d.id, d.title, d.file_name, d.added, d.note, d.voided_at, d.void_reason, v.pages, v.size
         FROM documents d JOIN versions v ON v.id = (SELECT id FROM versions WHERE document = d.id ORDER BY added DESC, rowid DESC LIMIT 1)
         ORDER BY d.added DESC, d.rowid DESC`,
      )
      .all() as { id: string; title: string; file_name: string; added: string; note: string; voided_at: string | null; void_reason: string | null; pages: number; size: number }[];
    const labels = db.prepare('SELECT document, label FROM labels ORDER BY label').all() as { document: string; label: string }[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      fileName: r.file_name,
      added: r.added,
      pages: r.pages,
      size: r.size,
      labels: labels.filter((l) => l.document === r.id).map((l) => l.label),
      note: r.note,
      voided: r.voided_at ? { at: r.voided_at, reason: r.void_reason ?? '' } : null,
    }));
  }

  document(id: string): VaultDocument {
    const found = this.documents().find((d) => d.id === id);
    if (!found) throw new VaultError('invalid', "That document isn't in the vault.");
    return found;
  }

  /** How much the vault holds: documents, and bytes on disk. */
  size(): { documents: number; bytes: number } {
    const { db } = this.requireUnlocked();
    const documents = (db.prepare('SELECT count(*) AS n FROM documents').get() as { n: number }).n;
    let bytes = 0;
    const files = path.join(this.dir, 'files');
    for (const f of [this.infoFile, this.archiveFile, ...(existsSync(files) ? readdirSync(files).map((n) => path.join(files, n)) : [])]) {
      try {
        bytes += statSync(f).size;
      } catch {
        // gone in the meantime
      }
    }
    return { documents, bytes };
  }

  /** Stores a PDF, encrypted, as a new document. */
  add(doc: NewDocument): VaultDocument {
    const { key, db, info } = this.requireUnlocked();
    if (!(doc.bytes instanceof Uint8Array) || doc.bytes.length === 0) throw new VaultError('invalid', 'There is nothing to add.');
    const fileName = clean(doc.fileName, LIMITS.fileName) || 'document.pdf';
    const title = clean(doc.title, LIMITS.title) || fileName.replace(/\.pdf$/i, '');
    const id = randomUUID();
    const file = randomUUID();
    const added = this.now().toISOString();
    mkdirSync(path.join(this.dir, 'files'), { recursive: true });
    writeSafely(this.filePath(file), seal(subkey(key, info.id, 'files'), `file:${file}`, doc.bytes));
    const sha = createHash('sha256').update(doc.bytes).digest('hex');
    const pages = Number.isInteger(doc.pages) && doc.pages > 0 ? doc.pages : 0;
    const thumbnail = doc.thumbnail instanceof Uint8Array && doc.thumbnail.length < 512 * 1024 ? doc.thumbnail : null;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO documents (id, title, file_name, added) VALUES (?, ?, ?, ?)').run(id, title, fileName, added);
      db.prepare('INSERT INTO versions (id, document, added, file, size, pages, sha256, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        id,
        added,
        file,
        doc.bytes.length,
        pages,
        sha,
        thumbnail,
      );
      this.record('added', id, title, {});
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      rmSync(this.filePath(file), { force: true });
      throw error;
    }
    this.save();
    return this.document(id);
  }

  private latestVersion(id: string): { file: string; sha256: string; thumbnail: Uint8Array | null } {
    const { db } = this.requireUnlocked();
    const row = db.prepare('SELECT file, sha256, thumbnail FROM versions WHERE document = ? ORDER BY added DESC, rowid DESC LIMIT 1').get(id) as
      | { file: string; sha256: string; thumbnail: Uint8Array | null }
      | undefined;
    if (!row) throw new VaultError('invalid', "That document isn't in the vault.");
    return row;
  }

  /** A stored document's PDF, decrypted into memory, and checked against the checksum it was stored with. */
  read(id: string): Uint8Array {
    const { key, info } = this.requireUnlocked();
    const version = this.latestVersion(id);
    let bytes: Buffer;
    try {
      bytes = unseal(subkey(key, info.id, 'files'), `file:${version.file}`, readFileSync(this.filePath(version.file)));
    } catch {
      throw new VaultError('damaged', "This document's file in the vault is missing or damaged, so it wasn't opened.");
    }
    if (createHash('sha256').update(bytes).digest('hex') !== version.sha256) {
      throw new VaultError('damaged', "This document's file in the vault doesn't match what was stored, so it wasn't opened.");
    }
    return new Uint8Array(bytes);
  }

  thumbnail(id: string): Uint8Array | null {
    const t = this.latestVersion(id).thumbnail;
    return t ? new Uint8Array(t) : null;
  }

  /** Changes a document's title, labels or note; each change is recorded. */
  update(id: string, change: { title?: string; labels?: string[]; note?: string }): VaultDocument {
    const { db } = this.requireUnlocked();
    const before = this.document(id);
    db.exec('BEGIN');
    try {
      if (change.title !== undefined) {
        const title = clean(change.title, LIMITS.title);
        if (!title) throw new VaultError('invalid', 'A document needs a title.');
        if (title !== before.title) {
          db.prepare('UPDATE documents SET title = ? WHERE id = ?').run(title, id);
          this.record('renamed', id, title, { from: before.title });
        }
      }
      if (change.labels !== undefined) {
        const labels = [...new Set(change.labels.map((l) => clean(l, LIMITS.label)).filter(Boolean))].slice(0, LIMITS.labels).sort((a, b) => a.localeCompare(b));
        if (labels.join('\n') !== before.labels.join('\n')) {
          db.prepare('DELETE FROM labels WHERE document = ?').run(id);
          for (const label of labels) db.prepare('INSERT INTO labels (document, label) VALUES (?, ?)').run(id, label);
          this.record('labels', id, clean(change.title ?? before.title, LIMITS.title), {});
        }
      }
      if (change.note !== undefined) {
        const note = cleanNote(change.note);
        if (note !== before.note) {
          db.prepare('UPDATE documents SET note = ? WHERE id = ?').run(note, id);
          this.record('note', id, clean(change.title ?? before.title, LIMITS.title), {});
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    this.save();
    return this.document(id);
  }

  /** Voids a document: hidden from the list, kept in the vault, with the reason in the history. */
  voidDocument(id: string, reason: string): VaultDocument {
    const { db } = this.requireUnlocked();
    const why = clean(reason, LIMITS.reason);
    if (!why) throw new VaultError('invalid', 'Say why the document is being voided.');
    const doc = this.document(id);
    if (doc.voided) return doc;
    db.prepare('UPDATE documents SET voided_at = ?, void_reason = ? WHERE id = ?').run(this.now().toISOString(), why, id);
    this.record('voided', id, doc.title, { reason: why });
    this.save();
    return this.document(id);
  }

  restoreDocument(id: string): VaultDocument {
    const { db } = this.requireUnlocked();
    const doc = this.document(id);
    if (!doc.voided) return doc;
    db.prepare('UPDATE documents SET voided_at = NULL, void_reason = NULL WHERE id = ?').run(id);
    this.record('restored', id, doc.title, {});
    this.save();
    return this.document(id);
  }

  /**
   * Erases a document for good (Phase 3 plan, question 6): its files and everything about it go,
   * except its title and the reason, in the history. Copies already in backups stay there.
   */
  eraseDocument(id: string, reason: string): void {
    const { db } = this.requireUnlocked();
    const why = clean(reason, LIMITS.reason);
    if (!why) throw new VaultError('invalid', 'Say why the document is being erased.');
    const doc = this.document(id);
    const files = (db.prepare('SELECT file FROM versions WHERE document = ?').all(id) as { file: string }[]).map((r) => r.file);
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM labels WHERE document = ?').run(id);
      db.prepare('DELETE FROM versions WHERE document = ?').run(id);
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      this.record('erased', id, doc.title, { reason: why });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    this.save();
    for (const file of files) rmSync(this.filePath(file), { force: true });
  }

  /** Records that a copy was saved out of the vault (the app saves it where the person chose). */
  copySaved(id: string): void {
    const doc = this.document(id);
    this.record('copy-saved', id, doc.title, {});
    this.save();
  }

  changePassword(current: string, next: string): void {
    const { key, info } = this.requireUnlocked();
    if (!this.openCopy(info.password, current, 'password', info.id)) throw new VaultError('invalid', "The current password isn't right.");
    if (next.length < MIN_PASSWORD) throw new VaultError('invalid', `The new password needs at least ${MIN_PASSWORD} characters.`);
    this.record('password-changed', null, null, {});
    this.save();
    this.writeInfo({ ...info, password: this.keyCopy(key, next, 'password', info.id) });
  }

  /** Makes a new recovery code (the old one stops working). The password is asked for first. */
  makeRecoveryCode(password: string): string {
    const { key, info } = this.requireUnlocked();
    if (!this.openCopy(info.password, password, 'password', info.id)) throw new VaultError('invalid', "The password isn't right.");
    const code = newRecoveryCode();
    this.record('recovery-made', null, null, { replaced: info.recovery ? 'yes' : 'no' });
    this.save();
    this.writeInfo({ ...info, recovery: this.keyCopy(key, code, 'recovery', info.id) });
    return code;
  }

  /**
   * One file holding the whole vault, still encrypted: the key file, the database and every stored
   * file, with a seal over all of it so any change is found when it's restored.
   */
  backup(): Uint8Array {
    const { key, info } = this.requireUnlocked();
    this.record('backup-made', null, null, {});
    this.save();
    const names = ['vault.json', 'archive.sealed', ...readdirSync(path.join(this.dir, 'files')).filter((n) => FILE_NAME.test(n)).map((n) => `files/${n}`)];
    const parts = names.map((name) => ({ name, bytes: readFileSync(path.join(this.dir, name)) }));
    const manifest = Buffer.from(JSON.stringify({ created: this.now().toISOString(), vault: info.id, files: parts.map((p) => ({ name: p.name, size: p.bytes.length })) }));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(manifest.length);
    const body = Buffer.concat([BACKUP_MAGIC, length, manifest, ...parts.map((p) => p.bytes)]);
    return new Uint8Array(Buffer.concat([body, hmac(subkey(key, info.id, 'backup'), body)]));
  }

  /**
   * Checks a backup with its password (or recovery code), and replaces this vault with it. Every
   * part is checked before anything is written. Returns when the backup was made, and how many
   * documents it holds; the vault is then unlocked.
   */
  restoreBackup(backup: Uint8Array, secret: string, kind: 'password' | 'recovery' = 'password', check = false): { created: string; documents: number } {
    const bytes = Buffer.from(backup.buffer, backup.byteOffset, backup.byteLength);
    const damaged = () => new VaultError('damaged', "This backup is damaged or has been altered, so it wasn't used.");
    if (!bytes.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC) || bytes.length < BACKUP_MAGIC.length + 4 + 32) throw new VaultError('invalid', "This isn't a ScribeForge vault backup.");
    const manifestLength = bytes.readUInt32BE(BACKUP_MAGIC.length);
    const manifestStart = BACKUP_MAGIC.length + 4;
    let manifest: { created: string; vault: string; files: { name: string; size: number }[] };
    try {
      manifest = JSON.parse(bytes.subarray(manifestStart, manifestStart + manifestLength).toString('utf8'));
    } catch {
      throw damaged();
    }
    const parts = new Map<string, Buffer>();
    let at = manifestStart + manifestLength;
    for (const f of manifest.files ?? []) {
      const ok = f.name === 'vault.json' || f.name === 'archive.sealed' || (f.name.startsWith('files/') && FILE_NAME.test(f.name.slice(6)));
      if (!ok || !Number.isSafeInteger(f.size) || f.size < 0 || at + f.size > bytes.length - 32) throw damaged();
      parts.set(f.name, bytes.subarray(at, at + f.size));
      at += f.size;
    }
    if (at !== bytes.length - 32 || !parts.has('vault.json') || !parts.has('archive.sealed')) throw damaged();

    // Unlock the backup's own key copy, then check the seal over everything, then every part.
    let info: VaultFile;
    try {
      info = JSON.parse((parts.get('vault.json') as Buffer).toString('utf8'));
    } catch {
      throw damaged();
    }
    if (info?.format !== 'ScribeForge vault' || info.id !== manifest.vault) throw damaged();
    const copy = kind === 'password' ? info.password : info.recovery;
    const key = copy ? this.openCopy(copy, kind === 'recovery' ? normaliseRecoveryCode(secret) : secret, kind, info.id) : null;
    if (!key) throw new VaultError('invalid', kind === 'password' ? "That password doesn't open this backup." : "That recovery code doesn't open this backup.");
    if (!sameBytes(hmac(subkey(key, info.id, 'backup'), bytes.subarray(0, bytes.length - 32)), bytes.subarray(bytes.length - 32))) throw damaged();
    let documents: number;
    try {
      const db = new DatabaseSync(':memory:');
      db.deserialize(unseal(subkey(key, info.id, 'archive'), 'archive', parts.get('archive.sealed') as Buffer));
      documents = (db.prepare('SELECT count(*) AS n FROM documents').get() as { n: number }).n;
      const needed = (db.prepare('SELECT file FROM versions').all() as { file: string }[]).map((r) => `files/${r.file}.sealed`);
      db.close();
      if (needed.some((n) => !parts.has(n))) throw damaged();
      for (const [name, part] of parts) if (name.startsWith('files/')) unseal(subkey(key, info.id, 'files'), `file:${name.slice(6, -7)}`, part);
    } catch {
      throw damaged();
    }
    if (check) return { created: manifest.created, documents };

    // Written beside the vault first, then swapped in.
    this.lock();
    this.info = null;
    const incoming = `${this.dir}.restoring`;
    const old = `${this.dir}.replaced`;
    rmSync(incoming, { recursive: true, force: true });
    mkdirSync(path.join(incoming, 'files'), { recursive: true });
    for (const [name, part] of parts) writeSafely(path.join(incoming, ...name.split('/')), part);
    rmSync(old, { recursive: true, force: true });
    if (existsSync(this.dir)) renameSync(this.dir, old);
    renameSync(incoming, this.dir);
    rmSync(old, { recursive: true, force: true });
    if (!this.unlock(secret, kind)) throw damaged();
    this.record('backup-restored', null, null, { made: manifest.created });
    this.save();
    return { created: manifest.created, documents };
  }
}
