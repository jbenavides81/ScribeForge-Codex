import type { CSSProperties } from 'react';
import { annotationColour } from '../../../shared/annotationColours';
import type { Quad } from '../../../engine/types';
import { Icon } from '../components/Icon';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { TEXT_BOX_POINTS, type Annot } from './annotState';
import { markLineBox, quadToBox, type Box } from './geometry';

const NAMES: Record<Annot['kind'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikeout',
  note: 'Note',
  text: 'Text box',
};

/**
 * Draws the annotations added in ScribeForge over the document's pages, at the current zoom.
 * It sits beside pdf.js's pages inside the scrolling area, so it scrolls with them. `layout`
 * changes whenever pdf.js re-lays out the pages, which redraws this.
 */
export function AnnotationLayer({
  viewer,
  container,
  annots,
  selected,
  interactive,
  onSelect,
}: {
  viewer: PDFViewer | null;
  container: HTMLDivElement | null;
  annots: Annot[];
  selected: string | null;
  /** With the Select tool, annotations can be clicked; otherwise clicks go through to the page. */
  interactive: boolean;
  layout: number;
  onSelect: (id: string) => void;
}) {
  if (!viewer || !container) return null;
  const frame = container.getBoundingClientRect();

  const place = (pageIndex: number) => {
    const view = viewer.getPageView(pageIndex);
    if (!view?.div || !view.viewport) return null;
    const page = view.div.getBoundingClientRect();
    return {
      viewport: view.viewport,
      x: page.left - frame.left + container.scrollLeft,
      y: page.top - frame.top + container.scrollTop,
    };
  };

  const at = (b: Box, x: number, y: number): CSSProperties => ({ left: `${x + b.left}px`, top: `${y + b.top}px`, width: `${b.right - b.left}px`, height: `${b.bottom - b.top}px` });

  return (
    <div className={`sf-annot-layer${interactive ? ' sf-annot-interactive' : ''}`} data-testid="annot-layer">
      {annots.map((a) => {
        const where = place(a.page);
        if (!where) return null;
        const colour = annotationColour(a.colourId);
        const style = { '--sf-annot-colour': a.kind === 'highlight' || a.kind === 'note' ? colour.highlight : colour.ink, '--sf-annot-ink': colour.ink } as CSSProperties;
        const label = `${NAMES[a.kind]} on page ${a.page + 1}${a.text ? `: ${a.text}` : ''}`;
        const common = {
          'data-annot': a.id,
          'data-kind': a.kind,
          'data-selected': a.id === selected,
          role: interactive ? 'button' : undefined,
          tabIndex: interactive ? 0 : -1,
          'aria-label': label,
          title: a.text || NAMES[a.kind],
          onClick: (e: React.MouseEvent) => {
            if (!interactive) return;
            e.stopPropagation();
            onSelect(a.id);
          },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (interactive && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onSelect(a.id);
            }
          },
        };

        if (a.kind === 'note' || a.kind === 'text') {
          const box = quadToBox(a.box as Quad, where.viewport);
          if (a.kind === 'note') {
            return (
              <span key={a.id} className="sf-annot sf-annot-note" style={{ ...style, ...at(box, where.x, where.y) }} {...common}>
                <Icon name="note" size={Math.max(12, Math.round((box.right - box.left) * 0.7))} />
              </span>
            );
          }
          const scale = where.viewport.scale as number;
          return (
            <span
              key={a.id}
              className="sf-annot sf-annot-text"
              data-empty={a.text.trim() === ''}
              style={{
                ...style,
                left: `${where.x + box.left}px`,
                top: `${where.y + box.top}px`,
                width: `${box.right - box.left}px`,
                minHeight: `${box.bottom - box.top}px`,
                fontSize: `${(a.fontSize ?? TEXT_BOX_POINTS) * scale}px`,
                padding: `${4 * scale}px`,
              }}
              {...common}
            >
              {a.text}
            </span>
          );
        }

        // Each marked line is a click area; underlines and strikeouts also draw their line, the
        // same line the saved file has (along the text, even on a page turned sideways).
        const kind = a.kind;
        return (
          <span key={a.id} className={`sf-annot sf-annot-${kind}`} style={style} {...common}>
            {(a.quads ?? []).map((q, i) => (
              <span key={i} className="sf-annot-part" style={at(quadToBox(q, where.viewport), where.x, where.y)} />
            ))}
            {(kind === 'underline' || kind === 'strikeout') &&
              (a.quads ?? []).map((q, i) => <span key={`line${i}`} className="sf-annot-line" style={at(markLineBox(q, kind, where.viewport), where.x, where.y)} />)}
          </span>
        );
      })}
    </div>
  );
}
