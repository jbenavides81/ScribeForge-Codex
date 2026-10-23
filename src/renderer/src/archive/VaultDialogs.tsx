import { useState } from 'react';
import { MIN_VAULT_PASSWORD } from '../../../shared/vault';
import { Dialog } from '../components/Dialog';
import { formatDate } from '../details/describe';
import { plural } from '../words';

const api = window.scribeforge;

/** A recovery code, shown once: it can't be shown again. */
export function RecoveryCodeDialog({ code, onDone }: { code: string; onDone: () => void }) {
  const [kept, setKept] = useState(false);
  return (
    <Dialog title="Your recovery code" onCancel={() => kept && onDone()} testId="recovery-code-dialog">
      <p>If you forget your password, this code opens the vault. It's shown only now: write it down and keep it somewhere safe, away from this PC.</p>
      <p className="sf-recovery-code" data-testid="recovery-code">
        {code}
      </p>
      <p className="sf-muted">Anyone with the code can open the vault. If you lose both the password and the code, nobody can open it, ScribeForge included.</p>
      <label className="sf-choice">
        <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />
        <span>I've written it down somewhere safe</span>
      </label>
      <div className="sf-dialog-buttons">
        <button type="button" className="sf-button sf-primary" disabled={!kept} onClick={onDone}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

export function ChangePasswordDialog({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_VAULT_PASSWORD) return setProblem(`The new password needs at least ${MIN_VAULT_PASSWORD} characters.`);
    if (next !== again) return setProblem("The two new passwords aren't the same.");
    const result = await api.vaultChangePassword(current, next);
    if (result.ok) onDone();
    else setProblem(result.message);
  };
  return (
    <Dialog title="Change the vault's password" onCancel={onCancel} testId="change-password-dialog">
      <form onSubmit={(e) => void submit(e)}>
        <label className="sf-field">
          <span>Current password</span>
          <input type="password" value={current} autoComplete="off" onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="sf-field">
          <span>New password (at least {MIN_VAULT_PASSWORD} characters)</span>
          <input type="password" value={next} autoComplete="new-password" onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="sf-field">
          <span>The new password again</span>
          <input type="password" value={again} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
        </label>
        {problem && (
          <p className="sf-error" role="alert">
            {problem}
          </p>
        )}
        <div className="sf-dialog-buttons">
          <button type="button" className="sf-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="sf-button sf-primary" disabled={!current || !next}>
            Change the password
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Makes a new recovery code after asking for the password; the old code stops working. */
export function NewRecoveryCodeDialog({ replacing, onCode, onCancel }: { replacing: boolean; onCode: (code: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await api.vaultRecoveryCode(password);
    if (result.ok) onCode(result.value);
    else setProblem(result.message);
  };
  return (
    <Dialog title={replacing ? 'Make a new recovery code' : 'Make a recovery code'} onCancel={onCancel} testId="new-recovery-dialog">
      <form onSubmit={(e) => void submit(e)}>
        <p>{replacing ? 'A new code replaces the old one, which then stops working.' : 'A recovery code opens the vault if you forget your password.'} Type the vault's password first.</p>
        <label className="sf-field">
          <span>Password</span>
          <input type="password" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} />
        </label>
        {problem && (
          <p className="sf-error" role="alert">
            {problem}
          </p>
        )}
        <div className="sf-dialog-buttons">
          <button type="button" className="sf-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="sf-button sf-primary" disabled={!password}>
            Make the code
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks for a reason, for voiding or erasing a document. */
export function ReasonDialog({
  title,
  explanation,
  warning,
  confirmLabel,
  onConfirm,
  onCancel,
  testId,
}: {
  title: string;
  explanation: string;
  warning?: string;
  confirmLabel: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  testId: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title={title} onCancel={onCancel} testId={testId}>
      <p>{explanation}</p>
      {warning && <p className="sf-banner sf-notice">{warning}</p>}
      <label className="sf-field">
        <span>Reason</span>
        <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="sf-dialog-buttons">
        <button type="button" className="sf-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="sf-button sf-primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Restoring a backup: its password (or recovery code) checks every part of it first; then it
 * says when it was made and what it holds, and asks before replacing the vault.
 */
export function RestoreBackupDialog({ name, replacing, onRestored, onCancel }: { name: string; replacing: boolean; onRestored: (documents: number) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<'password' | 'recovery'>('password');
  const [secret, setSecret] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ created: string; documents: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await api.vaultRestoreBackup(secret, kind, false);
    setBusy(false);
    if (result.ok) {
      setChecked(result.value);
      setProblem(null);
    } else setProblem(result.message);
  };
  const restore = async () => {
    setBusy(true);
    const result = await api.vaultRestoreBackup(secret, kind, true);
    setBusy(false);
    if (result.ok) onRestored(result.value.documents);
    else setProblem(result.message);
  };
  return (
    <Dialog title="Restore a backup" onCancel={onCancel} testId="restore-backup-dialog">
      {!checked ? (
        <form onSubmit={(e) => void check(e)}>
          <p>
            <span className="sf-strong">{name}</span>: type the password the vault had when this backup was made, or its recovery code. ScribeForge checks every
            part of the backup before using it.
          </p>
          <div className="sf-choice-row" role="radiogroup" aria-label="Open the backup with">
            <label className="sf-choice">
              <input type="radio" name="backup-kind" checked={kind === 'password'} onChange={() => setKind('password')} />
              <span>Password</span>
            </label>
            <label className="sf-choice">
              <input type="radio" name="backup-kind" checked={kind === 'recovery'} onChange={() => setKind('recovery')} />
              <span>Recovery code</span>
            </label>
          </div>
          <label className="sf-field">
            <span>{kind === 'password' ? 'Password' : 'Recovery code'}</span>
            <input type={kind === 'password' ? 'password' : 'text'} value={secret} autoComplete="off" spellCheck={false} onChange={(e) => setSecret(e.target.value)} />
          </label>
          {problem && (
            <p className="sf-error" role="alert">
              {problem}
            </p>
          )}
          <div className="sf-dialog-buttons">
            <button type="button" className="sf-button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="sf-button sf-primary" disabled={!secret || busy}>
              {busy ? 'Checking…' : 'Check the backup'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p data-testid="backup-checked">
            The backup is complete and undamaged. It was made on {formatDate(checked.created)} and holds {plural(checked.documents, 'document')}.
          </p>
          {replacing && (
            <p className="sf-banner sf-notice">
              Restoring it replaces the vault on this PC. Anything added or changed since the backup was made is lost.
            </p>
          )}
          {problem && (
            <p className="sf-error" role="alert">
              {problem}
            </p>
          )}
          <div className="sf-dialog-buttons">
            <button type="button" className="sf-button" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="sf-button sf-primary" disabled={busy} onClick={() => void restore()}>
              {replacing ? 'Replace the vault with it' : 'Restore it'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
