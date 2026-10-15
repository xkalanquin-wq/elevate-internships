// Renders the Microsoft Store logo art to store/. Run: node scripts/make-store-art.js
//
// 9:16 poster art (1440x2160) is the Store's main logo on Windows; 1:1 box art
// (2160x2160) is used in square layouts. Both reuse the favicon's mark on the
// brand navy, with the Store name under it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'store');

const ACCENT = '#1e3a5f';
const DEEP = '#0b1b2e';
const SKY = '#8fbcec';
const PAPER = '#eaf1f8';
const NAME = 'Elevate Internships';
const TAGLINE = 'Internships and certifications for business students';

/** The favicon's 32-unit mark, `size` pixels square, top-left at (x, y). */
const mark = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 32})">
    <rect x="6" y="24" width="20" height="2.5" rx="1.25" fill="${DEEP}"/>
    <rect x="6" y="24" width="14" height="2.5" rx="1.25" fill="${SKY}"/>
    <path d="M16 6.5c2.6 2.1 4 5 4 8.1 0 1.3-.25 2.5-.7 3.6h-6.6a9.4 9.4 0 0 1-.7-3.6c0-3.1 1.4-6 4-8.1z" fill="${PAPER}"/>
    <circle cx="16" cy="13.4" r="1.7" fill="${ACCENT}"/>
  </g>`;

function art(w, h, { markSize, markY, titleY, titleSize, tagY, tagSize }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${ACCENT}"/>
  ${mark((w - markSize) / 2, markY, markSize)}
  <text x="${w / 2}" y="${titleY}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${titleSize}" fill="${PAPER}">${NAME}</text>
  ${tagSize ? `<text x="${w / 2}" y="${tagY}" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="${tagSize}" fill="${SKY}">${TAGLINE}</text>` : ''}
</svg>`;
}

const ART = [
  { file: 'poster-art-1440x2160.png', w: 1440, h: 2160, markSize: 900, markY: 420, titleY: 1520, titleSize: 132, tagY: 1650, tagSize: 50 },
  { file: 'box-art-2160x2160.png', w: 2160, h: 2160, markSize: 1150, markY: 300, titleY: 1640, titleSize: 190, tagY: 1790, tagSize: 72 },
];

for (const { file, w, h, ...opts } of ART) {
  const png = await sharp(Buffer.from(art(w, h, opts))).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(`wrote store/${file} (${w}x${h}, ${png.length} bytes)`);
}
