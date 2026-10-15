/**
 * Web links inside a PDF. Only these kinds of address can be opened, and only after the person
 * has seen the address and said yes. Everything else (file:, javascript:, network shares,
 * other programs' links) is refused.
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'];

export function isOpenableLink(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) return false;
  if (url.protocol !== 'mailto:' && !url.hostname) return false;
  return true;
}
