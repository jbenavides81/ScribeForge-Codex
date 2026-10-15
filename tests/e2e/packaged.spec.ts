// The installed app (the unpacked installer build in release/win-unpacked): the same safety
// checks as the development build, on the files that actually ship.
import { expect, test } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  blockedRequests,
  fixtureHashes,
  goTo,
  launch,
  openedLinks,
  openFixture,
  PACKAGED_EXE,
  recordOpenedLinks,
  setTheme,
  waitForFirstPage,
} from './helpers';

test('the installed app opens PDFs, keeps PDF JavaScript off and makes no network requests', async ({}, info) => {
  test.skip(!existsSync(PACKAGED_EXE), 'Run "npm run pack" first.');
  const before = fixtureHashes();
  const run = await launch(info.project.name);
  const { app, win } = run;
  await recordOpenedLinks(app);
  const dialogs: string[] = [];
  win.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await goTo(win, 'About');
  await expect(win.getByTestId('about-version')).toHaveText('Version 0.1.0');

  await openFixture(run, 'large.pdf');
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 600');

  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await win.getByLabel('Find in document').fill('anvil');
  await expect(win.getByTestId('find-count')).toHaveText('1 of 5');

  await openFixture(run, 'protected.pdf');
  await win.getByTestId('password-dialog').getByLabel('Password').fill('open-sesame');
  await win.getByTestId('password-dialog').getByRole('button', { name: 'Open' }).click();
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 2');

  await openFixture(run, 'scripted.pdf');
  await waitForFirstPage(win);
  await win.waitForTimeout(1500);

  for (const theme of ['light', 'high-contrast', 'cathedral']) await setTheme(win, theme);

  expect(dialogs).toEqual([]);
  expect(await openedLinks(app)).toEqual([]);
  expect(await blockedRequests(app)).toEqual([]);
  await app.close();
  expect(fixtureHashes()).toEqual(before);
});

test('the installed app ships no pdf.js scripting sandbox and no node_modules', async () => {
  test.skip(!existsSync(PACKAGED_EXE), 'Run "npm run pack" first.');
  const resources = path.join(path.dirname(PACKAGED_EXE), 'resources');
  expect(existsSync(path.join(resources, 'app.asar'))).toBe(true);
  expect(existsSync(path.join(resources, 'app.asar.unpacked'))).toBe(false);
  // @electron/asar comes with electron-builder; it reads the app bundle's file list.
  const { listPackage } = await import('@electron/asar');
  const files = listPackage(path.join(resources, 'app.asar'), { isPack: false }).map((f) => f.replace(/\\/g, '/'));
  expect(files.length).toBeGreaterThan(50);
  expect(files.filter((f) => /sandbox|node_modules|\/src\/|\/tests\//i.test(f))).toEqual([]);
  expect(files).toContain('/out/renderer/pdfjs/standard_fonts/FoxitFixed.pfb');
  expect(readdirSync(resources)).toEqual(expect.arrayContaining(['LICENSE', 'THIRD-PARTY-NOTICES.md']));
  // Electron's own Chromium notices ship next to the app.
  expect(existsSync(path.join(path.dirname(PACKAGED_EXE), 'LICENSES.chromium.html'))).toBe(true);
});
