// Saving new files, shared by the Document, Pages and Details screens. Every save builds a
// brand-new PDF from the pages as arranged on the Pages screen, the annotations added on the
// Document screen and the details from the Details screen; the original is never touched unless
// the person chooses to replace it. Before saving, the person can see what the new file carries.
import { useCallback, useRef, useState } from 'react';
import { outputName } from '../../../engine/names';
import { emptyReport, type AnnotationInput, type BuildReport, type Carries, type DocInfo, type PageItem } from '../../../engine/types';
import { toEngineInput, type AnnotState } from '../annotate/annotState';
import { combineCarries } from '../details/describe';
import { plural } from '../words';
import { buildNotes, savedMessage } from './report';
import { buildDocument, inspectDocument } from './engineClient';
import type { EditState, Tile } from './editState';
import { engineInput, type ConfirmRequest, type SourceDoc } from './sources';

const api = window.scribeforge;

/** Several build reports added together (for split). */
function addReports(reports: BuildReport[]): BuildReport {
  const total = emptyReport();
  for (const r of reports) for (const key of Object.keys(total) as (keyof BuildReport)[]) total[key] += r[key];
  return total;
}

/** Shown before saving, when Settings says so. */
export interface ReviewRequest {
  carries: Carries;
  /** How many new files (more than one when splitting). */
  files: number;
  notes: string[];
}

export function useSaving({
  sources,
  edit,
  annots,
  authorName,
  details,
  producer,
  reviewBeforeSave,
  confirm,
  review,
  onMessage,
  onSaved,
}: {
  sources: SourceDoc[];
  edit: EditState;
  annots: AnnotState;
  authorName: string;
  /** The new file's title, author, subject and keywords, once the open file's are known. */
  details: DocInfo | undefined;
  producer: string;
  reviewBeforeSave: boolean;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  review: (request: ReviewRequest) => Promise<boolean>;
  onMessage: (text: string) => void;
  onSaved: (path: string) => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const busy = useRef(false);
  const primary = sources[0];

  const annotations = (): AnnotationInput[] =>
    primary ? annots.items.flatMap((a) => toEngineInput(a, primary.id, authorName) ?? []) : [];

  const usedSources = (items: PageItem[]) => sources.filter((s) => items.some((i) => i.kind === 'page' && i.source === s.id));

  const build = (items: PageItem[]) => buildDocument(usedSources(items).map(engineInput), items, annotations(), { details, producer });

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
  const reviewed = async (made: { name: string; bytes: Uint8Array }[], report: BuildReport): Promise<boolean> => {
    if (!reviewBeforeSave) return true;
    setWorking('Checking what the new file carries…');
    const carries: Carries[] = [];
    for (const file of made) carries.push((await inspectDocument({ id: file.name, name: file.name, bytes: file.bytes })).carries);
    setWorking(null);
    return review({ carries: combineCarries(carries), files: made.length, notes: buildNotes(report) });
  };

  const save = (tiles: Tile[], name: string, openAfter: boolean) =>
    run(async () => {
      const items = tiles.map((t) => t.item);
      if (items.length === 0 || !(await lockCheck(items))) return;
      setWorking('Making the new file…');
      const { bytes, report } = await build(items);
      if (!(await reviewed([{ name, bytes }], report))) return;
      setWorking('Saving…');
      const result = await api.saveFile({ bytes, suggestedName: name, sourcePaths: sources.map((s) => s.path) });
      if (result.ok) {
        onMessage(savedMessage(result.path, report));
        if (openAfter) onSaved(result.path);
      } else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the file.");
    });

  const saveAll = useCallback(() => {
    if (!primary) return Promise.resolve();
    const merged = usedSources(edit.tiles.map((t) => t.item)).length > 1;
    return save(edit.tiles, outputName(primary.name, merged ? 'merged' : 'edited'), true);
  }, [primary, edit, annots, authorName, sources, details, producer, reviewBeforeSave]);

  const saveSelected = (tiles: Tile[]) => {
    const positions = tiles.map((t) => edit.tiles.indexOf(t) + 1);
    return save(tiles, outputName(primary.name, { pages: positions }), false);
  };

  const split = (parts: number[][]) =>
    run(async () => {
      const groups = parts.map((part) => part.map((n) => edit.tiles[n - 1]));
      if (!(await lockCheck(groups.flat().map((t) => t.item)))) return;
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

  return { working, saveAll, saveSelected, split };
}
