// Renders the installable-app icons to PNG. Run: npm run icons
//
// Android, Windows and the app stores want square PNGs at fixed sizes, and the
// launcher crops "maskable" icons to a circle or squircle, so the mark has to
// sit inside the middle 80%. Everything here is drawn from the favicon's shapes
// (the launch mark over a part-filled progress bar) so the brand stays one mark.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'client', 'public', 'icons');

const ACCENT = '#1e3a5f';
const DEEP = '#0b1b2e';
const SKY = '#8fbcec';
const PAPER = '#eaf1f8';

/**
 * The favicon's 32-unit artwork, scaled into a square of `size` pixels.
 * `inset` is the fraction of each edge left as plain background; `radius` is
 * the corner rounding of the background as a fraction of the size (0 = square,
 * which the maskable and Apple icons need because the OS rounds them itself).
 */
function iconSvg(size, { inset = 0, radius = 0.125 } = {}) {
  const art = size * (1 - inset * 2);
  const scale = art / 32;
  const offset = size * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * radius}" fill="${ACCENT}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <rect x="6" y="24" width="20" height="2.5" rx="1.25" fill="${DEEP}"/>
    <rect x="6" y="24" width="14" height="2.5" rx="1.25" fill="${SKY}"/>
    <path d="M16 6.5c2.6 2.1 4 5 4 8.1 0 1.3-.25 2.5-.7 3.6h-6.6a9.4 9.4 0 0 1-.7-3.6c0-3.1 1.4-6 4-8.1z" fill="${PAPER}"/>
    <circle cx="16" cy="13.4" r="1.7" fill="${ACCENT}"/>
  </g>
</svg>`;
}

const ICONS = [
  // Browsers and the Windows Store: rounded tile, art to the edges.
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // Android adaptive icons: square, art inside the 80% safe zone.
  { file: 'icon-maskable-192.png', size: 192, inset: 0.14, radius: 0 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.14, radius: 0 },
  // iOS home screen: square and opaque; iOS rounds the corners.
  { file: 'apple-touch-icon.png', size: 180, inset: 0.06, radius: 0 },
];

fs.mkdirSync(outDir, { recursive: true });
for (const { file, size, ...opts } of ICONS) {
  let img = sharp(Buffer.from(iconSvg(size, opts)));
  // Square icons must be fully opaque; rounded ones keep transparent corners.
  if (opts.radius === 0) img = img.flatten({ background: ACCENT });
  const png = await img.png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(`wrote icons/${file} (${size}x${size}, ${png.length} bytes)`);
}
