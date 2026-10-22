// Stop 2c: Find patterns and the redaction log, driven through the real app.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findEverywhere, pageTexts } from '../unit/support/inspect';
import { answerDialogs, blockedRequests, closeApp, fixtureHashes, launch, openFixture, SCREENS, waitForFirstPage, type Running } from './helpers';

let current: Running | null = null;
test.afterEach(async () => {
  if (current) await closeApp(current.app).catch(() => {});
  current = null;
});
let hashesBefore: Record<string, string>;
test.beforeAll(() => {
  hashesBefore = fixtureHashes();
});
test.afterAll(() => {
  expect(fixtureHashes()).toEqual(hashesBefore);
});

const toolbar = (win: Page) => win.getByRole('toolbar', { name: 'Redact' });
const dialog = (win: Page) => win.getByTestId('pattern-dialog');
const VALUES = [
  'jane.doe@example.com',
  'j.smith+work@mail.example.org',
  '(555) 123-4567',
  '555.987.6543',
  '+1 555 246 8135',
  '123-45-6789',
  '234 56 7890',
  '4111 1111 1111 1111',
  '5500-0000-0000-0004',
  '378282246310005',
  'Project Nightingale',
];

test('find patterns, untick one, and redact with a log that never repeats the marked text', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openFixture(run, 'patterns.pdf');
  await waitForFirstPage(win);
  await win.getByRole('radiogroup', { name: 'Tools' }).getByRole('radio', { name: 'Redact' }).click();

  // Choose what to look for.
  await toolbar(win).getByRole('button', { name: 'Find patterns…' }).click();
  for (const name of ['Email addresses', 'Phone numbers', 'Social Security numbers', 'Card numbers']) await expect(dialog(win).getByLabel(name)).toBeChecked();
  await dialog(win).getByLabel('Words or phrases, one per line').fill('Project Nightingale');
  await dialog(win).getByRole('button', { name: 'Find' }).click();

  // The matches, by pattern and page, all ticked: untick one.
  await expect(dialog(win).getByTestId('pattern-summary')).toHaveText("Found 12 matches. Untick any you don't want marked.");
  await expect(dialog(win).locator('section h3')).toHaveText(['Email addresses (2)', 'Phone numbers (4)', 'Social Security numbers (2)', 'Card numbers (3)', '“Project Nightingale” (1)']);
  await expect(dialog(win).getByText('4111 1111 1112')).toHaveCount(0);
  await dialog(win).getByRole('checkbox', { name: /\+44 20 7946 0958/ }).uncheck();
  await win.screenshot({ path: path.join(SCREENS, `patterns-${info.project.name}.png`) });
  await dialog(win).getByRole('button', { name: 'Mark 11 matches' }).click();
  await expect(win.getByTestId('redact-hint')).toHaveText('Marked 11 matches on 2 pages.');
  await expect(win.locator('.sf-redact-mark')).toHaveCount(11);

  // A mark says which pattern found it.
  await toolbar(win).getByRole('button', { name: 'Select', exact: true }).click();
  await win.locator('.sf-redact-mark .sf-redact-part').first().click();
  await expect(win.getByTestId('mark-panel')).toContainText('Email address');

  // Redact, with the log ticked.
  await toolbar(win).getByRole('button', { name: 'Review and redact…' }).click();
  const marks = win.getByTestId('marks-dialog');
  const logChoice = marks.getByLabel('Also save a redaction log next to the redacted file');
  await expect(logChoice).not.toBeChecked();
  await logChoice.check();
  await marks.getByRole('button', { name: 'Redact…' }).click();
  const folder = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-'));
  const target = path.join(folder, 'patterns-redacted.pdf');
  await answerDialogs(app, { saveAs: target });
  await win.getByTestId('review-dialog').getByRole('button', { name: 'Choose where to save…' }).click({ timeout: 30_000 });
  await expect(win.getByTestId('message')).toContainText('Redaction log saved as patterns-redacted (redaction log).txt.');

  // Every marked value is found nowhere in the redacted file.
  const bytes = new Uint8Array(readFileSync(target));
  for (const v of VALUES) expect(await findEverywhere(bytes, v), v).toEqual([]);
  expect((await pageTexts(bytes)).every((t) => t === '')).toBe(true);

  // The log: beside the file, listing the marks by kind with hints, never the values.
  expect(readdirSync(folder).sort()).toEqual(['patterns-redacted (redaction log).txt', 'patterns-redacted.pdf']);
  const log = readFileSync(path.join(folder, 'patterns-redacted (redaction log).txt'), 'utf8');
  expect(log).toContain('Redacted file: patterns-redacted.pdf');
  expect(log).toContain('Made from: patterns.pdf');
  expect(log.match(/ - Phone number: /g)?.length).toBe(3);
  expect(log).toContain(' - Email address: j•••@e•••.com');
  for (const v of [...VALUES, '+44 20 7946 0958']) {
    expect(log.includes(v), v).toBe(false);
    expect(log.replace(/\s+/g, '').includes(v.replace(/\s+/g, '')), v).toBe(false);
  }
  expect(await blockedRequests(app)).toEqual([]);
});

test('nothing found says so, and Back goes back to the choices', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await win.getByRole('radiogroup', { name: 'Tools' }).getByRole('radio', { name: 'Redact' }).click();
  await toolbar(win).getByRole('button', { name: 'Find patterns…' }).click();
  await dialog(win).getByRole('button', { name: 'Find' }).click();
  await expect(dialog(win).getByTestId('pattern-summary')).toHaveText('Nothing was found.');
  await expect(dialog(win).getByRole('button', { name: /^Mark/ })).toBeDisabled();
  await dialog(win).getByRole('button', { name: 'Back' }).click();
  for (const name of ['Email addresses', 'Phone numbers', 'Social Security numbers', 'Card numbers']) await dialog(win).getByLabel(name).uncheck();
  await expect(dialog(win).getByRole('button', { name: 'Find' })).toBeDisabled();
  await dialog(win).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(win)).toHaveCount(0);
});
