import type { BuildReport, PageItem, SourceInput } from '../../../engine/types';

type Reply = { id: number; ok: true; bytes: Uint8Array; report: BuildReport } | { id: number; ok: false; message: string };

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (r: { bytes: Uint8Array; report: BuildReport }) => void; reject: (e: Error) => void }>();

function engine(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      const job = waiting.get(reply.id);
      if (!job) return;
      waiting.delete(reply.id);
      if (reply.ok) job.resolve({ bytes: reply.bytes, report: reply.report });
      else job.reject(new Error(reply.message));
    };
    worker.onerror = (event) => {
      for (const job of waiting.values()) job.reject(new Error(event.message || 'The PDF engine stopped.'));
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Builds a new PDF from pages of the sources. The sources' bytes are copied, never changed. */
export function buildDocument(sources: SourceInput[], items: PageItem[]): Promise<{ bytes: Uint8Array; report: BuildReport }> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    engine().postMessage({ id, sources: sources.map((s) => ({ ...s, bytes: s.bytes.slice() })), items });
  });
}
