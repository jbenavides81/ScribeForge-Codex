import { useState } from 'react';
import { parseRanges, splitEvery } from '../../../engine/names';
import { Dialog } from '../components/Dialog';

type Mode = 'each' | 'every' | 'ranges';

/** Asks how to split. Returns groups of page positions (1-based, in the current order). */
export function SplitDialog({
  pageCount,
  onSplit,
  onCancel,
}: {
  pageCount: number;
  onSplit: (parts: number[][]) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>('every');
  const [every, setEvery] = useState('2');
  const [ranges, setRanges] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'each') return onSplit(splitEvery(pageCount, 1));
    if (mode === 'every') {
      const n = Number(every);
      if (!Number.isInteger(n) || n < 1) return setError('Type a whole number of pages, 1 or more.');
      if (n >= pageCount) return setError(`The document has ${pageCount} pages, so every ${n} pages would make just one file.`);
      return onSplit(splitEvery(pageCount, n));
    }
    const result = parseRanges(ranges, pageCount);
    if (!result.ok) return setError(result.error);
    return onSplit(result.parts);
  };

  const preview =
    mode === 'each'
      ? `${pageCount} files, one page each.`
      : mode === 'every' && Number(every) >= 1 && Number.isInteger(Number(every))
        ? `${splitEvery(pageCount, Number(every)).length} files.`
        : '';

  return (
    <Dialog title="Split into separate files" onCancel={onCancel} testId="split-dialog">
      <form onSubmit={submit}>
        <p className="sf-muted">The pages are split as they are now, in this order and turned as shown. Each part is saved as a new file.</p>
        <fieldset className="sf-split-choices">
          <legend className="sf-strong">How to split</legend>
          <label className="sf-choice">
            <input type="radio" name="split-mode" checked={mode === 'each'} onChange={() => { setMode('each'); setError(null); }} />
            Every page as its own file
          </label>
          <label className="sf-choice">
            <input type="radio" name="split-mode" checked={mode === 'every'} onChange={() => { setMode('every'); setError(null); }} />
            Every
            <input
              type="text"
              inputMode="numeric"
              className="sf-small-input"
              aria-label="Pages in each file"
              value={every}
              onFocus={() => setMode('every')}
              onChange={(e) => { setEvery(e.target.value.replace(/[^0-9]/g, '')); setError(null); }}
            />
            pages
          </label>
          <label className="sf-choice">
            <input type="radio" name="split-mode" checked={mode === 'ranges'} onChange={() => { setMode('ranges'); setError(null); }} />
            These page ranges
          </label>
          <input
            type="text"
            className="sf-wide-input"
            aria-label="Page ranges"
            placeholder="for example 1-3, 4, 5-9"
            value={ranges}
            onFocus={() => setMode('ranges')}
            onChange={(e) => { setRanges(e.target.value); setError(null); }}
          />
        </fieldset>
        {error ? (
          <p className="sf-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="sf-muted">{preview}</p>
        )}
        <div className="sf-dialog-buttons">
          <button type="button" className="sf-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="sf-button sf-primary">
            Choose a folder and split
          </button>
        </div>
      </form>
    </Dialog>
  );
}
