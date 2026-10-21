import { useEffect, useRef, type CSSProperties, type Dispatch } from 'react';
import { ANNOTATION_COLOURS } from '../../../shared/annotationColours';
import type { StampKind } from '../../../engine/types';
import { Icon } from '../components/Icon';
import { formatDate } from '../details/describe';
import { ANNOT_NAMES, LINE_WIDTHS, STAMPS, TEXT_SIZES, type Annot, type AnnotAction, type FileEdit } from './annotState';
import { canRedraw, fileKindName, paletteMatch, type FileAnnot } from './fileAnnots';

/** What's selected: an annotation added here, or one that was already in the file. */
export type PanelTarget = { kind: 'new'; annot: Annot } | { kind: 'file'; file: FileAnnot; edit: FileEdit };

function Swatches({ value, onChange }: { value: string | undefined; onChange: (id: string) => void }) {
  return (
    <div className="sf-swatches" role="radiogroup" aria-label="Colour">
      {ANNOTATION_COLOURS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-label={c.name}
          title={c.name}
          className="sf-swatch"
          style={{ '--sf-swatch': c.highlight, '--sf-swatch-ink': c.ink } as CSSProperties}
          onClick={() => onChange(c.id)}
        />
      ))}
    </div>
  );
}

/**
 * Replies to the selected annotation: those already in the file (shown as they are), then those
 * added here (editable). Reply adds one and puts the cursor in it.
 */
