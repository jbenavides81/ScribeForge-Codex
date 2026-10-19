import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AppInfo, MenuCommand, OpenedFile, OpenResult, RecentFile, SettingsChange } from '../../shared/api';
import type { Settings as AppSettings } from '../../shared/settings';
import { DOC_INFO_FIELDS, type DocInfo, type FileReport } from '../../engine/types';
import { annotReducer, emptyAnnots, hasAnnotChanges } from './annotate/annotState';
import { applyAppearance, onSystemThemeChange } from './appearance';
import { Dialog } from './components/Dialog';
import { CarriesList } from './details/CarriesList';
import { Icon, type IconName } from './components/Icon';
import { editReducer, emptyEdit, hasChanges, newKey, type Tile } from './pages/editState';
import { PagesView } from './pages/PagesView';
import { inspectDocument } from './pages/engineClient';
import { useSaving, type ReviewRequest } from './pages/saving';
import { engineInput, type ConfirmRequest, type SourceDoc } from './pages/sources';
import { About } from './screens/About';
import { Details } from './screens/Details';
import { Settings } from './screens/Settings';
import { Start } from './screens/Start';
import { DocumentView } from './viewer/DocumentView';
import { loadDocument, OpenError, type PdfDocument } from './viewer/pdfjs';

type Screen = 'start' | 'document' | 'pages' | 'details' | 'settings' | 'about';

interface OpenDocument {
  /** Each opened document gets a fresh viewer. */
  id: number;
  pdf: PdfDocument;
  name: string;
  path: string;
  bytes: Uint8Array;
  /** Only for password-protected files; in memory while the document is open, never stored. */
  password?: string;
  /** For a locked file, what its author allows (pdf.js flags); null when it isn't locked. */
  permissions: number[] | null;
}

/** The open document's details and what it carries, read in the background after opening. */
interface DocReport {
  docId: number;
  report: FileReport | null;
  failed: boolean;
}

/** What a locked file allows, or null when it isn't locked. */
async function permissionsOf(pdf: PdfDocument): Promise<number[] | null> {
  try {
    const allowed = await pdf.getPermissions();
    return allowed ? [...allowed] : null;
  } catch {
    return null;
  }
}

interface PasswordRequest {
  id: number;
  name: string;
  retry: boolean;
  resolve: (password: string | null) => void;
}

const api = window.scribeforge;

function openFailureMessage(result: Exclude<OpenResult, { ok: true } | { reason: 'cancelled' }>): string {
  const name = result.path.split(/[\\/]/).pop() ?? result.path;
  switch (result.reason) {
    case 'not-found':
      return `${name} couldn't be found. It may have been moved, renamed or deleted.`;
    case 'not-pdf':
      return `${name} isn't a PDF file. ScribeForge opens PDF files only.`;
    case 'too-large':
      return `${name} is larger than 1 GB, which is more than ScribeForge can open.`;
    default:
      return `${name} couldn't be read. Check that it isn't open in another program, then try again.`;
  }
}

