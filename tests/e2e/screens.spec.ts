// Screenshots of every screen in every theme and text size, combined into a contact sheet
// (test-results/screens/contact-sheet.png) for checking layout, colours and the logo.
import { test } from '@playwright/test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { THEME_CHOICES } from '../../src/shared/themes';
import { choose, closeApp, goTo, launch, openFixture, SCREENS, setTheme, waitForFirstPage } from './helpers';

const SCREEN_NAMES = ['Start', 'Document', 'Pages', 'Details', 'Settings', 'Help', 'About'] as const;
/**
 * Each theme's row also shows the list of what a new file carries before saving, the Document
 * screen in Redact mode with a mark selected, the list of marks before redacting, and the
 * comments panel with a stamp selected.
 */
const COLUMNS = SCREEN_NAMES.length + 4;

test('screenshots of every screen in every theme', async ({}, info) => {
  test.setTimeout(300_000);
  mkdirSync(SCREENS, { recursive: true });
  const run = await launch(info.project.name);
  const { app, win } = run;
  await win.setViewportSize({ width: 1280, height: 800 });
  await openFixture(run, 'links.pdf');
  await waitForFirstPage(win);
  // Annotations of each kind, with one selected, so the Document screen shows them and the panel.
  const annotate = win.getByRole('toolbar', { name: 'Annotate' });
  const page1 = win.locator('.page[data-page-number="1"]');
  const markText = async (toolName: string, needle: string) => {
    await annotate.getByRole('button', { name: toolName, exact: true }).click();
    await page1.locator('.textLayer span', { hasText: needle }).first().evaluate((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await win.getByTestId('viewer').dispatchEvent('mouseup');
  };
  const place = async (toolName: string, fx: number, fy: number, text: string) => {
    await annotate.getByRole('button', { name: toolName, exact: true }).click();
    const box = (await page1.boundingBox())!;
    await win.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await win.getByTestId('annot-panel').getByRole('textbox').fill(text);
    await win.getByTestId('annot-panel').getByRole('button', { name: 'Done' }).click();
  };
  await markText('Highlight', 'UNIQUE-PAGE-1');
  await annotate.getByRole('radio', { name: 'Blue' }).click();
  await markText('Underline', 'This is page 1');
  await place('Note', 0.55, 0.12, 'A note');
  await annotate.getByRole('radio', { name: 'Red', exact: true }).click();
  await place('Text box', 0.12, 0.3, 'Approved by the team');
  // A drawing, a filled rectangle, an arrow and a stamp.
  const dragOn = async (from: [number, number], to: [number, number]) => {
    const box = (await page1.boundingBox())!;
    await win.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 6 });
    await win.mouse.up();
  };
  await annotate.getByRole('radio', { name: 'Green' }).click();
  await annotate.getByRole('button', { name: 'Draw', exact: true }).click();
  await dragOn([0.62, 0.3], [0.8, 0.34]);
  await annotate.getByRole('radio', { name: 'Orange' }).click();
  await annotate.getByRole('button', { name: 'Shape', exact: true }).click();
  await annotate.getByLabel('Fill').check();
  await dragOn([0.62, 0.37], [0.78, 0.43]);
  await win.getByTestId('annot-panel').getByRole('button', { name: 'Done' }).click();
  await annotate.getByRole('button', { name: 'Shape', exact: true }).click();
  await annotate.getByLabel('Shape', { exact: true }).selectOption('arrow');
  await dragOn([0.3, 0.44], [0.52, 0.38]);
  await win.getByTestId('annot-panel').getByRole('button', { name: 'Done' }).click();
  await annotate.getByRole('button', { name: 'Stamp', exact: true }).click();
  const stampAt = (await page1.boundingBox())!;
  await win.mouse.click(stampAt.x + stampAt.width * 0.62, stampAt.y + stampAt.height * 0.02);
  await win.getByTestId('annot-panel').getByRole('button', { name: 'Done' }).click();
  // Redaction marks: a search, and an area.
  const tools = win.getByRole('radiogroup', { name: 'Tools' });
  const redactBar = win.getByRole('toolbar', { name: 'Redact' });
  await tools.getByRole('radio', { name: 'Redact' }).click();
  await redactBar.getByLabel('Text to find and mark').fill('UNIQUE-PAGE');
  await redactBar.getByRole('button', { name: 'Mark all' }).click();
  await redactBar.getByRole('button', { name: 'Mark area', exact: true }).click();
  const area = (await page1.boundingBox())!;
  await win.mouse.move(area.x + area.width * 0.55, area.y + area.height * 0.3);
  await win.mouse.down();
  await win.mouse.move(area.x + area.width * 0.85, area.y + area.height * 0.4, { steps: 4 });
  await win.mouse.up();
  await tools.getByRole('radio', { name: 'Annotate' }).click();
  const selectHighlight = async () => {
    await annotate.getByRole('button', { name: 'Select', exact: true }).click();
    await win.locator('.sf-annot-highlight .sf-annot-part').first().click();
  };
  await selectHighlight();
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
    const review = win.getByTestId('review-dialog');
    await review.waitFor();
    await win.waitForTimeout(300);
    const reviewFile = path.join(SCREENS, `${theme.id}-review.png`);
    await win.screenshot({ path: reviewFile });
    row.push(reviewFile);
    await review.getByRole('button', { name: 'Cancel' }).click();

    await goTo(win, 'Document');
    await tools.getByRole('radio', { name: 'Redact' }).click();
    await redactBar.getByRole('button', { name: 'Select', exact: true }).click();
    await win.locator('.sf-redact-mark[data-kind="area"] .sf-redact-part').first().click();
    await win.waitForTimeout(300);
    const redactFile = path.join(SCREENS, `${theme.id}-redact.png`);
    await win.screenshot({ path: redactFile });
    row.push(redactFile);
    await redactBar.getByRole('button', { name: 'Review and redact…' }).click();
    await win.getByTestId('marks-dialog').waitFor();
    await win.waitForTimeout(200);
    const marksFile = path.join(SCREENS, `${theme.id}-marks.png`);
    await win.screenshot({ path: marksFile });
    row.push(marksFile);
    await win.getByTestId('marks-dialog').getByRole('button', { name: 'Cancel' }).click();
    await tools.getByRole('radio', { name: 'Annotate' }).click();
    await annotate.getByRole('button', { name: 'Select', exact: true }).click();
    await annotate.getByRole('button', { name: 'Comments' }).click();
    await win.locator('.sf-annot-stamp').click();
    await win.waitForTimeout(300);
    const commentsFile = path.join(SCREENS, `${theme.id}-comments.png`);
    await win.screenshot({ path: commentsFile });
    row.push(commentsFile);
    await annotate.getByRole('button', { name: 'Comments' }).click();
    await selectHighlight();
    shots.push(row);
  }
  // The larger text sizes, on the busiest screens.
  await setTheme(win, 'cathedral');
  const sizes: string[] = [];
  for (const size of ['large', 'larger']) {
    await goTo(win, 'Settings');
    await choose(win.locator(`input[name="text-size"][value="${size}"]`));
    for (const screen of ['Document', 'Pages', 'Details'] as const) {
      await goTo(win, screen);
      await win.waitForTimeout(500);
      const file = path.join(SCREENS, `text-${size}-${screen.toLowerCase()}.png`);
      await win.screenshot({ path: file });
      sizes.push(file);
    }
  }
  await closeApp(app);

  // Contact sheet: one row per theme (Start, Document, Pages, Details, Settings, Help, About, the
  // before-save list, Redact mode, the marks list and the comments panel), then text sizes.
  const scale = 0.3;
  const w = Math.round(1280 * scale);
  const h = Math.round(800 * scale);
  const rows = [...shots, sizes];
  const sheet = createCanvas(w * COLUMNS + 10 * (COLUMNS + 1), (h + 10) * rows.length + 10);
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
