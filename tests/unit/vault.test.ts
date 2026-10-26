// Stop 3a's required checks for the vault itself (docs/Plan_Phase3.md, section 5): nothing in the
// vault folder is readable; the password and recovery code work and wrong ones don't; once locked,
// nothing can be read; damage is refused, never used; the history detects changed, missing and
// reordered entries; voiding hides but keeps, erasing removes; a backup restores exactly.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { normaliseRecoveryCode, seal, subkey, unseal } from '../../src/main/vault/crypto';
import { Vault } from '../../src/main/vault/vault';
import { fixture } from './support/inspect';

/** A low scrypt cost, so the tests run quickly; real vaults use 2^17. */
const COST = 10;
const PASSWORD = 'correct horse battery';
const SECRETS = ['VAULT-SECRET-TEXT', 'Quarterly lease contract', 'lease-contract-2026.pdf', 'tenancy', 'NOTE-SECRET-WORDS'];

let dir: string;
const vaultDir = () => path.join(dir, 'Vault');
const make = (options: { now?: () => Date } = {}) => new Vault(vaultDir(), { cost: COST, ...options });

/** Every file in a folder and the folders inside it. */
const filesIn = (folder: string): string[] =>
  readdirSync(folder).flatMap((f) => (statSync(path.join(folder, f)).isDirectory() ? filesIn(path.join(folder, f)) : [path.join(folder, f)]));

/** A small PDF-like file carrying a secret phrase in plain bytes. */
const pdfWith = (text: string) => new TextEncoder().encode(`%PDF-1.7\n1 0 obj (${text}) endobj\n%%EOF\n`);

function addSample(vault: Vault) {
  const doc = vault.add({ fileName: 'lease-contract-2026.pdf', title: 'Quarterly lease contract', pages: 3, bytes: pdfWith('VAULT-SECRET-TEXT'), thumbnail: new Uint8Array([137, 80, 78, 71]) });
  return vault.update(doc.id, { labels: ['tenancy', 'Home'], note: 'NOTE-SECRET-WORDS\nsecond line' });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'scribeforge-vault-test-'));
});

/** Makes a backup file of the vault, and returns where it is. */
let backups = 0;
function backupOf(vault: Vault): { file: string } {
  const file = path.join(dir, `backup ${++backups}.sfbackup`);
  vault.backup(file);
  return { file };
}

describe('making and opening a vault', () => {
  it('keeps nothing readable on disk: no text, title, file name, label or note', () => {
    const vault = make();
    vault.create(PASSWORD, true);
    addSample(vault);
    vault.lock();
    const files = filesIn(vaultDir());
    expect(files.map((f) => path.relative(vaultDir(), f).split(path.sep)[0]).sort()).toEqual(['archive.sealed', 'files', 'search.sealed', 'vault.json']);
    for (const file of files) {
      const bytes = readFileSync(file);
      for (const secret of [...SECRETS, PASSWORD]) expect(bytes.includes(Buffer.from(secret)), `${secret} in ${file}`).toBe(false);
    }
  });

  it('opens with the password, not with a wrong one; real vaults use scrypt at 2^17', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    addSample(vault);
    vault.lock();
    expect(vault.unlocked).toBe(false);
    expect(vault.unlock('wrong password!!')).toBe(false);
    expect(vault.unlock(PASSWORD)).toBe(true);
    expect(vault.documents().map((d) => d.title)).toEqual(['Quarterly lease contract']);
    expect(JSON.parse(readFileSync(path.join(vaultDir(), 'vault.json'), 'utf8')).password.kdf).toMatchObject({ name: 'scrypt', cost: COST, r: 8, p: 1 });
    expect(new Vault(path.join(dir, 'real')).create('a long enough password', false)).toBeUndefined();
    expect(JSON.parse(readFileSync(path.join(dir, 'real', 'vault.json'), 'utf8')).password.kdf.cost).toBe(17);
  });

  it('needs a password of at least 10 characters', () => {
    expect(() => make().create('too short', false)).toThrow(/at least 10 characters/);
  });

  it('opens with the recovery code, however it is typed, and records that it was used', () => {
    const vault = make();
    const code = vault.create(PASSWORD, true) as string;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
    vault.lock();
    expect(vault.hasRecoveryCode()).toBe(true);
    expect(vault.unlock('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA', 'recovery')).toBe(false);
    expect(vault.unlock(code.toLowerCase().replace(/-/g, ' '), 'recovery')).toBe(true);
    expect(vault.history().entries.map((e) => e.action)).toEqual(['vault-made', 'recovery-used']);
    // O reads as 0, and I and L as 1, since the code never uses them.
    expect(normaliseRecoveryCode('o1il0 00000 00000 00000 00000')).toBe('01110-00000-00000-00000-00000');
  });

  it('after a password change only the new password works; a new recovery code replaces the old', () => {
    const vault = make();
    const first = vault.create(PASSWORD, true) as string;
    expect(() => vault.changePassword('not the password', 'a new long password')).toThrow(/current password/);
    vault.changePassword(PASSWORD, 'a new long password');
    const second = vault.makeRecoveryCode('a new long password');
    vault.lock();
    expect(vault.unlock(PASSWORD)).toBe(false);
    expect(vault.unlock('a new long password')).toBe(true);
    vault.lock();
    expect(vault.unlock(first, 'recovery')).toBe(false);
    expect(vault.unlock(second, 'recovery')).toBe(true);
  });

  it('once locked, nothing can be read or changed', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    const doc = addSample(vault);
    vault.lock();
    for (const attempt of [() => vault.documents(), () => vault.read(doc.id), () => vault.update(doc.id, { title: 'x' }), () => vault.history(), () => vault.backup(path.join(dir, 'locked.sfbackup'))]) {
      expect(attempt).toThrow(/locked/);
    }
  });
});

