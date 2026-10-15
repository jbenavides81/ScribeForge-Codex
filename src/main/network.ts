import { net, protocol, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ScribeForge never uses the network. The screens are served from the app's own files through
// the app:// address, with a strict Content-Security-Policy, and every other request is
// cancelled and recorded. Tests read the record to prove nothing was attempted.

export const APP_ORIGIN = 'app://scribeforge';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  // 'wasm-unsafe-eval' lets pdf.js compile its bundled image decoders (WebAssembly). It does not
  // allow JavaScript eval.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Requests that were cancelled. Read by the whole-app tests. */
export const blockedRequests: string[] = [];
(globalThis as Record<string, unknown>).__scribeforgeBlocked = blockedRequests;

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Serves files from `rendererDir` at app://scribeforge/..., never anything outside it. */
export function serveApp(rendererDir: string): void {
  const root = path.resolve(rendererDir);
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'scribeforge') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const full = path.resolve(path.join(root, rel));
    if (!full.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(full).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (full.endsWith('.mjs') || full.endsWith('.js')) headers.set('Content-Type', 'text/javascript');
    if (full.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
    return new Response(res.body, { status: res.status, headers });
  });
}

/**
 * Cancels every request that isn't the app's own files. `devServer` is the trial-mode
 * address (http://localhost:...), allowed only while trial mode runs from source.
 */
export function blockNetwork(rendererDir: string, devServer: string | undefined): void {
  const fileRoot = pathToFileURL(path.resolve(rendererDir)).toString().toLowerCase();
  const devOrigin = devServer ? new URL(devServer).origin : null;
  const devSocket = devOrigin ? devOrigin.replace(/^http/, 'ws') : null;

  const allowed = (address: string): boolean => {
    if (address.startsWith(`${APP_ORIGIN}/`)) return true;
    if (address.startsWith('data:') || address.startsWith('blob:') || address.startsWith('devtools:')) return true;
    if (address.toLowerCase().startsWith(fileRoot)) return true;
    if (devOrigin && (address.startsWith(devOrigin) || (devSocket !== null && address.startsWith(devSocket)))) return true;
    return false;
  };

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (allowed(details.url)) {
      callback({});
    } else {
      blockedRequests.push(details.url);
      callback({ cancel: true });
    }
  });

  // No camera, microphone, notifications, location or anything else a page could ask for.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}
