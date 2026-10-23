// Small helpers for signing that need no PDF library, so the app's screens can use them.

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** Room to keep for a signature, from the size of the certificates that go in it, with plenty to spare. */
export function signatureSpace(certificateBytes: number): number {
  return Math.ceil((certificateBytes + 6144) / 1024) * 1024;
}

/** Whether the file's last cross-reference section is where the file says (adding to a damaged file would carry the damage on). */
export function soundForUpdate(bytes: Uint8Array): boolean {
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!m) return false;
  const at = Number(m[1]);
  if (!Number.isSafeInteger(at) || at <= 0 || at >= bytes.length) return false;
  const head = latin1(bytes.subarray(at, at + 64));
  return /^xref\b/.test(head) || /^\d+\s+\d+\s+obj\b/.test(head);
}