describe('documents', () => {
  it('stores a PDF exactly, with its title, file name, pages, labels and note', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    const bytes = fixture('normal.pdf');
    const doc = vault.add({ fileName: 'normal.pdf', title: '', pages: 3, bytes });
    expect(doc).toMatchObject({ title: 'normal', fileName: 'normal.pdf', pages: 3, size: bytes.length, labels: [], note: '', voided: null });
    const back = vault.read(doc.id);
    expect(createHash('sha256').update(back).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    const changed = vault.update(doc.id, { title: '  Test   document ', labels: ['b', 'a', 'b', ''], note: 'Line one\r\nLine two' });
    expect(changed).toMatchObject({ title: 'Test document', labels: ['a', 'b'], note: 'Line one\nLine two' });
    expect(vault.size().documents).toBe(1);
  });

  it('voiding hides nothing from the vault itself: the document stays, with its reason, until restored', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    const doc = addSample(vault);
    expect(() => vault.voidDocument(doc.id, '  ')).toThrow(/why/);
    const voided = vault.voidDocument(doc.id, 'Superseded by the new lease');
    expect(voided.voided?.reason).toBe('Superseded by the new lease');
    expect(vault.read(doc.id).length).toBeGreaterThan(0);
    expect(vault.restoreDocument(doc.id).voided).toBeNull();
    expect(vault.history().entries.map((e) => e.action)).toEqual(['vault-made', 'added', 'labels', 'note', 'voided', 'restored']);
  });

  it('erasing removes the document and its file for good; the history keeps only its title and the reason', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    const doc = addSample(vault);
    const filesBefore = readdirSync(path.join(vaultDir(), 'files'));
    expect(filesBefore).toHaveLength(1);
    vault.eraseDocument(doc.id, 'Stored by mistake');
    expect(readdirSync(path.join(vaultDir(), 'files'))).toEqual([]);
    expect(vault.documents()).toEqual([]);
    const last = vault.history().entries.at(-1);
    expect(last).toMatchObject({ action: 'erased', title: 'Quarterly lease contract', details: { reason: 'Stored by mistake' } });
    // Nothing else about it is left in the database, even in its unused space (decrypted here with the vault's own key).
    const key = (vault as unknown as { key: Buffer }).key;
    const id = JSON.parse(readFileSync(path.join(vaultDir(), 'vault.json'), 'utf8')).id as string;
    const plain = unseal(subkey(key, id, 'archive'), 'archive', readFileSync(path.join(vaultDir(), 'archive.sealed')));
    for (const gone of ['NOTE-SECRET-WORDS', 'tenancy', 'lease-contract-2026.pdf']) expect(plain.includes(Buffer.from(gone)), gone).toBe(false);
  });
});

