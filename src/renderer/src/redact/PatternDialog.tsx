import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { plural } from '../words';
import { PATTERNS, type PatternId, type PatternMatch } from './patterns';

/** A match found on a page, to tick or untick. */
export interface FoundMatch extends PatternMatch {
  id: string;
  /** 0-based page. */
  page: number;
}

/**
 * Find patterns: choose what to look for, then tick the matches to mark. Matches are listed by
 * pattern and page; all are ticked to begin with.
 */
export function PatternDialog({
  search,
  onMark,
  onCancel,
}: {
  /** Searches every page, reporting progress. */
  search: (patterns: PatternId[], words: string[], progress: (text: string) => void) => Promise<FoundMatch[]>;
  /** The ticked matches, and every match found (to know which values were all marked). */
  onMark: (ticked: FoundMatch[], all: FoundMatch[]) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<PatternId[]>(PATTERNS.map((p) => p.id));
  const [words, setWords] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [found, setFound] = useState<FoundMatch[] | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const wordList = words
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter(Boolean);

  const run = async () => {
    setProgress('Searching…');
    try {
      setFound(await search(chosen, wordList, setProgress));
      setUnticked(new Set());
    } finally {
      setProgress(null);
    }
  };

  if (!found) {
    return (
      <Dialog title="Find patterns" onCancel={onCancel} testId="pattern-dialog" wide>
        <p>Find everything of a kind, on every page. You'll see each match before anything is marked.</p>
        <fieldset className="sf-section">
          <legend className="sf-strong">Look for</legend>
          {PATTERNS.map((p) => (
            <label key={p.id} className="sf-choice">
              <input
                type="checkbox"
                checked={chosen.includes(p.id)}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
              />
              <span>
                {p.plural} <span className="sf-muted">(such as {p.example})</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="sf-field">
          <span>Words or phrases, one per line</span>
          <textarea rows={4} value={words} onChange={(e) => setWords(e.target.value)} placeholder={'Such as\nProject Nightingale'} />
        </label>
        <p className="sf-muted" aria-live="polite" data-testid="pattern-progress">
          {progress ?? ''}
        </p>
        <div className="sf-dialog-buttons">
          <button type="button" className="sf-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="sf-button sf-primary" disabled={progress !== null || (chosen.length === 0 && wordList.length === 0)} onClick={() => void run()}>
            Find
          </button>
        </div>
      </Dialog>
    );
  }

  const ticked = found.filter((m) => !unticked.has(m.id));
  const groups: { key: string; name: string; matches: FoundMatch[] }[] = [
    ...PATTERNS.map((p) => ({ key: p.id, name: p.plural, matches: found.filter((m) => m.pattern === p.id) })),
    ...wordList.map((w) => ({ key: `words:${w}`, name: `“${w}”`, matches: found.filter((m) => m.pattern === 'words' && m.term === w) })),
  ].filter((g) => g.matches.length > 0);
  const toggle = (ids: string[], on: boolean) =>
    setUnticked((u) => {
      const next = new Set(u);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  return (
    <Dialog title="Find patterns" onCancel={onCancel} testId="pattern-dialog" wide>
      <p data-testid="pattern-summary">
        {found.length === 0 ? 'Nothing was found.' : `Found ${plural(found.length, 'match', 'matches')}. Untick any you don't want marked.`}
      </p>
      {found.length > 0 && (
        <div className="sf-dialog-scroll" tabIndex={0} aria-label="Matches">
          {groups.map((g) => {
            const all = g.matches.every((m) => !unticked.has(m.id));
            return (
              <section key={g.key} className="sf-marks-page" aria-label={g.name}>
                <h3>
                  <label className="sf-choice">
                    <input type="checkbox" checked={all} onChange={(e) => toggle(g.matches.map((m) => m.id), e.target.checked)} />
                    <span>
                      {g.name} <span className="sf-muted">({g.matches.length})</span>
                    </span>
                  </label>
                </h3>
                <ul>
                  {g.matches.map((m) => (
                    <li key={m.id}>
                      <label className="sf-choice">
                        <input type="checkbox" checked={!unticked.has(m.id)} onChange={(e) => toggle([m.id], e.target.checked)} />
                        <span>
                          {m.text} <span className="sf-muted">page {m.page + 1}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <div className="sf-dialog-buttons">
        <button type="button" className="sf-button" onClick={() => setFound(null)}>
          Back
        </button>
        <button type="button" className="sf-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="sf-button sf-primary" disabled={ticked.length === 0} onClick={() => onMark(ticked, found)}>
          Mark {plural(ticked.length, 'match', 'matches')}
        </button>
      </div>
    </Dialog>
  );
}
