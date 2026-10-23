import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OpenedFile } from '../../../shared/api';
import { MIN_VAULT_PASSWORD, type HistoryCheck, type NewDocument, type VaultDocument, type VaultStatus } from '../../../shared/vault';
import { historyFile, historyState, historyText, lockedBecause } from '../archive/describe';
import { ChangePasswordDialog, NewRecoveryCodeDialog, ReasonDialog, RecoveryCodeDialog, RestoreBackupDialog } from '../archive/VaultDialogs';
import { Icon } from '../components/Icon';
import { formatDate, sizeText } from '../details/describe';
import type { ConfirmRequest } from '../pages/sources';
import { plural } from '../words';

const api = window.scribeforge;

/** A document's first page, as stored (encrypted) with it. */
function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let current = true;
    void api.vaultThumbnail(id).then((r) => {
      if (!current || !r.ok || !r.value) return;
      made = URL.createObjectURL(new Blob([r.value.slice()], { type: 'image/png' }));
      setUrl(made);
    });
    return () => {
      current = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  return <span className="sf-vault-thumb">{url && <img src={url} alt="" />}</span>;
}

/** The selected document: its title, labels and note (saved as they're changed), and what can be done with it. */
function DocumentPanel({
  doc,
  onChange,
  onOpen,
  onSaveCopy,
  onVoid,
  onRestore,
  onErase,
}: {
  doc: VaultDocument;
  onChange: (change: { title?: string; labels?: string[]; note?: string }) => void;
  onOpen: () => void;
  onSaveCopy: () => void;
  onVoid: () => void;
  onRestore: () => void;
  onErase: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [labels, setLabels] = useState(doc.labels.join(', '));
  const [note, setNote] = useState(doc.note);
  const labelList = (text: string) => text.split(',').map((l) => l.trim()).filter(Boolean);
  return (
    <section className="sf-vault-panel" aria-label="Selected document" data-testid="vault-panel">
      {doc.voided && (
        <p className="sf-banner sf-notice">
          Voided on {formatDate(doc.voided.at)}. Reason: {doc.voided.reason}
        </p>
      )}
      <label className="sf-field">
        <span>Title</span>
        <input type="text" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== doc.title && onChange({ title })} />
      </label>
      <label className="sf-field">
        <span>Labels, separated with commas</span>
        <input
          type="text"
          value={labels}
          onChange={(e) => setLabels(e.target.value)}
          onBlur={() => labelList(labels).join('\n') !== doc.labels.join('\n') && onChange({ labels: labelList(labels) })}
        />
      </label>
      <label className="sf-field">
        <span>Note</span>
        <textarea rows={3} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== doc.note && onChange({ note })} />
      </label>
      <dl className="sf-facts">
        <dt>File</dt>
        <dd>{doc.fileName}</dd>
        <dt>Added</dt>
        <dd>{formatDate(doc.added)}</dd>
        <dt>Pages</dt>
        <dd>{doc.pages || 'Not known'}</dd>
        <dt>Size</dt>
        <dd>{sizeText(doc.size)}</dd>
      </dl>
      <div className="sf-vault-buttons">
        <button type="button" className="sf-button sf-primary" onClick={onOpen}>
          Open
        </button>
        <button type="button" className="sf-button" onClick={onSaveCopy}>
          Save a copy…
        </button>
        {doc.voided ? (
          <button type="button" className="sf-button" onClick={onRestore}>
            Restore
          </button>
        ) : (
          <button type="button" className="sf-button" onClick={onVoid}>
            Void…
          </button>
        )}
        <button type="button" className="sf-button" onClick={onErase}>
          Erase for good…
        </button>
      </div>
    </section>
  );
}

/**
 * The Archive (codenames Niko's Archive and Beloved Codex; docs/Plan_Phase3.md): an encrypted vault
 * for PDFs. It's locked until unlocked here, and locks again after a while unused, when Windows
 * locks, when the PC sleeps, or with Lock.
 */