describe('the history', () => {
  /** Opens the saved database with the vault's own key, so a test can tamper with it as an outside tool would. */
  let tampered = 0;
  function tamper(change: (db: DatabaseSync) => void) {
    const folder = path.join(dir, `tampered ${++tampered}`);
    const vault = new Vault(folder, { cost: COST });
    vault.create(PASSWORD, false);
    const doc = addSample(vault);
    vault.voidDocument(doc.id, 'Old');
    const key = Buffer.from((vault as unknown as { key: Buffer }).key); // a copy: locking clears the vault's own
    const id = JSON.parse(readFileSync(path.join(folder, 'vault.json'), 'utf8')).id as string;
    vault.lock();
    const file = path.join(folder, 'archive.sealed');
    const db = new DatabaseSync(':memory:');
    db.deserialize(unseal(subkey(key, id, 'archive'), 'archive', readFileSync(file)));
    db.exec('DROP TRIGGER history_no_update; DROP TRIGGER history_no_delete;');
    change(db);
    writeFileSync(file, seal(subkey(key, id, 'archive'), 'archive', db.serialize()));
    vault.unlock(PASSWORD);
    return vault.history();
  }

  it('is intact when untouched, and ScribeForge itself refuses to change it', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    addSample(vault);
    expect(vault.history()).toMatchObject({ intact: true });
    const db = (vault as unknown as { db: DatabaseSync }).db;
    expect(() => db.exec("UPDATE history SET action = 'x'")).toThrow(/can't be changed/);
    expect(() => db.exec('DELETE FROM history')).toThrow(/can't be changed/);
  });

  it('finds a changed, a missing and a reordered entry', () => {
    expect(tamper((db) => db.exec("UPDATE history SET details = '{\"reason\":\"Nothing to see\"}' WHERE action = 'voided'"))).toMatchObject({ intact: false, brokenAt: 5 });
    expect(tamper((db) => db.exec("DELETE FROM history WHERE action = 'labels'"))).toMatchObject({ intact: false, brokenAt: 4 });
    expect(tamper((db) => db.exec('UPDATE history SET seq = 100 WHERE seq = 2; UPDATE history SET seq = 2 WHERE seq = 3; UPDATE history SET seq = 3 WHERE seq = 100;'))).toMatchObject({ intact: false, brokenAt: 2 });
  });
});

describe('damage', () => {
  const flip = (file: string) => {
    const bytes = readFileSync(file);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    writeFileSync(file, bytes);
  };

  it('a changed byte in the database: refused with a plain message, never used', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    addSample(vault);
    vault.lock();
    flip(path.join(vaultDir(), 'archive.sealed'));
    expect(() => vault.unlock(PASSWORD)).toThrow(/damaged or has been altered/);
    expect(vault.unlocked).toBe(false);
  });

  it("a changed byte in a stored file: that document won't open, the rest still do", () => {
    const vault = make();
    vault.create(PASSWORD, false);
    const doc = addSample(vault);
    const other = vault.add({ fileName: 'normal.pdf', title: 'Other', pages: 3, bytes: fixture('normal.pdf') });
    const fileOf = (id: string) => (vault as unknown as { latestVersion(id: string): { file: string } }).latestVersion(id).file;
    flip(path.join(vaultDir(), 'files', `${fileOf(doc.id)}.sealed`));
    expect(() => vault.read(doc.id)).toThrow(/missing or damaged/);
    expect(vault.read(other.id).length).toBe(fixture('normal.pdf').length);
  });

  it('stored files can\'t be swapped for each other', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    const a = addSample(vault);
    const b = vault.add({ fileName: 'b.pdf', title: 'B', pages: 1, bytes: pdfWith('B') });
    const fileOf = (id: string) => path.join(vaultDir(), 'files', `${(vault as unknown as { latestVersion(id: string): { file: string } }).latestVersion(id).file}.sealed`);
    writeFileSync(fileOf(a.id), readFileSync(fileOf(b.id)));
    expect(() => vault.read(a.id)).toThrow(/missing or damaged/);
  });
});

describe('backups', () => {
  it('restore the vault exactly, and only with the right password', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    const doc = addSample(vault);
    const backup = backupOf(vault);
    for (const secret of [...SECRETS, PASSWORD]) expect(readFileSync(backup.file).includes(Buffer.from(secret)), secret).toBe(false);
    // Later changes are undone by restoring.
    vault.eraseDocument(doc.id, 'Gone');
    expect(() => vault.restoreBackup(backup, 'wrong password!!')).toThrow(/doesn't open this backup/);
    expect(vault.restoreBackup(backup, PASSWORD, 'password', true)).toMatchObject({ documents: 1 });
    expect(vault.documents()).toEqual([]); // only checked, not restored yet
    const restored = vault.restoreBackup(backup, PASSWORD);
    expect(restored.documents).toBe(1);
    expect(vault.unlocked).toBe(true);
    expect(vault.documents().map((d) => [d.title, d.labels, d.note])).toEqual([['Quarterly lease contract', ['Home', 'tenancy'], 'NOTE-SECRET-WORDS\nsecond line']]);
    expect(new TextDecoder().decode(vault.read(doc.id))).toContain('VAULT-SECRET-TEXT');
    expect(vault.history().entries.at(-1)?.action).toBe('backup-restored');
    expect(vault.history().intact).toBe(true);
  });

  it('a changed byte anywhere in a backup is refused, and the vault is left as it was', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    addSample(vault);
    const backup = readFileSync(backupOf(vault).file);
    for (const at of [20, Math.floor(backup.length / 2), backup.length - 5]) {
      const bad = Buffer.from(backup);
      bad[at] ^= 1;
      const file = path.join(dir, `bad ${at}.sfbackup`);
      writeFileSync(file, bad);
      expect(() => vault.restoreBackup({ file }, PASSWORD)).toThrow(/damaged|isn't a ScribeForge|doesn't open/);
    }
    expect(vault.unlocked).toBe(true);
    expect(vault.documents()).toHaveLength(1);
    expect(existsSync(`${vaultDir()}.restoring`)).toBe(false);
  });

  it('restore into a PC with no vault yet', () => {
    const vault = make();
    vault.create(PASSWORD, false);
    addSample(vault);
    const backup = backupOf(vault);
    const elsewhere = new Vault(path.join(dir, 'Other PC', 'Vault'), { cost: COST });
    expect(elsewhere.exists()).toBe(false);
    expect(elsewhere.restoreBackup(backup, PASSWORD).documents).toBe(1);
    expect(elsewhere.documents()[0].title).toBe('Quarterly lease contract');
  });
});
