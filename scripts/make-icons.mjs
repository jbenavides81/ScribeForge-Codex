// Draws ScribeForge's app icon, a quill crossing an anvil, and its contact sheet.
//   node scripts/make-icons.mjs
//
// - build/icon.png: 512 px, for the window and electron-builder.
// - build/icon.ico: every size Windows uses. From 32 px up it's the full design (a solid gold
//   anvil, a steel quill); at 16-24 px a simpler one (a chunky anvil and a single thick quill
//   stroke), because the full design turns to mush that small (Phase 0 plan, section 7).
// - docs/icon-sheet.png: the app icon at every size and all the in-app line icons, on each
//   theme's background and on Windows' light and dark taskbars, to check they read everywhere.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { PATHS } from '../src/renderer/src/components/iconPaths.ts';
import { PRESETS } from '../src/shared/themes.ts';

// The Cathedral palette (build prompt, section 4).
const OBSIDIAN = '#0F0F11';
const GOLD = '#D9A441';
const STEEL = '#C7C9CC';

const ANVIL = 'M5 27 C 10 27 13 29 16 31 L16 35 C 20 35 24 37 25 41 L22 47 L17 49 L17 52 L47 52 L47 49 L42 47 L39 41 C 40 37 44 35 50 35 L57 35 L57 27 Z';
const FEATHER = 'M58 5 C 46 9 36 17 29 28 C 34 27 38 25 41 22 C 38 26 35 29 31 31 C 40 29 49 21 58 5 Z';
const SMALL_ANVIL = 'M4 24 L60 24 L60 34 L45 34 L41 42 L49 46 L49 56 L15 56 L15 46 L23 42 L19 34 L13 34 Z';

function background(g, size, radius) {
  g.fillStyle = OBSIDIAN;
  g.beginPath();
  g.roundRect(0, 0, size, size, size * radius);
  g.fill();
}

/** A line drawn twice: a wide obsidian edge, then the colour, so it stands apart from the anvil. */
function edgedLine(g, x1, y1, x2, y2, width, edge, colour) {
  g.lineCap = 'round';
  for (const [w, c] of [
    [width + edge * 2, OBSIDIAN],
    [width, colour],
  ]) {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }
}

/** The full design, on a size × size square. */
function drawFull(g, size) {
  background(g, size, 0.18);
  g.save();
  g.scale(size / 64, size / 64);
  g.translate(32, 32);
  g.scale(0.86, 0.86);
  g.translate(-31.5, -31.5);
  g.fillStyle = GOLD;
  g.fill(new Path2D(ANVIL));
  edgedLine(g, 29, 28, 14, 58, 3, 1.5, STEEL);
  const feather = new Path2D(FEATHER);
  g.lineJoin = 'round';
  g.strokeStyle = OBSIDIAN;
  g.lineWidth = 3;
  g.stroke(feather);
  g.fillStyle = STEEL;
  g.fill(feather);
  g.restore();
}

/** The simple design for 16-24 px. */
function drawSmall(g, size) {
  background(g, size, 0.12);
  g.save();
  g.scale(size / 64, size / 64);
  g.fillStyle = GOLD;
  g.fill(new Path2D(SMALL_ANVIL));
  edgedLine(g, 55, 7, 22, 51, 8, 3, STEEL);
  g.restore();
}

function iconPng(size) {
  const canvas = createCanvas(size, size);
  const g = canvas.getContext('2d');
  if (size <= 24) drawSmall(g, size);
  else drawFull(g, size);
  return canvas.encodeSync('png');
}

/** A Windows .ico holding PNG images (supported since Windows Vista). */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, png: iconPng(size) }));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2); // no palette
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4); // planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', iconPng(512));
writeFileSync('build/icon.ico', ico([16, 20, 24, 32, 40, 48, 64, 96, 128, 256]));

// The contact sheet.
const APP_SIZES = [16, 20, 24, 32, 48, 64, 128];
const rows = [
  ...PRESETS.map((p) => ({ bg: p.tokens.bg, text: p.tokens.text, accent: p.tokens.accent })),
  { bg: '#202020', text: '#FFFFFF', accent: GOLD }, // Windows taskbar, dark
  { bg: '#F3F3F3', text: '#1B1B1B', accent: GOLD }, // Windows taskbar, light
];
const names = Object.keys(PATHS).filter((n) => n !== 'logo');
const ROW = 150;
const width = 24 + APP_SIZES.reduce((w, s) => w + s + 24, 0) + 72 + 24 + Math.ceil(names.length / 2) * 36 + 24;
const sheet = createCanvas(width, ROW * rows.length);
const g = sheet.getContext('2d');
for (const [r, row] of rows.entries()) {
  const top = r * ROW;
  g.fillStyle = row.bg;
  g.fillRect(0, top, width, ROW);
  let x = 24;
  for (const size of APP_SIZES) {
    g.save();
    g.translate(x, top + (ROW - size) / 2);
    if (size <= 24) drawSmall(g, size);
    else drawFull(g, size);
    g.restore();
    x += size + 24;
  }
  // The in-app logo (line art in the theme's accent colour, as in the navigation).
  const line = (d, size, colour, at, y, weight = 4) => {
    g.save();
    g.translate(at, y);
    g.scale(size / 64, size / 64);
    g.strokeStyle = colour;
    g.lineWidth = weight;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const p of d) g.stroke(new Path2D(p));
    g.restore();
  };
  line(PATHS.logo, 48, row.accent, x, top + (ROW - 48) / 2, 3);
  x += 72 + 24;
  // Every other line icon at 20 px, in two rows, in the theme's text colour.
  names.forEach((name, i) => line(PATHS[name], 20, row.text, x + Math.floor(i / 2) * 36, top + ROW / 2 - 26 + (i % 2) * 32));
}
mkdirSync('docs', { recursive: true });
writeFileSync('docs/icon-sheet.png', sheet.encodeSync('png'));
console.log('Wrote build/icon.png, build/icon.ico and docs/icon-sheet.png');
