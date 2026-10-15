import type { SourceInput } from '../../../engine/types';
import type { PdfDocument } from '../viewer/pdfjs';

/** A file whose pages are in the Pages screen: the open document, or one added to it. */
export interface SourceDoc {
  id: string;
  name: string;
  path: string;
  /** The file as it was read. Never changed; the engine works on copies. */
  bytes: Uint8Array;
  /** Only for password-protected files, kept in memory while the document is open. */
  password?: string;
  /** For drawing thumbnails. */
  pdf: PdfDocument;
}

export function engineInput(source: SourceDoc): SourceInput {
  return { id: source.id, name: source.name, bytes: source.bytes, password: source.password };
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
}
