// Comparing two versions of a stored document, side by side, page by page (stop 3c). Both versions
// are decrypted into memory only, and closed when this view closes or the vault locks.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { compareDocuments, CompareStopped, type Comparison, type PageComparison, type Rect } from '../../../engine/compare/compare';
import { COMPARE_COLOURS } from '../../../shared/annotationColours';
import type { VaultDocument, VaultVersion } from '../../../shared/vault';
import { compareProgress, compareSummary, pageHeading, textChangeLines } from '../compare/describe';
import { drawPage, pdfSource } from '../compare/source';
import { formatDate } from '../details/describe';
import type { PdfDocument } from '../viewer/pdfjs';

const api = window.scribeforge;
const COLOURS = { '--sf-compare-edge': COMPARE_COLOURS.edge, '--sf-compare-fill': COMPARE_COLOURS.fill } as CSSProperties;
/** Each page is shown about this many pixels wide. */
const SHOWN_WIDTH = 420;
/** At most this many pages are listed at first; the rest on request. */
const FIRST_PAGES = 40;

/** One side of a page pair: the page, drawn when it scrolls into view, with boxes around what changed. */
function ComparePage({ pdf, page, regions, label }: { pdf: PdfDocument; page: number; regions: Rect[]; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let current = true;
    void pdf.getPage(page).then((p) => {
      const v = p.getViewport({ scale: 1 });
      if (current) setSize({ width: v.width, height: v.height });
    });
    const target = canvas.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        void drawPage(pdf, page, target, SHOWN_WIDTH).catch(() => {});
      },
      { rootMargin: '600px' },
    );
    observer.observe(target);
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [pdf, page]);
  return (
    <figure className="sf-compare-side">
      <div className="sf-compare-page" style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}>
        <canvas ref={canvas} aria-hidden="true" />
        {size &&
          regions.map((r, i) => (
            <span
              key={i}
              className="sf-compare-box"
              data-testid="compare-box"
              style={{ left: `${(r.x / size.width) * 100}%`, top: `${(r.y / size.height) * 100}%`, width: `${(r.width / size.width) * 100}%`, height: `${(r.height / size.height) * 100}%` }}
            />
          ))}
      </div>
      <figcaption className="sf-muted">{label}</figcaption>
    </figure>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <div className="sf-compare-side">
      <p className="sf-compare-missing">{text}</p>
    </div>
  );
}

export function CompareView({
  doc,
  first,
  second,
  readPdf,
  onBack,
}: {
  doc: VaultDocument;
  first: VaultVersion;
  second: VaultVersion;
  /** Opens a version's bytes with pdf.js (asking for its password if it has one); null if it can't be. */
  readPdf: (bytes: Uint8Array, name: string) => Promise<PdfDocument | null>;
  onBack: () => void;
}) {
  const [pdfs, setPdfs] = useState<{ a: PdfDocument; b: PdfDocument } | null>(null);
  const [progress, setProgress] = useState<string | null>('Opening the two versions…');
  const [result, setResult] = useState<Comparison | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showSame, setShowSame] = useState(false);
  const [listed, setListed] = useState(FIRST_PAGES);
  const stop = useRef(false);

  useEffect(() => {
    let alive = true;
    const opened: PdfDocument[] = [];
    void (async () => {
      const versions = [];
      for (const v of [first, second]) {
        const r = await api.vaultOpenVersion(doc.id, v.id);
        if (!r.ok) throw new Error(r.message);
        const pdf = await readPdf(r.value.bytes, r.value.name);
        if (!pdf) throw new Error(`Version ${v.number} couldn't be opened.`);
        if (!alive) return void pdf.loadingTask.destroy();
        opened.push(pdf);
        versions.push(pdf);
      }
      const [a, b] = versions;
      setPdfs({ a, b });
      const comparison = await compareDocuments(pdfSource(a), pdfSource(b), {
        onProgress: (stage, done, total) => alive && setProgress(compareProgress(stage, done, total)),
        stopped: () => !alive || stop.current,
      });
      if (alive) setResult(comparison);
    })()
      .catch((error: unknown) => {
        if (!alive) return;
        setProblem(error instanceof CompareStopped ? 'The comparison was stopped.' : `The versions couldn't be compared. ${error instanceof Error ? error.message : ''}`.trim());
      })
      .finally(() => alive && setProgress(null));
    return () => {
      alive = false;
      for (const pdf of opened) void pdf.loadingTask.destroy();
    };
  }, [doc.id, first, second, readPdf]);

  const rows: PageComparison[] = result ? result.pages.filter((p) => showSame || p.status !== 'same') : [];
  return (
    <section className="sf-compare" aria-labelledby="compare-heading" data-testid="compare-view" style={COLOURS}>
      <div className="sf-section-head">
        <h1 id="compare-heading">Compare versions</h1>
        <button type="button" className="sf-button" onClick={onBack}>
          Back to the Archive
        </button>
      </div>
      <p className="sf-muted">
        “{doc.title}”: version {first.number} (added {formatDate(first.added)}) and version {second.number} (added {formatDate(second.added)}).
      </p>
      {progress && (
        <p className="sf-compare-progress" role="status" data-testid="compare-progress">
          {progress}
          <button type="button" className="sf-button" onClick={() => (stop.current = true)}>
            Stop
          </button>
        </p>
      )}
      {problem && (
        <p className="sf-error" role="alert">
          {problem}
        </p>
      )}
      {result && (
        <>
          <p className="sf-strong" data-testid="compare-summary">
            {compareSummary(result)}
          </p>
          {!result.identical && result.same > 0 && (
            <label className="sf-choice">
              <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
              <span>Show the pages that are the same</span>
            </label>
          )}
        </>
      )}
      {result && pdfs && (
        <ol className="sf-compare-pages">
          {rows.slice(0, listed).map((p) => (
            <li key={`${p.a}:${p.b}`} data-testid="compare-page" data-status={p.status}>
              <h2 className="sf-compare-heading">{pageHeading(p, second.number)}</h2>
              <div className="sf-compare-pair">
                {p.a === null ? <Missing text={`Not in version ${first.number}`} /> : <ComparePage pdf={pdfs.a} page={p.a} regions={p.regions} label={`Version ${first.number}, page ${p.a}`} />}
                {p.b === null ? <Missing text={`Not in version ${second.number}`} /> : <ComparePage pdf={pdfs.b} page={p.b} regions={p.regions} label={`Version ${second.number}, page ${p.b}`} />}
              </div>
              {textChangeLines(p.text, p.status).length > 0 && (
                <ul className="sf-compare-text">
                  {textChangeLines(p.text, p.status).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {rows.length > listed && (
        <button type="button" className="sf-button" onClick={() => setListed((n) => n + FIRST_PAGES)}>
          Show {Math.min(FIRST_PAGES, rows.length - listed)} more pages
        </button>
      )}
    </section>
  );
}
