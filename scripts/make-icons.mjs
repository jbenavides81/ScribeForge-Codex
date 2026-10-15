// Draws the app icon (build/icon.png, 512 px) from the quill-and-anvil draft: gold line art on an
// obsidian square. electron-builder turns it into the Windows icon.
//   node scripts/make-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const SIZE = 512;
const svg = readFileSync('docs/phase0/icon-draft.svg', 'utf8')
  .replace(/currentColor/g, '#D9A441')
  .replace('<svg ', `<svg width="${SIZE * 0.8}" height="${SIZE * 0.8}" `);

const canvas = createCanvas(SIZE, SIZE);
const g = canvas.getContext('2d');
g.fillStyle = '#0F0F11';
g.beginPath();
g.roundRect(0, 0, SIZE, SIZE, SIZE * 0.18);
g.fill();
const art = await loadImage(Buffer.from(svg));
g.drawImage(art, SIZE * 0.1, SIZE * 0.1, SIZE * 0.8, SIZE * 0.8);

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', canvas.toBuffer('image/png'));
console.log('Wrote build/icon.png');
