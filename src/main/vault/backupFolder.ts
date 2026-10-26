// A backup folder (stop 4a, docs/Plan_Phase4.md section 4): usually inside a folder OneDrive or
// Google Drive syncs. It holds the vault's encrypted stored files, each copied once, and one small
// backup (.sfsnap) each time a backup is made: the encrypted database, search index and key file,
// with the list of stored files it needs. Nothing here needs the vault's key.
//
//   ScribeForge Archive backup\
//     README.txt
//     files\<random>.sealed
//     backups\2026-10-26T19-30-12-345Z_<vault>_<pc>.sfsnap
//
// The vault and PC in a backup's name are short random tags, never names. Making a backup only
// lists folders and reads file sizes; it never opens an earlier backup, so files OneDrive keeps
// online only stay that way (B2).
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ContainerReader } from './container';

export const FOLDER_NAME = 'ScribeForge Archive backup';
export const SNAPSHOT_MAGIC = Buffer.from('SFSNAP1\n');
const SNAPSHOT = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_([0-9a-f]{12})_([0-9a-f]{12})\.sfsnap$/;
export const STORED_FILE = /^[0-9a-f-]{36}\.sealed$/;
/** Left-over temporary files older than this are tidied away. */
const LEFT_OVER_MS = 24 * 60 * 60 * 1000;

const README = `This folder holds encrypted backups of a ScribeForge Archive.

Nothing in it can be read without the vault's password or recovery code.
Please don't change, move or rename the files in it.

To restore it: open ScribeForge, go to the Archive, and click
"Restore from a backup folder…". Choose this folder.

ScribeForge adds a new backup here when the vault locks or ScribeForge
closes, if anything changed.
`;

export interface SnapshotInfo {
  /** The backup's file name, in backups\. */
  name: string;
  created: Date;
  /** Which vault it's a backup of (a short tag, the same on every PC). */
  vault: string;
  /** Which PC made it (a short random tag). */
  madeBy: string;
}

export function snapshotName(created: Date, vault: string, madeBy: string): string {
  return `${created.toISOString().replace(/[:.]/g, '-')}_${vault}_${madeBy}.sfsnap`;
}

export function parseSnapshotName(name: string): SnapshotInfo | null {
  const m = SNAPSHOT.exec(name);
  if (!m) return null;
  const created = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(created.getTime()) ? null : { name, created, vault: m[6], madeBy: m[7] };
}

/**
 * The backup folder for a folder the person chose: the folder itself if it's a backup folder,
 * the backup folder inside it if there is one, or else where one would be made inside it.
 */
export function backupFolderFor(chosen: string): string {
  if (path.basename(chosen).toLowerCase() === FOLDER_NAME.toLowerCase() || existsSync(path.join(chosen, 'backups'))) return chosen;
  return path.join(chosen, FOLDER_NAME);
}

/** Every backup in the folder, newest first, from their names alone. */
export function listSnapshots(folder: string): SnapshotInfo[] {
  let names: string[];
  try {
    names = readdirSync(path.join(folder, 'backups'));
  } catch {
    return [];
  }
  return names
    .map(parseSnapshotName)
    .filter((s): s is SnapshotInfo => s !== null)
    .sort((a, b) => b.created.getTime() - a.created.getTime() || (a.name < b.name ? 1 : -1));
}

export const snapshotPath = (folder: string, name: string) => path.join(folder, 'backups', name);
export const storedPath = (folder: string, name: string) => path.join(folder, 'files', name);

/** Makes the folder's layout and README, if they aren't there yet. Throws if the folder can't be written. */
export async function prepareFolder(folder: string): Promise<void> {
  await mkdir(path.join(folder, 'files'), { recursive: true });
  await mkdir(path.join(folder, 'backups'), { recursive: true });
  const readme = path.join(folder, 'README.txt');
  if (!existsSync(readme)) await writeFile(readme, README.replace(/\n/g, '\r\n'), 'utf8');
}

/**
 * Copies the stored files the folder doesn't have yet: each under a temporary name, then put in
 * place. A file already there with the same size is the same file (stored files never change,
 * and their names are random). Returns how many were copied.
 */
