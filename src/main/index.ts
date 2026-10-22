import { isTrial, dataDir } from './paths';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppInfo, SettingsChange } from '../shared/api';
import { isOpenableLink } from '../shared/links';
import { applyChange } from '../shared/settings';
import { presetFor } from '../shared/themes';
import { clearRecent, forgetRecent, openManyWithDialog, openPath, openWithDialog, recentFiles } from './files';
import { saveBeside, saveManyWithDialog, saveWithDialog } from './save';
import { commandWords } from './cli/args';
import { runCli } from './cli/main';
import { buildMenu } from './menu';
import { APP_ORIGIN, blockNetwork, registerAppScheme, serveApp } from './network';
import { isTestWindow, placeAndShow } from './placement';
import { SettingsStore } from './settingsStore';

const here = import.meta.dirname;
const rendererDir = path.join(here, '../renderer');
const devServer = process.env.ELECTRON_RENDERER_URL;

let store: SettingsStore;
let mainWindow: BrowserWindow | null = null;
/** Page changes not saved yet: closing the window asks first. */
let unsaved = false;

function createWindow(): BrowserWindow {
  const settings = store.get();
  const preset = presetFor(settings.theme, nativeTheme.shouldUseDarkColors);
  const devIcon = path.join(here, '../../build/icon.png');
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: isTrial ? 'ScribeForge (trial)' : 'ScribeForge',
    backgroundColor: preset.tokens.bg,
    icon: existsSync(devIcon) ? devIcon : undefined,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  });

  // Keep "ScribeForge (trial)" in the title bar; the page's own title would replace it.
  win.on('page-title-updated', (event) => event.preventDefault());

  win.on('close', (event) => {
    if (!unsaved) return;
    event.preventDefault();
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: 'Unsaved changes',
        message: 'You have changes to pages, annotations, details or redaction marks that aren\'t saved yet.',
        detail: 'If you close ScribeForge now, they are lost. To keep them, choose Keep editing, then Save as new file.',
        buttons: ['Close without saving', 'Keep editing'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          unsaved = false;
          win.close();
        }
      });
  });

  // The window only ever shows ScribeForge's own screens.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const ownScreens = url.startsWith(`${APP_ORIGIN}/`) || (devServer !== undefined && url.startsWith(devServer));
    if (!ownScreens) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  buildMenu(win);
  placeAndShow(win);
  if (devServer) void win.loadURL(devServer);
  else void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

function registerHandlers(): void {
  const win = () => {
    if (!mainWindow) throw new Error('No window');
    return mainWindow;
  };
  ipcMain.handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    trial: isTrial,
    settingsNotice: store.notice,
  }));
  ipcMain.handle('settings:get', () => store.get());
  ipcMain.handle('settings:change', (_e, change: SettingsChange) => {
    const next = store.set(applyChange(store.get(), change ?? {}));
    if (change?.theme !== undefined) {
      win().setBackgroundColor(presetFor(next.theme, nativeTheme.shouldUseDarkColors).tokens.bg);
    }
    return next;
  });
  ipcMain.handle('file:open-dialog', () => openWithDialog(win(), store));
  ipcMain.handle('file:open-path', (_e, filePath: string) => openPath(filePath, store));
  ipcMain.handle('file:open-many', () => openManyWithDialog(win(), store));
  ipcMain.handle('file:save', (_e, request) => saveWithDialog(win(), request));
  ipcMain.handle('file:save-many', (_e, request) => saveManyWithDialog(win(), request));
  ipcMain.handle('file:save-beside', (_e, request) => saveBeside(request));
  ipcMain.on('doc:unsaved', (_e, value: unknown) => {
    unsaved = value === true;
  });
  ipcMain.handle('recent:list', () => recentFiles(store));
  ipcMain.handle('recent:remove', (_e, filePath: string) => forgetRecent(store, filePath));
  ipcMain.handle('recent:clear', () => clearRecent(store));
  // The screens ask the person first; this only checks the address is a safe kind.
  ipcMain.handle('link:open', async (_e, address: string) => {
    if (typeof address !== 'string' || !isOpenableLink(address)) return false;
    await shell.openExternal(address);
    return true;
  });
}

// Started with a command (scribeforge merge ...): run it and exit, without the app's window.
const words = commandWords(process.argv, process.defaultApp === true);

// Otherwise one ScribeForge window per data folder. Test runs each have their own folder.
const onlyInstance = words !== null || isTestWindow() || app.requestSingleInstanceLock();
if (words !== null) {
  runCli(words, rendererDir, devServer);
} else if (!onlyInstance) {
  app.quit();
} else {
  registerAppScheme();

  app.whenReady().then(() => {
    store = new SettingsStore(dataDir());
    blockNetwork(rendererDir, devServer);
    serveApp(rendererDir);
    registerHandlers();
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => app.quit());
}
