// The PDF engine runs here, in a worker inside the sandboxed window, so untrusted PDFs are never
// parsed with full Windows access (Phase 0 plan, question 3).
import { buildPdf } from '../../../engine/build';
import { inspectPdf } from '../../../engine/inspect';
import { checkSignatures } from '../../../engine/sign/check';
import { emptySignatureFields, insertSignature, prepareSignature } from '../../../engine/sign/prepare';
import type { PreparedSignature, SignRequest, TrustAnchor } from '../../../engine/sign/types';
import type { AnnotationInput, BuildOptions, PageItem, SourceInput } from '../../../engine/types';

type Job =
  | { id: number; kind: 'build'; sources: SourceInput[]; items: PageItem[]; annotations: AnnotationInput[]; options: BuildOptions }
  | { id: number; kind: 'inspect'; source: SourceInput }
  | { id: number; kind: 'signatures'; bytes: Uint8Array; trusted: TrustAnchor[]; password?: string }
  | { id: number; kind: 'empty-signature-fields'; bytes: Uint8Array; password?: string }
  | { id: number; kind: 'prepare-signature'; bytes: Uint8Array; request: SignRequest }
  | { id: number; kind: 'finish-signature'; prepared: PreparedSignature; signature: Uint8Array };

/**
 * The signature put in its place, then checked before anything is saved: the new signature must
 * cover the whole file and match it.
 */
async function finish(prepared: PreparedSignature, signature: Uint8Array): Promise<Uint8Array> {
  const signed = insertSignature(prepared, signature);
  const own = (await checkSignatures(signed, [])).find((c) => c.signedLength === signed.length);
  if (own?.status !== 'valid') throw new Error("The new signature didn't check out, so nothing was saved.");
  return signed;
}

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
    } else if (job.kind === 'inspect') {
      scope.postMessage({ id: job.id, ok: true, result: await inspectPdf(job.source) });
    } else if (job.kind === 'signatures') {
      scope.postMessage({ id: job.id, ok: true, result: await checkSignatures(job.bytes, job.trusted, job.password) });
    } else if (job.kind === 'empty-signature-fields') {
      scope.postMessage({ id: job.id, ok: true, result: await emptySignatureFields(job.bytes, job.password) });
    } else if (job.kind === 'prepare-signature') {
      const result = await prepareSignature(job.bytes, job.request);
      scope.postMessage({ id: job.id, ok: true, result }, [result.bytes.buffer]);
    } else {
      const result = await finish(job.prepared, job.signature);
      scope.postMessage({ id: job.id, ok: true, result }, [result.buffer]);
    }
  } catch (error) {
    scope.postMessage({ id: job.id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
