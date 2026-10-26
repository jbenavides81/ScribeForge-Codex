// The vault (codenames Niko's Archive and Beloved Codex; docs/Plan_Phase3.md, section 4). Plain
// Node, so the unit tests use it directly; src/main/archive.ts connects it to the app.
//
// On disk, in one folder:
//   vault.json       how the vault key is protected (scrypt settings and the locked copies of the key)
//   archive.sealed   the database: documents, versions, labels, notes and the history (encrypted)
//   search.sealed    the search index: each page's text (encrypted); rebuilt from the documents if lost
//   files\*.sealed   one encrypted file per stored PDF, with a random name
// While unlocked, the database lives in memory (Electron's own SQLite, A1) and is saved, encrypted,
// after every change. Locking clears the key and the database from memory. This never reads PDFs:
// page counts, titles and pictures of first pages come from the sandboxed window.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeSafely } from '../fileWrite';
import { missingFiles, snapshotName, snapshotPath, SNAPSHOT_MAGIC, storedPath } from './backupFolder';
import { buildContainer, ContainerError, ContainerReader, writeContainer } from './container';
import {
  DEFAULT_COST,
  derive,
  hmac,
  newKdf,
  newRecoveryCode,
  normaliseRecoveryCode,
  sameBytes,
  seal,
  sealedFileSound,
  subkey,
  unseal,
  VaultCryptoError,
  type KdfSettings,
} from './crypto';
import type { HistoryAction, HistoryCheck, HistoryEntry, NewDocument, NewVersion, SearchOptions, SearchResult, TextlessDocument, VaultDocument, VaultVersion } from '../../shared/vault';

export type { HistoryAction, HistoryCheck, HistoryEntry, NewDocument, NewVersion, SearchOptions, SearchResult, TextlessDocument, VaultDocument, VaultVersion };

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
  // 2 (stop 3c): each version keeps the name of the file it came from.
  `ALTER TABLE versions ADD COLUMN file_name TEXT NOT NULL DEFAULT '';`,
];

/** The search index's tables: each page's text (full-text search, FTS5), and which documents are in it. */
const INDEX_SCHEMA = `CREATE TABLE IF NOT EXISTS indexed (document TEXT PRIMARY KEY, pages INTEGER NOT NULL, textless TEXT NOT NULL);
  CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(document UNINDEXED, page UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2');`;
/** Marks around the matching words in a result's snippet (control characters never left in indexed text). */
export const MATCH_START = '\u0002';
export const MATCH_END = '\u0003';
const MAX_PAGE_TEXT = 200_000;
const MAX_RESULTS = 200;
const HITS_SHOWN = 5;

/** One part of a search: a word, an "exact phrase", or the start of a word (insur*). */
interface SearchPart {
  /** Folded as the index folds them: small letters, no accents. */
  words: string[];
  prefix: boolean;
}

/** A word as the index compares it: small letters, accents removed (like its unicode61 tokenizer). */
const fold = (word: string) => word.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();

/** What was typed, as words, "exact phrases" and word starts (insur*). Punctuation only separates words. */
function searchParts(typed: string): SearchPart[] {
  const parts: SearchPart[] = [];
  for (const m of typed.matchAll(/"([^"]*)"?|(\S+)/g)) {
    const raw = m[1] ?? m[2] ?? '';
    const words = raw.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length > 0) parts.push({ words: words.map(fold), prefix: m[2] !== undefined && raw.endsWith('*') });
  }
  return parts;
}

/**
 * What was typed in the search box, as a full-text query that can't go wrong: every word must be
 * on the page. Null when there's nothing to search for.
 */
export function searchQuery(typed: string): string | null {
  const parts = searchParts(typed);
  return parts.length > 0 ? parts.map((p) => `"${p.words.join(' ')}"${p.prefix ? '*' : ''}`).join(' ') : null;
}

/**
 * The words around the first match on a page (about a dozen), with each match between
 * MATCH_START and MATCH_END. Matched the same way the index matches: whole words, phrases in
 * order, word starts, ignoring case and accents.
 */
