import type { Settings, TextSize } from './settings';
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

export type SettingsChange = Partial<{ theme: ThemeId; textSize: TextSize; rememberRecent: boolean; authorName: string }>;

export interface SaveRequest {
  bytes: Uint8Array;
  suggestedName: string;
  /** The files the pages came from: the dialog starts in their folder, and replacing one asks first. */
  sourcePaths: string[];
}

export type SaveResult = { ok: true; path: string } | { ok: false; reason: 'cancelled' | 'failed'; message?: string };

export interface SaveManyRequest {
  files: { name: string; bytes: Uint8Array }[];
  sourcePaths: string[];
}

export type SaveManyResult =
  | { ok: true; folder: string; paths: string[] }
  | { ok: false; reason: 'cancelled' | 'failed'; message?: string };

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
  | 'show-settings'
  | 'show-about';

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
  /** Tells the app there are page changes not saved yet, so closing the window asks first. */
  setUnsaved(unsaved: boolean): void;
  pathForFile(file: File): string;
  recentFiles(): Promise<RecentFile[]>;
  removeRecent(path: string): Promise<RecentFile[]>;
  clearRecent(): Promise<RecentFile[]>;
  openLink(address: string): Promise<boolean>;
  onMenu(listener: (command: MenuCommand) => void): () => void;
}

/** Largest file ScribeForge will open. */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
