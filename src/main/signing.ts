// Signing, the main process's part (docs/Plan_Sign.md, section 6). The certificate file and its
// password are handled only here, where PDFs are never read. The screens get the certificate's
// description, then send the fingerprint of the prepared file, and get back only the signature.
// The key is kept in memory between those two steps, for ten minutes at most, and dropped as soon
// as the signature is made or the person cancels. Passwords are never saved.
import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { KeyObject } from 'node:crypto';
import type * as pkijs from 'pkijs';
import type { CertificateFileInfo, MakeCertificateRequest, MakeCertificateResult, SignDigestResult, TrustList, UnlockResult } from '../shared/api';
import { MAX_TRUSTED } from '../shared/settings';
import { certificateDer, fromBase64, parseCertificate, summarise, toBase64 } from '../engine/sign/certificate';
import { safeFileName } from '../engine/names';
import { samePath, uniquePath, writeSafely } from './fileWrite';
import { makeOwnCertificate } from './sign/makeCertificate';
import { CertificateFileError, readPfx, writePfx } from './sign/pfx';
import { makeSignature } from './sign/signer';
import { windowsRoots } from './sign/windowsTrust';
import type { SettingsStore } from './settingsStore';

/** Largest certificate file read: they're a few kilobytes. */
const MAX_CERTIFICATE_FILE = 1024 * 1024;
const KEEP_KEY_FOR = 10 * 60 * 1000;
const MIN_PASSWORD = 8;

let unlocked: { key: KeyObject; chain: pkijs.Certificate[]; timer: NodeJS.Timeout } | null = null;
/** Certificate files chosen in this session: the only ones that can be opened (besides the remembered one). */
const chosen = new Set<string>();

function forget(): void {
  if (unlocked) clearTimeout(unlocked.timer);
  unlocked = null;
}

function fileInfo(filePath: string): CertificateFileInfo | null {
  if (!filePath) return null;
  return { path: filePath, name: path.basename(filePath), exists: existsSync(filePath) };
}

function remember(store: SettingsStore, filePath: string): void {
  chosen.add(path.resolve(filePath).toLowerCase());
  const settings = store.get();
  if (settings.rememberRecent) store.set({ ...settings, certificateFile: filePath });
}

async function trustList(store: SettingsStore): Promise<TrustList> {
  const mine = store.get().trustedCertificates;
  const summaries = [];
  for (const der of mine) {
    try {
      summaries.push(await summarise(parseCertificate(fromBase64(der))));
    } catch {
      // Unreadable: left out of the list shown (it can't vouch for anything either).
    }
  }
  return {
    anchors: [...mine.map((der) => ({ der, source: 'mine' as const })), ...windowsRoots().map((der) => ({ der, source: 'windows' as const }))],
    mine: summaries,
  };
}

const unlockMessage: Record<CertificateFileError['problem'], UnlockResult> = {
  'wrong-password': { ok: false, reason: 'wrong-password' },
  'old-format': { ok: false, reason: 'old-format' },
  'no-key': { ok: false, reason: 'no-key' },
  unsupported: { ok: false, reason: 'unsupported' },
  unreadable: { ok: false, reason: 'unreadable' },
};

