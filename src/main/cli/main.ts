// Command-line mode: ScribeForge.exe started with a command (through scribeforge.cmd) runs it and
// exits, without opening the app's window. It has the same network blocking as the app. A window
// appears only to ask for a password; redacted pages are drawn in a hidden window, with the same
// code the app uses. Its working data goes in a temporary folder that's removed afterwards, so it
// never touches the app's settings and can run while the app is open.
import { app, BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { mkdtempSync, readdirSync, readSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RenderJob, RenderResult } from '../../shared/cli';
import { APP_ORIGIN, blockedRequests, blockNetwork, registerAppScheme, serveApp } from '../network';
import { placeAndShow } from '../placement';
import { parseCommand } from './args';
import { CliError, EXIT, firstLineOf, runCommand, type CliIo } from './run';
import { windowsRoots } from '../sign/windowsTrust';

const here = import.meta.dirname;

interface WindowInfo {
  mode: 'render' | 'password';
  fileName: string;
  retry: boolean;
}

/** What each of the tool's windows is for, asked for by its preload script. */
const windows = new Map<number, WindowInfo>();

function openWindow(info: WindowInfo, devServer: string | undefined): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 290,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'ScribeForge',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/cli.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false,
      // The hidden window must keep drawing although it's never shown.
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  windows.set(win.webContents.id, info);
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  void win.loadURL(devServer ? `${devServer.replace(/\/$/, '')}/cli.html` : `${APP_ORIGIN}/cli.html`);
  return win;
}

/** Waits for one message on `channel` from this window, or for the window to go away. */
function fromWindow<T>(win: BrowserWindow, channel: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const contents: WebContents = win.webContents;
    const onMessage = (event: IpcMainEvent, value: T) => {
      if (event.sender !== contents) return;
      done(value);
    };
    const onGone = () => done(undefined);
    const done = (value: T | undefined) => {
      ipcMain.removeListener(channel, onMessage);
      win.removeListener('closed', onGone);
      if (!contents.isDestroyed()) contents.removeListener('render-process-gone', onGone);
      resolve(value);
    };
    ipcMain.on(channel, onMessage);
    win.once('closed', onGone);
    contents.once('render-process-gone', onGone);
  });
}

function askPassword(fileName: string, retry: boolean, devServer: string | undefined): Promise<string | null> {
  const win = openWindow({ mode: 'password', fileName, retry }, devServer);
  win.setTitle('ScribeForge: password');
  placeAndShow(win);
  return fromWindow<string | null>(win, 'cli:password').then((password) => {
    if (!win.isDestroyed()) win.destroy();
    return typeof password === 'string' ? password : null;
  });
}

async function render(job: RenderJob, devServer: string | undefined): Promise<RenderResult> {
  const win = openWindow({ mode: 'render', fileName: '', retry: false }, devServer);
  try {
    const ready = await fromWindow<void>(win, 'cli:ready').then(() => !win.isDestroyed());
    if (!ready) throw new CliError(EXIT.file, "The pages couldn't be drawn for redacting.");
    const answer = fromWindow<RenderResult | { error: string }>(win, 'cli:result');
    win.webContents.send('cli:job', job);
    const result = await answer;
    if (!result || 'error' in result) throw new CliError(EXIT.file, "The pages couldn't be drawn for redacting. The file may be damaged.");
    return result;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Waits until everything written to the console has gone out. */
const flush = (stream: NodeJS.WriteStream) => new Promise<void>((resolve) => stream.write('', () => resolve()));

/**
 * The first line of standard input, or null when there isn't one. Read directly: Electron's
 * main process on Windows doesn't deliver standard input as a stream.
 */
async function firstLine(): Promise<string | null> {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(4096);
  try {
    for (;;) {
      const n = readSync(0, buffer, 0, buffer.length, null);
      if (n === 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, n)));
      if (buffer.subarray(0, n).includes(10)) break;
    }
  } catch {
    // No standard input at all (or it's closed): the same as an empty one.
  }
  return firstLineOf(Buffer.concat(chunks).toString('utf8'));
}

const PREFIX = 'scribeforge-cli-';

/**
 * Removes working folders that earlier runs couldn't remove (Electron keeps some files open until
 * the moment it exits). A folder still in use by a run can't be renamed, so it's left alone; so are
 * folders less than a minute old, in case their run hasn't opened its files yet.
 */
function removeLeftovers(): void {
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      const full = path.join(tmpdir(), name);
      try {
        if (Date.now() - statSync(full).birthtimeMs < 60_000) continue;
        const moved = name.endsWith('-old') ? full : `${full}-old`;
        if (moved !== full) renameSync(full, moved);
        rmSync(moved, { recursive: true, force: true });
      } catch {
        // In use, or already being removed by another run.
      }
    }
  } catch {
    // The temporary folder can't be listed; nothing to tidy.
  }
}

/** Runs the command given by `words` and exits with its code. Called before the app is ready. */
export function runCli(words: string[], rendererDir: string, devServer: string | undefined): void {
  removeLeftovers();
  // By its full name: Windows can give the temporary folder a short one (such as RUNNER~1), which
  // Chromium's caches can't use, and it says so on standard error (seen on GitHub's machines).
  const temp = realpathSync.native(mkdtempSync(path.join(tmpdir(), PREFIX)));
  app.setPath('userData', temp);
  // Only ScribeForge's own messages go to the command line, never Chromium's log lines.
  app.commandLine.appendSwitch('log-level', '3');
  app.disableHardwareAcceleration();
  registerAppScheme();
  // Windows come and go (the password window, the hidden one); the tool exits only when it's done.
  app.on('window-all-closed', () => undefined);
  ipcMain.on('cli:window', (event) => {
    event.returnValue = windows.get(event.sender.id) ?? { mode: 'render', fileName: '', retry: false };
  });

  const finish = async (code: number) => {
    if (blockedRequests.length > 0) {
      process.stderr.write(`Note: ScribeForge stopped ${blockedRequests.length} attempt(s) to reach the network. It never uses the network.\n`);
    }
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    await Promise.all([flush(process.stdout), flush(process.stderr)]);
    try {
      rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Something still has a file open in it. It's only working data, in Windows' temporary folder.
    }
    app.exit(code);
  };

  void app.whenReady().then(async () => {
    blockNetwork(rendererDir, devServer);
    serveApp(rendererDir);
    const parsed = parseCommand(words);
    let code: number;
    if (!parsed.ok) {
      process.stderr.write(`${parsed.error}\n`);
      process.stderr.write(parsed.topic ? `Type "scribeforge help ${parsed.topic}" to see how to use it.\n` : 'Type "scribeforge help" to see the commands.\n');
      code = EXIT.command;
    } else {
      const io: CliIo = {
        cwd: process.cwd(),
        version: app.getVersion(),
        out: (line) => void process.stdout.write(`${line}\n`),
        err: (line) => void process.stderr.write(`${line}\n`),
        stdinLine: firstLine,
        askPassword: (fileName, retry) => askPassword(fileName, retry, devServer),
        render: (job) => render(job, devServer),
        windowsTrust: windowsRoots,
      };
      code = await runCommand(parsed.command, io);
    }
    await finish(code);
  });
}

