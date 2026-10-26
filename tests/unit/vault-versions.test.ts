// Stop 3c's required checks for the vault side of versions (docs/Plan_Phase3.md, section 5): each
// version opens exactly as stored (checksum), the newest is the one shown, opened and searched,
// erasing removes every version, backups keep them all, and vaults made before 3c still open.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { seal, subkey, unseal } from '../../src/main/vault/crypto';
import { Vault } from '../../src/main/vault/vault';

const COST = 10;
const PASSWORD = 'correct horse battery';
let dir: string;
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.7\n1 0 obj (${text}) endobj\n%%EOF\n`);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'scribeforge-versions-test-'));
});

function withTwoVersions(now?: () => Date) {
  const vault = new Vault(path.join(dir, 'Vault'), { cost: COST, now });
  vault.create(PASSWORD, false);
  const doc = vault.add({ fileName: 'contract-draft.pdf', title: 'Contract', pages: 2, bytes: pdf('FIRST'), pageTexts: ['The fee is 100 pounds.', 'Signed by both.'] });
  const second = vault.addVersion(doc.id, { fileName: 'contract-final.pdf', pages: 3, bytes: pdf('SECOND'), pageTexts: ['The fee is 120 pounds.', 'Signed by both.', 'Summary'], note: 'After the meeting' });
  return { vault, doc, second };
}

describe('versions', () => {
  it('are listed oldest first, numbered, with their own pages, file name and note', () => {
    const { vault, doc, second } = withTwoVersions();
    const list = vault.versions(doc.id);
    expect(list.map((v) => [v.number, v.pages, v.fileName, v.note])).toEqual([
      [1, 2, 'contract-draft.pdf', ''],
      [2, 3, 'contract-final.pdf', 'After the meeting'],
    ]);
    expect(second).toEqual(list[1]);
    expect(vault.document(doc.id)).toMatchObject({ versions: 2, pages: 3, title: 'Contract', fileName: 'contract-final.pdf' });
  });

  it('each opens exactly as stored; the newest is the one opened', () => {
    const { vault, doc } = withTwoVersions();
    const [first, second] = vault.versions(doc.id);
    expect(Buffer.from(vault.readVersion(first.id)).toString()).toContain('FIRST');
    expect(Buffer.from(vault.readVersion(second.id)).toString()).toContain('SECOND');
    expect(Buffer.from(vault.read(doc.id)).toString()).toContain('SECOND');
    expect(() => vault.readVersion('no-such-version')).toThrow(/isn't in the vault/);
  });

  it('a version whose stored file was changed is refused; the other still opens', () => {
    const vault = new Vault(path.join(dir, 'Vault'), { cost: COST });
    vault.create(PASSWORD, false);
    const files = path.join(dir, 'Vault', 'files');
    const doc = vault.add({ fileName: 'a.pdf', title: 'A', pages: 1, bytes: pdf('FIRST') });
    const before = new Set(readdirSync(files));
    const second = vault.addVersion(doc.id, { fileName: 'b.pdf', pages: 1, bytes: pdf('SECOND') });
    const newFile = path.join(files, readdirSync(files).find((f) => !before.has(f)) as string);
    const bytes = readFileSync(newFile);
    bytes[bytes.length - 5] ^= 1;
    writeFileSync(newFile, bytes);
    expect(() => vault.readVersion(second.id)).toThrow(/damaged|altered/);
    expect(Buffer.from(vault.readVersion(vault.versions(doc.id)[0].id)).toString()).toContain('FIRST');
  });

  it('search finds the newest version\'s words, not the old ones', () => {
    const { vault } = withTwoVersions();
    expect(vault.search('120')).toHaveLength(1);
    expect(vault.search('100')).toEqual([]);
    expect(vault.search('summary')[0].hits.map((h) => h.page)).toEqual([3]);
  });

  it("a version added without its text is left for catch-up indexing, so old words aren't found", () => {
    const { vault, doc } = withTwoVersions();
    vault.addVersion(doc.id, { fileName: 'scan.pdf', pages: 1, bytes: pdf('THIRD') });
    expect(vault.search('120')).toEqual([]);
    expect(vault.unindexed()).toEqual([doc.id]);
  });

  it('notes can be changed; the history records that a version was added or its note changed, never the note', () => {
    const { vault, doc } = withTwoVersions();
    const [, second] = vault.versions(doc.id);
    expect(vault.versionNote(second.id, '  Signed copy  ').note).toBe('Signed copy');
    expect(vault.versions(doc.id)[1].note).toBe('Signed copy');
    const entries = vault.history().entries.filter((e) => e.action.startsWith('version'));
    expect(entries.map((e) => [e.action, e.title, e.details])).toEqual([
      ['version-added', 'Contract', { version: '2' }],
      ['version-note', 'Contract', { version: '2' }],
    ]);
    expect(JSON.stringify(vault.history())).not.toContain('Signed copy');
    expect(JSON.stringify(vault.history())).not.toContain('After the meeting');
    expect(vault.history().intact).toBe(true);
  });

  it('erasing a document removes every version', () => {
    const { vault, doc } = withTwoVersions();
    expect(readdirSync(path.join(dir, 'Vault', 'files'))).toHaveLength(2);
    vault.eraseDocument(doc.id, 'Not needed');
    expect(readdirSync(path.join(dir, 'Vault', 'files'))).toEqual([]);
  });

  it('a backup keeps every version, and they restore exactly', () => {
    const { vault, doc } = withTwoVersions();
    const file = path.join(dir, 'versions.sfbackup');
    vault.backup(file);
    vault.addVersion(doc.id, { fileName: 'later.pdf', pages: 1, bytes: pdf('LATER'), pageTexts: ['later'] });
    expect(vault.versions(doc.id)).toHaveLength(3);
    vault.restoreBackup({ file }, PASSWORD);
    const list = vault.versions(doc.id);
    expect(list).toHaveLength(2);
    expect(Buffer.from(vault.readVersion(list[0].id)).toString()).toContain('FIRST');
    expect(Buffer.from(vault.readVersion(list[1].id)).toString()).toContain('SECOND');
  });

  it("can't be added to a document that isn't there, or with nothing in it", () => {
    const { vault, doc } = withTwoVersions();
    expect(() => vault.addVersion('missing', { fileName: 'x.pdf', pages: 1, bytes: pdf('X') })).toThrow();
    expect(() => vault.addVersion(doc.id, { fileName: 'x.pdf', pages: 1, bytes: new Uint8Array() })).toThrow(/nothing to add/);
    expect(vault.versions(doc.id)).toHaveLength(2);
  });
});

describe('a vault made before versions had file names (stop 3b)', () => {
  it('opens, and its documents keep their file name', () => {
    const folder = path.join(dir, 'Old');
    const vault = new Vault(folder, { cost: COST });
    vault.create(PASSWORD, false);
    const doc = vault.add({ fileName: 'old.pdf', title: 'Old one', pages: 1, bytes: pdf('OLD'), pageTexts: ['old'] });
    // Turn the saved database back into a schema 1 one, as 3a and 3b made.
    const key = Buffer.from((vault as unknown as { key: Buffer }).key);
    const id = JSON.parse(readFileSync(path.join(folder, 'vault.json'), 'utf8')).id as string;
    vault.lock();
    const file = path.join(folder, 'archive.sealed');
    const db = new DatabaseSync(':memory:');
    db.deserialize(unseal(subkey(key, id, 'archive'), 'archive', readFileSync(file)));
    db.exec("ALTER TABLE versions DROP COLUMN file_name; UPDATE meta SET value = '1' WHERE key = 'schema';");
    writeFileSync(file, seal(subkey(key, id, 'archive'), 'archive', db.serialize()));

    vault.unlock(PASSWORD);
    expect(vault.versions(doc.id)).toMatchObject([{ number: 1, fileName: 'old.pdf' }]);
    vault.addVersion(doc.id, { fileName: 'new.pdf', pages: 1, bytes: pdf('NEW'), pageTexts: ['new'] });
    expect(vault.versions(doc.id).map((v) => v.fileName)).toEqual(['old.pdf', 'new.pdf']);
  });
});
