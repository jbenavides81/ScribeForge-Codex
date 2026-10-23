import type { CertificateSummary, TrustAnchor } from '../engine/sign/types';
import type { RedactionDpi, Settings, TextSize } from './settings';
import type { HistoryCheck, NewDocument, VaultDocument, VaultLockMinutes, VaultReply, VaultStatus } from './vault';
import type { ThemeId } from './themes';

/** A file the main process read for the screens. */
export interface OpenedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export type OpenResult =
  | { ok: true; file: OpenedFile }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'not-found' | 'not-pdf' | 'too-large' | 'unreadable'; path: string };

export interface RecentFile {
  path: string;
  name: string;
  folder: string;
  exists: boolean;
}

export interface AppInfo {
  version: string;
  trial: boolean;
  settingsNotice: string | null;
}

export type SettingsChange = Partial<{
  theme: ThemeId;
  textSize: TextSize;
  rememberRecent: boolean;
  authorName: string;
  reviewBeforeSave: boolean;
  redactionDpi: RedactionDpi;
  vaultLockMinutes: VaultLockMinutes;
}>;

export interface SaveRequest {
  bytes: Uint8Array;
  suggestedName: string;
  /** The files the pages came from: the dialog starts in their folder, and replacing one asks first. */
  sourcePaths: string[];
}

export type SaveResult = { ok: true; path: string } | { ok: false; reason: 'cancelled' | 'failed'; message?: string };

/** A text file saved next to a PDF just saved, such as a redaction log. */
export interface SaveBesideRequest {
  /** The PDF it goes with: one saved through the save window in this session. */
  pdfPath: string;
  /** Added to the PDF's name: "report (redacted)" becomes "report (redacted) (redaction log).txt". */
  suffix: string;
  text: string;
}

export interface SaveManyRequest {
  files: { name: string; bytes: Uint8Array }[];
  sourcePaths: string[];
}

export type SaveManyResult =
  | { ok: true; folder: string; paths: string[] }
  | { ok: false; reason: 'cancelled' | 'failed'; message?: string };

/** A certificate file for signing, by where it is. */
export interface CertificateFileInfo {
  path: string;
  name: string;
  exists: boolean;
}

export type UnlockResult =
  | { ok: true; certificate: CertificateSummary; /** Size of the certificates, to keep room for the signature. */ certificateBytes: number }
  | { ok: false; reason: 'wrong-password' | 'old-format' | 'no-key' | 'unsupported' | 'unreadable' | 'not-found' };

export type SignDigestResult = { ok: true; signature: Uint8Array } | { ok: false; message: string };

/** Who ScribeForge trusts when checking signatures: Windows' certificates and the person's own list. */
export interface TrustList {
  anchors: TrustAnchor[];
  /** The person's own list, described. */
  mine: CertificateSummary[];
}

export interface MakeCertificateRequest {
  name: string;
  email: string;
  password: string;
}

export type MakeCertificateResult = { ok: true; path: string } | { ok: false; reason: 'cancelled' | 'failed'; message?: string };

export type MenuCommand =
  | 'open'
  | 'save'
  | 'close-document'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit-width'
  | 'zoom-fit-page'
  | 'find'
  | 'toggle-thumbnails'
  | 'show-pages'
  | 'show-details'
  | 'show-cleanup'
  | 'show-sign'
  | 'show-archive'
  | 'show-settings'
  | 'show-about'
  | 'show-help';

