import type { EmptySignatureField, PreparedSignature, SignatureCheck, SignRequest, TrustAnchor } from '../../../engine/sign/types';
import type { AnnotationInput, BuildOptions, BuildReport, FileReport, PageItem, SourceInput } from '../../../engine/types';

type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; message: string };

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (result: unknown) => void; reject: (e: Error) => void }>();

function engine(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      const job = waiting.get(reply.id);
      if (!job) return;
      waiting.delete(reply.id);
      if (reply.ok) job.resolve(reply.result);
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

function run<T>(job: Record<string, unknown>): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (result: unknown) => void, reject });
    engine().postMessage({ id, ...job });
  });
}

/** Sources go to the worker as copies, so the originals' bytes are never changed or moved. */
const copied = (s: SourceInput): SourceInput => ({ ...s, bytes: s.bytes.slice() });

/** Builds a new PDF from pages of the sources. */
export function buildDocument(
  sources: SourceInput[],
  items: PageItem[],
  annotations: AnnotationInput[] = [],
  options: BuildOptions = {},
): Promise<{ bytes: Uint8Array; report: BuildReport; found: string[] }> {
  return run({ kind: 'build', sources: sources.map(copied), items, annotations, options });
}

/** A PDF's details and what it carries. */
export function inspectDocument(source: SourceInput): Promise<FileReport> {
  return run({ kind: 'inspect', source: copied(source) });
}

/** Checks every signature in a PDF against the trusted certificates. */
export function checkDocumentSignatures(bytes: Uint8Array, trusted: TrustAnchor[], password?: string): Promise<SignatureCheck[]> {
  return run({ kind: 'signatures', bytes: bytes.slice(), trusted, password });
}

/** The empty signature boxes a PDF has, which can be signed in. */
export function emptySignatureBoxes(bytes: Uint8Array, password?: string): Promise<EmptySignatureField[]> {
  return run({ kind: 'empty-signature-fields', bytes: bytes.slice(), password });
}

/** Signing, step 1: the file with the signature's field, look and space added, and the fingerprint to sign. */
export function prepareSigning(bytes: Uint8Array, request: SignRequest): Promise<PreparedSignature> {
  return run({ kind: 'prepare-signature', bytes: bytes.slice(), request });
}

/** Signing, step 3: the signature in its place, checked. */
export function finishSigning(prepared: PreparedSignature, signature: Uint8Array): Promise<Uint8Array> {
  return run({ kind: 'finish-signature', prepared, signature });
}
