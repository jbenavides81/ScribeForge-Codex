// Saving new files, shared by the Document and Pages screens. Every save builds a brand-new PDF
// from the pages as arranged on the Pages screen plus the annotations added on the Document
// screen; the original is never touched unless the person chooses to replace it.
import { useCallback, useRef, useState } from 'react';
import { outputName } from '../../../engine/names';
import type { AnnotationInput, BuildReport, PageItem } from '../../../engine/types';
import { toEngineInput, type AnnotState } from '../annotate/annotState';
import { buildDocument } from './engineClient';
import type { EditState, Tile } from './editState';
import { engineInput, type ConfirmRequest, type SourceDoc } from './sources';

const api = window.scribeforge;
const fileNameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What to tell the person after saving. */
export function savedMessage(path: string, report: BuildReport): string {
  const lines = [`Saved ${fileNameOf(path)} (${plural(report.pages, 'page')}).`];
  if (report.annotationsAdded > 0) lines.push(`${plural(report.annotationsAdded, 'annotation')} saved with the pages.`);
  if (report.annotationsLeftOut > 0) {
    const n = report.annotationsLeftOut;
    lines.push(`${plural(n, 'annotation')} ${n === 1 ? 'was' : 'were'} on pages that aren't in the new file, so ${n === 1 ? 'it was' : 'they were'} left out.`);
  }
  if (report.linksRemoved + report.bookmarksRemoved > 0) {
    lines.push(
      `${plural(report.linksRemoved, 'link')} and ${plural(report.bookmarksRemoved, 'bookmark')} pointed to pages that aren't in the new file, so they were left out.`,
    );
  }
  if (report.formFieldsDetached > 0) lines.push("Form fields look the same but can't be filled in, in the new file.");
  if (report.actionsRemoved > 0) lines.push('Scripts and other actions in the pages were removed.');
  return lines.join('\n');
}

export function useSaving({
  sources,
  edit,
  annots,
  authorName,
  confirm,
  onMessage,
  onSaved,
}: {
  sources: SourceDoc[];
  edit: EditState;
  annots: AnnotState;
  authorName: string;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  onMessage: (text: string) => void;
  onSaved: (path: string) => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const busy = useRef(false);
  const primary = sources[0];

  const annotations = (): AnnotationInput[] =>
    primary ? annots.items.flatMap((a) => toEngineInput(a, primary.id, authorName) ?? []) : [];

  const usedSources = (items: PageItem[]) => sources.filter((s) => items.some((i) => i.kind === 'page' && i.source === s.id));

  /** Asks first when any page comes from a password-protected file (the new file has no password). */
  const passwordCheck = async (items: PageItem[]): Promise<boolean> => {
    const locked = usedSources(items).filter((s) => s.password);
    if (locked.length === 0) return true;
    return confirm({
      title: "The new file won't have a password",
      message: `${locked.map((s) => s.name).join(', ')} ${locked.length === 1 ? 'is' : 'are'} password-protected. The new file will open without a password.`,
      confirmLabel: 'Save without a password',
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

  const save = (tiles: Tile[], name: string, openAfter: boolean) =>
    run(async () => {
      const items = tiles.map((t) => t.item);
      if (items.length === 0 || !(await passwordCheck(items))) return;
      setWorking('Making the new file…');
      const { bytes, report } = await buildDocument(usedSources(items).map(engineInput), items, annotations());
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
  }, [primary, edit, annots, authorName, sources]);

  const saveSelected = (tiles: Tile[]) => {
    const positions = tiles.map((t) => edit.tiles.indexOf(t) + 1);
    return save(tiles, outputName(primary.name, { pages: positions }), false);
  };

  const split = (parts: number[][]) =>
    run(async () => {
      const groups = parts.map((part) => part.map((n) => edit.tiles[n - 1]));
      if (!(await passwordCheck(groups.flat().map((t) => t.item)))) return;
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (const [i, group] of groups.entries()) {
        setWorking(`Making file ${i + 1} of ${groups.length}…`);
        const items = group.map((t) => t.item);
        const { bytes } = await buildDocument(usedSources(items).map(engineInput), items, annotations());
        files.push({ name: outputName(primary.name, { pages: parts[i] }), bytes });
      }
      setWorking('Saving…');
      const result = await api.saveFiles({ files, sourcePaths: sources.map((s) => s.path) });
      if (result.ok) onMessage(`Split into ${plural(result.paths.length, 'file')} in ${result.folder}.`);
      else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the files.");
    });

  return { working, saveAll, saveSelected, split };
}
