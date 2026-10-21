import type { CSSProperties, ReactNode } from 'react';
import { ANNOTATION_COLOURS } from '../../../shared/annotationColours';
import type { StampKind } from '../../../engine/types';
import { Icon, type IconName } from '../components/Icon';
import { LINE_WIDTHS, STAMPS, TEXT_SIZES } from './annotState';

export type Tool = 'select' | 'highlight' | 'underline' | 'strikeout' | 'note' | 'text' | 'ink' | 'shape' | 'stamp';
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

/** Settings for the next annotation made with a tool. */
export interface ToolOptions {
  shape: ShapeKind;
  width: number;
  fill: boolean;
  fontSize: number;
  stamp: StampKind;
  stampText: string;
}

export const SHAPES: { id: ShapeKind; label: string; icon: IconName }[] = [
  { id: 'rect', label: 'Rectangle', icon: 'rect' },
  { id: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
  { id: 'line', label: 'Line', icon: 'line' },
  { id: 'arrow', label: 'Arrow', icon: 'arrow' },
];

export const TOOLS: { id: Tool; label: string; icon: IconName; hint: (o: ToolOptions) => string }[] = [
  { id: 'select', label: 'Select', icon: 'select', hint: () => 'Select text to copy it, or click an annotation to change, move or resize it.' },
  { id: 'highlight', label: 'Highlight', icon: 'highlight', hint: () => 'Select text to highlight it.' },
  { id: 'underline', label: 'Underline', icon: 'underline', hint: () => 'Select text to underline it.' },
  { id: 'strikeout', label: 'Strikeout', icon: 'strikeout', hint: () => 'Select text to strike it out.' },
  { id: 'note', label: 'Note', icon: 'note', hint: () => 'Click on the page where the note goes.' },
  { id: 'text', label: 'Text box', icon: 'textbox', hint: () => 'Click on the page where the text box goes.' },
  { id: 'ink', label: 'Draw', icon: 'draw', hint: () => 'Draw on the page with the mouse. Each stroke adds to the drawing until you choose another tool.' },
  {
    id: 'shape',
    label: 'Shape',
    icon: 'rect',
    hint: (o) => (o.shape === 'line' || o.shape === 'arrow' ? `Drag on the page from where the ${o.shape} starts to where it ends.` : 'Drag across the page where the shape goes.'),
  },
  { id: 'stamp', label: 'Stamp', icon: 'stamp', hint: () => 'Click on the page where the stamp goes.' },
];

export function AnnotateToolbar({
  lead,
  tool,
  onTool,
  colourId,
  onColour,
  options,
  onOptions,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  commentsOpen,
  onComments,
  onSave,
  working,
}: {
  /** Shown first: the Annotate / Redact switch. */
  lead?: ReactNode;
  tool: Tool;
  onTool: (tool: Tool) => void;
  colourId: string;
  onColour: (id: string) => void;
  options: ToolOptions;
  onOptions: (change: Partial<ToolOptions>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  commentsOpen: boolean;
  onComments: () => void;
  onSave: () => void;
  working: string | null;
}) {
  const hint = TOOLS.find((t) => t.id === tool)?.hint(options) ?? '';
  const lined = tool === 'ink' || tool === 'shape';
  return (
    <div className="sf-toolbar sf-annotate-bar" role="toolbar" aria-label="Annotate">
      {lead}
      {TOOLS.map((t) => (
        <button key={t.id} type="button" className="sf-tool" aria-pressed={tool === t.id} onClick={() => onTool(t.id)}>
          <Icon name={t.id === 'shape' ? (SHAPES.find((s) => s.id === options.shape)?.icon ?? 'rect') : t.icon} size={18} />
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
      {tool === 'shape' && (
        <label className="sf-tool-option">
          <span>Shape</span>
          <select aria-label="Shape" value={options.shape} onChange={(e) => onOptions({ shape: e.target.value as ShapeKind })}>
            {SHAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {lined && (
        <label className="sf-tool-option">
          <span>Thickness</span>
          <select aria-label="Thickness" value={options.width} onChange={(e) => onOptions({ width: Number(e.target.value) })}>
            {LINE_WIDTHS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === 'shape' && (options.shape === 'rect' || options.shape === 'ellipse') && (
        <label className="sf-tool-option sf-choice">
          <input type="checkbox" checked={options.fill} onChange={(e) => onOptions({ fill: e.target.checked })} />
          <span>Fill</span>
        </label>
      )}
      {tool === 'text' && (
        <label className="sf-tool-option">
          <span>Text size</span>
          <select aria-label="Text size" value={options.fontSize} onChange={(e) => onOptions({ fontSize: Number(e.target.value) })}>
            {TEXT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} pt
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === 'stamp' && (
        <label className="sf-tool-option">
          <span>Stamp</span>
          <select aria-label="Stamp" value={options.stamp} onChange={(e) => onOptions({ stamp: e.target.value as StampKind })}>
            {STAMPS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === 'stamp' && options.stamp === 'custom' && (
        <label className="sf-tool-option">
          <span>Stamp text</span>
          <input type="text" aria-label="Stamp text" maxLength={40} value={options.stampText} placeholder="Such as Paid" onChange={(e) => onOptions({ stampText: e.target.value })} />
        </label>
      )}
      <span className="sf-toolbar-gap" />
      <button type="button" className="sf-tool" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Icon name="undo" size={18} />
        <span>Undo</span>
      </button>
      <button type="button" className="sf-tool" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
        <Icon name="redo" size={18} />
        <span>Redo</span>
      </button>
      <button type="button" className="sf-tool" aria-pressed={commentsOpen} onClick={onComments} title="All comments (Ctrl+Shift+M)">
        <Icon name="comments" size={18} />
        <span>Comments</span>
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
