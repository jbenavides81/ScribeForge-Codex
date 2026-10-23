import { useState } from 'react';
import type { MakeCertificateRequest, MakeCertificateResult } from '../../../shared/api';
import { Dialog } from '../components/Dialog';

const MIN_PASSWORD = 8;

/**
 * "Make a certificate": a certificate in your name that issues itself, saved as a file protected
 * by a password you choose. ScribeForge saves neither the password nor a copy of the file.
 */
export function MakeCertificateDialog({
  defaultName,
  onMake,
  onDone,
  onCancel,
}: {
  defaultName: string;
  onMake: (request: MakeCertificateRequest) => Promise<MakeCertificateResult>;
  onDone: (path: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setProblem('Type the name to put on the certificate.');
    if (password.length < MIN_PASSWORD) return setProblem(`The password needs at least ${MIN_PASSWORD} characters.`);
    if (password !== again) return setProblem("The two passwords aren't the same.");
    setProblem(null);
    setBusy(true);
    const result = await onMake({ name: name.trim(), email: email.trim(), password });
    setBusy(false);
    if (result.ok) onDone(result.path);
    else if (result.reason === 'failed') setProblem(result.message ?? "ScribeForge couldn't make the certificate.");
  };

  return (
    <Dialog title="Make a certificate" onCancel={onCancel} testId="make-certificate-dialog" wide>
      <form onSubmit={(e) => void submit(e)}>
        <p>
          A certificate in your name, which issues itself, valid for five years. It's saved as a file protected by the password you choose here. Keep
          the file safe, and remember the password: ScribeForge can't get it back.
        </p>
        <label className="sf-field">
          <span>Name on the certificate</span>
          <input type="text" value={name} maxLength={100} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="sf-field">
          <span>Email address (optional)</span>
          <input type="email" value={email} maxLength={200} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="sf-field">
          <span>Password for the certificate file (at least {MIN_PASSWORD} characters)</span>
          <input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="sf-field">
          <span>The password again</span>
          <input type="password" value={again} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
        </label>
        {problem && (
          <p className="sf-error" role="alert">
            {problem}
          </p>
        )}
        <p className="sf-muted">
          Other people's readers will say its identity isn't confirmed unless they choose to trust it: anyone can make a certificate with any name.
        </p>
        <div className="sf-dialog-buttons">
          <button type="button" className="sf-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="sf-button sf-primary" disabled={busy}>
            {busy ? 'Making it…' : 'Make and save…'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
