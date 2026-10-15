// Screenshots of every screen in every theme and text size, combined into a contact sheet
// (test-results/screens/contact-sheet.png) for checking layout, colours and the logo.
import { test } from '@playwright/test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { THEME_CHOICES } from '../../src/shared/themes';
import { closeApp, goTo, launch, openFixture, SCREENS, setTheme, waitForFirstPage } from './helpers';

const SCREEN_NAMES = ['Start', 'Document', 'Pages', 'Settings', 'About'] as const;

test('screenshots of every screen in every theme', async ({}, info) => {
  test.setTimeout(300_000);
  mkdirSync(SCREENS, { recursive: true });
  const run = await launch(info.project.name);
  const { app, win } = run;
  await win.setViewportSize({ width: 1280, height: 800 });
  await openFixture(run, 'links.pdf');
  await waitForFirstPage(win);
  // Some page changes, so the Pages screen shows selection, rotation and the unsaved marker.
  await goTo(win, 'Pages');
  await win.getByRole('option', { name: /^Page 1/ }).click();
  await win.getByRole('button', { name: 'Rotate right' }).click();
  await win.getByRole('option', { name: /^Page 3/ }).click({ modifiers: ['Control'] });

  const shots: string[][] = [];
  for (const theme of THEME_CHOICES) {
    await setTheme(win, theme.id);
    const row: string[] = [];
    for (const screen of SCREEN_NAMES) {
      await goTo(win, screen);
      if (screen === 'Document') {
        await win.getByLabel('Find in document').fill('UNIQUE');
        await win.waitForTimeout(600);
      }
      if (screen === 'Pages') await win.locator('.sf-page-canvas[data-rendered]').nth(5).waitFor();
      await win.waitForTimeout(300);
      const file = path.join(SCREENS, `${theme.id}-${screen.toLowerCase()}.png`);
      await win.screenshot({ path: file });
      row.push(file);
    }
    shots.push(row);
  }
  // The larger text sizes, on the busiest screens.
  await setTheme(win, 'cathedral');
  const sizes: string[] = [];
  for (const size of ['large', 'larger']) {
    await goTo(win, 'Settings');
    await win.locator(`input[name="text-size"][value="${size}"]`).check();
    for (const screen of ['Document', 'Pages'] as const) {
      await goTo(win, screen);
      await win.waitForTimeout(500);
      const file = path.join(SCREENS, `text-${size}-${screen.toLowerCase()}.png`);
      await win.screenshot({ path: file });
      sizes.push(file);
    }
  }
  await closeApp(app);

  // Contact sheet: one row per theme (Start, Document, Pages, Settings, About), then text sizes.
  const scale = 0.3;
  const w = Math.round(1280 * scale);
  const h = Math.round(800 * scale);
  const rows = [...shots, sizes];
  const sheet = createCanvas(w * SCREEN_NAMES.length + 10 * (SCREEN_NAMES.length + 1), (h + 10) * rows.length + 10);
  const g = sheet.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (const [r, row] of rows.entries()) {
    for (const [c, file] of row.entries()) {
      g.drawImage(await loadImage(file), 10 + c * (w + 10), 10 + r * (h + 10), w, h);
    }
  }
  writeFileSync(path.join(SCREENS, 'contact-sheet.png'), sheet.toBuffer('image/png'));
});
