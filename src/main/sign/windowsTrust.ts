// Windows' trusted certificates on this PC, read without going online (docs/Plan_Sign.md, S9).
// Node's list mixes in intermediate certificates that Windows keeps but doesn't trust on their
// own, so only the top-level ones are used: certificates that issued themselves and may issue
// others.
import { X509Certificate } from 'node:crypto';
import { getCACertificates } from 'node:tls';

let cached: string[] | null = null;

/** DER, base64. Read once per run. */
export function windowsRoots(): string[] {
  if (cached) return cached;
  let list: string[] = [];
  try {
    list = getCACertificates('system');
  } catch {
    list = [];
  }
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const pem of list) {
    try {
      const cert = new X509Certificate(pem);
      if (!cert.ca || cert.subject !== cert.issuer || !cert.verify(cert.publicKey)) continue;
      const der = cert.raw.toString('base64');
      if (seen.has(der)) continue;
      seen.add(der);
      roots.push(der);
    } catch {
      // A certificate Node can't read is left out.
    }
  }
  cached = roots;
  return roots;
}
