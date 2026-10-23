import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AppInfo, CertificateFileInfo, MenuCommand, OpenedFile, OpenResult, RecentFile, SettingsChange, TrustList } from '../../shared/api';
import type { Settings as AppSettings } from '../../shared/settings';
import { DOC_INFO_FIELDS, type CleanOptions, type DocInfo, type FileReport, type RedactKeep } from '../../engine/types';
import { baseName, safeFileName } from '../../engine/names';
import { soundForUpdate } from '../../engine/sign/space';
import type { CertificateSummary, EmptySignatureField, SignatureCheck } from '../../engine/sign/types';
import { annotReducer, emptyAnnots, hasAnnotChanges } from './annotate/annotState';
import { fileAnnotsOf, type FileAnnot, type PdfAnnotationData } from './annotate/fileAnnots';
import { applyAppearance, onSystemThemeChange } from './appearance';
import { Dialog } from './components/Dialog';
import { CarriesList } from './details/CarriesList';
import { Icon, type IconName } from './components/Icon';
import { editReducer, emptyEdit, hasChanges, newKey, type Tile } from './pages/editState';
import { PagesView } from './pages/PagesView';
import { checkDocumentSignatures, emptySignatureBoxes, inspectDocument } from './pages/engineClient';
import { useSaving, type ArchiveChoice, type NewFileReason, type ReviewAnswer, type ReviewRequest, type SignChoices } from './pages/saving';
import type { NewDocument, VaultDocument, VaultStatus, VaultVersion } from '../../shared/vault';
import { pageTexts } from './archive/text';
import { firstPagePicture } from './archive/thumbnail';
import { Archive } from './screens/Archive';
import { emptyRedact, markLabel, marksByPage, redactReducer, type RedactMark } from './redact/redactState';
import { engineInput, type ConfirmRequest, type SourceDoc } from './pages/sources';
import { About } from './screens/About';
import { CleanUp } from './screens/CleanUp';
import { Details } from './screens/Details';
import { Help, HELP_PAGES } from './screens/Help';
import { Settings } from './screens/Settings';
import { Sign } from './screens/Sign';
import { Start } from './screens/Start';
import { newFileNote, signaturesSummary } from './sign/describe';
import { MakeCertificateDialog } from './sign/MakeCertificateDialog';
import { SignDialog } from './sign/SignDialog';
import { DocumentView } from './viewer/DocumentView';
import { loadDocument, OpenError, type PdfDocument } from './viewer/pdfjs';

