// Stop 3b's required checks for search (docs/Plan_Phase3.md, section 5): words, phrases and word
// starts find exactly the pages they should; 1,000 documents are searched in under 200 ms; voided
// documents aren't found unless asked for; rebuilding gives the same results; the index is never
// readable on disk.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSnippet, MATCH_END, MATCH_START, searchQuery, Vault } from '../../src/main/vault/vault';

const COST = 10;
const PASSWORD = 'correct horse battery';
let dir: string;
const pdf = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'scribeforge-search-test-'));
});

function sample(): Vault {
  const vault = new Vault(path.join(dir, 'Vault'), { cost: COST });
  vault.create(PASSWORD, false);
  vault.add({ fileName: 'lease.pdf', title: 'Lease', pages: 3, bytes: pdf, pageTexts: ['The tenant pays rent monthly.', '', 'Insurance of the building is the landlord’s duty.'] });
  vault.add({ fileName: 'policy.pdf', title: 'Car policy', pages: 2, bytes: pdf, pageTexts: ['Vehicle insurance policy for the car.', 'Café receipts are kept in the insured glovebox.'] });
  vault.add({ fileName: 'notes.pdf', title: 'Notes', pages: 1, bytes: pdf, pageTexts: ['Pay the rent before the fifth.'] });
  return vault;
}

const found = (vault: Vault, query: string, options = {}) => vault.search(query, options).map((r) => `${r.document.title}:${r.hits.map((h) => h.page).join(',')}`);

describe('what a search finds', () => {
  it('words: every word must be on the page; case and accents don\'t matter', () => {
    const vault = sample();
    expect(found(vault, 'rent')).toEqual(expect.arrayContaining(['Lease:1', 'Notes:1']));
    expect(found(vault, 'rent')).toHaveLength(2);
    expect(found(vault, 'tenant RENT')).toEqual(['Lease:1']);
    expect(found(vault, 'cafe')).toEqual(['Car policy:2']);
    expect(found(vault, 'tenant insurance')).toEqual([]); // on different pages
  });

  it('"exact phrases" and the start of a word', () => {
    const vault = sample();
    expect(found(vault, '"insurance policy"')).toEqual(['Car policy:1']);
    expect(found(vault, '"policy insurance"')).toEqual([]);
    expect(found(vault, 'insur*').sort()).toEqual(['Car policy:1,2', 'Lease:3']);
    expect(found(vault, 'insur')).toEqual([]); // a word start needs the *
  });

  it('marks the matching words in the snippet, and counts the pages found', () => {
    const vault = sample();
    const [result] = vault.search('"insurance policy"');
    expect(result.hits[0].snippet).toBe(`Vehicle ${MATCH_START}insurance policy${MATCH_END} for the car.`);
    expect(vault.search('tenant rent')[0].hits[0].snippet).toBe(`The ${MATCH_START}tenant${MATCH_END} pays ${MATCH_START}rent${MATCH_END} monthly.`);
    expect(vault.search('insur*').find((r) => r.document.title === 'Car policy')?.pagesFound).toBe(2);
  });

  it('shows about a dozen words around the first match, with accents and word starts matched as the index matches them', () => {
    const m = (w: string) => `${MATCH_START}${w}${MATCH_END}`;
    expect(makeSnippet('Two receipts from the Café Rouge.', 'cafe')).toBe(`Two receipts from the ${m('Café')} Rouge.`);
    expect(makeSnippet('Insured, insurance and insurer.', 'insur*')).toBe(`${m('Insured')}, ${m('insurance')} and ${m('insurer')}.`);
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    expect(makeSnippet(long, 'w20')).toBe(`…w16 w17 w18 w19 ${m('w20')} w21 w22 w23 w24 w25 w26 w27…`);
    expect(makeSnippet('', 'x')).toBe('');
  });

  it("can't be broken by what's typed", () => {
    const vault = sample();
    for (const typed of ['"', 'NEAR(rent', 'rent AND', '-rent', 'a:b', '***', '"unclosed phrase', '^rent', 'rent OR tenant']) expect(() => vault.search(typed), typed).not.toThrow();
    expect(searchQuery('  ')).toBeNull();
    expect(searchQuery('e-mail "the car" insur*')).toBe('"e mail" "the car" "insur"*');
  });

  it('leaves out voided documents unless asked, and filters by label and date added', () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const vault = new Vault(path.join(dir, 'Dated'), { cost: COST, now: () => now });
    vault.create(PASSWORD, false);
    const old = vault.add({ fileName: 'a.pdf', title: 'Old', pages: 1, bytes: pdf, pageTexts: ['anvil'] });
    now = new Date('2026-10-01T00:00:00Z');
    const recent = vault.add({ fileName: 'b.pdf', title: 'Recent', pages: 1, bytes: pdf, pageTexts: ['anvil'] });
    vault.update(recent.id, { labels: ['Forge'] });
    expect(found(vault, 'anvil').sort()).toEqual(['Old:1', 'Recent:1']);
    expect(found(vault, 'anvil', { label: 'Forge' })).toEqual(['Recent:1']);
    expect(found(vault, 'anvil', { since: '2026-06-01T00:00:00Z' })).toEqual(['Recent:1']);
    vault.voidDocument(old.id, 'Old');
    expect(found(vault, 'anvil')).toEqual(['Recent:1']);
    expect(found(vault, 'anvil', { voided: true }).sort()).toEqual(['Old:1', 'Recent:1']);
  });

  it('lists pages with no text, which search can\'t find words on', () => {
    const vault = sample();
    expect(vault.textless()).toEqual([{ id: expect.any(String), title: 'Lease', pages: [2], voided: false }]);
  });
});

