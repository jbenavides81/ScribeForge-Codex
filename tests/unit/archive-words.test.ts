// The Archive's plain words: its history, whether the history checks out, and why it locked.
import { describe, expect, it } from 'vitest';
import type { HistoryAction, HistoryEntry } from '../../src/shared/vault';
import { historyFile, historyState, historyText, lockedBecause } from '../../src/renderer/src/archive/describe';

const entry = (action: HistoryAction, details: Record<string, string> = {}, title: string | null = 'Lease'): HistoryEntry => ({
  seq: 1,
  at: '2026-10-23T09:00:00.000Z',
  action,
  document: 'd1',
  title,
  details,
});

describe('the Archive history in words', () => {
  it('says what each entry was', () => {
    expect(historyText(entry('vault-made', { recovery: 'yes' }, null))).toBe('The vault was made, with a recovery code.');
    expect(historyText(entry('added'))).toBe('“Lease” was added.');
    expect(historyText(entry('renamed', { from: 'Old lease' }))).toBe('“Old lease” was renamed “Lease”.');
    expect(historyText(entry('labels'))).toBe('The labels of “Lease” were changed.');
    expect(historyText(entry('voided', { reason: 'Superseded' }))).toBe('“Lease” was voided. Reason: Superseded');
    expect(historyText(entry('erased', { reason: 'Stored by mistake' }))).toBe('“Lease” was erased for good. Reason: Stored by mistake');
    expect(historyText(entry('copy-saved'))).toBe('A copy of “Lease” was saved out of the vault.');
    expect(historyText(entry('recovery-made', { replaced: 'yes' }, null))).toBe('A new recovery code was made; the old one no longer works.');
    expect(historyText(entry('recovery-used', {}, null))).toBe('The vault was opened with the recovery code.');
  });

  it('says whether the history checks out, and saves as text', () => {
    expect(historyState({ entries: [entry('added')], intact: true })).toBe('The history is intact: 1 entry, each sealed to the one before it.');
    expect(historyState({ entries: [entry('added'), entry('labels')], intact: false, brokenAt: 2 })).toMatch(/^The history has been changed outside ScribeForge, from entry 2 on\./);
    const text = historyFile({ entries: [entry('added')], intact: true }, new Date('2026-10-23T10:00:00Z'));
    expect(text.split('\r\n')[0]).toBe('ScribeForge Archive: history');
    expect(text).toContain('1. ');
    expect(text).toContain('“Lease” was added.');
  });

  it('says why it locked by itself, and nothing when it was locked on purpose', () => {
    expect(lockedBecause('idle')).toMatch(/wasn't used for a while/);
    expect(lockedBecause('windows-locked')).toMatch(/Windows locked/);
    expect(lockedBecause('sleep')).toMatch(/went to sleep/);
    expect(lockedBecause('button')).toBeNull();
  });
});
