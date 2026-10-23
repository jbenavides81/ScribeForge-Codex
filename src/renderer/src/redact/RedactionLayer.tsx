import type { CSSProperties } from 'react';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { Rect } from '../../../engine/types';
import { REDACTION_COLOURS } from '../../../shared/annotationColours';
import { markLabel, type RedactMark } from './redactState';

/** A box being dragged out with Mark area (or for a signature), in pixels on its page. */
export interface DragBox {
  page: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** A signature's box is drawn as an outline only. */
  signature?: boolean;
}

const COLOURS = { '--sf-redact-fill': REDACTION_COLOURS.box, '--sf-redact-outline': REDACTION_COLOURS.outline } as CSSProperties;

/**
 * Draws redaction marks over the pages, see-through so the person can check what's under them.
 * Laid out like the annotation layer: it scrolls with the pages, and `layout` redraws it.
 */
export function RedactionLayer({
  viewer,
  container,
  marks,
  selected,
  interactive,
  drag,
  onSelect,
}: {
  viewer: PDFViewer | null;
  container: HTMLDivElement | null;
  marks: RedactMark[];
  selected: string | null;
  interactive: boolean;
  drag: DragBox | null;
  layout: number;
  onSelect: (id: string) => void;
}) {
  if (!viewer || !container) return null;
  const frame = container.getBoundingClientRect();
  const place = (pageIndex: number) => {
    const view = viewer.getPageView(pageIndex);
    if (!view?.div || !view.viewport) return null;
    const page = view.div.getBoundingClientRect();
    return { viewport: view.viewport, x: page.left - frame.left + container.scrollLeft, y: page.top - frame.top + container.scrollTop };
  };
  const at = (rect: Rect, where: NonNullable<ReturnType<typeof place>>): CSSProperties => {
    const a = where.viewport.convertToViewportPoint(rect[0], rect[1]);
    const b = where.viewport.convertToViewportPoint(rect[2], rect[3]);
    return {
      left: `${where.x + Math.min(a[0], b[0])}px`,
      top: `${where.y + Math.min(a[1], b[1])}px`,
      width: `${Math.abs(b[0] - a[0])}px`,
      height: `${Math.abs(b[1] - a[1])}px`,
    };
  };
  const dragPlace = drag ? place(drag.page) : null;

  return (
    <div className={`sf-redact-layer${interactive ? ' sf-redact-interactive' : ''}`} style={COLOURS} data-testid="redact-layer">
      {marks.map((m) => {
        const where = place(m.page);
        if (!where) return null;
        return (
          <span
            key={m.id}
            className="sf-redact-mark"
            data-mark={m.id}
            data-kind={m.kind}
            data-selected={m.id === selected}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : -1}
            aria-label={`Redaction mark on page ${m.page + 1}: ${markLabel(m)}`}
            title={markLabel(m)}
            onClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              onSelect(m.id);
            }}
            onKeyDown={(e) => {
              if (interactive && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onSelect(m.id);
              }
            }}
          >
            {m.rects.map((r, i) => (
              <span key={i} className="sf-redact-part" style={at(r, where)} />
            ))}
          </span>
        );
      })}
      {drag && dragPlace && (
        <span
          className={drag.signature ? 'sf-sign-drag' : 'sf-redact-drag'}
          style={{
            left: `${dragPlace.x + drag.left}px`,
            top: `${dragPlace.y + drag.top}px`,
            width: `${drag.right - drag.left}px`,
            height: `${drag.bottom - drag.top}px`,
          }}
        />
      )}
    </div>
  );
}
