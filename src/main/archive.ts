// The Archive, the main process's part (docs/Plan_Phase3.md): the vault lives here, with its key,
// and the screens ask for what they need. PDFs are never read here: the screens send the page
// count, title and a small picture of the first page with each PDF they add.
//
// The vault locks when ScribeForge starts (it's never unlocked until asked), after the time set in
// Settings without using ScribeForge, when Windows locks, when the PC sleeps, and with Lock. The
// screens are told, so they close anything opened from the vault.
import { app, dialog, ipcMain, powerMonitor, type BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { safeFileName } from '../engine/names';
import type { OpenResult, SaveResult } from '../shared/api';
import type { HistoryCheck, NewDocument, VaultDocument, VaultReply, VaultStatus } from '../shared/vault';
import { uniquePath, writeSafely } from './fileWrite';
import { readPdf } from './files';
import type { SettingsStore } from './settingsStore';
import { Vault, VaultError } from './vault/vault';

const MAX_BACKUP = 4 * 1024 * 1024 * 1024;

function reply<T>(work: () => T): VaultReply<T> {
  try {
    return { ok: true, value: work() };
  } catch (error) {
    if (error instanceof VaultError) return { ok: false, locked: error.kind === 'locked', message: error.message };
    return { ok: false, locked: false, message: `Something went wrong in the vault: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export function registerArchive(win: () => BrowserWindow, store: SettingsStore, folder: string): { lock: (why: string) => void } {
  const vault = new Vault(folder);
  let lastUse = Date.now();
  /** A backup chosen for restoring, kept here (still encrypted) until it's checked and restored or cancelled. */
  let pendingBackup: Uint8Array | null = null;

  const lock = (why: string) => {
    if (!vault.unlocked) return;
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
  app.on('before-quit', () => {
    clearInterval(timer);
    vault.lock();
  });

  const status = (): VaultStatus => {
    const exists = vault.exists();
    let hasRecoveryCode = false;
    try {
      hasRecoveryCode = exists && vault.hasRecoveryCode();
    } catch {
      // A damaged key file: unlocking says so.
    }
    return { exists, unlocked: vault.unlocked, hasRecoveryCode, ...(vault.unlocked ? vault.size() : {}) };
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

  handle('vault:choose-files', async (): Promise<OpenResult[]> => {
    const result = await dialog.showOpenDialog(win(), {
      title: 'Add PDFs to the Archive',
      properties: ['openFile', 'multiSelections'],
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
  handle('vault:erase', (id: unknown, reason: unknown) => reply(() => vault.eraseDocument(String(id), String(reason ?? ''))));

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
    let bytes: Uint8Array;
    try {
      bytes = vault.backup();
    } catch (error) {
      return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
    const result = await dialog.showSaveDialog(win(), {
      title: 'Save a backup of the Archive',
      defaultPath: uniquePath(app.getPath('documents'), `${today()} ScribeForge vault.sfbackup`),
      filters: [{ name: 'ScribeForge vault backups', extensions: ['sfbackup'] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    const target = /\.sfbackup$/i.test(result.filePath) ? result.filePath : `${result.filePath}.sfbackup`;
    try {
      writeSafely(target, bytes);
      return { ok: true, path: target };
    } catch {
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
    try {
      const bytes = new Uint8Array(await readFile(result.filePaths[0]));
      if (bytes.length > MAX_BACKUP) return { ok: false, message: 'That file is too large to be a ScribeForge backup.' };
      pendingBackup = bytes;
      return { ok: true, name: path.basename(result.filePaths[0]) };
    } catch {
      return { ok: false, message: "That file couldn't be read." };
    }
  });

  /** Checks the chosen backup with its password or recovery code; with `restore`, then replaces the vault with it. */
  handle('vault:restore-backup', (secret: unknown, kind: unknown, restore: unknown) =>
    reply(() => {
      if (!pendingBackup) throw new VaultError('invalid', 'Choose a backup first.');
      const result = vault.restoreBackup(pendingBackup, String(secret ?? ''), kind === 'recovery' ? 'recovery' : 'password', restore !== true);
      if (restore === true) pendingBackup = null;
      return result;
    }),
  );
  ipcMain.on('vault:forget-backup', () => {
    pendingBackup = null;
  });

  return { lock };
}
