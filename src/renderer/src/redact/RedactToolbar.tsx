import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

export type RedactTool = 'select' | 'area' | 'text';

export const REDACT_TOOLS: { id: RedactTool; label: string; icon: IconName; hint: string }[] = [
  { id: 'select', label: 'Select', icon: 'select', hint: 'Click a mark to check or remove it.' },
  { id: 'area', label: 'Mark area', icon: 'redact-area', hint: 'Drag across the part of the page to black out.' },
  { id: 'text', label: 'Mark text', icon: 'redact-text', hint: 'Select the text to black out.' },
];

export function RedactToolbar({
  lead,
  tool,
  onTool,
  onFind,
  onPatterns,
  finding,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  marks,
  onReview,
  working,
  status,
}: {
  /** Shown first: the Annotate / Redact switch. */
  lead: ReactNode;
  tool: RedactTool;
  onTool: (tool: RedactTool) => void;
  onFind: (term: string) => void;
  /** Opens Find patterns. */
  onPatterns: () => void;
  finding: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  marks: number;
  onReview: () => void;
  working: string | null;
  /** The result of the last search, or progress. */
  status: string | null;
}) {
  const [term, setTerm] = useState('');
  const hint = REDACT_TOOLS.find((t) => t.id === tool)?.hint ?? '';
  return (
    <div className="sf-toolbar sf-annotate-bar" role="toolbar" aria-label="Redact">
      {lead}
      {REDACT_TOOLS.map((t) => (
        <button key={t.id} type="button" className="sf-tool" aria-pressed={tool === t.id} onClick={() => onTool(t.id)}>
          <Icon name={t.icon} size={18} />
          <span>{t.label}</span>
        </button>
      ))}
      <span className="sf-toolbar-gap" />
      <form
        className="sf-search"
        role="search"
        aria-label="Find and mark"
        onSubmit={(e) => {
          e.preventDefault();
          if (term.trim()) onFind(term);
        }}
      >
        <input type="search" aria-label="Text to find and mark" placeholder="Find and mark" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button type="submit" className="sf-button" disabled={!term.trim() || finding || working !== null}>
          Mark all
        </button>
      </form>
      <button type="button" className="sf-button" onClick={onPatterns} disabled={finding || working !== null}>
        Find patterns…
      </button>
      <span className="sf-toolbar-gap" />
      <span className="sf-tool-group">
        <button type="button" className="sf-tool" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <Icon name="undo" size={18} />
          <span>Undo</span>
        </button>
        <button type="button" className="sf-tool" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          <Icon name="redo" size={18} />
          <span>Redo</span>
        </button>
      </span>
      <span className="sf-toolbar-fill" />
      <span className="sf-hint" data-testid="redact-hint" aria-live="polite">
        {working ?? status ?? hint}
      </span>
      <button type="button" className="sf-button sf-primary" onClick={onReview} disabled={marks === 0 || working !== null}>
        <Icon name="redact" size={18} />
        Review and redact…
      </button>
    </div>
  );
}

/** Annotate or redact: which tools the Document screen's second toolbar shows. */
export function ModeSwitch({ mode, onMode }: { mode: 'annotate' | 'redact'; onMode: (mode: 'annotate' | 'redact') => void }) {
  return (
    <div className="sf-mode" role="radiogroup" aria-label="Tools">
      {(['annotate', 'redact'] as const).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} className="sf-mode-option" onClick={() => onMode(m)}>
          {m === 'annotate' ? 'Annotate' : 'Redact'}
        </button>
      ))}
    </div>
  );
}