/** What the preload script makes available to the screens as `window.scribeforge`. */
export interface ScribeForgeApi {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  changeSettings(change: SettingsChange): Promise<Settings>;
  openDialog(): Promise<OpenResult>;
  openPath(path: string): Promise<OpenResult>;
  /** Choose several PDFs to add (merge). An empty list if cancelled. */
  openMany(): Promise<OpenResult[]>;
  saveFile(request: SaveRequest): Promise<SaveResult>;
  saveFiles(request: SaveManyRequest): Promise<SaveManyResult>;
  /** Saves a text file next to a PDF just saved; never replaces a file. */
  saveBeside(request: SaveBesideRequest): Promise<SaveResult>;
  /** Tells the app there are page changes not saved yet, so closing the window asks first. */
  setUnsaved(unsaved: boolean): void;
  pathForFile(file: File): string;
  recentFiles(): Promise<RecentFile[]>;
  removeRecent(path: string): Promise<RecentFile[]>;
  clearRecent(): Promise<RecentFile[]>;
  openLink(address: string): Promise<boolean>;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  /** The certificate file remembered for signing, if any. */
  rememberedCertificate(): Promise<CertificateFileInfo | null>;
  /** Choose a certificate file (.pfx, .p12). Null if cancelled. */
  chooseCertificate(): Promise<CertificateFileInfo | null>;
  /** Opens the certificate file with its password, ready to sign. The password is never saved. */
  unlockCertificate(path: string, password: string): Promise<UnlockResult>;
  /** Signs the fingerprint (SHA-256) of a prepared file with the certificate opened last, then closes it. */
  signDigest(digest: Uint8Array): Promise<SignDigestResult>;
  /** Closes the certificate without signing. */
  forgetCertificate(): void;
  trustList(): Promise<TrustList>;
  /** Adds a certificate (DER, base64) to the person's own trusted list. The screen asks first. */
  trustCertificate(der: string): Promise<TrustList>;
  untrustCertificate(der: string): Promise<TrustList>;
  /** Makes a certificate in the person's name and saves it where they choose. */
  makeCertificate(request: MakeCertificateRequest): Promise<MakeCertificateResult>;

  // The Archive's vault (docs/Plan_Phase3.md). Passwords and recovery codes are never saved.
  vaultStatus(): Promise<VaultStatus>;
  /** Makes the vault and leaves it unlocked; the recovery code, if asked for (shown once). */
  vaultCreate(password: string, withRecoveryCode: boolean): Promise<VaultReply<string | null>>;
  vaultUnlock(secret: string, kind: 'password' | 'recovery'): Promise<VaultReply<boolean>>;
  vaultLock(): void;
  /** The person is using ScribeForge: the vault's idle time starts again. */
  vaultActive(): void;
  vaultDocuments(): Promise<VaultReply<VaultDocument[]>>;
  vaultThumbnail(id: string): Promise<VaultReply<Uint8Array | null>>;
  /** Choose PDFs to add (read, not added to the recent files). */
  vaultChooseFiles(): Promise<OpenResult[]>;
  vaultAdd(items: NewDocument[]): Promise<VaultReply<VaultDocument[]>>;
  /** A stored document's PDF, decrypted into memory. */
  vaultOpen(id: string): Promise<VaultReply<{ name: string; title: string; bytes: Uint8Array }>>;
  vaultUpdate(id: string, change: { title?: string; labels?: string[]; note?: string }): Promise<VaultReply<VaultDocument>>;
  vaultVoid(id: string, reason: string): Promise<VaultReply<VaultDocument>>;
  vaultRestoreDocument(id: string): Promise<VaultReply<VaultDocument>>;
  vaultErase(id: string, reason: string): Promise<VaultReply<void>>;
  vaultSaveCopy(id: string): Promise<SaveResult>;
  vaultHistory(): Promise<VaultReply<HistoryCheck>>;
  /** Saves text (the history) where the person chooses. */
  vaultSaveText(suggestedName: string, text: string): Promise<SaveResult>;
  vaultChangePassword(current: string, next: string): Promise<VaultReply<void>>;
  /** Makes a new recovery code (the password is asked for first); the old one stops working. */
  vaultRecoveryCode(password: string): Promise<VaultReply<string>>;
  vaultBackup(): Promise<SaveResult>;
  vaultChooseBackup(): Promise<{ ok: true; name: string } | { ok: false; message?: string }>;
  /** Checks the chosen backup with its password or recovery code, and with `restore`, replaces the vault with it. */
  vaultRestoreBackup(secret: string, kind: 'password' | 'recovery', restore: boolean): Promise<VaultReply<{ created: string; documents: number }>>;
  vaultForgetBackup(): void;
  /** Called when the vault locks: idle, Windows locked, sleep or the Lock button. */
  onVaultLocked(listener: (why: string) => void): () => void;
}

/** Largest file ScribeForge will open. */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
