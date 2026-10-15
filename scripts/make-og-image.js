// Renders the social preview card to PNG. Run: npm run og
//
// Facebook, X/Twitter, LinkedIn and Slack will not render an SVG as a preview
// image, so this produces a real raster file at the 1200x630 size they expect.
//
// Fonts: the renderer only has system fonts, so this uses Georgia and a generic
// monospace — the same fallbacks the app itself declares behind Fraunces and
// IBM Plex Mono. The card stays on-brand without shipping font binaries.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'client', 'public');

// Mirrors the light theme in client/src/styles.css.
const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#5b6b80';
const RULE = '#d6dee8';
const ACCENT = '#1e3a5f';
const ACCENT_SOFT = '#eaf1f8';
const BG = '#f7f9fc';
const SURFACE = '#ffffff';

/** Ticks echo the ledger's progress meter — the app's most recognisable mark. */
function ticks(x, y, w, total, done) {
  const gap = 6;
  const tw = (w - gap * (total - 1)) / total;
  let out = '';
  for (let i = 0; i < total; i++) {
    out += `<rect x="${x + i * (tw + gap)}" y="${y}" width="${tw}" height="9" rx="2" fill="${
      i < done ? ACCENT : RULE
    }"/>`;
  }
  return out;
}

/**
 * Chips are sized from their text. Fixed widths overflowed the moment a label
 * changed, and the next chip was drawn straight over the overflow.
 */
function chips(x, y, labels, fontSize = 19) {
  const charW = fontSize * 0.62; // Consolas advance width
  const padX = 17;
  const gap = 13;
  let cx = x;
  let out = '';
  for (const label of labels) {
    const w = Math.round(label.length * charW + padX * 2);
    out += `<rect x="${cx}" y="${y}" width="${w}" height="46" rx="4" fill="${SURFACE}" stroke="${RULE}"/>
    <text x="${cx + padX}" y="${y + 30}" font-family="Consolas, 'Courier New', monospace" font-size="${fontSize}" fill="${ACCENT}">${label}</text>`;
    cx += w + gap;
  }
  return out;
}

function card({ width = 1200, height = 630 } = {}) {
  // The emblem sits top-right and the text is hard-limited to its left, so a
  // wider fallback serif can never run underneath it.
  const size = 190;
  const ex = width - size - 78;
  const s = size / 278;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${BG}"/>

  <!-- accent spine -->
  <rect x="0" y="0" width="14" height="${height}" fill="${ACCENT}"/>

  <!-- emblem: the favicon mark, enlarged -->
  <g transform="translate(${ex}, 74) scale(${s})">
    <rect width="278" height="278" rx="26" fill="${ACCENT}"/>
    <rect x="52" y="214" width="174" height="20" rx="10" fill="#0b1b2e"/>
    <rect x="52" y="214" width="122" height="20" rx="10" fill="#8fbcec"/>
    <path d="M139 48c22.6 18.3 34.8 43.5 34.8 70.5 0 11.3-2.2 21.8-6.1 31.3h-57.4a86 86 0 0 1-6.1-31.3c0-27 12.2-52.2 34.8-70.5z" fill="${ACCENT_SOFT}"/>
    <circle cx="139" cy="108" r="14.8" fill="${ACCENT}"/>
  </g>

  <!-- eyebrow -->
  <text x="84" y="106" font-family="Consolas, 'Courier New', monospace" font-size="20"
        letter-spacing="4" fill="${FAINT}">ELEVATE INTERNSHIPS</text>

  <!-- headline: sized to clear the emblem in a serif fallback -->
  <text x="84" y="206" font-family="Georgia, 'Times New Roman', serif" font-size="62"
        font-weight="700" fill="${INK}">Find the internship,</text>
  <text x="84" y="276" font-family="Georgia, 'Times New Roman', serif" font-size="62"
        font-weight="700" fill="${INK}">earn the credential.</text>

  <!-- subhead -->
  <text x="84" y="344" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="27"
        fill="${MUTED}">Real internships near you, and the certifications</text>
  <text x="84" y="382" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="27"
        fill="${MUTED}">that fit your business major — priced honestly.</text>

  <!-- progress meter, as in the ledger -->
  ${ticks(84, 446, 440, 14, 9)}
  <text x="84" y="494" font-family="Consolas, 'Courier New', monospace" font-size="19"
        fill="${FAINT}">9 OF 14 COMPLETE</text>

  ${chips(84, 536, ['14 BUSINESS MAJORS', '200 CERTIFICATIONS', 'ZIP + RADIUS'])}
</svg>`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const svg = Buffer.from(card());

  // Open Graph / LinkedIn / Slack — 1200x630 is the safe universal size.
  await sharp(svg).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'og-image.png'));

  // A 2:1 crop reads better in X's summary_large_image card.
  await sharp(Buffer.from(card({ width: 1200, height: 600 })))
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, 'twitter-image.png'));

  // Square fallback for chat apps that crop to 1:1.
  await sharp(svg)
    .resize(630, 630, { fit: 'cover', position: 'left' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, 'og-square.png'));

  for (const f of ['og-image.png', 'twitter-image.png', 'og-square.png']) {
    const p = path.join(outDir, f);
    const m = await sharp(p).metadata();
    console.log(`${f.padEnd(20)} ${m.width}x${m.height}  ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
