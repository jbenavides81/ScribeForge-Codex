// The PDF engine runs here, in a worker inside the sandboxed window, so untrusted PDFs are never
// parsed with full Windows access (Phase 0 plan, question 3).
import { buildPdf } from '../../../engine/build';
import { inspectPdf } from '../../../engine/inspect';
import type { AnnotationInput, BuildOptions, PageItem, SourceInput } from '../../../engine/types';

type Job =
  | { id: number; kind: 'build'; sources: SourceInput[]; items: PageItem[]; annotations: AnnotationInput[]; options: BuildOptions }
  | { id: number; kind: 'inspect'; source: SourceInput };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Job>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (event) => {
  const job = event.data;
  try {
    if (job.kind === 'build') {
      const result = await buildPdf(job.sources, job.items, job.annotations, job.options);
      scope.postMessage({ id: job.id, ok: true, result }, [result.bytes.buffer]);
    } else {
      scope.postMessage({ id: job.id, ok: true, result: await inspectPdf(job.source) });
    }
  } catch (error) {
    scope.postMessage({ id: job.id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