export function Archive({
  lockSignal,
  openName,
  onAddOpen,
  describe,
  onOpen,
  onMessage,
  confirm,
  onStatus,
}: {
  /** Changes each time the vault locks, with why. */
  lockSignal: { seq: number; why: string } | null;
  /** The open document's name, for "Add the open file", or null when none is open. */
  openName: string | null;
  onAddOpen: () => Promise<NewDocument | null>;
  /** Reads a chosen PDF (asking for its password if it has one) into what the vault stores. */
  describe: (file: OpenedFile) => Promise<NewDocument | null>;
  onOpen: (doc: VaultDocument, bytes: Uint8Array) => void;
  onMessage: (text: string) => void;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  onStatus: (status: VaultStatus) => void;
}) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [docs, setDocs] = useState<VaultDocument[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'documents' | 'history'>('documents');
  const [label, setLabel] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [sort, setSort] = useState<'added' | 'title'>('added');
  const [history, setHistory] = useState<HistoryCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'password' | 'code' | 'void' | 'erase' | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  // Making and unlocking.
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [withCode, setWithCode] = useState(true);
  const [kind, setKind] = useState<'password' | 'recovery'>('password');
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await api.vaultStatus();
    setStatus(s);
    onStatus(s);
    if (!s.unlocked) {
      setDocs(null);
      setHistory(null);
      return;
    }
    const list = await api.vaultDocuments();
    if (list.ok) setDocs(list.value);
    const h = await api.vaultHistory();
    if (h.ok) setHistory(h.value);
  }, [onStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!lockSignal) return;
    setNote(lockedBecause(lockSignal.why));
    setSelected(null);
    void refresh();
  }, [lockSignal, refresh]);

  /** Shows a vault reply's message, and refreshes if the vault turned out to be locked. */
  const failed = (message: string, locked: boolean) => {
    onMessage(message);
    if (locked) void refresh();
  };

  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_VAULT_PASSWORD) return setProblem(`The password needs at least ${MIN_VAULT_PASSWORD} characters.`);
    if (password !== again) return setProblem("The two passwords aren't the same.");
    setBusy('Making the vault…');
    const result = await api.vaultCreate(password, withCode);
    setBusy(null);
    if (!result.ok) return setProblem(result.message);
    setPassword('');
    setAgain('');
    setProblem(null);
    if (result.value) setCode(result.value);
    await refresh();
  };

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('Unlocking…');
    const result = await api.vaultUnlock(password, kind);
    setBusy(null);
    if (!result.ok) return setProblem(result.message);
    setPassword('');
    setProblem(null);
    setNote(null);
    await refresh();
    if (kind === 'recovery') {
      setKind('password');
      onMessage('The vault was opened with the recovery code. If you\'ve forgotten the password, set a new one with Change password.');
    }
  };

  const addDocuments = async (items: NewDocument[]) => {
    if (items.length === 0) return;
    setBusy(items.length === 1 ? 'Adding the document…' : `Adding ${items.length} documents…`);
    const result = await api.vaultAdd(items);
    setBusy(null);
    if (!result.ok) return failed(result.message, result.locked);
    onMessage(result.value.length === 1 ? `Added “${result.value[0].title}” to the Archive.` : `Added ${plural(result.value.length, 'document')} to the Archive.`);
    setSelected(result.value[0]?.id ?? null);
    await refresh();
  };

  const addFiles = async () => {
    const chosen = await api.vaultChooseFiles();
    const items: NewDocument[] = [];
    for (const [i, file] of chosen.entries()) {
      if (!file.ok) {
        if (file.reason !== 'cancelled') onMessage(`${file.path.split(/[\\/]/).pop()} couldn't be added: it couldn't be read as a PDF.`);
        continue;
      }
      setBusy(`Reading ${i + 1} of ${chosen.length}…`);
      const item = await describe(file.file);
      if (item) items.push(item);
    }
    setBusy(null);
    await addDocuments(items);
  };

  const change = async (id: string, c: { title?: string; labels?: string[]; note?: string }) => {
    const result = await api.vaultUpdate(id, c);
    if (!result.ok) return failed(result.message, result.locked);
    await refresh();
  };

  const open = async (doc: VaultDocument) => {
    const result = await api.vaultOpen(doc.id);
    if (!result.ok) return failed(result.message, result.locked);
    onOpen(doc, result.value.bytes);
  };

  const saveCopy = async (doc: VaultDocument) => {
    const result = await api.vaultSaveCopy(doc.id);
    if (result.ok) onMessage(`Saved a copy of “${doc.title}” as ${result.path.split(/[\\/]/).pop()}.`);
    else if (result.reason === 'failed') onMessage(result.message ?? "The copy couldn't be saved.");
    await refresh();
  };

  const backup = async () => {
    setBusy('Making the backup…');
    const result = await api.vaultBackup();
    setBusy(null);
    if (result.ok) onMessage(`Saved the backup as ${result.path.split(/[\\/]/).pop()}. It's encrypted: the vault's password (or recovery code) opens it.`);
    else if (result.reason === 'failed') onMessage(result.message ?? "The backup couldn't be saved.");
    await refresh();
  };

  const chooseBackup = async () => {
    const chosen = await api.vaultChooseBackup();
    if (chosen.ok) setRestoring(chosen.name);
    else if (chosen.message) onMessage(chosen.message);
  };

  const saveHistory = async () => {
    if (!history) return;
    const result = await api.vaultSaveText('ScribeForge Archive history', historyFile(history, new Date()));
    if (result.ok) onMessage(`Saved the history as ${result.path.split(/[\\/]/).pop()}.`);
  };

  const all = docs ?? [];
  const labels = useMemo(() => [...new Set(all.flatMap((d) => d.labels))].sort((a, b) => a.localeCompare(b)), [all]);
  const shown = all
    .filter((d) => (showVoided ? true : !d.voided) && (!label || d.labels.includes(label)))
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : b.added.localeCompare(a.added)));
  const current = all.find((d) => d.id === selected) ?? null;

  const restoreDialog = restoring && (
    <RestoreBackupDialog
      name={restoring}
      replacing={!!status?.exists}
      onCancel={() => {
        api.vaultForgetBackup();
        setRestoring(null);
      }}
      onRestored={(n) => {
        setRestoring(null);
        onMessage(`The vault was restored from the backup: ${plural(n, 'document')}.`);
        void refresh();
      }}
    />
  );

  if (!status) return null;

  if (!status.exists) {
    return (
      <div className="sf-screen sf-archive" data-testid="archive-screen">
        <h1>Archive</h1>
        <p>
          The Archive keeps copies of your PDFs in an encrypted vault on this PC, with labels and notes, and a history of every change. Nothing in it can
          be read without your password, and it locks itself when you're not using it.
        </p>
        <form className="sf-section sf-vault-form" onSubmit={(e) => void make(e)}>
          <h2>Make the vault</h2>
          <label className="sf-field">
            <span>Password (at least {MIN_VAULT_PASSWORD} characters)</span>
            <input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="sf-field">
            <span>The password again</span>
            <input type="password" value={again} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
          </label>
          <label className="sf-choice">
            <input type="checkbox" checked={withCode} onChange={(e) => setWithCode(e.target.checked)} />
            <span>Also make a recovery code, in case I forget the password</span>
          </label>
          <p className="sf-muted">ScribeForge never saves the password. If you lose it (and the recovery code), nobody can open the vault, ScribeForge included.</p>
          {problem && (
            <p className="sf-error" role="alert">
              {problem}
            </p>
          )}
          <div className="sf-vault-buttons">
            <button type="submit" className="sf-button sf-primary" disabled={!password || busy !== null}>
              {busy ?? 'Make the vault'}
            </button>
            <button type="button" className="sf-button" onClick={() => void chooseBackup()}>
              Restore a backup…
            </button>
          </div>
        </form>
        {restoreDialog}
      </div>
    );
  }

  if (!status.unlocked) {
    return (
      <div className="sf-screen sf-archive" data-testid="archive-screen">
        <h1>Archive</h1>
        {note && (
          <p className="sf-banner sf-notice" data-testid="vault-locked-note">
            {note}
          </p>
        )}
        <form className="sf-section sf-vault-form" onSubmit={(e) => void unlock(e)}>
          <h2>
            <Icon name="lock" size={20} /> The vault is locked
          </h2>
          <label className="sf-field">
            <span>{kind === 'password' ? 'Password' : 'Recovery code'}</span>
            <input type={kind === 'password' ? 'password' : 'text'} value={password} autoComplete="off" spellCheck={false} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {problem && (
            <p className="sf-error" role="alert">
              {problem}
            </p>
          )}
          <div className="sf-vault-buttons">
            <button type="submit" className="sf-button sf-primary" disabled={!password || busy !== null}>
              {busy ?? 'Unlock'}
            </button>
            {status.hasRecoveryCode && (
              <button
                type="button"
                className="sf-link-button"
                onClick={() => {
                  setKind(kind === 'password' ? 'recovery' : 'password');
                  setPassword('');
                  setProblem(null);
                }}
              >
                {kind === 'password' ? 'Use the recovery code instead' : 'Use the password instead'}
              </button>
            )}
          </div>
        </form>
        <section className="sf-section">
          <h2>Restore a backup</h2>
          <p className="sf-muted">Replaces the vault on this PC with a backup you made earlier.</p>
          <button type="button" className="sf-button" onClick={() => void chooseBackup()}>
            Restore a backup…
          </button>
        </section>
        {restoreDialog}
      </div>
    );
  }

  return (
    <div className="sf-screen sf-archive" data-testid="archive-screen">
      <div className="sf-section-head">
        <h1>Archive</h1>
        <button type="button" className="sf-button" onClick={() => api.vaultLock()}>
          <Icon name="lock" size={18} />
          Lock
        </button>
      </div>
      <p className="sf-muted" data-testid="vault-size">
        {plural(status.documents ?? 0, 'document')}, {sizeText(status.bytes ?? 0)}, encrypted on this PC.
      </p>
      <div className="sf-vault-buttons">
        <button type="button" className="sf-button sf-primary" onClick={() => void addFiles()} disabled={busy !== null}>
          <Icon name="add" size={18} />
          Add PDFs…
        </button>
        {openName && (
          <button
            type="button"
            className="sf-button"
            disabled={busy !== null}
            onClick={() => void onAddOpen().then((item) => item && addDocuments([item]))}
          >
            Add the open file ({openName})
          </button>
        )}
        <span className="sf-toolbar-fill" />
        <div className="sf-mode" role="radiogroup" aria-label="Show">
          {(
            [
              ['documents', 'Documents'],
              ['history', 'History'],
            ] as const
          ).map(([id, text]) => (
            <button key={id} type="button" role="radio" aria-checked={view === id} className="sf-mode-option" onClick={() => setView(id)}>
              {text}
            </button>
          ))}
        </div>
      </div>
      {busy && (
        <p className="sf-muted" role="status">
          {busy}
        </p>
      )}

      {view === 'documents' ? (
        <>
          <div className="sf-vault-filters">
            <label className="sf-field">
              <span>Label</span>
              <select value={label} onChange={(e) => setLabel(e.target.value)}>
                <option value="">All labels</option>
                {labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="sf-field">
              <span>Order</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as 'added' | 'title')}>
                <option value="added">Newest first</option>
                <option value="title">By title</option>
              </select>
            </label>
            <label className="sf-choice">
              <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
              <span>Show voided documents</span>
            </label>
          </div>
          {all.length === 0 ? (
            <p data-testid="vault-empty">The vault is empty. Add PDFs to keep encrypted copies of them here.</p>
          ) : shown.length === 0 ? (
            <p>No documents match.</p>
          ) : (
            <div className="sf-vault-body">
              <ul className="sf-vault-list" aria-label="Documents">
                {shown.map((d) => (
                  <li key={d.id}>
                    <button type="button" className="sf-vault-item" aria-current={d.id === selected ? 'true' : undefined} onClick={() => setSelected(d.id)} onDoubleClick={() => void open(d)}>
                      <Thumb id={d.id} />
                      <span className="sf-vault-item-text">
                        <span className="sf-strong">{d.title}</span>
                        <span className="sf-muted">
                          Added {formatDate(d.added)} · {plural(d.pages, 'page')}
                          {d.voided ? ' · Voided' : ''}
                        </span>
                        {d.labels.length > 0 && <span className="sf-vault-labels">{d.labels.join(', ')}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {current && (
                <DocumentPanel
                  key={current.id + current.title + current.labels.join() + current.note + String(current.voided?.at)}
                  doc={current}
                  onChange={(c) => void change(current.id, c)}
                  onOpen={() => void open(current)}
                  onSaveCopy={() => void saveCopy(current)}
                  onVoid={() => setDialog('void')}
                  onRestore={() =>
                    void api.vaultRestoreDocument(current.id).then((r) => {
                      if (!r.ok) failed(r.message, r.locked);
                      void refresh();
                    })
                  }
                  onErase={() => setDialog('erase')}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <section className="sf-section" aria-label="History" data-testid="vault-history">
          {history && (
            <>
              <p className={history.intact ? undefined : 'sf-error'} data-testid="history-state">
                {historyState(history)}
              </p>
              <ol className="sf-vault-history">
                {[...history.entries].reverse().map((e) => (
                  <li key={e.seq} value={e.seq}>
                    <span className="sf-muted">{formatDate(e.at)}</span> {historyText(e)}
                  </li>
                ))}
              </ol>
              <button type="button" className="sf-button" onClick={() => void saveHistory()}>
                Save as a text file…
              </button>
            </>
          )}
        </section>
      )}

      <section className="sf-section" aria-labelledby="vault-keeping">
        <h2 id="vault-keeping">Keeping the vault safe</h2>
        <div className="sf-vault-buttons">
          <button type="button" className="sf-button" onClick={() => void backup()} disabled={busy !== null}>
            Make a backup…
          </button>
          <button type="button" className="sf-button" onClick={() => void chooseBackup()}>
            Restore a backup…
          </button>
          <button type="button" className="sf-button" onClick={() => setDialog('password')}>
            Change the password…
          </button>
          <button type="button" className="sf-button" onClick={() => setDialog('code')}>
            {status.hasRecoveryCode ? 'Make a new recovery code…' : 'Make a recovery code…'}
          </button>
        </div>
        <p className="sf-muted">A backup is one encrypted file. Keep it somewhere other than this PC, such as a USB drive: the password (or recovery code) opens it.</p>
      </section>

      {code && <RecoveryCodeDialog code={code} onDone={() => setCode(null)} />}
      {dialog === 'password' && (
        <ChangePasswordDialog
          onCancel={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onMessage('The password was changed. Use the new one from now on.');
            void refresh();
          }}
        />
      )}
      {dialog === 'code' && (
        <NewRecoveryCodeDialog
          replacing={status.hasRecoveryCode}
          onCancel={() => setDialog(null)}
          onCode={(c) => {
            setDialog(null);
            setCode(c);
            void refresh();
          }}
        />
      )}
      {dialog === 'void' && current && (
        <ReasonDialog
          title={`Void “${current.title}”?`}
          explanation="A voided document is hidden from the list, but stays in the vault: Show voided documents finds it, and Restore brings it back. The reason goes in the history."
          confirmLabel="Void it"
          testId="void-dialog"
          onCancel={() => setDialog(null)}
          onConfirm={(reason) => {
            setDialog(null);
            void api.vaultVoid(current.id, reason).then((r) => {
              if (!r.ok) failed(r.message, r.locked);
              void refresh();
            });
          }}
        />
      )}
      {dialog === 'erase' && current && (
        <ReasonDialog
          title={`Erase “${current.title}” for good?`}
          explanation="Erasing removes the document and everything about it from the vault. It can't be undone. Only its title and your reason stay, in the history."
          warning="Copies in backups you've already made aren't touched: restoring one of those brings it back. To keep it but hide it, use Void instead."
          confirmLabel="Erase it for good"
          testId="erase-dialog"
          onCancel={() => setDialog(null)}
          onConfirm={(reason) => {
            setDialog(null);
            void (async () => {
              const ok = await confirm({ title: 'Erase it for good?', message: `“${current.title}” will be gone from the vault, and this can't be undone.`, confirmLabel: 'Erase it' });
              if (!ok) return;
              const r = await api.vaultErase(current.id, reason);
              if (!r.ok) return failed(r.message, r.locked);
              setSelected(null);
              onMessage(`“${current.title}” was erased from the vault.`);
              void refresh();
            })();
          }}
        />
      )}
      {restoreDialog}
    </div>
  );
}
