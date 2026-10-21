// What the command-line tool and its hidden window pass to each other.
import type { RedactedPage } from '../engine/types';

/** An area to redact: on a 1-based page, measured from its top-left corner as it's shown, in points. */
export interface Area {
  page: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the hidden window is asked to do for "redact". */
export interface RenderJob {
  bytes: Uint8Array;
  password?: string;
  dpi: number;
  /** 0-based pages to black out completely. */
  wholePages: number[];
  areas: Area[];
  find: string[];
}

export interface RenderResult {
  /** Marked pages, drawn as pictures, by 0-based page. */
  pages: Record<number, RedactedPage>;
  marks: number;
  /** How many times each --find text was found. */
  matches: Record<string, number>;
}

/** What the command-line tool's window can use (window.scribeforgeCli). */
export interface CliBridge {
  /** "render" (hidden, draws redacted pages) or "password" (asks for a PDF's password). */
  mode: string;
  /** The PDF a password is asked for. */
  fileName: string;
  /** True when the last password didn't work. */
  retry: boolean;
  ready(): void;
  onJob(listener: (job: RenderJob) => void): void;
  sendResult(result: RenderResult | { error: string }): void;
  sendPassword(password: string | null): void;
}
