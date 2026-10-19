import type { CSSProperties } from 'react';
import { ANNOTATION_COLOURS } from '../../../shared/annotationColours';
import { Icon, type IconName } from '../components/Icon';

export type Tool = 'select' | 'highlight' | 'underline' | 'strikeout' | 'note' | 'text';

export const TOOLS: { id: Tool; label: string; icon: IconName; hint: string }[] = [
  { id: 'select', label: 'Select', icon: 'select', hint: 'Select text to copy it, or click an annotation to change it.' },
  { id: 'highlight', label: 'Highlight', icon: 'highlight', hint: 'Select text to highlight it.' },
  { id: 'underline', label: 'Underline', icon: 'underline', hint: 'Select text to underline it.' },
  { id: 'strikeout', label: 'Strikeout', icon: 'strikeout', hint: 'Select text to strike it out.' },
  { id: 'note', label: 'Note', icon: 'note', hint: 'Click on the page where the note goes.' },
  { id: 'text', label: 'Text box', icon: 'textbox', hint: 'Click on the page where the text box goes.' },
];

export function AnnotateToolbar({
  tool,
  onTool,
  colourId,
  onColour,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  working,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  colourId: string;
  onColour: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  working: string | null;
}) {
  const hint = TOOLS.find((t) => t.id === tool)?.hint ?? '';
  return (
    <div className="sf-toolbar sf-annotate-bar" role="toolbar" aria-label="Annotate">
      {TOOLS.map((t) => (
        <button key={t.id} type="button" className="sf-tool" aria-pressed={tool === t.id} onClick={() => onTool(t.id)}>
          <Icon name={t.icon} size={18} />
          <span>{t.label}</span>
        </button>
      ))}
      <span className="sf-toolbar-gap" />
      <div className="sf-swatches" role="radiogroup" aria-label="Colour for new annotations">
        {ANNOTATION_COLOURS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={colourId === c.id}
            aria-label={c.name}
            title={c.name}
            className="sf-swatch"
            style={{ '--sf-swatch': c.highlight, '--sf-swatch-ink': c.ink } as CSSProperties}
            onClick={() => onColour(c.id)}
          />
        ))}
      </div>
      <span className="sf-toolbar-gap" />
      <button type="button" className="sf-tool" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Icon name="undo" size={18} />
        <span>Undo</span>
      </button>
      <button type="button" className="sf-tool" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
        <Icon name="redo" size={18} />
        <span>Redo</span>
      </button>
      <span className="sf-toolbar-fill" />
      <span className="sf-hint" data-testid="annotate-hint">
        {working ?? hint}
      </span>
      <button type="button" className="sf-button sf-primary" onClick={onSave} disabled={working !== null}>
        <Icon name="save" size={18} />
        Save as new file…
      </button>
    </div>
  );
}
