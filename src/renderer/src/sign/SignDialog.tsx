import { useState } from 'react';
import type { EmptySignatureField } from '../../../engine/sign/types';
import type { CertificateFileInfo, UnlockResult } from '../../../shared/api';
import { Dialog } from '../components/Dialog';
import { formatDate } from '../details/describe';
import type { NewFileReason, SignChoices } from '../pages/saving';
import { certificateWarnings, newFileNote, UNLOCK_PROBLEMS } from './describe';

type Unlocked = Extract<UnlockResult, { ok: true }>;

/**
 * Signing, in two steps: the certificate file and its password (never saved), then how the
 * signature looks and why. Drawing a box on the page happens after this window closes.
 */
export function SignDialog({
  remembered,
  newFile,
  emptyFields,
  onChooseFile,
  onUnlock,
  onCancel,
  onSign,
  onDraw,
  onMakeCertificate,
}: {
  remembered: CertificateFileInfo | null;
  newFile: NewFileReason;
  emptyFields: EmptySignatureField[];
  onChooseFile: () => Promise<CertificateFileInfo | null>;
  onUnlock: (path: string, password: string) => Promise<UnlockResult>;
  onCancel: () => void;
  onSign: (choices: SignChoices) => void;
  onDraw: (choices: Omit<SignChoices, 'place'>) => void;
  onMakeCertificate: () => void;
}) {
  const [file, setFile] = useState<CertificateFileInfo | null>(remembered?.exists ? remembered : null);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState<Unlocked | null>(null);
  const usable = newFile ? [] : emptyFields;
  const [kind, setKind] = useState<'box' | 'field' | 'invisible'>('box');
  const [field, setField] = useState(usable[0]?.name ?? '');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');

  const choose = async () => {
    const chosen = await onChooseFile();
    if (chosen) {
      setFile(chosen);
      setProblem(null);
    }
  };

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !password || busy) return;
    setBusy(true);
    const result = await onUnlock(file.path, password);
    setBusy(false);
    if (result.ok) {
      setPassword('');
      setUnlocked(result);
    } else setProblem(UNLOCK_PROBLEMS[result.reason]);
  };

  if (!unlocked) {
    return (
      <Dialog key="certificate" title="Sign this file" onCancel={onCancel} testId="sign-dialog">
        <form onSubmit={(e) => void unlock(e)}>
          <p>Choose your certificate file (.pfx or .p12) and type its password. ScribeForge doesn't save the password.</p>
          <div className="sf-sign-file">
            <p data-testid="certificate-file">{file ? <span className="sf-strong">{file.name}</span> : <span className="sf-muted">No certificate file chosen.</span>}</p>
            <button type="button" className="sf-button" onClick={() => void choose()}>
              {file ? 'Choose another file…' : 'Choose a certificate file…'}
            </button>
          </div>
          <label className="sf-field">
            <span>Password for the certificate file</span>
            <input type="password" value={password} autoComplete="off" disabled={!file} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {problem && (
            <p className="sf-error" role="alert">
              {problem}
            </p>
          )}
          <p className="sf-muted">
            No certificate?{' '}
            <button type="button" className="sf-link-button" onClick={onMakeCertificate}>
              Make a certificate…
            </button>
          </p>
          <div className="sf-dialog-buttons">
            <button type="button" className="sf-button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="sf-button sf-primary" disabled={!file || !password || busy}>
              {busy ? 'Opening…' : 'Next'}
            </button>
          </div>
        </form>
      </Dialog>
    );
  }

  const cert = unlocked.certificate;
  const warnings = certificateWarnings(cert);
  const note = newFileNote(newFile);
  const choices = { certificate: cert, certificateBytes: unlocked.certificateBytes, reason, location };
  const go = () => {
    if (kind === 'box') onDraw(choices);
    else onSign({ ...choices, place: kind === 'field' ? { kind: 'field', field } : { kind: 'invisible' } });
  };

  return (
    <Dialog key="look" title="Sign this file" onCancel={onCancel} testId="sign-dialog" wide>
      <dl className="sf-facts" data-testid="certificate-summary">
        <dt>Signed by</dt>
        <dd>
          {cert.name}
          {cert.email ? ` (${cert.email})` : ''}
        </dd>
        <dt>Issued by</dt>
        <dd>{cert.selfSigned ? 'Itself' : cert.issuer}</dd>
        <dt>Valid</dt>
        <dd>
          {formatDate(cert.validFrom)} to {formatDate(cert.validTo)}
        </dd>
      </dl>
      {warnings.map((w) => (
        <p key={w} className="sf-banner sf-notice">
          {w}
        </p>
      ))}
      <fieldset className="sf-section">
        <legend className="sf-strong">How it looks</legend>
        <div role="radiogroup" aria-label="How it looks" className="sf-choice-column">
          <label className="sf-choice">
            <input type="radio" name="sign-look" checked={kind === 'box'} onChange={() => setKind('box')} />
            <span>A box I draw on the page, with my name, the date and the reason</span>
          </label>
          <label className="sf-choice">
            <input type="radio" name="sign-look" checked={kind === 'field'} disabled={usable.length === 0} onChange={() => setKind('field')} />
            <span>{usable.length > 0 ? 'In an empty signature box this file has' : "In an empty signature box (this file hasn't any)"}</span>
          </label>
          {kind === 'field' && (
            <label className="sf-field sf-field-narrow">
              <span>Signature box</span>
              <select value={field} onChange={(e) => setField(e.target.value)}>
                {usable.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                    {f.page ? `, page ${f.page}` : ''}
                    {f.visible ? '' : ' (invisible)'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="sf-choice">
            <input type="radio" name="sign-look" checked={kind === 'invisible'} onChange={() => setKind('invisible')} />
            <span>Invisible: no box on the page</span>
          </label>
        </div>
      </fieldset>
      <label className="sf-field">
        <span>Reason (optional)</span>
        <input type="text" value={reason} maxLength={200} placeholder="I approve this document" onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="sf-field">
        <span>Place (optional)</span>
        <input type="text" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
      </label>
      {note && <p className="sf-muted">{note}</p>}
      <p className="sf-muted">The signing time is this PC's clock. The signed file is saved as a new file; the one you opened isn't changed.</p>
      <div className="sf-dialog-buttons">
        <button type="button" className="sf-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="sf-button sf-primary" onClick={go} disabled={kind === 'field' && !field}>
          {kind === 'box' ? 'Draw the box…' : 'Sign and save…'}
        </button>
      </div>
    </Dialog>
  );
}