export function makeSnippet(text: string, typed: string, size = 12): string {
  const parts = searchParts(typed);
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, word: fold(m[0]) }));
  if (tokens.length === 0) return '';
  const marks: [number, number][] = [];
  for (const part of parts) {
    const n = part.words.length;
    for (let i = 0; i + n <= tokens.length; i++) {
      const fits = part.words.every((want, k) => tokens[i + k].word === want || (k === n - 1 && part.prefix && tokens[i + k].word.startsWith(want)));
      if (fits) marks.push([i, i + n - 1]);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const from = Math.max(0, (marks[0]?.[0] ?? 0) - Math.floor(size / 3));
  const to = Math.min(tokens.length - 1, from + size - 1);
  let pos = from === 0 ? 0 : tokens[from].start;
  let out = '';
  for (const [a, b] of marks) {
    if (b < from || a > to) continue;
    const start = tokens[Math.max(a, from)].start;
    const end = tokens[Math.min(b, to)].end;
    if (start < pos) continue;
    out += text.slice(pos, start) + MATCH_START + text.slice(start, end) + MATCH_END;
    pos = end;
  }
  out += text.slice(pos, to === tokens.length - 1 ? text.length : tokens[to].end);
  return `${from > 0 ? '…' : ''}${out}${to < tokens.length - 1 ? '…' : ''}`;
}

/** A page's text as indexed: no control characters (they mark matches), and not endlessly long. */
function indexText(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_TEXT) : '';
}

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
  /** The search index, in memory while unlocked. */
  private index: DatabaseSync | null = null;
  /** The index file couldn't be read when unlocking, so it's being rebuilt. */
  private indexDamaged = false;
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

  private get searchFile() {
    return path.join(this.dir, 'search.sealed');
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
    this.index = this.emptyIndex();
    this.record('vault-made', null, null, code ? { recovery: 'yes' } : {});
    this.save();
    this.saveIndex();
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
    this.loadIndex();
    if (kind === 'recovery') {
      this.record('recovery-used', null, null, {});
      this.save();
    }
    return true;
  }

  /** Clears the key, the database and the search index from memory. */
  lock(): void {
    this.key?.fill(0);
    this.key = null;
    this.db?.close();
    this.db = null;
    this.index?.close();
    this.index = null;
    this.indexDamaged = false;
  }

  private emptyIndex(): DatabaseSync {
    const index = new DatabaseSync(':memory:');
    index.exec(`PRAGMA secure_delete = ON; ${INDEX_SCHEMA}`);
    return index;
  }

  /** Loads the search index; if it's missing or damaged, starts an empty one (the documents can be indexed again). */
  private loadIndex(): void {
    const { key, info } = this.requireUnlocked();
    this.index = this.emptyIndex();
    this.indexDamaged = false;
    if (!existsSync(this.searchFile)) return;
    try {
      const plain = unseal(subkey(key, info.id, 'search'), 'search', readFileSync(this.searchFile));
      const index = new DatabaseSync(':memory:');
      index.deserialize(plain);
      plain.fill(0);
      index.exec(`PRAGMA secure_delete = ON; ${INDEX_SCHEMA}`);
      this.index.close();
      this.index = index;
    } catch {
      this.indexDamaged = true;
    }
  }

  private requireIndex(): DatabaseSync {
    this.requireUnlocked();
    if (!this.index) throw new VaultError('locked', 'The vault is locked.');
    return this.index;
  }

  private saveIndex(): void {
    const { key, info } = this.requireUnlocked();
    const image = this.requireIndex().serialize();
    try {
      writeSafely(this.searchFile, seal(subkey(key, info.id, 'search'), 'search', image));
    } finally {
      image.fill(0);
    }
  }

  /** Puts a document's pages in the search index, replacing what was there for it. */
  private indexPages(id: string, pageTexts: unknown[]): void {
    const index = this.requireIndex();
    const texts = pageTexts.map(indexText);
    const textless = texts.flatMap((t, i) => (t ? [] : [i + 1]));
    index.prepare('DELETE FROM pages WHERE document = ?').run(id);
    index.prepare('INSERT OR REPLACE INTO indexed (document, pages, textless) VALUES (?, ?, ?)').run(id, texts.length, JSON.stringify(textless));
    const insert = index.prepare('INSERT INTO pages (document, page, text) VALUES (?, ?, ?)');
    texts.forEach((text, i) => {
      if (text) insert.run(id, i + 1, text);
    });
  }

  /** Indexes documents whose page text the window has read (as when catching up, or rebuilding). */
  indexDocuments(entries: { id: string; pageTexts: string[] }[]): void {
    const index = this.requireIndex();
    const known = new Set(this.documents().map((d) => d.id));
    index.exec('BEGIN');
    try {
      for (const e of entries) if (known.has(e.id) && Array.isArray(e.pageTexts)) this.indexPages(e.id, e.pageTexts);
      index.exec('COMMIT');
    } catch (error) {
      index.exec('ROLLBACK');
      throw error;
    }
    this.saveIndex();
  }

  /** Documents not in the search index yet (added before search existed, or after the index was lost). */
  unindexed(): string[] {
    const index = this.requireIndex();
    const done = new Set((index.prepare('SELECT document FROM indexed').all() as { document: string }[]).map((r) => r.document));
    return this.documents()
      .map((d) => d.id)
      .filter((id) => !done.has(id));
  }

  /** Empties the search index, so every document is indexed again. */
  clearIndex(): void {
    this.requireIndex().exec('DELETE FROM pages; DELETE FROM indexed;');
    this.indexDamaged = false;
    this.saveIndex();
  }

  /** Whether the index file couldn't be read when the vault was unlocked. */
  get searchIndexDamaged(): boolean {
    return this.indexDamaged;
  }

  /**
   * Finds documents whose pages have the words, phrases or word starts typed, best first, with
   * the pages and the matching words. Voided documents only when asked for.
   */
  search(typed: string, options: SearchOptions = {}): SearchResult[] {
    const index = this.requireIndex();
    const query = searchQuery(typed);
    if (!query) return [];
    // First the matching pages, best first; then the words around each match, only for the pages shown.
    let rows: { id: number; document: string; page: number }[];
    try {
      rows = index.prepare('SELECT rowid AS id, document, page FROM pages WHERE pages MATCH ? ORDER BY bm25(pages) LIMIT 5000').all(query) as typeof rows;
    } catch {
      throw new VaultError('invalid', "That search couldn't be read. Try plain words.");
    }
    const docs = new Map(this.documents().map((d) => [d.id, d]));
    const since = options.since ? new Date(options.since).getTime() : undefined;
    const results = new Map<string, SearchResult>();
    const shown = new Map<number, SearchResult['hits'][number]>();
    for (const row of rows) {
      const document = docs.get(row.document);
      if (!document || (document.voided && !options.voided)) continue;
      if (options.label && !document.labels.includes(options.label)) continue;
      if (since !== undefined && new Date(document.added).getTime() < since) continue;
      let result = results.get(row.document);
      if (!result) {
        if (results.size >= MAX_RESULTS) continue;
        result = { document, hits: [], pagesFound: 0 };
        results.set(row.document, result);
      }
      result.pagesFound++;
      if (result.hits.length < HITS_SHOWN) {
        const hit = { page: Number(row.page), snippet: '' };
        result.hits.push(hit);
        shown.set(Number(row.id), hit);
      }
    }
    // The shown pages' text, looked up directly (quick), and the words around each match.
    const ids = [...shown.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const texts = index.prepare(`SELECT rowid AS id, text FROM pages WHERE rowid IN (${batch.map(() => '?').join(',')})`).all(...batch) as { id: number; text: string }[];
      for (const t of texts) {
        const hit = shown.get(Number(t.id));
        if (hit) hit.snippet = makeSnippet(t.text, typed);
      }
    }
    for (const r of results.values()) r.hits.sort((a, b) => a.page - b.page);
    return [...results.values()];
  }

  /** Documents with pages that have no text (scans, usually): search can't find words on them. */
  textless(): TextlessDocument[] {
    const index = this.requireIndex();
    const docs = new Map(this.documents().map((d) => [d.id, d]));
    return (index.prepare("SELECT document, textless FROM indexed WHERE textless != '[]'").all() as { document: string; textless: string }[]).flatMap((r) => {
      const doc = docs.get(r.document);
      return doc ? [{ id: doc.id, title: doc.title, pages: JSON.parse(r.textless) as number[], voided: !!doc.voided }] : [];
    });
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
        `SELECT d.id, d.title, CASE WHEN v.file_name <> '' THEN v.file_name ELSE d.file_name END AS file_name, d.added, d.note, d.voided_at, d.void_reason, v.pages, v.size,
                (SELECT count(*) FROM versions WHERE document = d.id) AS versions
         FROM documents d JOIN versions v ON v.id = (SELECT id FROM versions WHERE document = d.id ORDER BY added DESC, rowid DESC LIMIT 1)
         ORDER BY d.added DESC, d.rowid DESC`,
      )
      .all() as { id: string; title: string; file_name: string; added: string; note: string; voided_at: string | null; void_reason: string | null; pages: number; size: number; versions: number }[];
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
      versions: r.versions,
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
    for (const f of [this.infoFile, this.archiveFile, this.searchFile, ...(existsSync(files) ? readdirSync(files).map((n) => path.join(files, n)) : [])]) {
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
      db.prepare('INSERT INTO versions (id, document, added, file, size, pages, sha256, thumbnail, file_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        id,
        added,
        file,
        doc.bytes.length,
        pages,
        sha,
        thumbnail,
        fileName,
      );
      this.record('added', id, title, {});
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      rmSync(this.filePath(file), { force: true });
      throw error;
    }
    this.save();
    if (Array.isArray(doc.pageTexts)) {
      this.indexPages(id, doc.pageTexts);
      this.saveIndex();
    }
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

  /** A stored document's newest version, decrypted into memory, and checked against the checksum it was stored with. */
  read(id: string): Uint8Array {
    return this.readStored(this.latestVersion(id));
  }

  /** One version of a document, decrypted and checked (stop 3c). */
  readVersion(versionId: string): Uint8Array {
    const { db } = this.requireUnlocked();
    const row = db.prepare('SELECT file, sha256 FROM versions WHERE id = ?').get(versionId) as { file: string; sha256: string } | undefined;
    if (!row) throw new VaultError('invalid', "That version isn't in the vault.");
    return this.readStored(row);
  }

  private readStored(version: { file: string; sha256: string }): Uint8Array {
    const { key, info } = this.requireUnlocked();
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

  /** A document's versions, oldest first, numbered from 1. */
  versions(id: string): VaultVersion[] {
    const { db } = this.requireUnlocked();
    // Versions stored before 3c have no file name of their own: they're the document's first file.
    const doc = db.prepare('SELECT file_name FROM documents WHERE id = ?').get(id) as { file_name: string } | undefined;
    if (!doc) throw new VaultError('invalid', "That document isn't in the vault.");
    const rows = db.prepare('SELECT id, added, pages, size, file_name, note FROM versions WHERE document = ? ORDER BY added, rowid').all(id) as {
      id: string;
      added: string;
      pages: number;
      size: number;
      file_name: string;
      note: string;
    }[];
    return rows.map((r, i) => ({ id: r.id, number: i + 1, added: r.added, pages: r.pages, size: r.size, fileName: r.file_name || doc.file_name, note: r.note }));
  }

  /**
   * Stores a new version of a document (stop 3c). It becomes the one shown, opened and searched;
   * every earlier version stays, and can still be opened and compared.
   */
  addVersion(id: string, doc: NewVersion): VaultVersion {
    const { key, db, info } = this.requireUnlocked();
    const current = this.document(id);
    if (!(doc.bytes instanceof Uint8Array) || doc.bytes.length === 0) throw new VaultError('invalid', 'There is nothing to add.');
    const fileName = clean(doc.fileName, LIMITS.fileName) || current.fileName;
    const file = randomUUID();
    const version = randomUUID();
    writeSafely(this.filePath(file), seal(subkey(key, info.id, 'files'), `file:${file}`, doc.bytes));
    const pages = Number.isInteger(doc.pages) && doc.pages > 0 ? doc.pages : 0;
    const thumbnail = doc.thumbnail instanceof Uint8Array && doc.thumbnail.length < 512 * 1024 ? doc.thumbnail : null;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO versions (id, document, added, file, size, pages, sha256, thumbnail, file_name, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        version,
        id,
        this.now().toISOString(),
        file,
        doc.bytes.length,
        pages,
        createHash('sha256').update(doc.bytes).digest('hex'),
        thumbnail,
        fileName,
        cleanNote(doc.note),
      );
      this.record('version-added', id, current.title, { version: String(current.versions + 1) });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      rmSync(this.filePath(file), { force: true });
      throw error;
    }
    this.save();
    if (Array.isArray(doc.pageTexts)) {
      this.indexPages(id, doc.pageTexts);
    } else {
      // The old version's words would be wrong now: leave it for catch-up indexing to read.
      const index = this.requireIndex();
      index.prepare('DELETE FROM pages WHERE document = ?').run(id);
      index.prepare('DELETE FROM indexed WHERE document = ?').run(id);
    }
    this.saveIndex();
    return this.versions(id).find((v) => v.id === version) as VaultVersion;
  }

  /** Changes a version's note (recorded in the history, without the note itself). */
  versionNote(versionId: string, note: string): VaultVersion {
    const { db } = this.requireUnlocked();
    const row = db.prepare('SELECT document FROM versions WHERE id = ?').get(versionId) as { document: string } | undefined;
    if (!row) throw new VaultError('invalid', "That version isn't in the vault.");
    const version = this.versions(row.document).find((v) => v.id === versionId) as VaultVersion;
    const text = cleanNote(note);
    if (text !== version.note) {
      db.prepare('UPDATE versions SET note = ? WHERE id = ?').run(text, versionId);
      this.record('version-note', row.document, this.document(row.document).title, { version: String(version.number) });
      this.save();
    }
    return { ...version, note: text };
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
   * except its title and the reason, in the history. Copies already in backup files stay there;
   * returns the stored files removed, so a backup folder can lose them too (stop 4a).
   */
  eraseDocument(id: string, reason: string): string[] {
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
    const index = this.requireIndex();
    index.prepare('DELETE FROM pages WHERE document = ?').run(id);
    index.prepare('DELETE FROM indexed WHERE document = ?').run(id);
    this.saveIndex();
    for (const file of files) rmSync(this.filePath(file), { force: true });
    return files.map((f) => `${f}.sealed`);
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

  /** A short tag for this vault, the same on every PC, for naming its backups in a backup folder. Readable while locked. */
  tag(): string {
    return createHash('sha256').update(this.readInfo().id).digest('hex').slice(0, 12);
  }

  /** Where the vault's contents are now: it changes with every change recorded in the history (stop 4a). */
  state(): string {
    const { db } = this.requireUnlocked();
    const last = db.prepare('SELECT seq, seal FROM history ORDER BY seq DESC LIMIT 1').get() as { seq: number; seal: string } | undefined;
    return last ? `${last.seq}:${last.seal.slice(0, 16)}` : '';
  }

  /** The stored files the vault uses now, with their sizes. */
  private storedFiles(): { name: string; size: number; from: string }[] {
    const { db } = this.requireUnlocked();
    return (db.prepare('SELECT DISTINCT file FROM versions ORDER BY file').all() as { file: string }[]).map((r) => {
      const from = this.filePath(r.file);
      return { name: `${r.file}.sealed`, size: statSync(from).size, from };
    });
  }

  /**
   * One file holding the whole vault, still encrypted: the key file, the database and every stored
   * file, with a seal over all of it so any change is found when it's restored. It's written a piece
   * at a time, so a large vault doesn't need memory several times its size (stop 4a).
   */
  backup(target: string): void {
    const { key, info } = this.requireUnlocked();
    this.record('backup-made', null, null, {});
    this.save();
    if (this.index) this.saveIndex();
    const names = ['vault.json', 'archive.sealed', ...(existsSync(this.searchFile) ? ['search.sealed'] : []), ...this.storedFiles().map((f) => `files/${f.name}`)];
    writeContainer(
      target,
      BACKUP_MAGIC,
      { created: this.now().toISOString(), vault: info.id },
      names.map((name) => ({ name, file: path.join(this.dir, ...name.split('/')) })),
      subkey(key, info.id, 'backup'),
      (file) => statSync(file).size,
    );
  }

  /**
   * A backup for a backup folder (stop 4a): the key file, database and search index, sealed, with
   * the list of stored files it needs. The stored files themselves are copied into the folder by
   * the caller, once each; they're already encrypted.
   */
  snapshot(madeBy: string): { name: string; bytes: Buffer; stored: { name: string; size: number; from: string }[]; state: string; created: Date } {
    const { key, info } = this.requireUnlocked();
    if (this.index) this.saveIndex();
    const created = this.now();
    const stored = this.storedFiles();
    const parts = ['vault.json', 'archive.sealed', ...(existsSync(this.searchFile) ? ['search.sealed'] : [])].map((name) => ({ name, bytes: readFileSync(path.join(this.dir, name)) }));
    const bytes = buildContainer(
      SNAPSHOT_MAGIC,
      { created: created.toISOString(), vault: info.id, madeBy, stored: stored.map((f) => ({ name: f.name, size: f.size })) },
      parts,
      subkey(key, info.id, 'backup'),
    );
    return { name: snapshotName(created, this.tag(), madeBy), bytes, stored, state: this.state(), created };
  }

  /**
   * Checks a backup with its password (or recovery code), and with `check` false, replaces this
   * vault with it. The backup is a backup file, or one backup in a backup folder. Nothing is
   * replaced until every part has been checked. Returns when the backup was made and how many
   * documents it holds; after restoring, the vault is unlocked.
   */
  restoreBackup(
    source: { file: string } | { folder: string; snapshot: string },
    secret: string,
    kind: 'password' | 'recovery' = 'password',
    check = false,
  ): { created: string; documents: number; checkedAll: boolean } {
    const damaged = () => new VaultError('damaged', "This backup is damaged or has been altered, so it wasn't used.");
    const small = ['vault.json', 'archive.sealed', 'search.sealed'];
    let reader: ContainerReader;
    try {
      reader =
        'file' in source
          ? new ContainerReader(source.file, BACKUP_MAGIC, (n) => small.includes(n) || (n.startsWith('files/') && FILE_NAME.test(n.slice(6))))
          : new ContainerReader(snapshotPath(source.folder, source.snapshot), SNAPSHOT_MAGIC, (n) => small.includes(n));
    } catch (error) {
      if (error instanceof ContainerError && error.kind === 'not-backup') throw new VaultError('invalid', "This isn't a ScribeForge vault backup.");
      if (error instanceof ContainerError) throw damaged();
      throw new VaultError('invalid', "That backup couldn't be read.");
    }
    try {
      const list = reader.list as { created?: unknown; vault?: unknown; stored?: unknown };
      if (typeof list.created !== 'string' || typeof list.vault !== 'string' || !reader.has('vault.json') || !reader.has('archive.sealed')) throw damaged();
      const created = list.created;

      // Unlock the backup's own key copy, then check the seal over everything.
      let info: VaultFile;
      try {
        info = JSON.parse(reader.read('vault.json').toString('utf8'));
      } catch {
        throw damaged();
      }
      if (info?.format !== 'ScribeForge vault' || info.id !== list.vault) throw damaged();
      const copy = kind === 'password' ? info.password : info.recovery;
      const key = copy ? this.openCopy(copy, kind === 'recovery' ? normaliseRecoveryCode(secret) : secret, kind, info.id) : null;
      if (!key) throw new VaultError('invalid', kind === 'password' ? "That password doesn't open this backup." : "That recovery code doesn't open this backup.");
      if (!reader.sealed(subkey(key, info.id, 'backup'))) throw damaged();

      // What it holds, and whether every stored file it needs is there.
      const stored = new Map<string, number>();
      if ('file' in source) {
        for (const name of reader.names()) if (name.startsWith('files/')) stored.set(name.slice(6), (reader.list.files.find((f) => f.name === name) as { size: number }).size);
      } else {
        if (!Array.isArray(list.stored)) throw damaged();
        for (const f of list.stored as { name?: unknown; size?: unknown }[]) {
          if (typeof f?.name !== 'string' || !FILE_NAME.test(f.name) || !Number.isSafeInteger(f.size)) throw damaged();
          stored.set(f.name, f.size as number);
        }
      }
      let documents: number;
      let needed: string[];
      try {
        const db = new DatabaseSync(':memory:');
        db.deserialize(unseal(subkey(key, info.id, 'archive'), 'archive', reader.read('archive.sealed')));
        documents = (db.prepare('SELECT count(*) AS n FROM documents').get() as { n: number }).n;
        needed = (db.prepare('SELECT DISTINCT file FROM versions').all() as { file: string }[]).map((r) => `${r.file}.sealed`);
        db.close();
        if (reader.has('search.sealed')) unseal(subkey(key, info.id, 'search'), 'search', reader.read('search.sealed'));
      } catch {
        throw damaged();
      }
      if (needed.some((n) => !stored.has(n))) throw damaged();
      if ('folder' in source) {
        const missing = missingFiles(
          source.folder,
          needed.map((n) => ({ name: n, size: stored.get(n) as number })),
        );
        if (missing > 0) {
          throw new VaultError('invalid', `This backup isn't complete yet: ${missing === 1 ? "1 of its files isn't" : `${missing} of its files aren't`} in the folder. If it was made on another PC, it may still be arriving: try again in a few minutes.`);
        }
      }
      if (check) return { created, documents, checkedAll: 'file' in source };

      // Written beside the vault first, every stored file checked, then swapped in.
      const incoming = `${this.dir}.restoring`;
      const old = `${this.dir}.replaced`;
      rmSync(incoming, { recursive: true, force: true });
      mkdirSync(path.join(incoming, 'files'), { recursive: true });
      try {
        // A backup file: everything copied out in one pass, checked by its seal on the way.
        if ('file' in source) {
          const wanted = new Set(needed.map((n) => `files/${n}`));
          const ok = reader.extract(subkey(key, info.id, 'backup'), (name) =>
            small.includes(name) ? path.join(incoming, name) : wanted.has(name) ? path.join(incoming, ...name.split('/')) : null,
          );
          if (!ok) throw damaged();
        }
        // A backup folder: its own small parts (sealed already checked), then each stored file,
        // checked against its own seal, a piece at a time.
        else for (const name of small) if (reader.has(name)) writeFileSync(path.join(incoming, name), reader.read(name));
        const fileKey = subkey(key, info.id, 'files');
        const sound = (file: string, name: string) => sealedFileSound(fileKey, `file:${name.slice(0, -7)}`, file);
        for (const name of 'folder' in source ? needed : []) {
          const target = path.join(incoming, 'files', name);
          // A file this PC's vault already has is the same file (stored files never change): it's
          // used instead of downloading it again, if it checks out.
          const local = path.join(this.dir, 'files', name);
          if (existsSync(local) && statSync(local).size === stored.get(name)) {
            copyFileSync(local, target);
            if (sound(target, name)) continue;
          }
          copyFileSync(storedPath((source as { folder: string }).folder, name), target);
          if (!sound(target, name)) throw damaged();
        }
      } catch (error) {
        rmSync(incoming, { recursive: true, force: true });
        throw error instanceof VaultError ? error : damaged();
      }
      reader.close();
      this.lock();
      this.info = null;
      rmSync(old, { recursive: true, force: true });
      if (existsSync(this.dir)) renameSync(this.dir, old);
      renameSync(incoming, this.dir);
      rmSync(old, { recursive: true, force: true });
      if (!this.unlock(secret, kind)) throw damaged();
      this.record('backup-restored', null, null, { made: created });
      this.save();
      return { created, documents, checkedAll: true };
    } finally {
      try {
        reader.close();
      } catch {
        // Closed already.
      }
    }
  }
}
