// A canvas to draw a redacted page on, inside the app window (never added to the screen).
import type { MakeSurface } from './burn';

export const browserSurface: MakeSurface = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  return {
    canvas,
    context,
    png: () =>
      new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob((blob) => {
          // Free the canvas's memory straight away; large pages use a lot.
          canvas.width = 0;
          canvas.height = 0;
          if (blob) void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
          else reject(new Error("The page couldn't be made into an image."));
        }, 'image/png');
      }),
  };
};
