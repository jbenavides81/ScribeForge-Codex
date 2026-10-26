// The Archive, the main process's part (docs/Plan_Phase3.md): the vault lives here, with its key,
// and the screens ask for what they need. PDFs are never read here: the screens send the page
// count, title and a small picture of the first page with each PDF they add.
//
// The vault locks when ScribeForge starts (it's never unlocked until asked), after the time set in
// Settings without using ScribeForge, when Windows locks, when the PC sleeps, and with Lock. The
// screens are told, so they close anything opened from the vault.
//
// Automatic backups (stop 4a, docs/Plan_Phase4.md section 4): when the vault locks, or ScribeForge
// closes, and something changed since the last backup, a backup goes to the backup folder. The
// part that needs the key is made at once, before locking; the copying into the folder happens
// after, in the background, so locking is never held up.
import { app, dialog, ipcMain, powerMonitor, type BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { safeFileName } from '../engine/names';
import type { OpenResult, SaveResult } from '../shared/api';
import { MAX_BACKUP_STATES } from '../shared/settings';
import {
  BACKUP_KEEP,
  type BackupCheck,
  type BackupKeep,
  type BackupPlace,
  type BackupStatus,
  type HistoryCheck,
  type NewDocument,
  type NewVersion,
  type SearchOptions,
  type VaultDocument,
  type VaultReply,
  type VaultStatus,
  type VaultVersion,
} from '../shared/vault';
import { samePath, uniquePath, writeSafely } from './fileWrite';
import { readPdf } from './files';
import type { SettingsStore } from './settingsStore';
import { backupFolderFor, copyNewFiles, FOLDER_NAME, listSnapshots, newestComplete, prepareFolder, pruneSnapshots, removeErased, tidyLeftOvers, writeSnapshot } from './vault/backupFolder';
import { Vault, VaultError } from './vault/vault';

function reply<T>(work: () => T): VaultReply<T> {
  try {
    return { ok: true, value: work() };
  } catch (error) {
    if (error instanceof VaultError) return { ok: false, locked: error.kind === 'locked', message: error.message };
    return { ok: false, locked: false, message: `Something went wrong in the vault: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Why a backup to the backup folder failed, in plain words. */
function backupProblem(error: unknown, folder: string): string {
  const code = (error as { code?: string })?.code;
  if (!existsSync(path.dirname(folder)) || code === 'ENOENT') return "The backup folder isn't there. If it's on a USB drive, plug it in; if it's in OneDrive or Google Drive, check it's still on this PC.";
  if (code === 'ENOSPC') return "There isn't enough space for the backup.";
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return "ScribeForge isn't allowed to write to the backup folder.";
  return "ScribeForge couldn't write to the backup folder.";
}

/**
 * Folders that OneDrive and Google Drive keep in step with the internet, if they're on this PC.
 * OneDrive's comes from Windows (it sets where it is); Google Drive's is its "My Drive" folder,
 * either in the user's folder or on the drive it adds. A drive that doesn't answer within a second
 * (a network drive that's away) is skipped.
 */
async function backupPlaces(): Promise<BackupPlace[]> {
  const places: BackupPlace[] = [];
  const add = (name: string, folder: string | undefined) => {
    if (folder && existsSync(folder) && !places.some((p) => samePath(p.path, folder))) places.push({ name, path: folder });
  };
  for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) add('OneDrive', process.env[v]);
  if (process.env.SCRIBEFORGE_TEST_WINDOW === 'left') return places; // tests never look at this PC's drives
  add('Google Drive', process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'My Drive') : undefined);
  const answers = await Promise.all(
    'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async (letter) => {
      const folder = `${letter}:\\My Drive`;
      const found = await Promise.race([
        access(folder).then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
      ]);
      return found ? folder : null;
    }),
  );
  for (const folder of answers) if (folder) add('Google Drive', folder);
  return places;
}

/** Which sync program's folder a backup folder is in, for showing. */
function placeOf(folder: string): string | null {
  for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = process.env[v];
    if (root && path.resolve(folder).toLowerCase().startsWith(`${path.resolve(root).toLowerCase()}${path.sep}`)) return 'OneDrive';
  }
  return /[\\/]My Drive([\\/]|$)/i.test(folder) ? 'Google Drive' : null;
}

export function registerArchive(win: () => BrowserWindow, store: SettingsStore, folder: string): { lock: (why: string) => void } {
  const vault = new Vault(folder);
  let lastUse = Date.now();
  /** A backup chosen for restoring (a backup file, or one backup in a backup folder), until it's checked and restored or cancelled. */
  let pendingBackup: { file: string } | { folder: string; snapshot: string; waiting: number } | null = null;

  // ---- Automatic backups ----

  /** This PC's random tag, made the first time it's needed. */
  const installId = (): string => {
    const s = store.get();
    if (/^[0-9a-f]{12}$/.test(s.installId)) return s.installId;
    return store.set({ ...s, installId: randomBytes(6).toString('hex') }).installId;
  };
  /** Remembers what a vault held when it was last backed up or restored here. */
  const remember = (tag: string, at: Date, state: string) => {
    const s = store.get();
    const entries = Object.entries({ ...s.archiveBackupState, [tag]: { at: at.toISOString(), state } })
      .sort((a, b) => b[1].at.localeCompare(a[1].at))
      .slice(0, MAX_BACKUP_STATES);
    store.set({ ...s, archiveBackupState: Object.fromEntries(entries) });
  };
  let queue: Promise<unknown> = Promise.resolve();
  let running = 0;
  let last: BackupStatus['last'] = null;

  /**
   * Makes a backup into the backup folder: the part that needs the key now, the copying after, one
   * backup at a time. Resolves when it's in the folder (or failed).
   */
  const startBackup = (target: string): Promise<{ ok: true; at: string } | { ok: false; message: string }> => {
    const tag = vault.tag();
    const keep = store.get().archiveBackupKeep;
    let snap: ReturnType<Vault['snapshot']>;
    try {
      snap = vault.snapshot(installId());
    } catch (error) {
      return Promise.resolve({ ok: false, message: error instanceof VaultError ? error.message : "The backup couldn't be made." });
    }
    running++;
    const job = queue.then(async () => {
      try {
        if (!existsSync(path.dirname(target))) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        await prepareFolder(target);
        await tidyLeftOvers(target);
        await copyNewFiles(target, snap.stored);
        await writeSnapshot(target, snap.name, snap.bytes);
        await pruneSnapshots(target, tag, keep);
        // Documents erased for good since the last backup that reached the folder: removed from it now.
        const erased = store.get().archiveBackupErased[tag];
        if (erased?.length) {
          await removeErased(target, tag, erased);
          const s = store.get();
          const rest = { ...s.archiveBackupErased };
          delete rest[tag];
          store.set({ ...s, archiveBackupErased: rest });
        }
        remember(tag, snap.created, snap.state);
        last = { at: snap.created.toISOString(), ok: true, message: '' };
        return { ok: true as const, at: last.at };
      } catch (error) {
        last = { at: new Date().toISOString(), ok: false, message: backupProblem(error, target) };
        return { ok: false as const, message: last.message };
      } finally {
        running--;
      }
    });
    queue = job.catch(() => {});
    return job;
  };

  /** A backup, if automatic backups are on and the vault changed since its last backup from this PC. */
  const backupIfChanged = () => {
    const target = store.get().archiveBackupFolder;
    if (!target || !vault.unlocked) return;
    try {
      const saved = store.get().archiveBackupState[vault.tag()];
      if (saved && saved.state === vault.state()) return;
    } catch {
      return;
    }
    void startBackup(target);
  };

  /** A newer backup of this vault in the backup folder, made on another PC, if there is one. */
  const newerBackup = (): BackupStatus['newer'] => {
    const target = store.get().archiveBackupFolder;
    if (!target || !vault.unlocked) return null;
    const tag = vault.tag();
    const me = installId();
    const saved = store.get().archiveBackupState[tag];
    const since = saved ? new Date(saved.at).getTime() : 0;
    const newest = listSnapshots(target).find((s) => s.vault === tag);
    if (!newest || newest.madeBy === me || newest.created.getTime() <= since) return null;
    return { created: newest.created.toISOString(), changedHere: !saved || saved.state !== vault.state() };
  };

  const backupStatus = (): BackupStatus => {
    const s = store.get();
    // Before any backup this session: when the vault was last backed up here, or restored from the folder.
    let lastHere = last;
    if (!lastHere && s.archiveBackupFolder && vault.exists()) {
      try {
        const saved = s.archiveBackupState[vault.tag()];
        if (saved) lastHere = { at: saved.at, ok: true, message: '' };
      } catch {
        // A damaged key file: unlocking says so.
      }
    }
    return {
      folder: s.archiveBackupFolder || null,
      place: s.archiveBackupFolder ? placeOf(s.archiveBackupFolder) : null,
      keep: s.archiveBackupKeep,
      running: running > 0,
      last: lastHere,
      newer: newerBackup(),
    };
  };

  const lock = (why: string) => {
    if (!vault.unlocked) return;
    backupIfChanged();
    vault.lock();
    const w = win();
    if (!w.isDestroyed()) w.webContents.send('vault:locked', why);
  };
  const used = () => {
    lastUse = Date.now();
  };

  // Locking: after the time set in Settings without using ScribeForge (tests can shorten it), when
  // Windows locks, and when the PC sleeps.
  const testIdle = Number(process.env.SCRIBEFORGE_TEST_VAULT_IDLE_MS);
  const idleLimit = () => (Number.isFinite(testIdle) && testIdle > 0 ? testIdle : store.get().vaultLockMinutes * 60_000);
  const timer = setInterval(() => {
    if (vault.unlocked && Date.now() - lastUse >= idleLimit()) lock('idle');
  }, Number.isFinite(testIdle) && testIdle > 0 ? Math.max(100, testIdle / 4) : 15_000);
  powerMonitor.on('lock-screen', () => lock('windows-locked'));
  powerMonitor.on('suspend', () => lock('sleep'));
  // Closing: a last backup if anything changed, and ScribeForge waits for it to be in the folder.
  let waitedForBackup = false;
  app.on('before-quit', (event) => {
    clearInterval(timer);
    if (vault.unlocked) backupIfChanged();
    vault.lock();
    if (running > 0 && !waitedForBackup) {
      waitedForBackup = true;
      event.preventDefault();
      void queue.finally(() => app.quit());
    }
  });

  const status = (): VaultStatus => {
    const exists = vault.exists();
    let hasRecoveryCode = false;
    try {
      hasRecoveryCode = exists && vault.hasRecoveryCode();
    } catch {
      // A damaged key file: unlocking says so.
    }
    return {
      exists,
      unlocked: vault.unlocked,
      hasRecoveryCode,
      ...(vault.unlocked ? { ...vault.size(), unindexed: vault.unindexed().length, indexDamaged: vault.searchIndexDamaged } : {}),
    };
  };

  /** Every vault request counts as using ScribeForge. */
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(channel, (_e, ...args: unknown[]) => {
      used();
      return fn(...(args as A));
    });

  handle('vault:status', status);
  ipcMain.on('vault:active', used);
  ipcMain.on('vault:lock', () => lock('button'));

  handle('vault:create', (password: unknown, withRecoveryCode: unknown) =>
    reply(() => {
      if (typeof password !== 'string') throw new VaultError('invalid', 'Type a password.');
      return vault.create(password, withRecoveryCode === true) ?? null;
    }),
  );

  handle('vault:unlock', (secret: unknown, kind: unknown) =>
    reply(() => {
      if (typeof secret !== 'string') throw new VaultError('invalid', 'Type the password.');
      const recovery = kind === 'recovery';
      if (!vault.unlock(secret, recovery ? 'recovery' : 'password')) {
        throw new VaultError('invalid', recovery ? "That recovery code didn't work. Check it and try again." : "That password didn't work. Try again.");
      }
      return true;
    }),
  );

  handle('vault:documents', (): VaultReply<VaultDocument[]> => reply(() => vault.documents()));
  handle('vault:thumbnail', (id: unknown) => reply(() => (typeof id === 'string' ? vault.thumbnail(id) : null)));

  handle('vault:choose-files', async (purpose: unknown): Promise<OpenResult[]> => {
    const version = purpose === 'version';
    const result = await dialog.showOpenDialog(win(), {
      title: version ? 'Choose the new version' : 'Add PDFs to the Archive',
      properties: version ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF files', extensions: ['pdf'] }],
    });
    if (result.canceled) return [];
    const files: OpenResult[] = [];
    for (const filePath of result.filePaths) files.push(await readPdf(filePath));
    return files;
  });

  handle('vault:add', (items: unknown) =>
    reply(() => {
      if (!Array.isArray(items)) throw new VaultError('invalid', 'There is nothing to add.');
      return (items as NewDocument[]).map((item) => vault.add(item));
    }),
  );

  handle('vault:open', (id: unknown) =>
    reply(() => {
      if (typeof id !== 'string') throw new VaultError('invalid', "That document isn't in the vault.");
      const doc = vault.document(id);
      return { name: doc.fileName, title: doc.title, bytes: vault.read(id) };
    }),
  );

  handle('vault:versions', (id: unknown): VaultReply<VaultVersion[]> => reply(() => vault.versions(String(id))));
  handle('vault:add-version', (id: unknown, item: unknown) =>
    reply(() => {
      if (typeof id !== 'string' || typeof item !== 'object' || item === null) throw new VaultError('invalid', 'There is nothing to add.');
      return vault.addVersion(id, item as NewVersion);
    }),
  );
  handle('vault:open-version', (id: unknown, versionId: unknown) =>
    reply(() => {
      const version = vault.versions(String(id)).find((v) => v.id === versionId);
      if (!version) throw new VaultError('invalid', "That version isn't in the vault.");
      const doc = vault.document(String(id));
      return { name: version.fileName, title: doc.title, number: version.number, bytes: vault.readVersion(version.id) };
    }),
  );
  handle('vault:version-note', (versionId: unknown, note: unknown) => reply(() => vault.versionNote(String(versionId), String(note ?? ''))));

  handle('vault:update', (id: unknown, change: unknown) =>
    reply(() => {
      if (typeof id !== 'string' || typeof change !== 'object' || change === null) throw new VaultError('invalid', 'Nothing to change.');
      const c = change as { title?: unknown; labels?: unknown; note?: unknown };
      return vault.update(id, {
        title: typeof c.title === 'string' ? c.title : undefined,
        labels: Array.isArray(c.labels) ? c.labels.filter((l): l is string => typeof l === 'string') : undefined,
        note: typeof c.note === 'string' ? c.note : undefined,
      });
    }),
  );

  handle('vault:void', (id: unknown, reason: unknown) => reply(() => vault.voidDocument(String(id), String(reason ?? ''))));
  handle('vault:restore-document', (id: unknown) => reply(() => vault.restoreDocument(String(id))));
  /** Erasing for good also removes the document from the backup folder: a new backup without it first, then every older one that has it. */
  handle('vault:erase', async (id: unknown, reason: unknown): Promise<VaultReply<{ backupFolder: boolean }>> => {
    const erased = reply(() => vault.eraseDocument(String(id), String(reason ?? '')));
    if (!erased.ok) return erased;
    const target = store.get().archiveBackupFolder;
    if (!target) return { ok: true, value: { backupFolder: false } };
    // Noted first, so it's removed at the next backup that reaches the folder, if this one can't.
    const tag = vault.tag();
    const s = store.get();
    store.set({ ...s, archiveBackupErased: { ...s.archiveBackupErased, [tag]: [...(s.archiveBackupErased[tag] ?? []), ...erased.value] } });
    const made = await startBackup(target);
    return { ok: true, value: { backupFolder: made.ok && !store.get().archiveBackupErased[tag]?.length } };
  });

  handle('vault:save-copy', async (id: unknown): Promise<SaveResult> => {
    let bytes: Uint8Array;
    let name: string;
    try {
      const doc = vault.document(String(id));
      bytes = vault.read(doc.id);
      name = doc.fileName;
    } catch (error) {
      return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
    const result = await dialog.showSaveDialog(win(), {
      title: 'Save a copy out of the Archive',
      defaultPath: uniquePath(app.getPath('documents'), `${safeFileName(name.replace(/\.pdf$/i, ''))}.pdf`),
      filters: [{ name: 'PDF files', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    const target = path.extname(result.filePath).toLowerCase() === '.pdf' ? result.filePath : `${result.filePath}.pdf`;
    try {
      writeSafely(target, bytes);
      vault.copySaved(String(id));
      return { ok: true, path: target };
    } catch {
      return { ok: false, reason: 'failed', message: `ScribeForge couldn't save ${path.basename(target)}. Check the folder isn't read-only.` };
    }
  });

  handle('vault:history', (): VaultReply<HistoryCheck> => reply(() => vault.history()));

  // Search (stop 3b): the window reads each page's text (it never comes from here, which doesn't read PDFs).
  handle('vault:search', (query: unknown, options: unknown) =>
    reply(() => {
      const o = (typeof options === 'object' && options !== null ? options : {}) as SearchOptions;
      return vault.search(String(query ?? ''), { voided: o.voided === true, label: typeof o.label === 'string' ? o.label : undefined, since: typeof o.since === 'string' ? o.since : undefined });
    }),
  );
  handle('vault:unindexed', () => reply(() => vault.unindexed()));
  handle('vault:index', (entries: unknown) =>
    reply(() => {
      if (!Array.isArray(entries)) throw new VaultError('invalid', 'Nothing to index.');
      vault.indexDocuments(
        entries.filter((e): e is { id: string; pageTexts: string[] } => typeof e?.id === 'string' && Array.isArray(e?.pageTexts)).map((e) => ({ id: e.id, pageTexts: e.pageTexts.map(String) })),
      );
      return true;
    }),
  );
  handle('vault:clear-index', () => reply(() => vault.clearIndex()));
  handle('vault:textless', () => reply(() => vault.textless()));

  handle('vault:save-text', async (suggestedName: unknown, text: unknown): Promise<SaveResult> => {
    if (typeof text !== 'string') return { ok: false, reason: 'failed', message: 'Nothing to save.' };
    const result = await dialog.showSaveDialog(win(), {
      title: 'Save the history',
      defaultPath: uniquePath(app.getPath('documents'), `${safeFileName(String(suggestedName ?? 'history'))}.txt`),
      filters: [{ name: 'Text files', extensions: ['txt'] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    try {
      writeSafely(result.filePath, new TextEncoder().encode(text));
      return { ok: true, path: result.filePath };
    } catch {
      return { ok: false, reason: 'failed', message: `ScribeForge couldn't save ${path.basename(result.filePath)}.` };
    }
  });

  handle('vault:change-password', (current: unknown, next: unknown) => reply(() => vault.changePassword(String(current ?? ''), String(next ?? ''))));
  handle('vault:recovery-code', (password: unknown) => reply(() => vault.makeRecoveryCode(String(password ?? ''))));

  handle('vault:backup', async (): Promise<SaveResult> => {
    if (!vault.unlocked) return { ok: false, reason: 'failed', message: 'The vault is locked.' };
    const result = await dialog.showSaveDialog(win(), {
      title: 'Save a backup of the Archive',
      defaultPath: uniquePath(app.getPath('documents'), `${today()} ScribeForge vault.sfbackup`),
      filters: [{ name: 'ScribeForge vault backups', extensions: ['sfbackup'] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    const target = /\.sfbackup$/i.test(result.filePath) ? result.filePath : `${result.filePath}.sfbackup`;
    try {
      vault.backup(target);
      return { ok: true, path: target };
    } catch (error) {
      if (error instanceof VaultError) return { ok: false, reason: 'failed', message: error.message };
      return { ok: false, reason: 'failed', message: `ScribeForge couldn't save ${path.basename(target)}. Check the folder isn't read-only.` };
    }
  });

  handle('vault:choose-backup', async (): Promise<{ ok: true; name: string } | { ok: false; message?: string }> => {
    pendingBackup = null;
    const result = await dialog.showOpenDialog(win(), {
      title: 'Choose a backup of the Archive',
      properties: ['openFile'],
      filters: [{ name: 'ScribeForge vault backups', extensions: ['sfbackup'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    const file = result.filePaths[0];
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
    } catch {
      return { ok: false, message: "That file couldn't be read." };
    }
    pendingBackup = { file };
    return { ok: true, name: path.basename(file) };
  });

  /** Uses the newest complete backup in a backup folder: the one chosen, or (`own`) the one automatic backups go to. */
  const useFolder = (chosen: string): { ok: true; name: string } | { ok: false; message?: string } => {
    const target = backupFolderFor(chosen);
    if (listSnapshots(target).length === 0) return { ok: false, message: `There are no ScribeForge backups in that folder. Choose the “${FOLDER_NAME}” folder, or the folder it's in.` };
    const found = newestComplete(target);
    if (!found) return { ok: false, message: "The backups in that folder aren't complete yet. If they were made on another PC, they may still be arriving: try again in a few minutes." };
    pendingBackup = { folder: target, snapshot: found.snapshot.name, waiting: found.waiting };
    return { ok: true, name: 'The newest complete backup in the backup folder' };
  };
  handle('vault:choose-backup-folder', async (): Promise<{ ok: true; name: string } | { ok: false; message?: string }> => {
    pendingBackup = null;
    const result = await dialog.showOpenDialog(win(), { title: 'Choose a backup folder', properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    return useFolder(result.filePaths[0]);
  });
  handle('vault:use-backup-folder', (): { ok: true; name: string } | { ok: false; message?: string } => {
    pendingBackup = null;
    const target = store.get().archiveBackupFolder;
    return target ? useFolder(target) : { ok: false };
  });

  /** Checks the chosen backup with its password or recovery code; with `restore`, then replaces the vault with it. */
  handle('vault:restore-backup', async (secret: unknown, kind: unknown, restore: unknown) => {
    // A backup still being copied into the backup folder finishes first: restoring replaces the files it copies from.
    if (restore === true) await queue;
    return reply((): BackupCheck => {
      const source = pendingBackup;
      if (!source) throw new VaultError('invalid', 'Choose a backup first.');
      const result = vault.restoreBackup(source, String(secret ?? ''), kind === 'recovery' ? 'recovery' : 'password', restore !== true);
      if (restore !== true) return { ...result, ...('folder' in source ? { waiting: source.waiting, folder: source.folder } : {}) };
      pendingBackup = null;
      // Restored from a backup folder: the vault is as that backup left it, so there's nothing new to back up.
      if ('folder' in source) remember(vault.tag(), new Date(result.created), vault.state());
      return { ...result, ...('folder' in source ? { folder: source.folder } : {}) };
    });
  });

  // Automatic backups: where, how many, and now.
  handle('vault:backup-status', backupStatus);
  handle('vault:backup-places', () => backupPlaces());
  handle('vault:choose-backup-place', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(win(), { title: 'Choose where to keep backups', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });
  /** Turns automatic backups on, into a backup folder in (or at) `chosen`, and makes the first backup. */
  handle('vault:backup-on', async (chosen: unknown): Promise<VaultReply<BackupStatus>> => {
    if (typeof chosen !== 'string' || !path.isAbsolute(chosen) || !existsSync(chosen)) return { ok: false, locked: false, message: "That folder isn't there." };
    const target = backupFolderFor(chosen);
    const inside = (a: string, b: string) => samePath(a, b) || path.resolve(a).toLowerCase().startsWith(`${path.resolve(b).toLowerCase()}${path.sep}`);
    if (inside(target, path.dirname(folder)) || inside(path.dirname(folder), target)) {
      return { ok: false, locked: false, message: "Backups can't go in ScribeForge's own data folder. Choose a folder that OneDrive or Google Drive syncs, or a USB drive." };
    }
    if (!vault.unlocked) return { ok: false, locked: true, message: 'The vault is locked.' };
    store.set({ ...store.get(), archiveBackupFolder: target });
    // Just restored from this folder: it already has the vault as it is.
    const saved = store.get().archiveBackupState[vault.tag()];
    if (saved?.state === vault.state() && listSnapshots(target).some((x) => x.vault === vault.tag())) return { ok: true, value: backupStatus() };
    const result = await startBackup(target);
    if (!result.ok) return { ok: false, locked: false, message: result.message };
    return { ok: true, value: backupStatus() };
  });
  handle('vault:backup-off', (): BackupStatus => {
    store.set({ ...store.get(), archiveBackupFolder: '' });
    return backupStatus();
  });
  handle('vault:backup-keep', (keep: unknown): BackupStatus => {
    if (BACKUP_KEEP.includes(keep as BackupKeep)) store.set({ ...store.get(), archiveBackupKeep: keep as BackupKeep });
    return backupStatus();
  });
  handle('vault:backup-now', async (): Promise<VaultReply<BackupStatus>> => {
    const target = store.get().archiveBackupFolder;
    if (!target) return { ok: false, locked: false, message: 'Automatic backups are off.' };
    if (!vault.unlocked) return { ok: false, locked: true, message: 'The vault is locked.' };
    const result = await startBackup(target);
    if (!result.ok) return { ok: false, locked: false, message: result.message };
    return { ok: true, value: backupStatus() };
  });
  ipcMain.on('vault:forget-backup', () => {
    pendingBackup = null;
  });

  return { lock };
}
