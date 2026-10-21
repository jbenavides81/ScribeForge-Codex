// The command-line tool's window. It's either hidden, drawing redacted pages for
// "scribeforge redact", or a small window asking for a protected PDF's password.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../fonts.css';
import '../styles.css';
import type { CliBridge, RenderJob } from '../../../shared/cli';
import { safeDocumentOptions } from '../../../shared/pdfOptions';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { applyAppearance } from '../appearance';
import { browserSurface } from '../redact/surface';
import { PDFJS_ASSETS, pdfjsLib } from '../viewer/pdfjs';
import { redactionPages } from './redactionPages';

declare global {
  interface Window {
    scribeforgeCli?: CliBridge;
  }
}

const bridge = window.scribeforgeCli;
applyAppearance(DEFAULT_SETTINGS);

async function render(job: RenderJob) {
  const task = pdfjsLib.getDocument({ ...safeDocumentOptions(job.bytes, PDFJS_ASSETS), password: job.password });
  try {
    const pdf = await task.promise;
    const api = { OPS: pdfjsLib.OPS as unknown as Record<string, number>, annotationsOff: pdfjsLib.AnnotationMode.DISABLE };
    bridge!.sendResult(await redactionPages(pdf, job, api, browserSurface));
  } catch (error) {
    bridge!.sendResult({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    await task.destroy();
  }
}

function PasswordForm({ fileName, retry }: { fileName: string; retry: boolean }) {
  const [value, setValue] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    bridge!.sendPassword(value);
  };
  return (
    <form
      className="sf-screen"
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && bridge!.sendPassword(null)}
      data-testid="cli-password"
    >
      <h1>This file is password-protected</h1>
      <p>
        Enter the password for <span className="sf-strong">{fileName}</span>. ScribeForge doesn't save it.
      </p>
      <label className="sf-field">
        <span>Password</span>
        <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" autoFocus />
      </label>
      {retry && (
        <p className="sf-error" role="alert">
          That password didn't work. Try again.
        </p>
      )}
      <div className="sf-dialog-buttons">
        <button type="button" className="sf-button" onClick={() => bridge!.sendPassword(null)}>
          Cancel
        </button>
        <button type="submit" className="sf-button sf-primary" disabled={value.length === 0}>
          Open
        </button>
      </div>
    </form>
  );
}

if (bridge?.mode === 'password') {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <PasswordForm fileName={bridge.fileName} retry={bridge.retry} />
    </StrictMode>,
  );
} else if (bridge) {
  bridge.onJob((job) => void render(job));
}
bridge?.ready();
