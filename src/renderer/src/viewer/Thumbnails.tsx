import { useEffect, useRef } from 'react';
import type { PdfDocument } from './pdfjs';

const THUMB_WIDTH = 112;

/**
 * Page thumbnails. Each one is drawn only when it scrolls into view, two at a time, so a
 * 500-page file doesn't render 500 images up front.
 */
export function Thumbnails({
  pdf,
  currentPage,
  onSelect,
}: {
  pdf: PdfDocument;
  currentPage: number;
  onSelect: (page: number) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const queue: HTMLCanvasElement[] = [];
    let running = 0;
    let stopped = false;

    const pump = () => {
      while (!stopped && running < 2 && queue.length > 0) {
        const canvas = queue.shift() as HTMLCanvasElement;
        const pageNumber = Number(canvas.dataset.page);
        running++;
        void pdf
          .getPage(pageNumber)
          .then(async (page) => {
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
            canvas.width = Math.round(viewport.width * window.devicePixelRatio);
            canvas.height = Math.round(viewport.height * window.devicePixelRatio);
            canvas.style.width = `${Math.round(viewport.width)}px`;
            canvas.style.height = `${Math.round(viewport.height)}px`;
            const scaled = page.getViewport({ scale: (THUMB_WIDTH / base.width) * window.devicePixelRatio });
            if (!stopped) await page.render({ canvas, viewport: scaled }).promise;
            canvas.dataset.rendered = 'true';
          })
          .catch(() => {
            canvas.dataset.rendered = 'failed';
          })
          .finally(() => {
            running--;
            pump();
          });
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const canvas = entry.target as HTMLCanvasElement;
          if (entry.isIntersecting && !canvas.dataset.rendered && !queue.includes(canvas)) {
            canvas.dataset.rendered = 'queued';
            queue.push(canvas);
          }
        }
        pump();
      },
      { root: list, rootMargin: '200px 0px' },
    );
    list.querySelectorAll('canvas').forEach((c) => observer.observe(c));
    return () => {
      stopped = true;
      observer.disconnect();
    };
  }, [pdf]);

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [currentPage]);

  const pages = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  return (
    <ol ref={listRef} className="sf-thumbs" aria-label="Pages">
      {pages.map((n) => (
        <li key={n} data-thumb={n}>
          <button
            type="button"
            className="sf-thumb"
            aria-current={n === currentPage ? 'page' : undefined}
            aria-label={`Page ${n}`}
            onClick={() => onSelect(n)}
          >
            <canvas data-page={n} className="sf-thumb-canvas" />
            <span className="sf-thumb-number">{n}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