export async function copyNewFiles(folder: string, files: { name: string; size: number; from: string }[]): Promise<number> {
  const have = new Map<string, number>();
  for (const name of await readdir(path.join(folder, 'files'))) {
    if (!STORED_FILE.test(name)) continue;
    try {
      have.set(name, (await stat(storedPath(folder, name))).size);
    } catch {
      // Gone while looking: copied again below.
    }
  }
  let copied = 0;
  for (const f of files) {
    if (have.get(f.name) === f.size) continue;
    const target = storedPath(folder, f.name);
    const temp = `${target}.tmp`;
    try {
      await copyFile(f.from, temp);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    copied++;
  }
  return copied;
}

/** Puts a finished backup in place: under a temporary name first, so a half-written one is never seen. */
export async function writeSnapshot(folder: string, name: string, bytes: Uint8Array): Promise<void> {
  const target = snapshotPath(folder, name);
  const temp = `${target}.tmp`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Keeps the newest `keep` backups of one vault (from any PC); the rest are removed. Other vaults' backups aren't touched. */
export async function pruneSnapshots(folder: string, vault: string, keep: number): Promise<number> {
  const old = listSnapshots(folder)
    .filter((s) => s.vault === vault)
    .slice(Math.max(1, keep));
  for (const s of old) await rm(snapshotPath(folder, s.name), { force: true });
  return old.length;
}

/** Removes temporary files left by a backup that was cut short (the PC slept or ScribeForge was closed) more than a day ago. */
export async function tidyLeftOvers(folder: string, now = Date.now()): Promise<void> {
  for (const sub of ['files', 'backups']) {
    let names: string[] = [];
    try {
      names = await readdir(path.join(folder, sub));
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith('.tmp'))) {
      const file = path.join(folder, sub, name);
      try {
        if (now - (await stat(file)).mtimeMs > LEFT_OVER_MS) await rm(file, { force: true });
      } catch {
        // Gone already.
      }
    }
  }
}

/** Which of these stored files are missing from the folder, or the wrong size (still arriving from another PC). */
export function missingFiles(folder: string, files: { name: string; size: number }[]): number {
  let missing = 0;
  for (const f of files) {
    try {
      if (statSync(storedPath(folder, f.name)).size !== f.size) missing++;
    } catch {
      missing++;
    }
  }
  return missing;
}

/** The list of stored files a backup needs, read from the backup itself (this opens it). Null if it can't be read. */
export function storedFilesOf(folder: string, name: string): { name: string; size: number }[] | null {
  let reader: ContainerReader | null = null;
  try {
    reader = new ContainerReader(snapshotPath(folder, name), SNAPSHOT_MAGIC, (n) => ['vault.json', 'archive.sealed', 'search.sealed'].includes(n));
    const stored = (reader.list as { stored?: unknown }).stored;
    if (!Array.isArray(stored)) return null;
    return stored.filter((f): f is { name: string; size: number } => typeof f?.name === 'string' && STORED_FILE.test(f.name) && Number.isSafeInteger(f.size));
  } catch {
    return null;
  } finally {
    reader?.close();
  }
}

/**
 * The newest backup in the folder whose stored files have all arrived, for restoring. It's a
 * backup of `vault` if given, or else of the vault with the newest backup. `waiting` counts newer
 * backups of that vault still arriving (from another PC). Null when there's none.
 */
export function newestComplete(folder: string, vault?: string): { snapshot: SnapshotInfo; waiting: number } | null {
  const all = listSnapshots(folder);
  const which = vault ?? all[0]?.vault;
  let waiting = 0;
  for (const s of all.filter((x) => x.vault === which)) {
    const stored = storedFilesOf(folder, s.name);
    if (stored && missingFiles(folder, stored) === 0) return { snapshot: s, waiting };
    waiting++;
  }
  return null;
}

/**
 * After a document is erased for good: removes its stored files from the folder, and every
 * backup of this vault that still needs them (a backup that can't be read is left, but it can no
 * longer be restored without them). Returns how many backups were removed.
 */
export async function removeErased(folder: string, vault: string, erased: string[]): Promise<number> {
  const gone = new Set(erased);
  let removed = 0;
  for (const s of listSnapshots(folder).filter((x) => x.vault === vault)) {
    const stored = storedFilesOf(folder, s.name);
    if (stored?.some((f) => gone.has(f.name))) {
      await rm(snapshotPath(folder, s.name), { force: true });
      removed++;
    }
  }
  for (const name of gone) if (STORED_FILE.test(name)) await rm(storedPath(folder, name), { force: true });
  return removed;
}
