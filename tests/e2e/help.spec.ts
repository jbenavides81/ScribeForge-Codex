// Stop 1f: the help pages, shown in the app from content/help/*.md.
import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { closeApp, goTo, launch, ROOT } from './helpers';

const PAGES = readdirSync(path.join(ROOT, 'content/help')).filter((f) => f.endsWith('.md'));

test('Help lists every page, opens each one, and follows links between them', async ({}, info) => {
  const { app, win } = await launch(info.project.name);
  await goTo(win, 'Help');
  const topics = win.getByRole('navigation', { name: 'Help topics' }).getByRole('button');
  await expect(topics).toHaveCount(PAGES.length);
  const page = win.getByTestId('help-page');
  await expect(page.locator('h1')).toHaveText('Getting started');
  await expect(topics.first()).toHaveAttribute('aria-current', 'page');

  // A link to another help page opens it.
  await page.getByRole('link', { name: 'Saving and your original files' }).click();
  await expect(page.locator('h1')).toHaveText('Saving and your original files');
  await expect(win.getByRole('navigation', { name: 'Help topics' }).getByRole('button', { name: 'Saving and your original files' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Every topic opens, with its title.
  for (let i = 0; i < PAGES.length; i++) {
    const name = (await topics.nth(i).textContent()) ?? '';
    await topics.nth(i).click();
    await expect(page.locator('h1')).toHaveText(name);
  }
  await topics.filter({ hasText: 'Keyboard shortcuts' }).click();
  await expect(page.locator('table').first()).toContainText('Ctrl+S');

  // Help > ScribeForge help (F1) opens it from anywhere.
  await goTo(win, 'Settings');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'show-help'));
  await expect(page).toBeVisible();
  await closeApp(app);
});
