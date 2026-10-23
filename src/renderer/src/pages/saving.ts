// Saving new files, shared by the Document, Pages and Details screens. Every save builds a
// brand-new PDF from the pages as arranged on the Pages screen, the annotations added on the
// Document screen and the details from the Details screen; the original is never touched unless
// the person chooses to replace it. Before saving, the person can see what the new file carries.
// Redacting also saves a new file, built the same way from the pages as arranged.
import { useCallback, useRef, useState } from 'react';
import { outputName } from '../../../engine/names';
import { signatureSpace } from '../../../engine/sign/space';
import type { CertificateSummary, SignaturePlace } from '../../../engine/sign/types';
import { emptyReport, type AnnotationInput, type BuildReport, type Carries, type CleanOptions, type DocInfo, type PageItem, type RedactedPage, type RedactKeep } from '../../../engine/types';
import type { RedactionDpi } from '../../../shared/settings';
import { toEngineInput, type AnnotState } from '../annotate/annotState';
import { fileChanges, type FileAnnot } from '../annotate/fileAnnots';
import { combineCarries } from '../details/describe';
import { burnPage } from '../redact/burn';
import { redactionLog } from '../redact/log';
import { completeTerms, type RedactMark } from '../redact/redactState';
import { browserSurface } from '../redact/surface';
import { pdfjsLib } from '../viewer/pdfjs';
import { plural } from '../words';
import { buildNotes, cleanedMessage, cleanNotes, redactedMessage, redactionNotes, savedMessage } from './report';
import { boxTime } from '../sign/describe';
import { buildDocument, finishSigning, inspectDocument, prepareSigning } from './engineClient';
import type { EditState, Tile } from './editState';
import { engineInput, type ConfirmRequest, type SourceDoc } from './sources';

const api = window.scribeforge;

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Several build reports added together (for split). */
function addReports(reports: BuildReport[]): BuildReport {
  const total = emptyReport();
  for (const r of reports) for (const key of Object.keys(total) as (keyof BuildReport)[]) total[key] += r[key];
  return total;
}

/** What the person chose in the signing window. Page numbers are the open file's, as shown. */
export interface SignChoices {
  certificate: CertificateSummary;
  /** Size of the certificates, to keep room for the signature. */
  certificateBytes: number;
  place: SignaturePlace;
  reason: string;
  location: string;
}

/**
 * Why signing makes a new file first, instead of adding to the file as it is: unsaved changes,
 * a password (the new file has none), or a file whose structure is damaged. Null when it doesn't.
 */
export type NewFileReason = 'changes' | 'password' | 'damaged' | null;

/** Shown before saving, when Settings says so. */
export interface ReviewRequest {
  carries: Carries;
  /** How many new files (more than one when splitting). */
  files: number;
  notes: string[];
  /** For redaction, which has its own heading. */
  title?: string;
}

