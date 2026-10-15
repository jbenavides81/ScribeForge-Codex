// How ScribeForge asks pdf.js to open a document. These settings are part of the app's safety
// rules (build prompt, rule 6), and a unit test checks them.
//
// - The bytes come from the main process; pdf.js never fetches the document itself.
// - XFA forms are off. PDF JavaScript can't run: the scripting sandbox (pdf.sandbox.mjs) is
//   never bundled and the viewer is never given a scripting manager.
// - Fonts, character maps, image decoders and colour profiles load from files inside the app.
// - Damaged pages show what they can instead of stopping the whole document.
// - Very large images are capped so a hostile file can't exhaust memory.

export const MAX_IMAGE_PIXELS = 100_000_000;
export const MAX_CANVAS_BYTES = 512 * 1024 * 1024;

export interface SafeDocumentOptions {
  data: Uint8Array;
  password?: string;
  enableXfa: false;
  useWorkerFetch: false;
  cMapUrl: string;
  cMapPacked: true;
  standardFontDataUrl: string;
  wasmUrl: string;
  iccUrl: string;
  stopAtErrors: false;
  maxImageSize: number;
  canvasMaxAreaInBytes: number;
}

/** `assetBase` is the app's own address for the copied pdf.js files, ending in "/". */
export function safeDocumentOptions(data: Uint8Array, assetBase: string): SafeDocumentOptions {
  if (!assetBase.endsWith('/')) throw new Error('assetBase must end with "/"');
  return {
    data,
    enableXfa: false,
    useWorkerFetch: false,
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
    iccUrl: `${assetBase}iccs/`,
    stopAtErrors: false,
    maxImageSize: MAX_IMAGE_PIXELS,
    canvasMaxAreaInBytes: MAX_CANVAS_BYTES,
  };
}
