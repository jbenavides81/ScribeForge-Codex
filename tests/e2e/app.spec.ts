import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PRESETS } from '../../src/shared/themes';
import { blockedRequests, goTo, launch, openFixture, setTheme, waitForFirstPage } from './helpers';

test('starts on the Start screen, shows About, and makes no network requests', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await expect(win.getByRole('heading', { name: 'Open a PDF' })).toBeVisible();
  await expect(win.getByText('Files you open will appear here.')).toBeVisible();
  await expect(win.getByRole('button', { name: 'Document', exact: true })).toBeDisabled();
  // Drag-and-drop needs the file's path from the sandboxed window; the bridge for it works.
  expect(await win.evaluate(() => typeof window.scribeforge.pathForFile(new File(['x'], 'dropped.pdf')))).toBe('string');
  await goTo(win, 'About');
  await expect(win.getByTestId('about-version')).toHaveText('Version 0.1.0');
  await expect(win.getByText('by BC6')).toBeVisible();
  await win.getByText('Third-party notices', { exact: true }).click();
  await expect(win.getByTestId('notices')).toContainText('pdfjs-dist 6.4.299');
  await expect(win.getByTestId('notices')).toContainText('Apache License');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('ScribeForge');
  expect(await blockedRequests(app)).toEqual([]);
  await app.close();
});

test('every theme and text size applies at once and is remembered after a restart', async ({}, info) => {
  const first = await launch(info.project.name);
  const { win } = first;
  for (const preset of PRESETS) {
    await setTheme(win, preset.id);
    const bg = await win.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const hex = preset.tokens.bg;
    const rgb = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    expect(bg, preset.name).toBe(rgb);
  }
  await setTheme(win, 'system');
  expect(['light', 'dark']).toContain(await win.evaluate(() => document.documentElement.dataset.theme));

  await setTheme(win, 'high-contrast');
  for (const [size, px] of [['larger', '19px'], ['large', '17px'], ['standard', '15px']] as const) {
    await win.locator(`input[name="text-size"][value="${size}"]`).check();
    await expect.poll(() => win.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(px);
  }
  await win.locator('input[name="text-size"][value="large"]').check();
  await first.app.close();

  const second = await launch(info.project.name, first.userData);
  expect(await second.win.evaluate(() => document.documentElement.dataset.theme)).toBe('high-contrast');
  expect(await second.win.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('17px');
  await second.app.close();
});

test('recent files: remembered, removable, clearable, and can be turned off', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await goTo(win, 'Start');
  const list = win.getByTestId('recent-list');
  await expect(list.getByText('normal.pdf')).toBeVisible();

  // Opening it from the list works.
  await list.locator('.sf-recent-open', { hasText: 'normal.pdf' }).click();
  await waitForFirstPage(win);

  await goTo(win, 'Start');
  await win.getByRole('button', { name: 'Remove normal.pdf from the list' }).click();
  await expect(win.getByText('Files you open will appear here.')).toBeVisible();

  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await goTo(win, 'Start');
  await win.getByRole('button', { name: 'Clear the list' }).click();
  await expect(win.getByText('Files you open will appear here.')).toBeVisible();

  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await goTo(win, 'Settings');
  await win.getByLabel('Remember the files I open').uncheck();
  await goTo(win, 'Start');
  await expect(win.getByText('Recent files are turned off in Settings.')).toBeVisible();
  const saved = JSON.parse(readFileSync(path.join(run.userData, 'settings.json'), 'utf8'));
  expect(saved.recentFiles).toEqual([]);
  expect(saved.rememberRecent).toBe(false);
  expect(await blockedRequests(app)).toEqual([]);
  await app.close();
});

test('a damaged settings file is set aside with a message, and the app starts normally', async ({}, info) => {
  const first = await launch(info.project.name);
  await first.app.close();
  mkdirSync(first.userData, { recursive: true });
  writeFileSync(path.join(first.userData, 'settings.json'), '{ "theme": "cathedral", oops');
  const run = await launch(info.project.name, first.userData);
  await expect(run.win.getByTestId('message')).toContainText("Your settings file couldn't be read");
  expect(readdirSync(first.userData).some((f) => f.startsWith('settings.damaged-'))).toBe(true);
  await expect(run.win.getByRole('heading', { name: 'Open a PDF' })).toBeVisible();
  await run.app.close();
});

test('the network guard cancels and records any attempt, from either side of the app', async ({}, info) => {
  const { app, win } = await launch(info.project.name);
  // From the window: the Content-Security-Policy refuses it before it leaves.
  const fromWindow = await win.evaluate(() =>
    fetch('https://example.com/scribeforge-guard-window').then(
      () => 'reached',
      () => 'refused',
    ),
  );
  expect(fromWindow).toBe('refused');
  // From the main process: the request guard cancels it and records it.
  const fromMain = await app.evaluate(({ net }) =>
    net.fetch('https://example.com/scribeforge-guard-main').then(
      () => 'reached',
      () => 'refused',
    ),
  );
  expect(fromMain).toBe('refused');
  expect(await blockedRequests(app)).toEqual(['https://example.com/scribeforge-guard-main']);
  await app.close();
});

test('trial mode says so in the title bar and the navigation', async ({}, info) => {
  const { app, win, userData } = await launch(info.project.name, undefined, { SCRIBEFORGE_TRIAL: '1' });
  await expect(win.getByTestId('trial-badge')).toHaveText('Trial mode: separate test data');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('ScribeForge (trial)');
  await goTo(win, 'About');
  await expect(win.getByTestId('about-version')).toHaveText('Version 0.1.0 (trial mode)');
  expect(path.resolve(await app.evaluate(({ app: a }) => a.getPath('userData')))).toBe(path.resolve(userData));
  await app.close();
});

test('trial data and real data are never used by test runs', async ({}, info) => {
  const { app, userData } = await launch(info.project.name);
  const used = await app.evaluate(({ app: a }) => a.getPath('userData'));
  expect(path.resolve(used)).toBe(path.resolve(userData));
  expect(existsSync(path.join(userData))).toBe(true);
  await app.close();
});
