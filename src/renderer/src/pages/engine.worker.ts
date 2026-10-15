// The PDF engine runs here, in a worker inside the sandboxed window, so untrusted PDFs are never
// parsed with full Windows access (Phase 0 plan, question 3).
import { buildPdf } from '../../../engine/build';
import type { PageItem, SourceInput } from '../../../engine/types';

interface BuildMessage {
  id: number;
  sources: SourceInput[];
  items: PageItem[];
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BuildMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (event) => {
  const { id, sources, items } = event.data;
  try {
    const { bytes, report } = await buildPdf(sources, items);
    scope.postMessage({ id, ok: true, bytes, report }, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
