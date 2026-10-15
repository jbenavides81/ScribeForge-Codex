import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const FIXTURES = path.join(ROOT, 'tests/fixtures/out');
export const SCREENS = path.join(ROOT, 'test-results/screens');
export const PACKAGED_EXE = path.join(ROOT, 'release/win-unpacked/ScribeForge.exe');
export const VERSION: string = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

export interface Running {
  app: ElectronApplication;
  win: Page;
  userData: string;
}

/**
 * Starts ScribeForge with its own throwaway data folder. The window opens on the left-most
 * monitor without taking keyboard focus.
 */
export async function launch(project: string, userData?: string, extraEnv: Record<string, string> = {}): Promise<Running> {
  const data = userData ?? mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RENDERER_URL;
  delete env.SCRIBEFORGE_TRIAL;
  Object.assign(env, extraEnv);
  // Always last: a test run never uses the real or trial data folders.
  env.SCRIBEFORGE_USER_DATA = data;
  env.SCRIBEFORGE_TEST_WINDOW = 'left';
  const app =
    project === 'packaged'
      ? await electron.launch({ executablePath: PACKAGED_EXE, env })
      : await electron.launch({ args: [ROOT], env });
  const win = await app.firstWindow();
  await win.waitForSelector('.sf-app');
  return { app, win, userData: data };
}

/** Makes the next File > Open choose `file` without showing the dialog. */
export async function chooseInOpenDialog(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog;
  }, file);
}

export interface DialogAnswers {
  /** Files chosen in an Open dialog (empty: Cancel). */
  open?: string[];
  /** Folder chosen in a folder dialog (undefined: Cancel). */
  folder?: string;
  /** Path chosen in a Save dialog (undefined: Cancel). */
  saveAs?: string;
  /** Button pressed in a message box: 0 is the first button. */
  messageResponse?: number;
}

/** Answers the app's dialogs without showing them, and records what was asked. */
export async function answerDialogs(app: ElectronApplication, answers: DialogAnswers): Promise<void> {
  await app.evaluate(({ dialog }, a) => {
    const g = globalThis as Record<string, unknown>;
    const log = (g.__dialogLog as unknown[]) ?? (g.__dialogLog = []);
    const optionsOf = (args: unknown[]) => (args.length > 1 ? args[1] : args[0]) as Record<string, unknown>;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = optionsOf(args);
      const folder = (options.properties as string[] | undefined)?.includes('openDirectory');
      log.push({ kind: folder ? 'folder' : 'open', title: options.title });
      if (folder) return a.folder ? { canceled: false, filePaths: [a.folder] } : { canceled: true, filePaths: [] };
      return a.open?.length ? { canceled: false, filePaths: a.open } : { canceled: true, filePaths: [] };
    }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = optionsOf(args);
      log.push({ kind: 'save', defaultPath: options.defaultPath });
      return a.saveAs ? { canceled: false, filePath: a.saveAs } : { canceled: true, filePath: '' };
    }) as typeof dialog.showSaveDialog;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = optionsOf(args);
      log.push({ kind: 'message', message: options.message });
      return { response: a.messageResponse ?? 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, answers);
}

export async function dialogLog(app: ElectronApplication): Promise<{ kind: string; title?: string; defaultPath?: string; message?: string }[]> {
  return app.evaluate(() => ((globalThis as Record<string, unknown>).__dialogLog as never[]) ?? []);
}

/** Closes the app, answering "Close without saving" if it asks about unsaved changes. */
export async function closeApp(app: ElectronApplication): Promise<void> {
  await answerDialogs(app, { messageResponse: 0 });
  await app.close();
}

/** Records links the app asks Windows to open, instead of opening a browser. */
export async function recordOpenedLinks(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as Record<string, unknown>;
    g.__openedLinks = [];
    shell.openExternal = (async (address: string) => {
      (g.__openedLinks as string[]).push(address);
    }) as typeof shell.openExternal;
  });
}

export async function openedLinks(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => ((globalThis as Record<string, unknown>).__openedLinks as string[]) ?? []);
}

/** Every request the app's network guard cancelled. */
export async function blockedRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [...((globalThis as Record<string, unknown>).__scribeforgeBlocked as string[])]);
}

export async function goTo(win: Page, screen: 'Start' | 'Document' | 'Pages' | 'Settings' | 'About'): Promise<void> {
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: screen, exact: true }).click();
}

/** Opens a test PDF through the Start screen's Open button. */
export async function openFixture({ app, win }: Running, name: string): Promise<void> {
  await chooseInOpenDialog(app, path.join(FIXTURES, name));
  await goTo(win, 'Start');
  await win.getByRole('button', { name: 'Open a PDF…' }).click();
}

export async function waitForFirstPage(win: Page): Promise<void> {
  await win.locator('[data-testid="viewer"][data-ready="true"]').waitFor();
  await expect(win.locator('.page[data-page-number="1"] canvas').first()).toBeVisible();
  await win.waitForFunction(() => {
    const page = document.querySelector('.page[data-page-number="1"]');
    return !!page && page.getAttribute('data-loaded') === 'true' && !!page.querySelector('canvas');
  });
}

export function fixtureHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(FIXTURES)) out[f] = createHash('sha256').update(readFileSync(path.join(FIXTURES, f))).digest('hex');
  return out;
}

export async function setTheme(win: Page, id: string): Promise<void> {
  await goTo(win, 'Settings');
  await win.locator(`input[name="theme"][value="${id}"]`).check();
  await win.waitForFunction((t) => document.documentElement.dataset.theme === t || t === 'system', id);
}
