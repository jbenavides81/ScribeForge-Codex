import type { CertificateSummary, SignatureCheck } from '../../../engine/sign/types';
import { Icon, type IconName } from '../components/Icon';
import { formatDate } from '../details/describe';
import { detailLines, identityLines, isConfirmed, isIntact, limitLines, signaturesSummary, signedLine, statusSentence, statusWord } from '../sign/describe';

function statusIcon(c: SignatureCheck): IconName {
  if (isConfirmed(c)) return 'tick';
  if (c.status === 'not-valid') return 'close';
  return 'warning';
}

function SignatureItem({ check, onOpenSigned, onTrust }: { check: SignatureCheck; onOpenSigned: () => void; onTrust: () => void }) {
  return (
    <li className="sf-signature" data-testid="signature" data-status={check.status} data-identity={check.identity}>
      <p className="sf-signature-status">
        <Icon name={statusIcon(check)} size={20} />
        <span>
          <span className="sf-strong">{statusWord(check)}.</span> {statusSentence(check)}
        </span>
      </p>
      <p>{signedLine(check)}</p>
      {detailLines(check).map((line) => (
        <p key={line}>{line}</p>
      ))}
      {identityLines(check).map((line) => (
        <p key={line}>{line}</p>
      ))}
      {limitLines(check).map((line) => (
        <p key={line} className="sf-muted">
          {line}
        </p>
      ))}
      <div className="sf-signature-buttons">
        {check.signedLength > 0 && (
          <button type="button" className="sf-button" onClick={onOpenSigned}>
            Open the signed version
          </button>
        )}
        {check.identity === 'unknown' && check.certificate && isIntact(check) && (
          <button type="button" className="sf-button" onClick={onTrust}>
            Trust this certificate…
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Sign (codename Sealkeeper; docs/Plan_Sign.md): the file's signatures and what ScribeForge
 * found when checking them, signing the file, and the certificates you trust.
 */
export function Sign({
  name,
  checks,
  failed,
  trusted,
  newFileNote,
  working,
  onSign,
  onOpenSigned,
  onTrust,
  onUntrust,
  onMakeCertificate,
}: {
  name: string;
  /** Null while checking. */
  checks: SignatureCheck[] | null;
  failed: boolean;
  trusted: CertificateSummary[];
  /** Why signing makes a new file first, in a sentence, or null. */
  newFileNote: string | null;
  working: string | null;
  onSign: () => void;
  onOpenSigned: (check: SignatureCheck) => void;
  onTrust: (check: SignatureCheck) => void;
  onUntrust: (certificate: CertificateSummary) => void;
  onMakeCertificate: () => void;
}) {
  return (
    <div className="sf-screen sf-sign" data-testid="sign-screen">
      <h1>Sign</h1>
      <p className="sf-muted">{name}</p>

      <section className="sf-section" aria-labelledby="sign-found">
        <h2 id="sign-found">Signatures in this file</h2>
        {failed ? (
          <p>ScribeForge couldn't check this file's signatures.</p>
        ) : checks === null ? (
          <p className="sf-muted" role="status">
            Checking signatures…
          </p>
        ) : (
          <>
            <p data-testid="signatures-summary">{signaturesSummary(checks)}</p>
            {checks.length > 0 && (
              <ul className="sf-signatures">
                {checks.map((check) => (
                  <SignatureItem key={`${check.field}-${check.signedLength}`} check={check} onOpenSigned={() => onOpenSigned(check)} onTrust={() => onTrust(check)} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="sf-section" aria-labelledby="sign-new">
        <h2 id="sign-new">Sign this file</h2>
        <p>
          Sign it with your certificate. The signature is added to a copy, saved as a new file; the file you opened isn't changed. Signatures already
          in it stay valid.
        </p>
        {newFileNote && <p className="sf-banner sf-notice">{newFileNote}</p>}
        <div className="sf-sign-buttons">
          <button type="button" className="sf-button sf-primary" onClick={onSign} disabled={working !== null}>
            <Icon name="seal" size={18} />
            Sign this file…
          </button>
        </div>
        {working && (
          <p className="sf-muted" role="status">
            {working}
          </p>
        )}
      </section>

      <section className="sf-section" aria-labelledby="sign-trusted">
        <h2 id="sign-trusted">Certificates you trust</h2>
        <p className="sf-muted">
          Besides Windows' trusted certificates on this PC. A signature whose certificate leads back to one of these says whose it is.
        </p>
        {trusted.length === 0 ? (
          <p data-testid="trusted-none">None yet. To add one, use Trust this certificate… on a signature.</p>
        ) : (
          <ul className="sf-trusted" data-testid="trusted-list">
            {trusted.map((cert) => (
              <li key={cert.fingerprint}>
                <div>
                  <p className="sf-strong">{cert.name}</p>
                  <p className="sf-muted">
                    {cert.selfSigned ? 'Issued itself' : `Issued by ${cert.issuer}`}, valid until {formatDate(cert.validTo)}
                  </p>
                  <p className="sf-muted sf-fingerprint">Fingerprint: {cert.fingerprint}</p>
                </div>
                <button type="button" className="sf-button" aria-label={`Stop trusting ${cert.name}`} onClick={() => onUntrust(cert)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sf-section" aria-labelledby="sign-make">
        <h2 id="sign-make">No certificate?</h2>
        <p>
          Make your own: a certificate in your name, saved as a file protected by a password you choose. Other people's readers will say its identity
          isn't confirmed unless they choose to trust it.
        </p>
        <div className="sf-sign-buttons">
          <button type="button" className="sf-button" onClick={onMakeCertificate}>
            Make a certificate…
          </button>
        </div>
      </section>
    </div>
  );
}