function Replies({
  parent,
  fromFile,
  added,
  authorName,
  focus,
  dispatch,
  onReply,
}: {
  parent: string;
  fromFile: FileAnnot[];
  added: Annot[];
  authorName: string;
  /** The reply just added, to type into. */
  focus: string | null;
  dispatch: Dispatch<AnnotAction>;
  onReply: (parent: string) => void;
}) {
  return (
    <section className="sf-replies" aria-label="Replies">
      {(fromFile.length > 0 || added.length > 0) && <h3>Replies</h3>}
      <ul>
        {fromFile.map((r) => (
          <li key={r.id} className="sf-reply">
            <p className="sf-muted">
              {r.author || 'Someone'}
              {r.modified ? `, ${formatDate(r.modified)}` : ''}
            </p>
            <p>{r.contents}</p>
          </li>
        ))}
        {added.map((r) => (
          <li key={r.id} className="sf-reply">
            <label className="sf-field">
              <span>{authorName ? `Your reply (${authorName})` : 'Your reply'}</span>
              <textarea
                rows={2}
                value={r.text}
                autoFocus={focus === r.id}
                placeholder="Type your reply"
                onChange={(e) => dispatch({ type: 'update', id: r.id, text: e.target.value, typing: true })}
              />
            </label>
            <button type="button" className="sf-link-button" onClick={() => dispatch({ type: 'remove', id: r.id })}>
              Remove reply
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="sf-button" onClick={() => onReply(parent)}>
        <Icon name="reply" size={18} />
        Reply
      </button>
    </section>
  );
}

/** Details of the selected annotation: colour, comment or text, its settings, replies, and Delete. */
export function AnnotationPanel({
  target,
  fileReplies,
  addedReplies,
  authorName,
  flattenAll,
  dispatch,
  focusText,
  focusReply,
  onReply,
}: {
  target: PanelTarget;
  /** Replies in the file to the selected annotation (and to those replies). */
  fileReplies: FileAnnot[];
  /** Replies added here. */
  addedReplies: Annot[];
  authorName: string;
  flattenAll: boolean;
  dispatch: Dispatch<AnnotAction>;
  /** True right after a note, text box or stamp is placed, so typing goes straight in. */
  focusText: boolean;
  focusReply: string | null;
  onReply: (parent: string) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const id = target.kind === 'new' ? target.annot.id : `file:${target.file.id}`;
  useEffect(() => {
    if (focusText) textRef.current?.focus();
  }, [focusText, id]);
  const close = () => dispatch({ type: 'select', id: null });

  const burnIn = (checked: boolean, onChange: (on: boolean) => void) => (
    <label className="sf-choice">
      <input type="checkbox" checked={flattenAll || checked} disabled={flattenAll} onChange={(e) => onChange(e.target.checked)} />
      <span>Burn into the page when saving</span>
    </label>
  );

  if (target.kind === 'file') {
    const { file, edit } = target;
    const name = fileKindName(file);
    const isText = file.subtype === 'FreeText';
    const text = edit.text ?? file.contents;
    return (
      <aside className="sf-annot-panel" aria-label="Annotation" data-testid="annot-panel">
        <div className="sf-annot-panel-head">
          <h2>
            {name} <span className="sf-muted">on page {file.page + 1}</span>
          </h2>
          <button type="button" className="sf-icon-button" aria-label="Close" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="sf-muted" data-testid="annot-origin">
          Already in the file{file.author ? `, by ${file.author}` : ''}
          {file.modified ? `, ${formatDate(file.modified)}` : ''}.
        </p>
        {canRedraw(file) && <Swatches value={edit.colourId ?? paletteMatch(file)} onChange={(c) => dispatch({ type: 'edit-file', ref: file.id, colourId: c })} />}
        <label className="sf-field">
          <span>{isText ? 'Text' : 'Comment'}</span>
          <textarea
            ref={textRef}
            rows={isText ? 5 : 4}
            value={text}
            placeholder={isText ? 'Type the text for the box' : 'Optional comment'}
            onChange={(e) => dispatch({ type: 'edit-file', ref: file.id, text: e.target.value, typing: true })}
          />
        </label>
        {burnIn(edit.flatten ?? false, (on) => dispatch({ type: 'edit-file', ref: file.id, flatten: on }))}
        <Replies parent={`file:${file.id}`} fromFile={fileReplies} added={addedReplies} authorName={authorName} focus={focusReply} dispatch={dispatch} onReply={onReply} />
        <div className="sf-dialog-buttons">
          <button type="button" className="sf-button" onClick={() => dispatch({ type: 'edit-file', ref: file.id, deleted: true })}>
            <Icon name="delete" size={18} />
            Delete
          </button>
          <button type="button" className="sf-button sf-primary" onClick={close}>
            Done
          </button>
        </div>
      </aside>
    );
  }

  const { annot } = target;
  const isText = annot.kind === 'text';
  const lined = annot.kind === 'ink' || annot.kind === 'rect' || annot.kind === 'ellipse' || annot.kind === 'line' || annot.kind === 'arrow';
  const update = (change: Omit<Extract<AnnotAction, { type: 'update' }>, 'type' | 'id'>) => dispatch({ type: 'update', id: annot.id, ...change });
  return (
    <aside className="sf-annot-panel" aria-label="Annotation" data-testid="annot-panel">
      <div className="sf-annot-panel-head">
        <h2>
          {ANNOT_NAMES[annot.kind]} <span className="sf-muted">on page {annot.page + 1}</span>
        </h2>
        <button type="button" className="sf-icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <Swatches value={annot.colourId} onChange={(c) => update({ colourId: c })} />
      {annot.kind === 'stamp' && (
        <>
          <label className="sf-field">
            <span>Stamp</span>
            <select
              aria-label="Stamp"
              value={annot.stamp ?? 'custom'}
              onChange={(e) => {
                const stamp = e.target.value as StampKind;
                const preset = STAMPS.find((s) => s.id === stamp);
                dispatch({ type: 'update', id: annot.id, stamp, label: stamp === 'custom' ? '' : preset?.label } as AnnotAction);
              }}
            >
              {STAMPS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {annot.stamp === 'custom' && (
            <label className="sf-field">
              <span>Stamp text</span>
              <input type="text" aria-label="Stamp text" maxLength={40} value={annot.label ?? ''} onChange={(e) => update({ label: e.target.value, typing: `label:${annot.id}` })} />
            </label>
          )}
          {!annot.label?.trim() && <p className="sf-muted">A stamp with no text isn't saved.</p>}
        </>
      )}
      {lined && (
        <label className="sf-field sf-field-row">
          <span>Thickness</span>
          <select aria-label="Thickness" value={annot.width} onChange={(e) => update({ width: Number(e.target.value) })}>
            {LINE_WIDTHS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(annot.kind === 'rect' || annot.kind === 'ellipse') && (
        <label className="sf-choice">
          <input type="checkbox" checked={annot.fill ?? false} onChange={(e) => update({ fill: e.target.checked })} />
          <span>Fill</span>
        </label>
      )}
      {isText && (
        <label className="sf-field sf-field-row">
          <span>Text size</span>
          <select aria-label="Text size" value={annot.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })}>
            {TEXT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} pt
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="sf-field">
        <span>{isText ? 'Text' : 'Comment'}</span>
        <textarea
          ref={textRef}
          rows={isText ? 5 : 4}
          value={annot.text}
          placeholder={isText ? 'Type the text for the box' : annot.kind === 'note' ? 'Type your note' : 'Optional comment'}
          onChange={(e) => update({ text: e.target.value, typing: true })}
        />
      </label>
      {isText && annot.text.trim() === '' && <p className="sf-muted">An empty text box isn't saved.</p>}
      {burnIn(annot.flatten ?? false, (on) => update({ flatten: on }))}
      <Replies parent={annot.id} fromFile={fileReplies} added={addedReplies} authorName={authorName} focus={focusReply} dispatch={dispatch} onReply={onReply} />
      <div className="sf-dialog-buttons">
        <button type="button" className="sf-button" onClick={() => dispatch({ type: 'remove', id: annot.id })}>
          <Icon name="delete" size={18} />
          Delete
        </button>
        <button type="button" className="sf-button sf-primary" onClick={close}>
          Done
        </button>
      </div>
    </aside>
  );
}
