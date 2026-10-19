import { useEffect, useRef, type CSSProperties, type Dispatch } from 'react';
import { ANNOTATION_COLOURS } from '../../../shared/annotationColours';
import { Icon } from '../components/Icon';
import type { Annot, AnnotAction } from './annotState';

const NAMES: Record<Annot['kind'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikeout',
  note: 'Note',
  text: 'Text box',
};

/** Details of the selected annotation: colour, comment or text, and Delete. */
export function AnnotationPanel({
  annot,
  dispatch,
  focusText,
}: {
  annot: Annot;
  dispatch: Dispatch<AnnotAction>;
  /** True right after a note or text box is placed, so typing goes straight in. */
  focusText: boolean;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusText) textRef.current?.focus();
  }, [focusText, annot.id]);

  const isText = annot.kind === 'text';
  return (
    <aside className="sf-annot-panel" aria-label="Annotation" data-testid="annot-panel">
      <div className="sf-annot-panel-head">
        <h2>
          {NAMES[annot.kind]} <span className="sf-muted">on page {annot.page + 1}</span>
        </h2>
        <button type="button" className="sf-icon-button" aria-label="Close" onClick={() => dispatch({ type: 'select', id: null })}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="sf-swatches" role="radiogroup" aria-label="Colour">
        {ANNOTATION_COLOURS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={annot.colourId === c.id}
            aria-label={c.name}
            title={c.name}
            className="sf-swatch"
            style={{ '--sf-swatch': c.highlight, '--sf-swatch-ink': c.ink } as CSSProperties}
            onClick={() => dispatch({ type: 'update', id: annot.id, colourId: c.id })}
          />
        ))}
      </div>
      <label className="sf-field">
        <span>{isText ? 'Text' : 'Comment'}</span>
        <textarea
          ref={textRef}
          rows={isText ? 5 : 4}
          value={annot.text}
          placeholder={isText ? 'Type the text for the box' : annot.kind === 'note' ? 'Type your note' : 'Optional comment'}
          onChange={(e) => dispatch({ type: 'update', id: annot.id, text: e.target.value, typing: true })}
        />
      </label>
      {isText && annot.text.trim() === '' && <p className="sf-muted">An empty text box isn't saved.</p>}
      <div className="sf-dialog-buttons">
        <button type="button" className="sf-button" onClick={() => dispatch({ type: 'remove', id: annot.id })}>
          <Icon name="delete" size={18} />
          Delete
        </button>
        <button type="button" className="sf-button sf-primary" onClick={() => dispatch({ type: 'select', id: null })}>
          Done
        </button>
      </div>
    </aside>
  );
}
