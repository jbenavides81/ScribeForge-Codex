// pdf.js setup. This module must load before pdf.js's viewer components, which read the library
// from globalThis.pdfjsLib.
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { safeDocumentOptions } from '../../../shared/pdfOptions';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
(globalThis as Record<string, unknown>).pdfjsLib = pdfjsLib;

export { pdfjsLib };
export type PdfDocument = pdfjsLib.PDFDocumentProxy;

/** The app's own copy of pdf.js's fonts, character maps, decoders and colour profiles. */
export const PDFJS_ASSETS = new URL('pdfjs/', document.baseURI).href;

export type OpenFailure = 'cancelled' | 'damaged' | 'unreadable';

export class OpenError extends Error {
  constructor(readonly kind: OpenFailure) {
    super(kind);
  }
}

/**
 * Opens a document's bytes with ScribeForge's safe settings. `askPassword` is called when the
 * file is password-protected (again, with `retry` true, after a wrong password). It returns
 * null if the person cancels. Passwords are never stored.
 */
export async function loadDocument(
  bytes: Uint8Array,
  askPassword: (retry: boolean) => Promise<string | null>,
): Promise<PdfDocument> {
  const task = pdfjsLib.getDocument(safeDocumentOptions(bytes, PDFJS_ASSETS));
  let cancelled = false;
  task.onPassword = (update: (password: string) => void, reason: number) => {
    const retry = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
    void askPassword(retry).then((password) => {
      if (password === null) {
        cancelled = true;
        void task.destroy();
      } else {
        update(password);
      }
    });
  };
  try {
    return await task.promise;
  } catch (error) {
    if (cancelled) throw new OpenError('cancelled');
    const name = (error as { name?: string })?.name;
    if (name === 'InvalidPDFException' || name === 'FormatError') throw new OpenError('damaged');
    throw new OpenError('unreadable');
  }
}
