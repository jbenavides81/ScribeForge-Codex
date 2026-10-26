// Stop 4a's required checks for backups (docs/Plan_Phase4.md, section 7): a backup folder restores
// the vault exactly; backing up and restoring a 300 MB vault needs little memory; a second backup
// adds only what's new; half a backup is never used; damage is refused; nothing in the folder is
// readable; making a backup never opens earlier ones; backup files from 1.6 to 1.8 still restore;
// erasing for good reaches the folder.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { hmac, subkey } from '../../src/main/vault/crypto';
import {
  backupFolderFor,
  copyNewFiles,
  FOLDER_NAME,
  listSnapshots,
  newestComplete,
  parseSnapshotName,
  prepareFolder,
  pruneSnapshots,
  removeErased,
  snapshotName,
  storedFilesOf,
  tidyLeftOvers,
  writeSnapshot,
} from '../../src/main/vault/backupFolder';
import { Vault } from '../../src/main/vault/vault';
import { ROOT } from './support/inspect';

const COST = 10;
const PASSWORD = 'correct horse battery';
const PC_ONE = 'aaaaaaaaaaaa';
const PC_TWO = 'bbbbbbbbbbbb';
const SECRETS = ['BACKUP-SECRET-TEXT', 'Tenancy agreement', 'tenancy-2026.pdf', 'landlord-label', 'NOTE-ABOUT-RENT', 'searchable-glovebox'];
let dir: string;
let made = 0;
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.7\n1 0 obj (${text}) endobj\n%%EOF\n`);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'scribeforge-backup-folder-test-'));
});

function newVault(name = `Vault ${++made}`): Vault {
  const vault = new Vault(path.join(dir, name, 'Vault'), { cost: COST });
  vault.create(PASSWORD, false);
  return vault;
}

function sample(vault: Vault) {
  const doc = vault.add({ fileName: 'tenancy-2026.pdf', title: 'Tenancy agreement', pages: 2, bytes: pdf('BACKUP-SECRET-TEXT'), pageTexts: ['searchable-glovebox', 'page two'] });
  vault.update(doc.id, { labels: ['landlord-label'], note: 'NOTE-ABOUT-RENT' });
  vault.addVersion(doc.id, { fileName: 'tenancy-signed.pdf', pages: 2, bytes: pdf('SIGNED-COPY'), pageTexts: ['signed', 'page two'] });
  const other = vault.add({ fileName: 'insurance.pdf', title: 'Insurance', pages: 1, bytes: pdf('INSURANCE'), pageTexts: ['policy'] });
  return { doc, other };
}

/** What the app does on locking: the backup made with the key, then copied into the folder. */
async function backUp(vault: Vault, folder: string, madeBy = PC_ONE, keep = 10) {
  const snap = vault.snapshot(madeBy);
  await prepareFolder(folder);
  const copied = await copyNewFiles(folder, snap.stored);
  await writeSnapshot(folder, snap.name, snap.bytes);
  await pruneSnapshots(folder, vault.tag(), keep);
  return { ...snap, copied };
}

const filesIn = (folder: string): string[] =>
  readdirSync(folder).flatMap((f) => (statSync(path.join(folder, f)).isDirectory() ? filesIn(path.join(folder, f)) : [path.join(folder, f)]));

describe('a backup folder', () => {
  it('restores the vault exactly, on another PC, every version included', async () => {
    const vault = newVault();
    const { doc, other } = sample(vault);
    const folder = path.join(dir, 'OneDrive', FOLDER_NAME);
    await backUp(vault, folder);
    expect(readFileSync(path.join(folder, 'README.txt'), 'utf8')).toContain('Restore from a backup folder');

    const elsewhere = new Vault(path.join(dir, 'Other PC', 'Vault'), { cost: COST });
    const found = newestComplete(folder);
    expect(found?.waiting).toBe(0);
    const source = { folder, snapshot: found!.snapshot.name };
    expect(elsewhere.restoreBackup(source, PASSWORD, 'password', true)).toMatchObject({ documents: 2, checkedAll: false });
    expect(elsewhere.exists()).toBe(false); // only checked
    elsewhere.restoreBackup(source, PASSWORD);
    expect(elsewhere.documents().map((d) => d.title).sort()).toEqual(['Insurance', 'Tenancy agreement']);
    expect(elsewhere.document(doc.id)).toMatchObject({ labels: ['landlord-label'], note: 'NOTE-ABOUT-RENT', versions: 2 });
    const [first, second] = elsewhere.versions(doc.id);
    expect(Buffer.from(elsewhere.readVersion(first.id)).toString()).toContain('BACKUP-SECRET-TEXT');
    expect(Buffer.from(elsewhere.readVersion(second.id)).toString()).toContain('SIGNED-COPY');
    expect(Buffer.from(elsewhere.read(other.id)).toString()).toContain('INSURANCE');
    expect(elsewhere.search('glovebox')).toEqual([]); // the newest version is the one searched
    expect(elsewhere.search('signed')).toHaveLength(1);
    expect(elsewhere.history().intact).toBe(true);
    expect(elsewhere.history().entries.at(-1)?.action).toBe('backup-restored');
  });

  it('a second backup with nothing new adds only the small backup file; a new document adds only its own file', async () => {
    const vault = newVault();
    sample(vault);
    const folder = path.join(dir, FOLDER_NAME);
    const first = await backUp(vault, folder);
    expect(first.copied).toBe(3);
    const second = await backUp(vault, folder);
    expect(second.copied).toBe(0);
    expect(readdirSync(path.join(folder, 'files'))).toHaveLength(3);
    expect(listSnapshots(folder)).toHaveLength(2);
    vault.add({ fileName: 'new.pdf', title: 'New', pages: 1, bytes: pdf('NEW') });
    expect((await backUp(vault, folder)).copied).toBe(1);
    expect(readdirSync(path.join(folder, 'files'))).toHaveLength(4);
  });

  it('keeps the newest backups of each vault; other vaults in the same folder are left alone', async () => {
    const one = newVault();
    const two = newVault();
    sample(one);
    two.add({ fileName: 'b.pdf', title: 'B', pages: 1, bytes: pdf('B') });
    const folder = path.join(dir, FOLDER_NAME);
    let t = Date.now();
    for (let i = 0; i < 4; i++) {
      await backUp(one, folder, PC_ONE, 2);
      while (Date.now() === t); // a new name each time
      t = Date.now();
    }
    await backUp(two, folder, PC_TWO, 2);
    const snaps = listSnapshots(folder);
    expect(snaps.filter((s) => s.vault === one.tag())).toHaveLength(2);
    expect(snaps.filter((s) => s.vault === two.tag())).toHaveLength(1);
    expect(newestComplete(folder, one.tag())?.snapshot.vault).toBe(one.tag());
    expect(newestComplete(folder)?.snapshot.vault).toBe(two.tag()); // the vault with the newest backup
  });

  it('half a backup is never used: one still arriving is skipped for the newest complete one', async () => {
    const vault = newVault();
    sample(vault);
    const folder = path.join(dir, FOLDER_NAME);
    const complete = await backUp(vault, folder);
    while (Date.now() === complete.created.getTime());
    vault.add({ fileName: 'late.pdf', title: 'Late', pages: 1, bytes: pdf('LATE') });
    const later = await backUp(vault, folder);
    // The new document's file hasn't arrived yet (as when it was made on another PC).
    const lateFile = later.stored.find((f) => !complete.stored.some((c) => c.name === f.name))!;
    rmSync(path.join(folder, 'files', lateFile.name));
    // And a half-written backup is never listed.
    writeFileSync(path.join(folder, 'backups', `${snapshotName(new Date(), vault.tag(), PC_TWO)}.tmp`), 'half');
    const found = newestComplete(folder, vault.tag());
    expect(found).toMatchObject({ snapshot: { name: complete.name }, waiting: 1 });
    const elsewhere = new Vault(path.join(dir, 'Other', 'Vault'), { cost: COST });
    expect(() => elsewhere.restoreBackup({ folder, snapshot: later.name }, PASSWORD, 'password', true)).toThrow(/isn't complete yet: 1 of its files isn't in the folder/);
    expect(elsewhere.restoreBackup({ folder, snapshot: complete.name }, PASSWORD).documents).toBe(2);
  });

  it('a changed byte in a backup, or in a stored file, is refused; nothing is replaced', async () => {
    const vault = newVault();
    sample(vault);
    const folder = path.join(dir, FOLDER_NAME);
    const snap = await backUp(vault, folder);
    const snapFile = path.join(folder, 'backups', snap.name);
    const original = readFileSync(snapFile);
    for (const at of [12, Math.floor(original.length / 2), original.length - 3]) {
      const bad = Buffer.from(original);
      bad[at] ^= 1;
      writeFileSync(snapFile, bad);
      const elsewhere = new Vault(path.join(dir, `Other ${at}`, 'Vault'), { cost: COST });
      expect(() => elsewhere.restoreBackup({ folder, snapshot: snap.name }, PASSWORD)).toThrow(/damaged|isn't a ScribeForge|doesn't open/);
      expect(elsewhere.exists()).toBe(false);
    }
    writeFileSync(snapFile, original);
    // A stored file: found when it's restored (it's checked against its own seal), before anything is replaced.
    const stored = path.join(folder, 'files', snap.stored[0].name);
    const bytes = readFileSync(stored);
    bytes[bytes.length - 5] ^= 1;
    writeFileSync(stored, bytes);
    const elsewhere = new Vault(path.join(dir, 'Other PC', 'Vault'), { cost: COST });
    expect(() => elsewhere.restoreBackup({ folder, snapshot: snap.name }, PASSWORD)).toThrow(/damaged/);
    expect(elsewhere.exists()).toBe(false);
    expect(existsSync(path.join(dir, 'Other PC', 'Vault.restoring'))).toBe(false);
    // On this PC, its own good copy is used instead.
    expect(vault.restoreBackup({ folder, snapshot: snap.name }, PASSWORD).documents).toBe(2);
  });

  it('nothing in the folder is readable: no words, titles, labels, notes or file names; the names say nothing', async () => {
    const vault = newVault();
    sample(vault);
    const folder = path.join(dir, FOLDER_NAME);
    await backUp(vault, folder);
    for (const file of filesIn(folder)) {
      const bytes = readFileSync(file);
      for (const secret of [...SECRETS, PASSWORD]) expect(bytes.includes(Buffer.from(secret)), `${path.basename(file)}: ${secret}`).toBe(false);
    }
    for (const name of readdirSync(path.join(folder, 'backups'))) expect(parseSnapshotName(name)).toMatchObject({ vault: vault.tag(), madeBy: PC_ONE });
  });

  it('making a backup never opens earlier backups or stored files: names and sizes only', async () => {
    const vault = newVault();
    sample(vault);
    const folder = path.join(dir, FOLDER_NAME);
    const first = await backUp(vault, folder);
    // Earlier backups and stored files are made unreadable (same names and sizes). Opening any of
    // them would fail or be noticed; a new backup goes ahead without looking inside.
    const junk = (file: string) => writeFileSync(file, randomBytes(statSync(file).size));
    junk(path.join(folder, 'backups', first.name));
    for (const f of readdirSync(path.join(folder, 'files'))) junk(path.join(folder, 'files', f));
    const before = new Map(readdirSync(path.join(folder, 'files')).map((f) => [f, readFileSync(path.join(folder, 'files', f))]));
    while (Date.now() === first.created.getTime());
    const second = await backUp(vault, folder, PC_ONE, 1);
    expect(second.copied).toBe(0);
    for (const [f, bytes] of before) expect(readFileSync(path.join(folder, 'files', f)).equals(bytes)).toBe(true);
    expect(listSnapshots(folder).map((s) => s.name)).toEqual([second.name]); // the old one pruned by name
  });

  it('erasing for good reaches the folder: the document\'s files, and every backup that held it, go', async () => {
    const vault = newVault();
    const { doc } = sample(vault);
    const folder = path.join(dir, FOLDER_NAME);
    const before = vault.snapshot(PC_ONE);
    await backUp(vault, folder);
    const erased = vault.eraseDocument(doc.id, 'Stored by mistake');
    expect(erased).toHaveLength(2);
    const after = await backUp(vault, folder);
    expect(await removeErased(folder, vault.tag(), erased)).toBe(1);
    expect(listSnapshots(folder).map((s) => s.name)).toEqual([after.name]);
    const left = readdirSync(path.join(folder, 'files'));
    for (const name of erased) expect(left).not.toContain(name);
    expect(left).toHaveLength(1);
    expect(before.stored).toHaveLength(3);
    const elsewhere = new Vault(path.join(dir, 'Other', 'Vault'), { cost: COST });
    elsewhere.restoreBackup({ folder, snapshot: after.name }, PASSWORD);
    expect(elsewhere.documents().map((d) => d.title)).toEqual(['Insurance']);
  });

  it('tidies temporary files left by a backup cut short, a day later', async () => {
    const folder = path.join(dir, FOLDER_NAME);
    await prepareFolder(folder);
    const old = path.join(folder, 'files', 'x.sealed.tmp');
    const fresh = path.join(folder, 'backups', 'y.sfsnap.tmp');
    writeFileSync(old, 'x');
    writeFileSync(fresh, 'y');
    const twoDaysAgo = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    await tidyLeftOvers(folder);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('finds the backup folder from the folder chosen', async () => {
    const parent = path.join(dir, 'OneDrive');
    expect(backupFolderFor(parent)).toBe(path.join(parent, FOLDER_NAME));
    await prepareFolder(path.join(parent, FOLDER_NAME));
    expect(backupFolderFor(path.join(parent, FOLDER_NAME))).toBe(path.join(parent, FOLDER_NAME));
    expect(newestComplete(path.join(dir, 'empty'))).toBeNull();
    expect(storedFilesOf(path.join(dir, 'empty'), 'nothing.sfsnap')).toBeNull();
    const name = snapshotName(new Date('2026-10-26T19:30:12.345Z'), 'abcdef012345', PC_TWO);
    expect(name).toBe('2026-10-26T19-30-12-345Z_abcdef012345_bbbbbbbbbbbb.sfsnap');
    expect(parseSnapshotName(name)?.created.toISOString()).toBe('2026-10-26T19:30:12.345Z');
    expect(parseSnapshotName('notes.txt')).toBeNull();
  });
});

describe('backup files', () => {
  it('made by 1.6 to 1.8 (built all at once in memory) still restore', () => {
    const vault = newVault();
    const { doc } = sample(vault);
    const vaultDir = vault.dir;
    const key = Buffer.from((vault as unknown as { key: Buffer }).key);
    const id = JSON.parse(readFileSync(path.join(vaultDir, 'vault.json'), 'utf8')).id as string;
    // Exactly as 1.8.0's Vault.backup() made them.
    const names = ['vault.json', 'archive.sealed', 'search.sealed', ...readdirSync(path.join(vaultDir, 'files')).map((n) => `files/${n}`)];
    const parts = names.map((name) => ({ name, bytes: readFileSync(path.join(vaultDir, ...name.split('/'))) }));
    const manifest = Buffer.from(JSON.stringify({ created: '2026-10-23T10:00:00.000Z', vault: id, files: parts.map((p) => ({ name: p.name, size: p.bytes.length })) }));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(manifest.length);
    const body = Buffer.concat([Buffer.from('SFBACKUP1\n'), length, manifest, ...parts.map((p) => p.bytes)]);
    const file = path.join(dir, 'made by 1.8.sfbackup');
    writeFileSync(file, Buffer.concat([body, hmac(subkey(key, id, 'backup'), body)]));
    const elsewhere = new Vault(path.join(dir, 'Other', 'Vault'), { cost: COST });
    expect(elsewhere.restoreBackup({ file }, PASSWORD, 'password', true)).toMatchObject({ created: '2026-10-23T10:00:00.000Z', documents: 2, checkedAll: true });
    elsewhere.restoreBackup({ file }, PASSWORD);
    expect(elsewhere.versions(doc.id)).toHaveLength(2);
  });

  it('a 300 MB vault is backed up and restored, as a file and to a folder, with under 100 MB of extra memory', () => {
    const vault = newVault();
    for (let i = 0; i < 60; i++) vault.add({ fileName: `doc-${i}.pdf`, title: `Document ${i}`, pages: 1, bytes: randomBytes(5 * 1024 * 1024) });
    vault.lock();
    // Each step runs in a process of its own, which reports how much more memory it needed at its
    // peak than just before (1.8.0 needed about four times the vault's size, B3).
    const child = path.join(ROOT, 'tests/unit/support/backup-memory.mjs');
    const extra = (what: string, vaultDir: string, target: string) =>
      Number(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', child, what, vaultDir, target, PASSWORD], { encoding: 'utf8' }).trim().split(/\s+/).at(-1));
    const file = path.join(dir, 'big.sfbackup');
    const folder = path.join(dir, FOLDER_NAME);
    const results = {
      'backup file': extra('backup-file', vault.dir, file),
      'backup folder': extra('backup-folder', vault.dir, folder),
      'restore from file': extra('restore-file', path.join(dir, 'From file', 'Vault'), file),
      'restore from folder': extra('restore-folder', path.join(dir, 'From folder', 'Vault'), folder),
    };
    console.log(`300 MB vault, extra memory at the peak: ${Object.entries(results).map(([what, mb]) => `${what} ${mb} MB`).join(', ')}`);
    expect(statSync(file).size).toBeGreaterThan(300 * 1024 * 1024);
    expect(new Vault(path.join(dir, 'From folder', 'Vault'), { cost: COST }).unlock(PASSWORD)).toBe(true);
    for (const [what, mb] of Object.entries(results)) {
      expect(Number.isFinite(mb), what).toBe(true);
      expect(mb, what).toBeLessThan(100);
    }
  }, 180_000);
});
