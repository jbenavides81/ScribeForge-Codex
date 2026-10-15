import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo, MenuCommand, OpenResult, RecentFile, SettingsChange } from '../../shared/api';
import type { Settings as AppSettings } from '../../shared/settings';
import { applyAppearance, onSystemThemeChange } from './appearance';
import { Dialog } from './components/Dialog';
import { Icon, type IconName } from './components/Icon';
import { About } from './screens/About';
import { Settings } from './screens/Settings';
import { Start } from './screens/Start';
import { DocumentView } from './viewer/DocumentView';
import { loadDocument, OpenError, type PdfDocument } from './viewer/pdfjs';

type Screen = 'start' | 'document' | 'settings' | 'about';

interface OpenDocument {
  /** Each opened document gets a fresh viewer. */
  id: number;
  pdf: PdfDocument;
  name: string;
  path: string;
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

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [screen, setScreen] = useState<Screen>('start');
  const [doc, setDoc] = useState<OpenDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState<PasswordRequest | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [command, setCommand] = useState<{ name: MenuCommand; seq: number } | null>(null);
  const docRef = useRef<OpenDocument | null>(null);
  docRef.current = doc;

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

  const changeSettings = useCallback(async (change: SettingsChange) => {
    setSettings(await api.changeSettings(change));
    setRecent(await api.recentFiles());
  }, []);

  const nextDocId = useRef(0);

  /** Frees a document after its viewer has been cleared away. */
  const release = (old: OpenDocument | null) => {
    if (old) window.setTimeout(() => void old.pdf.loadingTask.destroy(), 0);
  };

  const closeDocument = useCallback(() => {
    const current = docRef.current;
    setDoc(null);
    setScreen('start');
    release(current);
  }, []);

  const handleResult = useCallback(
    async (result: OpenResult) => {
      setRecent(await api.recentFiles());
      if (!result.ok) {
        if (result.reason !== 'cancelled') setMessage(openFailureMessage(result));
        return;
      }
      const { file } = result;
      setMessage(null);
      setBusy(`Opening ${file.name}…`);
      try {
        let asks = 0;
        const pdf = await loadDocument(
          file.bytes,
          (retry) => new Promise((resolve) => setPassword({ id: ++asks, name: file.name, retry, resolve })),
        );
        const previous = docRef.current;
        setDoc({ id: ++nextDocId.current, pdf, name: file.name, path: file.path });
        setScreen('document');
        release(previous);
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
    },
    [],
  );

  const openWithDialog = useCallback(async () => handleResult(await api.openDialog()), [handleResult]);
  const openPath = useCallback(async (path: string) => handleResult(await api.openPath(path)), [handleResult]);

  // Menu commands from the main process.
  useEffect(() => {
    let seq = 0;
    return api.onMenu((name) => {
      switch (name) {
        case 'open':
          void openWithDialog();
          break;
        case 'close-document':
          closeDocument();
          break;
        case 'show-settings':
          setScreen('settings');
          break;
        case 'show-about':
          setScreen('about');
          break;
        default:
          if (docRef.current) {
            setScreen('document');
            setCommand({ name, seq: ++seq });
          }
      }
    });
  }, [openWithDialog, closeDocument]);

  // Dragging a PDF onto the window opens it. Nothing dropped ever navigates the window.
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

  if (!settings || !info) return null;

  const nav: { id: Screen; label: string; icon: IconName; disabled?: boolean }[] = [
    { id: 'start', label: 'Start', icon: 'open' },
    { id: 'document', label: 'Document', icon: 'document', disabled: !doc },
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
            <p>{message}</p>
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
              command={command}
              onAskLink={setLink}
              onRefusedLink={(address) => setMessage(`This link can't be opened from ScribeForge: ${address}`)}
              onClose={closeDocument}
            />
          </div>
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