export function registerSigning(win: () => BrowserWindow, store: SettingsStore): void {
  ipcMain.handle('sign:remembered', (): CertificateFileInfo | null => fileInfo(store.get().certificateFile));

  ipcMain.handle('sign:choose', async (): Promise<CertificateFileInfo | null> => {
    const result = await dialog.showOpenDialog(win(), {
      title: 'Choose your certificate file',
      properties: ['openFile'],
      filters: [{ name: 'Certificate files', extensions: ['pfx', 'p12'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    remember(store, result.filePaths[0]);
    return fileInfo(result.filePaths[0]);
  });

  ipcMain.handle('sign:unlock', async (_e, filePath: unknown, password: unknown): Promise<UnlockResult> => {
    forget();
    if (typeof filePath !== 'string' || typeof password !== 'string') return { ok: false, reason: 'unreadable' };
    const allowed = chosen.has(path.resolve(filePath).toLowerCase()) || (store.get().certificateFile !== '' && samePath(store.get().certificateFile, filePath));
    if (!allowed) return { ok: false, reason: 'unreadable' };
    if (!existsSync(filePath)) return { ok: false, reason: 'not-found' };
    let bytes: Uint8Array;
    try {
      if (statSync(filePath).size > MAX_CERTIFICATE_FILE) return { ok: false, reason: 'unreadable' };
      bytes = new Uint8Array(await readFile(filePath));
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    try {
      const { key, chain } = await readPfx(bytes, password);
      unlocked = { key, chain, timer: setTimeout(forget, KEEP_KEY_FOR) };
      return { ok: true, certificate: await summarise(chain[0]), certificateBytes: chain.reduce((n, c) => n + certificateDer(c).length, 0) };
    } catch (error) {
      return error instanceof CertificateFileError ? unlockMessage[error.problem] : { ok: false, reason: 'unreadable' };
    }
  });

  ipcMain.handle('sign:sign', (_e, digest: unknown): SignDigestResult => {
    if (!unlocked) return { ok: false, message: 'The certificate was closed (after ten minutes, or when signing was cancelled). Start again.' };
    if (!(digest instanceof Uint8Array) || digest.length !== 32) return { ok: false, message: 'The file to sign was not prepared properly.' };
    try {
      return { ok: true, signature: makeSignature(digest, unlocked.key, unlocked.chain) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      forget();
    }
  });

  ipcMain.on('sign:forget', () => forget());

  ipcMain.handle('sign:trust-list', () => trustList(store));

  ipcMain.handle('sign:trust-add', async (_e, der: unknown): Promise<TrustList> => {
    if (typeof der === 'string') {
      try {
        // Read and written again, so only a real certificate is ever kept.
        const clean = toBase64(certificateDer(parseCertificate(fromBase64(der))));
        const settings = store.get();
        if (!settings.trustedCertificates.includes(clean) && settings.trustedCertificates.length < MAX_TRUSTED) {
          store.set({ ...settings, trustedCertificates: [...settings.trustedCertificates, clean] });
        }
      } catch {
        // Not a certificate: nothing to trust.
      }
    }
    return trustList(store);
  });

  ipcMain.handle('sign:trust-remove', async (_e, der: unknown): Promise<TrustList> => {
    const settings = store.get();
    if (typeof der === 'string') store.set({ ...settings, trustedCertificates: settings.trustedCertificates.filter((d) => d !== der) });
    return trustList(store);
  });

  ipcMain.handle('sign:make', async (_e, request: MakeCertificateRequest): Promise<MakeCertificateResult> => {
    const name = typeof request?.name === 'string' ? request.name.replace(/\p{Cc}+/gu, ' ').trim().slice(0, 100) : '';
    const email = typeof request?.email === 'string' ? request.email.trim().slice(0, 200) : '';
    const password = typeof request?.password === 'string' ? request.password : '';
    if (!name) return { ok: false, reason: 'failed', message: 'Type the name to put on the certificate.' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'failed', message: "That email address doesn't look right." };
    if (password.length < MIN_PASSWORD) return { ok: false, reason: 'failed', message: `The password needs at least ${MIN_PASSWORD} characters.` };
    const result = await dialog.showSaveDialog(win(), {
      title: 'Save your new certificate file',
      defaultPath: uniquePath(app.getPath('documents'), `${safeFileName(name)}.pfx`),
      filters: [{ name: 'Certificate files', extensions: ['pfx'] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    let target = result.filePath;
    if (!/\.(pfx|p12)$/i.test(target)) target = `${target}.pfx`;
    try {
      const { key, cert } = makeOwnCertificate({ name, email: email || undefined });
      writeSafely(target, await writePfx(key, [cert], password, name));
      remember(store, target);
      return { ok: true, path: target };
    } catch {
      return { ok: false, reason: 'failed', message: `ScribeForge couldn't save ${path.basename(target)}. Check the folder isn't read-only.` };
    }
  });
}