function pageTiles(sourceId: string, count: number): Tile[] {
  return Array.from({ length: count }, (_, i) => ({ key: newKey(sourceId), item: { kind: 'page', source: sourceId, index: i, rotate: 0 } }));
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [screen, setScreen] = useState<Screen>('start');
  const [doc, setDoc] = useState<OpenDocument | null>(null);
  const [added, setAdded] = useState<SourceDoc[]>([]);
  const [edit, dispatch] = useReducer(editReducer, emptyEdit);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState<PasswordRequest | null>(null);
  const [confirming, setConfirming] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [command, setCommand] = useState<{ name: MenuCommand; seq: number } | null>(null);
  const [annots, annotDispatch] = useReducer(annotReducer, emptyAnnots);
  const [docReport, setDocReport] = useState<DocReport | null>(null);
  const [detailsEdit, setDetailsEdit] = useState<Partial<DocInfo>>({});
  const [reviewing, setReviewing] = useState<(ReviewRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const docRef = useRef<OpenDocument | null>(null);
  docRef.current = doc;
  const addedRef = useRef<SourceDoc[]>([]);
  addedRef.current = added;
  const editRef = useRef(edit);
  editRef.current = edit;
  const annotsRef = useRef(annots);
  annotsRef.current = annots;
  const nextDocId = useRef(0);
  const nextSourceId = useRef(0);

  useEffect(() => {
    void Promise.all([api.appInfo(), api.getSettings(), api.recentFiles()]).then(([i, s, r]) => {
      setInfo(i);
      setSettings(s);
      setRecent(r);
      if (i.settingsNotice) setMessage(i.settingsNotice);
    });
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyAppearance(settings);
    return onSystemThemeChange(() => applyAppearance(settings));
  }, [settings]);

  // The new file's details: the open file's, with any changes made on the Details screen.
  const report = doc && docReport?.docId === doc.id ? docReport.report : null;
  const detailValues: DocInfo | undefined = report ? { ...report.details.shown, ...detailsEdit } : undefined;
  const detailsChanged = !!report && DOC_INFO_FIELDS.some((f) => detailsEdit[f] !== undefined && detailsEdit[f] !== report.details.shown[f]);

  // Closing the window asks first while page changes, annotations or details aren't saved.
  const pagesChanged = hasChanges(edit);
  const dirty = pagesChanged || hasAnnotChanges(annots) || detailsChanged;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => api.setUnsaved(dirty), [dirty]);

  // Read the open document's details and contents in the background.
  useEffect(() => {
    if (!doc) return;
    let current = true;
    const source = { id: `doc${doc.id}`, name: doc.name, path: doc.path, bytes: doc.bytes, password: doc.password, permissions: doc.permissions, pdf: doc.pdf };
    inspectDocument(engineInput(source)).then(
      (result) => current && setDocReport({ docId: doc.id, report: result, failed: false }),
      () => current && setDocReport({ docId: doc.id, report: null, failed: true }),
    );
    return () => {
      current = false;
    };
  }, [doc]);

  const changeSettings = useCallback(async (change: SettingsChange) => {
    setSettings(await api.changeSettings(change));
    setRecent(await api.recentFiles());
  }, []);

  const confirm = useCallback(
    (request: ConfirmRequest) => new Promise<boolean>((resolve) => setConfirming({ ...request, resolve })),
    [],
  );

  /** Runs `action` now, or after the person agrees to lose unsaved changes. */
  const unlessUnsaved = useCallback(
    async (action: () => void | Promise<void>) => {
      if (dirtyRef.current) {
        const ok = await confirm({
          title: 'Discard your changes?',
          message: "You have changes to pages, annotations or details that aren't saved yet. If you continue, they are lost.",
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
        });
        if (!ok) return;
      }
      await action();
    },
    [confirm],
  );

  const askPassword = (name: string) => {
    let asks = 0;
    return (retry: boolean) => new Promise<string | null>((resolve) => setPassword({ id: ++asks, name, retry, resolve }));
  };

  /** Frees documents after their viewers have been cleared away. */
  const release = (docs: (PdfDocument | undefined)[]) => {
    window.setTimeout(() => docs.forEach((d) => void d?.loadingTask.destroy()), 0);
  };

  const closeDocument = useCallback(() => {
    const current = docRef.current;
    const extra = addedRef.current;
    setDoc(null);
    setAdded([]);
    dispatch({ type: 'reset', tiles: [] });
    annotDispatch({ type: 'reset' });
    setDetailsEdit({});
    setDocReport(null);
    setScreen('start');
    release([current?.pdf, ...extra.map((s) => s.pdf)]);
  }, []);

  const handleResult = useCallback(async (result: OpenResult) => {
    setRecent(await api.recentFiles());
    if (!result.ok) {
      if (result.reason !== 'cancelled') setMessage(openFailureMessage(result));
      return;
    }
    const { file } = result;
    setBusy(`Opening ${file.name}…`);
    try {
      const { pdf, password: used } = await loadDocument(file.bytes, askPassword(file.name));
      const permissions = await permissionsOf(pdf);
      const previous = docRef.current;
      const extra = addedRef.current;
      const id = ++nextDocId.current;
      setDoc({ id, pdf, name: file.name, path: file.path, bytes: file.bytes, password: used, permissions });
      setAdded([]);
      dispatch({ type: 'reset', tiles: pageTiles(`doc${id}`, pdf.numPages) });
      annotDispatch({ type: 'reset' });
      setDetailsEdit({});
      setScreen('document');
      release([previous?.pdf, ...extra.map((s) => s.pdf)]);
    } catch (error) {
      const kind = error instanceof OpenError ? error.kind : 'unreadable';
      if (kind === 'damaged') {
        setMessage(`ScribeForge couldn't open ${file.name}. The file may be damaged, or it may not really be a PDF.`);
      } else if (kind === 'unreadable') {
        setMessage(`ScribeForge couldn't open ${file.name}. Something in the file couldn't be read.`);
      }
    } finally {
      setPassword(null);
      setBusy(null);
    }
  }, []);

  const openWithDialog = useCallback(() => unlessUnsaved(async () => handleResult(await api.openDialog())), [handleResult, unlessUnsaved]);
  const openPath = useCallback((path: string) => unlessUnsaved(async () => handleResult(await api.openPath(path))), [handleResult, unlessUnsaved]);
  const closeWithCheck = useCallback(() => unlessUnsaved(closeDocument), [closeDocument, unlessUnsaved]);

  /** Files added on the Pages screen become extra sources (asking for passwords as needed). */
  const addFiles = useCallback(async (files: OpenedFile[]): Promise<SourceDoc[]> => {
    const loaded: SourceDoc[] = [];
    try {
      for (const file of files) {
        try {
          const { pdf, password: used } = await loadDocument(file.bytes, askPassword(file.name));
          const permissions = await permissionsOf(pdf);
          loaded.push({ id: `add${++nextSourceId.current}`, name: file.name, path: file.path, bytes: file.bytes, password: used, permissions, pdf });
        } catch (error) {
          if (!(error instanceof OpenError && error.kind === 'cancelled')) {
            setMessage(`${file.name} couldn't be added. The file may be damaged, or it may not really be a PDF.`);
          }
        }
      }
    } finally {
      setPassword(null);
    }
    setAdded((current) => [...current, ...loaded]);
    return loaded;
  }, []);

  // Menu commands from the main process.
  useEffect(() => {
    let seq = 0;
    return api.onMenu((name) => {
      switch (name) {
        case 'open':
          void openWithDialog();
          break;
        case 'close-document':
          void closeWithCheck();
          break;
        case 'show-settings':
          setScreen('settings');
          break;
        case 'show-about':
          setScreen('about');
          break;
        case 'show-pages':
          if (docRef.current) setScreen('pages');
          break;
        case 'show-details':
          if (docRef.current) setScreen('details');
          break;
        case 'save':
          if (docRef.current) void saveAllRef.current();
          break;
        default:
          if (docRef.current) {
            setScreen('document');
            setCommand({ name, seq: ++seq });
          }
      }
    });
  }, [openWithDialog, closeWithCheck]);

  // Dragging a PDF onto the window opens it. Nothing dropped ever navigates the window.
  // (On the Pages screen, a dropped PDF is added to the document instead.)
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      const path = api.pathForFile(file);
      if (path) void openPath(path);
      else setMessage('That item can\'t be opened. Drag a PDF file from a folder on this computer.');
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [openPath]);

  const sources: SourceDoc[] = useMemo(
    () =>
      doc ? [{ id: `doc${doc.id}`, name: doc.name, path: doc.path, bytes: doc.bytes, password: doc.password, permissions: doc.permissions, pdf: doc.pdf }, ...added] : [],
    [doc, added],
  );

  const saving = useSaving({
    sources,
    edit,
    annots,
    authorName: settings?.authorName ?? '',
    details: detailValues,
    producer: info ? `ScribeForge ${info.version}` : 'ScribeForge',
    reviewBeforeSave: settings?.reviewBeforeSave ?? true,
    confirm,
    review: (request) => new Promise<boolean>((resolve) => setReviewing({ ...request, resolve })),
    onMessage: setMessage,
    onSaved: (path) => void api.openPath(path).then(handleResult),
  });
  const saveAllRef = useRef(saving.saveAll);
  saveAllRef.current = saving.saveAll;

  if (!settings || !info) return null;

  const nav: { id: Screen; label: string; icon: IconName; disabled?: boolean }[] = [
    { id: 'start', label: 'Start', icon: 'open' },
    { id: 'document', label: 'Document', icon: 'document', disabled: !doc },
    { id: 'pages', label: 'Pages', icon: 'pages', disabled: !doc },
    { id: 'details', label: 'Details', icon: 'details', disabled: !doc },
    { id: 'settings', label: 'Settings', icon: 'settings' },
    { id: 'about', label: 'About', icon: 'about' },
  ];

  return (
    <div className="sf-app">
      <nav className="sf-nav" aria-label="Main">
        <div className="sf-brand">
          <span className="sf-brand-logo">
            <Icon name="logo" size={48} />
          </span>
          <span className="sf-brand-name">ScribeForge</span>
        </div>
        <ul>
          {nav.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="sf-nav-item"
                aria-current={screen === item.id ? 'page' : undefined}
                disabled={item.disabled}
                onClick={() => setScreen(item.id)}
              >
                <Icon name={item.icon} />
                {item.label}
                {((item.id === 'pages' && pagesChanged) || (item.id === 'details' && detailsChanged)) && (
                  <span className="sf-dot" aria-hidden="true" title="Changes not saved yet" />
                )}
              </button>
            </li>
          ))}
        </ul>
        {info.trial && (
          <p className="sf-trial" data-testid="trial-badge">
            Trial mode: separate test data
          </p>
        )}
      </nav>

      <main className="sf-main">
        {message && (
          <div className="sf-message" role="status" data-testid="message">
            <div>
              {message.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <button type="button" className="sf-icon-button" aria-label="Dismiss message" onClick={() => setMessage(null)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {busy && (
          <p className="sf-busy" role="status">
            {busy}
          </p>
        )}
        {screen === 'start' && (
          <Start
            recent={recent}
            rememberRecent={settings.rememberRecent}
            onOpen={() => void openWithDialog()}
            onOpenRecent={(p) => void openPath(p)}
            onRemoveRecent={(p) => void api.removeRecent(p).then(setRecent)}
            onClearRecent={() => void api.clearRecent().then(setRecent)}
          />
        )}
        {doc && (
          <div className="sf-document-slot" hidden={screen !== 'document'}>
            <DocumentView
              key={doc.id}
              pdf={doc.pdf}
              name={doc.name}
              changed={pagesChanged}
              command={command}
              annots={annots}
              annotDispatch={annotDispatch}
              active={screen === 'document'}
              working={saving.working}
              onSave={() => void saving.saveAll()}
              onAskLink={setLink}
              onRefusedLink={(address) => setMessage(`This link can't be opened from ScribeForge: ${address}`)}
              onClose={() => void closeWithCheck()}
            />
          </div>
        )}
        {doc && screen === 'pages' && (
          <PagesView
            edit={edit}
            dispatch={dispatch}
            sources={sources}
            unsaved={dirty}
            working={saving.working}
            onSaveAll={() => void saving.saveAll()}
            onSaveSelected={(tiles) => void saving.saveSelected(tiles)}
            onSplit={(parts) => void saving.split(parts)}
            addFiles={addFiles}
            onMessage={setMessage}
          />
        )}
        {doc && screen === 'details' && (
          <Details
            name={doc.name}
            report={report}
            failed={docReport?.docId === doc.id && docReport.failed}
            values={detailValues ?? { title: '', author: '', subject: '', keywords: '' }}
            changed={detailsChanged}
            onChange={(field, value) => setDetailsEdit((current) => ({ ...current, [field]: value }))}
            onReset={() => setDetailsEdit({})}
            password={!!doc.password}
            permissions={doc.permissions}
          />
        )}
        {screen === 'settings' && (
          <Settings
            settings={settings}
            onChange={(change) => void changeSettings(change)}
            onClearRecent={() =>
              void api.clearRecent().then(async (r) => {
                setRecent(r);
                setSettings(await api.getSettings());
              })
            }
          />
        )}
        {screen === 'about' && <About version={info.version} trial={info.trial} />}
      </main>

      {password && <PasswordDialog key={password.id} request={password} />}
      {reviewing && (
        <Dialog
          title={reviewing.files === 1 ? 'What the new file carries' : `What the ${reviewing.files} new files carry`}
          onCancel={() => {
            reviewing.resolve(false);
            setReviewing(null);
          }}
          testId="review-dialog"
          wide
        >
          <div className="sf-dialog-scroll" tabIndex={0} aria-label="What the new file carries">
            {reviewing.notes.length > 0 && (
              <ul className="sf-review-notes">
                {reviewing.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            <p className="sf-muted">Besides what's on its pages:</p>
            <CarriesList carries={reviewing.carries} />
          </div>
          <p className="sf-muted">You can stop showing this before saving in Settings.</p>
          <div className="sf-dialog-buttons">
            <button
              type="button"
              className="sf-button"
              onClick={() => {
                reviewing.resolve(false);
                setReviewing(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="sf-button sf-primary"
              onClick={() => {
                reviewing.resolve(true);
                setReviewing(null);
              }}
            >
              {reviewing.files === 1 ? 'Choose where to save…' : 'Choose a folder…'}
            </button>
          </div>
        </Dialog>
      )}
      {confirming && (
        <Dialog
          title={confirming.title}
          onCancel={() => {
            confirming.resolve(false);
            setConfirming(null);
          }}
          testId="confirm-dialog"
        >
          <p>{confirming.message}</p>
          <div className="sf-dialog-buttons">
            <button
              type="button"
              className="sf-button"
              onClick={() => {
                confirming.resolve(false);
                setConfirming(null);
              }}
            >
              {confirming.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className="sf-button sf-primary"
              onClick={() => {
                confirming.resolve(true);
                setConfirming(null);
              }}
            >
              {confirming.confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
      {link && (
        <Dialog title="Open this link in your web browser?" onCancel={() => setLink(null)} testId="link-dialog">
          <p>This link in the document goes to:</p>
          <p className="sf-address" data-testid="link-address">
            {link}
          </p>
          <p className="sf-muted">ScribeForge itself never connects to the internet. The link opens in your web browser.</p>
          <div className="sf-dialog-buttons">
            <button type="button" className="sf-button" onClick={() => setLink(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="sf-button sf-primary"
              onClick={() => {
                void api.openLink(link);
                setLink(null);
              }}
            >
              Open in browser
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PasswordDialog({ request }: { request: PasswordRequest }) {
  const [value, setValue] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    request.resolve(value);
  };
  return (
    <Dialog title="This file is password-protected" onCancel={() => request.resolve(null)} testId="password-dialog">
      <form onSubmit={submit}>
        <p>
          Enter the password for <span className="sf-strong">{request.name}</span>. ScribeForge doesn't save it.
        </p>
        <label className="sf-field">
          <span>Password</span>
          <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        </label>
        {request.retry && (
          <p className="sf-error" role="alert">
            That password didn't work. Try again.
          </p>
        )}
        <div className="sf-dialog-buttons">
          <button type="button" className="sf-button" onClick={() => request.resolve(null)}>
            Cancel
          </button>
          <button type="submit" className="sf-button sf-primary" disabled={value.length === 0}>
            Open
          </button>
        </div>
      </form>
    </Dialog>
  );
}