describe('the search index', () => {
  it('is never readable on disk, and is kept when the vault locks and opens again', () => {
    const vault = sample();
    vault.lock();
    const sealed = readFileSync(path.join(dir, 'Vault', 'search.sealed'));
    for (const word of ['tenant', 'Insurance', 'glovebox', 'Lease']) expect(sealed.includes(Buffer.from(word)), word).toBe(false);
    expect(vault.unlock(PASSWORD)).toBe(true);
    expect(found(vault, 'glovebox')).toEqual(['Car policy:2']);
  });

  it('documents added without their text are listed, and are found once indexed', () => {
    const vault = new Vault(path.join(dir, 'Vault'), { cost: COST });
    vault.create(PASSWORD, false);
    const doc = vault.add({ fileName: 'a.pdf', title: 'Old one', pages: 2, bytes: pdf });
    expect(vault.unindexed()).toEqual([doc.id]);
    vault.indexDocuments([{ id: doc.id, pageTexts: ['nothing here', 'the zephyr word'] }]);
    expect(vault.unindexed()).toEqual([]);
    expect(found(vault, 'zephyr')).toEqual(['Old one:2']);
  });

  it('erasing takes a document out of the index', () => {
    const vault = sample();
    const lease = vault.documents().find((d) => d.title === 'Lease')!;
    vault.eraseDocument(lease.id, 'Mistake');
    expect(found(vault, 'tenant')).toEqual([]);
    expect(vault.textless()).toEqual([]);
  });

  it('rebuilding gives the same results', () => {
    const vault = sample();
    const before = ['rent', '"insurance policy"', 'insur*', 'cafe'].map((q) => found(vault, q).sort());
    const texts: Record<string, string[]> = {
      'lease.pdf': ['The tenant pays rent monthly.', '', 'Insurance of the building is the landlord’s duty.'],
      'policy.pdf': ['Vehicle insurance policy for the car.', 'Café receipts are kept in the insured glovebox.'],
      'notes.pdf': ['Pay the rent before the fifth.'],
    };
    vault.clearIndex();
    expect(vault.unindexed()).toHaveLength(3);
    vault.indexDocuments(vault.documents().map((d) => ({ id: d.id, pageTexts: texts[d.fileName] })));
    expect(['rent', '"insurance policy"', 'insur*', 'cafe'].map((q) => found(vault, q).sort())).toEqual(before);
  });

  it('a damaged index file doesn\'t stop the vault opening: it says so, and every document is indexed again', () => {
    const vault = sample();
    vault.lock();
    const file = path.join(dir, 'Vault', 'search.sealed');
    const bytes = readFileSync(file);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    writeFileSync(file, bytes);
    expect(vault.unlock(PASSWORD)).toBe(true);
    expect(vault.searchIndexDamaged).toBe(true);
    expect(vault.unindexed()).toHaveLength(3);
    expect(vault.documents()).toHaveLength(3);
  });

  it('goes into backups, so a restored vault can be searched straight away', () => {
    const vault = sample();
    const file = path.join(dir, 'search.sfbackup');
    vault.backup(file);
    expect(readFileSync(file).includes(Buffer.from('glovebox'))).toBe(false);
    const elsewhere = new Vault(path.join(dir, 'Other', 'Vault'), { cost: COST });
    elsewhere.restoreBackup({ file }, PASSWORD);
    expect(elsewhere.unindexed()).toEqual([]);
    expect(found(elsewhere, 'glovebox')).toEqual(['Car policy:2']);
  });

  it('searches 1,000 documents in under 200 milliseconds', () => {
    const vault = new Vault(path.join(dir, 'Big'), { cost: COST });
    vault.create(PASSWORD, false);
    const vocabulary = Array.from({ length: 4000 }, (_, i) => `w${i.toString(36)}z`);
    const words = (n: number, seed: number) => Array.from({ length: n }, (_, i) => vocabulary[(seed * 7919 + i * 104729) % vocabulary.length]).join(' ');
    const docs = Array.from({ length: 1000 }, (_, d) => vault.add({ fileName: `d${d}.pdf`, title: `Document ${d}`, pages: 3, bytes: pdf }));
    vault.indexDocuments(docs.map((doc, d) => ({ id: doc.id, pageTexts: [words(300, d * 3), words(300, d * 3 + 1), `${words(300, d * 3 + 2)}${d === 777 ? ' needle' : ''}`] })));
    for (const query of ['needle', vocabulary[5], `"${vocabulary[10]} ${vocabulary[11]}"`, 'w1*']) {
      const started = performance.now();
      const results = vault.search(query);
      const took = performance.now() - started;
      expect(took, `${query}: ${took.toFixed(0)} ms`).toBeLessThan(200);
      if (query === 'needle') expect(results.map((r) => r.document.title)).toEqual(['Document 777']);
    }
  }, 60_000);
});