type Screen = 'start' | 'document' | 'pages' | 'details' | 'cleanup' | 'sign' | 'archive' | 'settings' | 'help' | 'about';

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
  /** Opened from the Archive: it's decrypted, so it closes when the vault locks. */
  fromVault?: boolean;
  /** The Archive document it came from, so saving can add a new version of it (stop 3c). */
  vaultDoc?: { id: string; title: string };
  /** The page to show first (a search result). */
  startPage?: number;
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
  const [fileAnnots, setFileAnnots] = useState<{ docId: number; list: FileAnnot[]; reading: string | null } | null>(null);
  const [docReport, setDocReport] = useState<DocReport | null>(null);
  const [helpPage, setHelpPage] = useState(HELP_PAGES[0]?.file ?? '');
  const [detailsEdit, setDetailsEdit] = useState<Partial<DocInfo>>({});
  /** What Clean up leaves out of the new file, chosen on its screen (for the open file). */
  const [cleanChoices, setCleanChoices] = useState<CleanOptions>({});
  const [reviewing, setReviewing] = useState<(ReviewRequest & { resolve: (answer: ReviewAnswer) => void }) | null>(null);
  /** "Also keep a copy in the Archive", in the list shown before saving. */
  const [keepCopy, setKeepCopy] = useState<ArchiveChoice>('none');
  /** Whether the Archive is unlocked, and a signal each time it locks. */
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [lockSignal, setLockSignal] = useState<{ seq: number; why: string } | null>(null);
  const [redact, redactDispatch] = useReducer(redactReducer, emptyRedact);
  const [reviewingMarks, setReviewingMarks] = useState<{ resolve: (result: { marks: RedactMark[]; log: boolean; keep: RedactKeep } | null) => void } | null>(null);
  /** What the redacted file keeps besides its pages: nothing, unless ticked each time. */
  const [redactKeep, setRedactKeep] = useState<RedactKeep>({});
  /** Save a redaction log too: offered each time, off unless ticked. */
  const [wantLog, setWantLog] = useState(false);
  /** Who's trusted when checking signatures: Windows' certificates and the person's own list. */
  const [trust, setTrust] = useState<TrustList | null>(null);
  /** What checking the open file's signatures found (null while checking). */
  const [signatures, setSignatures] = useState<{ docId: number; list: SignatureCheck[] | null; failed: boolean } | null>(null);
  /** The signing window, with the certificate file remembered and the file's empty signature boxes. */
  const [signing, setSigning] = useState<{ remembered: CertificateFileInfo | null; emptyFields: EmptySignatureField[] } | null>(null);
  /** Drawing the signature's box on the page, with what was chosen in the signing window. */
  const [placing, setPlacing] = useState<Omit<SignChoices, 'place'> | null>(null);
  /** The Make a certificate window, and where it was opened from. */
  const [making, setMaking] = useState<'screen' | 'sign' | null>(null);
  const redactRef = useRef(redact);
  redactRef.current = redact;
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
    void api.trustList().then(setTrust);
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyAppearance(settings);
    return onSystemThemeChange(() => applyAppearance(settings));
  }, [settings]);

  // Check the open file's signatures in the background, again whenever the trusted list changes.
  useEffect(() => {
    if (!doc || !trust) return;
    let current = true;
    setSignatures((s) => (s?.docId === doc.id ? s : { docId: doc.id, list: null, failed: false }));
    checkDocumentSignatures(doc.bytes, trust.anchors, doc.password).then(
      (list) => current && setSignatures({ docId: doc.id, list, failed: false }),
      () => current && setSignatures({ docId: doc.id, list: null, failed: true }),
    );
    return () => {
      current = false;
    };
  }, [doc, trust]);

  // The new file's details: the open file's, with any changes made on the Details screen.
  const report = doc && docReport?.docId === doc.id ? docReport.report : null;
  const detailValues: DocInfo | undefined = report ? { ...report.details.shown, ...detailsEdit } : undefined;
  const detailsChanged = !!report && DOC_INFO_FIELDS.some((f) => detailsEdit[f] !== undefined && detailsEdit[f] !== report.details.shown[f]);

  // Closing the window asks first while page changes, annotations, details or redaction marks
  // aren't saved.
  const pagesChanged = hasChanges(edit);
  const otherChanges = pagesChanged || hasAnnotChanges(annots) || detailsChanged;
  const dirty = otherChanges || redact.marks.length > 0;
  const dirtyRef = useRef({ other: otherChanges, marks: redact.marks.length > 0 });
  dirtyRef.current = { other: otherChanges, marks: redact.marks.length > 0 };
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
    async (action: () => void | Promise<void>, { marksApplied = false } = {}) => {
      if (dirtyRef.current.other || (!marksApplied && dirtyRef.current.marks)) {
        const ok = await confirm({
          title: 'Discard your changes?',
          message: "You have changes to pages, annotations, details or redaction marks that aren't saved yet. If you continue, they are lost.",
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
    redactDispatch({ type: 'reset' });
    setDetailsEdit({});
    setCleanChoices({});
    setDocReport(null);
    setSignatures(null);
    setPlacing(null);
    api.forgetCertificate();
    setScreen('start');
    release([current?.pdf, ...extra.map((s) => s.pdf)]);
  }, []);

  const handleResult = useCallback(async (result: OpenResult, options: { fromVault?: boolean; vaultDoc?: { id: string; title: string }; startPage?: number } = {}) => {
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
      setDoc({ id, pdf, name: file.name, path: file.path, bytes: file.bytes, password: used, permissions, fromVault: options.fromVault, vaultDoc: options.vaultDoc, startPage: options.startPage });
      setAdded([]);
      dispatch({ type: 'reset', tiles: pageTiles(`doc${id}`, pdf.numPages) });
      annotDispatch({ type: 'reset' });
      redactDispatch({ type: 'reset' });
      setDetailsEdit({});
      setCleanChoices({});
      setPlacing(null);
      api.forgetCertificate();
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
        case 'show-help':
          setScreen('help');
          break;
        case 'show-pages':
          if (docRef.current) setScreen('pages');
          break;
        case 'show-details':
          if (docRef.current) setScreen('details');
          break;
        case 'show-cleanup':
          if (docRef.current) setScreen('cleanup');
          break;
        case 'show-sign':
          if (docRef.current) setScreen('sign');
          break;
        case 'show-archive':
          setScreen('archive');
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

  // The Archive locks (idle, Windows locked, sleep, or Lock): anything opened from it closes, since
  // it's decrypted. Unsaved changes to it are lost (Phase 3 plan, question 5).
  useEffect(() => {
    let seq = 0;
    return api.onVaultLocked((why) => {
      setLockSignal({ seq: ++seq, why });
      setVault((v) => (v ? { ...v, unlocked: false } : v));
      if (docRef.current?.fromVault) {
        closeDocument();
        setScreen('archive');
        setMessage('The Archive locked, so the document opened from it was closed.');
      }
    });
  }, [closeDocument]);

  // Using ScribeForge (typing, clicking, scrolling) keeps the Archive from locking for being idle.
  useEffect(() => {
    let last = 0;
    const active = () => {
      const now = Date.now();
      if (now - last < 10_000) return;
      last = now;
      api.vaultActive();
    };
    for (const kind of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(kind, active, { passive: true });
    return () => {
      for (const kind of ['pointerdown', 'keydown', 'wheel'] as const) window.removeEventListener(kind, active);
    };
  }, []);

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

  // The annotations already in the open file, read once in the background, page by page.
  useEffect(() => {
    if (!doc) return;
    let stopped = false;
    void (async () => {
      const list: FileAnnot[] = [];
      const total = doc.pdf.numPages;
      for (let n = 1; n <= total && !stopped; n++) {
        try {
          const page = await doc.pdf.getPage(n);
          list.push(...fileAnnotsOf(n - 1, page.rotate, (await page.getAnnotations()) as PdfAnnotationData[]));
        } catch {
          // A damaged page: its annotations can't be listed.
        }
        if (!stopped && (n % 25 === 0 || n === total)) setFileAnnots({ docId: doc.id, list: [...list], reading: n === total ? null : `Reading comments, page ${n} of ${total}…` });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [doc]);
  const docFileAnnots = fileAnnots && doc && fileAnnots.docId === doc.id ? fileAnnots : null;

  const saving = useSaving({
    sources,
    edit,
    annots,
    fileAnnots: docFileAnnots?.list ?? [],
    authorName: settings?.authorName ?? '',
    details: detailValues,
    producer: info ? `ScribeForge ${info.version}` : 'ScribeForge',
    reviewBeforeSave: settings?.reviewBeforeSave ?? true,
    redactionDpi: settings?.redactionDpi ?? 200,
    signed: report ? report.carries.signatures.filter((s) => s.signed).length : null,
    archiveOpen: vault?.unlocked === true,
    versionOf: doc?.vaultDoc?.title ?? null,
    keepInArchive: async (path, bytes, choice) => {
      const name = path.split(/[\\/]/).pop() ?? 'document.pdf';
      const item = await vaultItem({ path, name, bytes });
      const of = docRef.current?.vaultDoc;
      if (choice === 'version' && of) {
        const version = item ? await api.vaultAddVersion(of.id, item) : null;
        return version?.ok
          ? `\nIt's also in the Archive, as version ${version.value.number} of “${of.title}”.`
          : `\nThe new version for the Archive couldn't be kept${version && !version.ok ? `: ${version.message}` : '.'}`;
      }
      const added = item ? await api.vaultAdd([item]) : null;
      return added?.ok ? '\nA copy is also in the Archive.' : `\nThe copy for the Archive couldn't be kept${added && !added.ok ? `: ${added.message}` : '.'}`;
    },
    confirm,
    review: (request) =>
      new Promise<ReviewAnswer>((resolve) => {
        setKeepCopy('none');
        setReviewing({ ...request, resolve });
      }),
    reviewMarks: () =>
      new Promise<{ marks: RedactMark[]; log: boolean; keep: RedactKeep } | null>((resolve) => {
        setWantLog(false);
        setRedactKeep({});
        setReviewingMarks({ resolve });
      }),
    onMessage: setMessage,
    onSaved: async (path) => handleResult(await api.openPath(path)),
    // Changes went into the signed file; only redaction marks (never applied by signing) would be lost.
    onSigned: async (path) => {
      if (dirtyRef.current.marks) {
        const ok = await confirm({
          title: 'Open the signed file?',
          message: "The signed file is saved. Opening it closes this one, and your redaction marks, which aren't in the signed file, are lost.",
          confirmLabel: 'Open the signed file',
          cancelLabel: 'Keep my marks',
        });
        if (!ok) return;
      }
      await handleResult(await api.openPath(path));
    },
    // The marks are applied, so they don't count as unsaved; anything else still asks first.
    onRedacted: (path) => unlessUnsaved(async () => handleResult(await api.openPath(path)), { marksApplied: true }),
  });
  const saveAllRef = useRef(saving.saveAll);
  saveAllRef.current = saving.saveAll;

  // Signing adds to the file as it is, unless it has unsaved changes, a password or a damaged structure.
  const newFile: NewFileReason = !doc ? null : otherChanges ? 'changes' : doc.password || doc.permissions ? 'password' : soundForUpdate(doc.bytes) ? null : 'damaged';
  const docSignatures = doc && signatures?.docId === doc.id ? signatures : null;

  const startSigning = async (remembered?: CertificateFileInfo) => {
    if (!doc) return;
    const found = remembered ?? (await api.rememberedCertificate());
    const emptyFields = newFile ? [] : await emptySignatureBoxes(doc.bytes, doc.password).catch(() => []);
    setSigning({ remembered: found, emptyFields });
  };

  /** Opens exactly what a signature covers, as a separate file. Nothing is saved unless the person saves it. */
  const openSignedVersion = (check: SignatureCheck) => {
    const current = docRef.current;
    if (!current) return;
    const name = `${safeFileName(`${baseName(current.name)} (as signed by ${check.name ?? 'the signer'})`)}.pdf`;
    void unlessUnsaved(() => handleResult({ ok: true, file: { path: current.path, name, bytes: current.bytes.slice(0, check.signedLength) } }, { fromVault: current.fromVault }));
  };

  /**
   * What the Archive stores for a PDF: read here, in the sandboxed window (asking for its password if
   * it has one), for its page count, title and a picture of its first page. The PDF is stored as it is.
   */
  async function vaultItem(file: OpenedFile): Promise<NewDocument | null> {
    try {
      const { pdf } = await loadDocument(file.bytes, askPassword(file.name));
      try {
        const meta = (await pdf.getMetadata().catch(() => null)) as { info?: { Title?: unknown } } | null;
        const title = typeof meta?.info?.Title === 'string' && meta.info.Title.trim() ? meta.info.Title.trim() : baseName(file.name);
        return { fileName: file.name, title, pages: pdf.numPages, bytes: file.bytes, thumbnail: await firstPagePicture(pdf), pageTexts: await pageTexts(pdf) };
      } finally {
        void pdf.loadingTask.destroy();
      }
    } catch (error) {
      if (!(error instanceof OpenError && error.kind === 'cancelled')) setMessage(`${file.name} couldn't be added: the file may be damaged, or it may not really be a PDF.`);
      return null;
    } finally {
      setPassword(null);
    }
  }

  const openFromVault = (item: VaultDocument, bytes: Uint8Array, page?: number) =>
    void unlessUnsaved(() => handleResult({ ok: true, file: { path: '', name: item.fileName, bytes } }, { fromVault: true, vaultDoc: { id: item.id, title: item.title }, startPage: page }));

  /** Opens one version of a stored document; its name says which version it is. */
  const openVersionFromVault = (item: VaultDocument, version: VaultVersion, bytes: Uint8Array) => {
    const name = `${safeFileName(`${baseName(version.fileName)} (version ${version.number})`)}.pdf`;
    void unlessUnsaved(() => handleResult({ ok: true, file: { path: '', name, bytes } }, { fromVault: true, vaultDoc: { id: item.id, title: item.title } }));
  };

  /** Opens a stored version with pdf.js for comparing (asking for its password if it has one). */
  const readVaultPdf = useCallback(async (bytes: Uint8Array, name: string): Promise<PdfDocument | null> => {
    try {
      return (await loadDocument(bytes, askPassword(name))).pdf;
    } catch {
      return null;
    } finally {
      setPassword(null);
    }
  }, []);

  /** A stored document's page text, for the search index (asking for its password if it has one). Null if it can't be read. */
  const vaultTexts = async (item: VaultDocument): Promise<string[] | null> => {
    const opened = await api.vaultOpen(item.id);
    if (!opened.ok) return null;
    try {
      const { pdf } = await loadDocument(opened.value.bytes, askPassword(item.fileName));
      try {
        return await pageTexts(pdf);
      } finally {
        void pdf.loadingTask.destroy();
      }
    } catch {
      return null;
    } finally {
      setPassword(null);
    }
  };

  /** The open file, for "Add the open file" on the Archive screen. */
  const openFileItem = async (): Promise<NewDocument | null> => {
    const current = docRef.current;
    if (!current) return null;
    return {
      fileName: current.name,
      title: report?.details.shown.title || baseName(current.name),
      pages: current.pdf.numPages,
      bytes: current.bytes,
      thumbnail: await firstPagePicture(current.pdf),
      pageTexts: await pageTexts(current.pdf),
    };
  };

  const trustSigner = async (check: SignatureCheck) => {
    const cert = check.certificate;
    if (!cert) return;
    const ok = await confirm({
      title: 'Trust this certificate?',
      message: `Only trust it if you know it's ${cert.name}'s: for example, they gave it to you, or read you its fingerprint. From now on, ScribeForge says signatures made with it are by ${cert.name}. Fingerprint: ${cert.fingerprint}`,
      confirmLabel: 'Trust it',
    });
    if (ok) setTrust(await api.trustCertificate(cert.der));
  };

  const untrust = async (cert: CertificateSummary) => setTrust(await api.untrustCertificate(cert.der));

  if (!settings || !info) return null;

  const nav: { id: Screen; label: string; icon: IconName; disabled?: boolean }[] = [
    { id: 'start', label: 'Start', icon: 'open' },
    { id: 'document', label: 'Document', icon: 'document', disabled: !doc },
    { id: 'pages', label: 'Pages', icon: 'pages', disabled: !doc },
    { id: 'details', label: 'Details', icon: 'details', disabled: !doc },
    { id: 'cleanup', label: 'Clean up', icon: 'clean', disabled: !doc },
    { id: 'sign', label: 'Sign', icon: 'seal', disabled: !doc },
    { id: 'archive', label: 'Archive', icon: 'archive' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
    { id: 'help', label: 'Help', icon: 'help' },
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
              fileAnnots={docFileAnnots?.list ?? []}
              fileLoading={docFileAnnots ? docFileAnnots.reading : 'Reading comments…'}
              authorName={settings?.authorName ?? ''}
              redact={redact}
              redactDispatch={redactDispatch}
              onRedact={() => void saving.redact()}
              active={screen === 'document'}
              working={saving.working}
              onSave={() => void saving.saveAll()}
              onAskLink={setLink}
              onRefusedLink={(address) => setMessage(`This link can't be opened from ScribeForge: ${address}`)}
              onClose={() => void closeWithCheck()}
              signatureNote={docSignatures?.list?.length ? { text: signaturesSummary(docSignatures.list), onShow: () => setScreen('sign') } : null}
              startPage={doc.startPage}
              placing={
                placing
                  ? {
                      onPlaced: (page, rect, rotation) => {
                        const chosen = placing;
                        setPlacing(null);
                        void saving.sign({ ...chosen, place: { kind: 'box', page, rect, rotation } }, newFile);
                      },
                      onCancel: () => {
                        setPlacing(null);
                        api.forgetCertificate();
                      },
                    }
                  : null
              }
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
        {doc && screen === 'cleanup' && (
          <CleanUp
            name={doc.name}
            report={report}
            failed={docReport?.docId === doc.id && docReport.failed}
            choices={cleanChoices}
            onChange={setCleanChoices}
            onClean={() => void saving.clean(cleanChoices)}
            working={saving.working}
          />
        )}
        {doc && screen === 'sign' && (
          <Sign
            name={doc.name}
            checks={docSignatures?.list ?? null}
            failed={docSignatures?.failed ?? false}
            trusted={trust?.mine ?? []}
            newFileNote={newFileNote(newFile)}
            working={saving.working}
            onSign={() => void startSigning()}
            onOpenSigned={openSignedVersion}
            onTrust={(check) => void trustSigner(check)}
            onUntrust={(cert) => void untrust(cert)}
            onMakeCertificate={() => setMaking('screen')}
          />
        )}
        {screen === 'archive' && (
          <Archive
            lockSignal={lockSignal}
            openName={doc && !doc.fromVault ? doc.name : null}
            onAddOpen={openFileItem}
            describe={vaultItem}
            readTexts={vaultTexts}
            onOpen={openFromVault}
            onOpenVersion={openVersionFromVault}
            readPdf={readVaultPdf}
            onMessage={setMessage}
            confirm={confirm}
            onStatus={setVault}
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
        {screen === 'help' && <Help page={helpPage} onPage={setHelpPage} onWebLink={setLink} />}
        {screen === 'about' && <About version={info.version} trial={info.trial} />}
      </main>

      {password && <PasswordDialog key={password.id} request={password} />}
      {signing && (
        <SignDialog
          remembered={signing.remembered}
          newFile={newFile}
          emptyFields={signing.emptyFields}
          onChooseFile={() => api.chooseCertificate()}
          onUnlock={(path, pw) => api.unlockCertificate(path, pw)}
          onCancel={() => {
            api.forgetCertificate();
            setSigning(null);
          }}
          onSign={(choices) => {
            setSigning(null);
            void saving.sign(choices, newFile);
          }}
          onDraw={(choices) => {
            setSigning(null);
            setPlacing(choices);
            setScreen('document');
          }}
          onMakeCertificate={() => {
            api.forgetCertificate();
            setSigning(null);
            setMaking('sign');
          }}
        />
      )}
      {making && (
        <MakeCertificateDialog
          defaultName={settings.authorName}
          onMake={(request) => api.makeCertificate(request)}
          onCancel={() => setMaking(null)}
          onDone={(path) => {
            const from = making;
            setMaking(null);
            const name = path.split(/[\\/]/).pop() ?? path;
            setMessage(`Saved your certificate as ${name}. Keep it safe, and remember its password: ScribeForge can't get it back.`);
            if (from === 'sign') void startSigning({ path, name, exists: true });
          }}
        />
      )}
      {reviewingMarks && (
        <Dialog
          title={redact.marks.length === 1 ? 'Redact 1 mark?' : `Redact ${redact.marks.length} marks?`}
          onCancel={() => {
            reviewingMarks.resolve(null);
            setReviewingMarks(null);
          }}
          testId="marks-dialog"
          wide
        >
          <p>
            Check the marks. Pages with a mark become pictures with the marked parts blacked out, so their text can't be selected, searched or copied.
            Pages without marks are copied as they are.
          </p>
          <p className="sf-muted">
            The redacted file won't include comments, form fields, bookmarks, attached files, the document's details or scripts, or any annotations you
            added, unless you choose to keep them below. Scripts are never kept.
          </p>
          <div className="sf-dialog-scroll" tabIndex={0} aria-label="Redaction marks">
            {redact.marks.length === 0 && <p>There are no marks left.</p>}
            {marksByPage(redact.marks).map(([page, list]) => (
              <section key={page} className="sf-marks-page">
                <h3>Page {page + 1}</h3>
                <ul>
                  {list.map((m) => (
                    <li key={m.id}>
                      <span>{markLabel(m)}</span>
                      <button type="button" className="sf-button" aria-label={`Remove ${markLabel(m)} on page ${page + 1}`} onClick={() => redactDispatch({ type: 'remove', ids: [m.id] })}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <fieldset className="sf-section sf-keep">
            <legend className="sf-strong">Also keep in the redacted file</legend>
            <div className="sf-choice-row">
              {(
                [
                  ['details', "The document's details"],
                  ['bookmarks', 'Bookmarks'],
                  ['comments', 'Comments on pages without marks'],
                  ['formFields', 'Form fields on pages without marks'],
                  ['attachments', 'Files attached to pages without marks'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="sf-choice">
                  <input type="checkbox" checked={redactKeep[key] === true} onChange={(e) => setRedactKeep((k) => ({ ...k, [key]: e.target.checked }))} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="sf-muted sf-log-hint">Anything kept is searched by the last check too.</p>
          </fieldset>
          <label className="sf-choice">
            <input type="checkbox" checked={wantLog} onChange={(e) => setWantLog(e.target.checked)} />
            <span>Also save a redaction log next to the redacted file</span>
          </label>
          <p className="sf-muted sf-log-hint">
            A text file listing when, which files, and each mark's page and kind. It never includes the marked text, only a hint such as j•••@e•••.com.
          </p>
          <div className="sf-dialog-buttons">
            <button
              type="button"
              className="sf-button"
              onClick={() => {
                reviewingMarks.resolve(null);
                setReviewingMarks(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="sf-button sf-primary"
              disabled={redact.marks.length === 0}
              onClick={() => {
                reviewingMarks.resolve({ marks: redactRef.current.marks, log: wantLog, keep: redactKeep });
                setReviewingMarks(null);
              }}
            >
              Redact…
            </button>
          </div>
        </Dialog>
      )}
      {reviewing && (
        <Dialog
          title={reviewing.title ?? (reviewing.files === 1 ? 'What the new file carries' : `What the ${reviewing.files} new files carry`)}
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
          {reviewing.archiveOffer && !reviewing.versionOf && (
            <label className="sf-choice">
              <input type="checkbox" checked={keepCopy === 'copy'} onChange={(e) => setKeepCopy(e.target.checked ? 'copy' : 'none')} />
              <span>Also keep a copy in the Archive</span>
            </label>
          )}
          {reviewing.archiveOffer && reviewing.versionOf && (
            <fieldset className="sf-split-choices" data-testid="review-archive">
              <legend className="sf-strong">The Archive</legend>
              {(
                [
                  ['none', "Don't keep it in the Archive"],
                  ['version', `Save as a new version of “${reviewing.versionOf}”`],
                  ['copy', 'Keep a copy in the Archive, as a separate document'],
                ] as const
              ).map(([choice, text]) => (
                <label key={choice} className="sf-choice">
                  <input type="radio" name="review-archive" checked={keepCopy === choice} onChange={() => setKeepCopy(choice)} />
                  <span>{text}</span>
                </label>
              ))}
            </fieldset>
          )}
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
                reviewing.resolve({ archive: keepCopy });
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
