import type { Dispatch } from 'react';
import { Icon } from '../components/Icon';
import { plural } from '../words';
import { PATTERNS } from './patterns';
import { markLabel, type RedactAction, type RedactMark } from './redactState';

/** The selected redaction mark: what it covers, and Remove. */
export function MarkPanel({ mark, marks, dispatch }: { mark: RedactMark; marks: RedactMark[]; dispatch: Dispatch<RedactAction> }) {
  const sameSearch = mark.group ? marks.filter((m) => m.group === mark.group) : [];
  const pattern = mark.pattern === 'words' ? 'From the list of words' : PATTERNS.find((p) => p.id === mark.pattern)?.name;
  const kind = mark.kind === 'area' ? 'Area' : mark.kind === 'text' ? 'Selected text' : (pattern ?? `Search for “${mark.term}”`);
  return (
    <aside className="sf-annot-panel" aria-label="Redaction mark" data-testid="mark-panel">
      <div className="sf-annot-panel-head">
        <h2>
          Redaction mark <span className="sf-muted">on page {mark.page + 1}</span>
        </h2>
        <button type="button" className="sf-icon-button" aria-label="Close" onClick={() => dispatch({ type: 'select', id: null })}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <p>{kind}</p>
      {mark.kind !== 'area' && <p className="sf-muted">{markLabel(mark)}</p>}
      <div className="sf-dialog-buttons">
        {sameSearch.length > 1 && (
          <button type="button" className="sf-button" onClick={() => dispatch({ type: 'remove', ids: sameSearch.map((m) => m.id) })}>
            Remove all {plural(sameSearch.length, 'match', 'matches')}
          </button>
        )}
        <button type="button" className="sf-button" onClick={() => dispatch({ type: 'remove', ids: [mark.id] })}>
          <Icon name="delete" size={18} />
          Remove mark
        </button>
        <button type="button" className="sf-button sf-primary" onClick={() => dispatch({ type: 'select', id: null })}>
          Done
        </button>
      </div>
    </aside>
  );
}