export function useSaving({
  sources,
  edit,
  annots,
  fileAnnots,
  authorName,
  details,
  producer,
  reviewBeforeSave,
  redactionDpi,
  signed: signedCount,
  confirm,
  review,
  reviewMarks,
  onMessage,
  onSaved,
  onSigned,
  onRedacted,
}: {
  sources: SourceDoc[];
  edit: EditState;
  annots: AnnotState;
  /** The annotations already in the open file, for saving changes to them. */
  fileAnnots: FileAnnot[];
  authorName: string;
  /** The new file's title, author, subject and keywords, once the open file's are known. */
  details: DocInfo | undefined;
  producer: string;
  reviewBeforeSave: boolean;
  redactionDpi: RedactionDpi;
  /** How many signatures the open file has (null until it's been read): new files leave them out, so saving asks first. */
  signed: number | null;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  review: (request: ReviewRequest) => Promise<boolean>;
  /** Shows the redaction marks for checking. The marks left when the person goes on, or null. */
  reviewMarks: () => Promise<{ marks: RedactMark[]; log: boolean; keep: RedactKeep } | null>;
  onMessage: (text: string) => void;
  /** Opens the saved file; the message about saving is shown once it's open. */
  onSaved: (path: string) => Promise<void>;
  /** Opens the signed file (asking first if redaction marks would be lost). */
  onSigned: (path: string) => Promise<void>;
  onRedacted: (path: string) => Promise<void>;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const busy = useRef(false);
  const primary = sources[0];

  const annotations = (): AnnotationInput[] =>
    primary ? annots.items.flatMap((a) => toEngineInput(a, primary.id, authorName) ?? []) : [];

  const usedSources = (items: PageItem[]) => sources.filter((s) => items.some((i) => i.kind === 'page' && i.source === s.id));

  const build = (items: PageItem[], clean?: CleanOptions) =>
    buildDocument(usedSources(items).map(engineInput), items, annotations(), {
      details,
      producer,
      clean,
      fileChanges: primary ? fileChanges(fileAnnots, annots.edits, primary.id, annots.flattenAll) : [],
      flattenAll: annots.flattenAll,
    });

  /**
   * Asks first when any page comes from a locked file: one that needs a password to open, or
   * whose author set restrictions. The new file has neither.
   */
  const lockCheck = async (items: PageItem[]): Promise<boolean> => {
    const used = usedSources(items);
    const withPassword = used.filter((s) => s.password);
    const restricted = used.filter((s) => !s.password && s.permissions);
    if (withPassword.length + restricted.length === 0) return true;
    const names = (list: SourceDoc[]) => `${list.map((s) => s.name).join(', ')} ${list.length === 1 ? 'is' : 'are'}`;
    const lines: string[] = [];
    if (withPassword.length > 0) lines.push(`${names(withPassword)} password-protected. The new file will open without a password.`);
    if (restricted.length > 0) {
      lines.push(`${names(restricted)} locked by ${restricted.length === 1 ? 'its author' : 'their authors'} against some uses, such as copying or changes. The new file won't have those restrictions.`);
    }
    return confirm({
      title: withPassword.length > 0 ? "The new file won't have a password" : "The new file won't have restrictions",
      message: lines.join(' '),
      confirmLabel: withPassword.length > 0 ? 'Save without a password' : 'Save without restrictions',
    });
  };

  /** Asks first when the new file's pages come from the open file and it's signed: the new file won't be. */
  const signedCheck = async (items: PageItem[], forSigning = false): Promise<boolean> => {
    if (!items.some((i) => i.kind === 'page' && i.source === primary.id)) return true;
    // Not read yet (just opened): read it now, so the question is never skipped.
    const signed = signedCount ?? (await inspectDocument(engineInput(primary))).carries.signatures.filter((s) => s.signed).length;
    if (signed === 0) return true;
    const which = signed === 1 ? 'its signature' : `its ${signed} signatures`;
    return confirm({
      title: forSigning ? "Its signatures won't come across" : "The new file won't be signed",
      message: forSigning
        ? `${primary.name} is signed, and has changes that aren't saved. ScribeForge makes a new file with your changes, then signs that. The new file can't keep ${which}: a signature only holds for the exact file that was signed.`
        : `${primary.name} is signed. The new file won't be: a signature only holds for the exact file that was signed, so ${which} ${signed === 1 ? 'is' : 'are'} left out, with ${signed === 1 ? 'its box' : 'their boxes'}.`,
      confirmLabel: forSigning ? 'Make the new file and sign it' : 'Save without the signatures',
    });
  };

  /** Runs one save at a time, showing what's happening. */
  const run = async (task: () => Promise<void>) => {
    if (busy.current || !primary) return;
    busy.current = true;
    try {
      await task();
    } catch (error) {
      onMessage(`ScribeForge couldn't make the new file. ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  /** Shows what the new files carry, when Settings says so. True to go on and save. */
  const reviewed = async (made: { name: string; bytes: Uint8Array }[], report: BuildReport, notes = buildNotes(report), title?: string): Promise<boolean> => {
    if (!reviewBeforeSave) return true;
    setWorking('Checking what the new file carries…');
    const carries: Carries[] = [];
    for (const file of made) carries.push((await inspectDocument({ id: file.name, name: file.name, bytes: file.bytes })).carries);
    setWorking(null);
    return review({ carries: combineCarries(carries), files: made.length, notes, title });
  };

  const save = (tiles: Tile[], name: string, openAfter: boolean) =>
    run(async () => {
      const items = tiles.map((t) => t.item);
      if (items.length === 0 || !(await lockCheck(items)) || !(await signedCheck(items))) return;
      setWorking('Making the new file…');
      const { bytes, report } = await build(items);
      if (!(await reviewed([{ name, bytes }], report))) return;
      setWorking('Saving…');
      const result = await api.saveFile({ bytes, suggestedName: name, sourcePaths: sources.map((s) => s.path) });
      if (result.ok) {
        if (openAfter) {
          setWorking('Opening the new file…');
          await onSaved(result.path);
        }
        onMessage(savedMessage(result.path, report));
      } else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the file.");
    });

  const saveAll = useCallback(() => {
    if (!primary) return Promise.resolve();
    const merged = usedSources(edit.tiles.map((t) => t.item)).length > 1;
    return save(edit.tiles, outputName(primary.name, merged ? 'merged' : 'edited'), true);
  }, [primary, edit, annots, fileAnnots, authorName, sources, details, producer, reviewBeforeSave, signedCount]);

  const saveSelected = (tiles: Tile[]) => {
    const positions = tiles.map((t) => edit.tiles.indexOf(t) + 1);
    return save(tiles, outputName(primary.name, { pages: positions }), false);
  };

  const split = (parts: number[][]) =>
    run(async () => {
      const groups = parts.map((part) => part.map((n) => edit.tiles[n - 1]));
      const all = groups.flat().map((t) => t.item);
      if (!(await lockCheck(all)) || !(await signedCheck(all))) return;
      const files: { name: string; bytes: Uint8Array }[] = [];
      const reports: BuildReport[] = [];
      for (const [i, group] of groups.entries()) {
        setWorking(`Making file ${i + 1} of ${groups.length}…`);
        const { bytes, report } = await build(group.map((t) => t.item));
        files.push({ name: outputName(primary.name, { pages: parts[i] }), bytes });
        reports.push(report);
      }
      if (!(await reviewed(files, addReports(reports)))) return;
      setWorking('Saving…');
      const result = await api.saveFiles({ files, sourcePaths: sources.map((s) => s.path) });
      if (result.ok) onMessage(`Split into ${plural(result.paths.length, 'file')} in ${result.folder}.`);
      else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the files.");
    });

  /**
   * Redact: after the marks are checked, each marked page is drawn as a picture with its marks
   * blacked out, and a new file is built from the pages as arranged. A last check searches the
   * new file for every search term whose matches were all marked. The person then sees what the
   * redacted file carries, and chooses where to save it.
   */
  const redact = () =>
    run(async () => {
      const reviewedMarks = await reviewMarks();
      if (!reviewedMarks || reviewedMarks.marks.length === 0) return;
      const { marks, log, keep } = reviewedMarks;
      const items = edit.tiles.map((t) => t.item);
      if (items.length === 0 || !(await lockCheck(items)) || !(await signedCheck(items))) return;
      const kept = new Set(items.flatMap((i) => (i.kind === 'page' && i.source === primary.id ? [i.index] : [])));
      const byPage = new Map<number, RedactMark[]>();
      for (const m of marks) if (kept.has(m.page)) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m]);
      const used = [...byPage.values()].reduce((n, list) => n + list.length, 0);

      const pages: Record<string, RedactedPage> = {};
      let n = 0;
      for (const [index, list] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
        setWorking(`Blacking out page ${++n} of ${byPage.size}…`);
        const page = await primary.pdf.getPage(index + 1);
        pages[`${primary.id}:${index}`] = await burnPage(page, list.flatMap((m) => m.rects), redactionDpi, browserSurface, pdfjsLib.AnnotationMode.DISABLE);
      }
      setWorking('Making the redacted file…');
      const terms = completeTerms(marks);
      const { bytes, report, found } = await buildDocument(usedSources(items).map(engineInput), items, [], { redact: pages, producer, verifyTerms: terms, keep });
      if (found.length > 0) {
        setWorking(null);
        const ok = await confirm({
          title: 'Marked text is still in the new file',
          message: `ScribeForge searched the redacted file and still found ${found.map((t) => `“${t}”`).join(', ')}. This can happen when a file stores text in an unusual way, or when the words also appear in the file's own workings. Nothing has been saved yet.`,
          confirmLabel: 'Save anyway',
          cancelLabel: "Don't save",
        });
        if (!ok) return;
      }
      const name = outputName(primary.name, 'redacted');
      setWorking('Checking what the redacted file carries…');
      const { carries } = await inspectDocument({ id: name, name, bytes });
      setWorking(null);
      const lowest = Math.min(...Object.values(pages).map((p) => p.dpi));
      if (!(await review({ carries, files: 1, notes: redactionNotes(report, used, marks.length - used, lowest, keep), title: 'What the redacted file carries' }))) return;
      setWorking('Saving…');
      const result = await api.saveFile({ bytes, suggestedName: name, sourcePaths: sources.map((s) => s.path) });
      if (result.ok) {
        // The log, if asked for: next to the redacted file, with hints instead of the marked text.
        let logged = '';
        if (log) {
          const text = redactionLog({
            made: new Date().toISOString(),
            version: producer.replace(/^ScribeForge /, ''),
            source: primary.name,
            saved: fileName(result.path),
            report,
            dpi: lowest,
            marks: marks.filter((m) => kept.has(m.page)),
            marksLeftOut: marks.length - used,
            checked: terms.length,
            found: found.length,
            kept: keep,
          });
          const savedLog = await api.saveBeside({ pdfPath: result.path, suffix: 'redaction log', text });
          logged = savedLog.ok ? `\nRedaction log saved as ${fileName(savedLog.path)}.` : `\nThe redaction log couldn't be saved. ${savedLog.message ?? ''}`.trimEnd();
        }
        // Shown first: opening the redacted file may ask about other unsaved changes.
        onMessage(redactedMessage(result.path, report) + logged);
        setWorking('Opening the new file…');
        await onRedacted(result.path);
      } else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the file.");
    });

  /**
   * Clean up: a new file, like any save, but without what was chosen on the Clean up screen. The
   * person sees what it carries and what was removed, then chooses where to save it.
   */
  const clean = (choices: CleanOptions) =>
    run(async () => {
      const items = edit.tiles.map((t) => t.item);
      if (items.length === 0 || !(await lockCheck(items)) || !(await signedCheck(items))) return;
      setWorking('Making the cleaned file…');
      const { bytes, report } = await build(items, choices);
      const name = outputName(primary.name, 'cleaned');
      if (!(await reviewed([{ name, bytes }], report, [...cleanNotes(report), ...buildNotes(report)], 'What the cleaned file carries'))) return;
      setWorking('Saving…');
      const result = await api.saveFile({ bytes, suggestedName: name, sourcePaths: sources.map((s) => s.path) });
      if (result.ok) {
        setWorking('Opening the new file…');
        await onSaved(result.path);
        onMessage(cleanedMessage(result.path, report));
      } else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the file.");
    });

  /**
   * Sign (docs/Plan_Sign.md, section 2): the signature is added to the end of the file as it is,
   * so the file before it, and any signatures in it, stay exactly as they were. When the file
   * has unsaved changes, a password or a damaged structure, the new file is made first (as Save
   * makes it) and that is signed. The certificate's key stays in the main process: it gets only
   * the fingerprint of the prepared file, and gives back only the signature.
   */
  const sign = (choices: SignChoices, newFile: NewFileReason) =>
    run(async () => {
      try {
        let bytes = primary.bytes;
        let place = choices.place;
        if (newFile) {
          const items = edit.tiles.map((t) => t.item);
          if (items.length === 0 || !(await lockCheck(items)) || !(await signedCheck(items, true))) return;
          if (place.kind === 'field') throw new Error('Signature boxes already in the file can only be used when the file is signed as it is.');
          setWorking('Making the new file…');
          bytes = (await build(items)).bytes;
          if (place.kind === 'box') {
            // The box was drawn on the file as it was opened: find where that page is now, and how it's turned.
            const from = place.page;
            const at = items.findIndex((i) => i.kind === 'page' && i.source === primary.id && i.index === from);
            if (at < 0) throw new Error("The page with the signature box isn't in the new file.");
            const item = items[at] as Extract<PageItem, { kind: 'page' }>;
            const own = (await primary.pdf.getPage(from + 1)).rotate;
            place = { ...place, page: at, rotation: ((((own + item.rotate) % 360) + 360) % 360) as 0 | 90 | 180 | 270 };
          }
        }
        setWorking('Preparing the file…');
        const now = new Date();
        const prepared = await prepareSigning(bytes, {
          place,
          name: choices.certificate.name,
          reason: choices.reason.trim() || undefined,
          location: choices.location.trim() || undefined,
          time: now.toISOString(),
          shownTime: boxTime(now),
          space: signatureSpace(choices.certificateBytes),
          producer,
        });
        setWorking('Signing…');
        const signature = await api.signDigest(prepared.digest);
        if (!signature.ok) {
          onMessage(signature.message);
          return;
        }
        const signedBytes = await finishSigning(prepared, signature.signature);
        setWorking('Saving…');
        const result = await api.saveFile({ bytes: signedBytes, suggestedName: outputName(primary.name, 'signed'), sourcePaths: sources.map((s) => s.path) });
        if (result.ok) {
          setWorking('Opening the signed file…');
          await onSigned(result.path);
          onMessage(`Signed and saved ${fileName(result.path)}.`);
        } else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the file.");
      } finally {
        api.forgetCertificate();
      }
    });

  return { working, saveAll, saveSelected, split, redact, clean, sign };
}
