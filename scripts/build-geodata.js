/**
 * Turns the GeoNames US postal-code export into the two lookup tables the
 * server uses for distance filtering.
 *
 *   node scripts/build-geodata.js <path-to-US.txt>
 *
 * Source: https://download.geonames.org/export/zip/US.zip  (US.txt inside)
 * Licence: Creative Commons Attribution 4.0. The attribution lives in
 * server/data/GEONAMES-LICENCE.txt and is surfaced in the Privacy page —
 * if you redistribute this app, that attribution has to travel with it.
 *
 * Two outputs, both plain CSV so they diff readably and parse fast:
 *
 *   us-zips.csv    zip,lat,lon,city,state   — every US ZIP, for the origin
 *   us-cities.csv  city|state|lat|lon       — one row per city, for matching
 *                                             the free-text location a job
 *                                             board gives us
 *
 * The city table is the one that matters for the radius filter. It replaced a
 * hand-written table of 62 metros, which meant anything outside those 62 was
 * "unplaceable" and skipped the distance check entirely.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'server', 'data');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Usage: node scripts/build-geodata.js <path-to-US.txt>');
  console.error('Get it from https://download.geonames.org/export/zip/US.zip');
  process.exit(1);
}

// GeoNames columns, tab separated.
const COL = { zip: 1, place: 2, stateCode: 4, lat: 9, lon: 10 };

const zips = new Map();
// (city, state) -> running mean of its ZIP centroids. A city spans many ZIPs;
// averaging them lands near the middle rather than on whichever ZIP sorted
// first, which matters for large cities.
const cities = new Map();

let rows = 0;
let skipped = 0;

for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const f = line.split('\t');
  const zip = f[COL.zip]?.trim();
  const place = f[COL.place]?.trim();
  const state = f[COL.stateCode]?.trim().toLowerCase();
  const lat = Number(f[COL.lat]);
  const lon = Number(f[COL.lon]);

  if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    skipped++;
    continue;
  }
  rows++;

  // A ZIP can appear more than once; first wins, they are within a few hundred
  // metres of each other. City and state ride along so the app can label the
  // search ("Bristol, CT") without a network call.
  if (!zips.has(zip)) zips.set(zip, [lat, lon, place || '', (f[COL.stateCode] || '').trim()]);

  if (!place || !/^[a-z]{2}$/.test(state)) continue;
  const key = `${place.toLowerCase()}|${state}`;
  const acc = cities.get(key);
  if (acc) {
    acc.lat += lat;
    acc.lon += lon;
    acc.n += 1;
  } else {
    cities.set(key, { lat, lon, n: 1 });
  }
}

const round = (n) => Math.round(n * 10000) / 10000;

// City names are stripped of commas so the CSV stays a simple 5-column split.
const safe = (s) => String(s || '').replace(/,/g, ' ').trim();

const zipOut = [...zips.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([zip, [lat, lon, city, st]]) => `${zip},${round(lat)},${round(lon)},${safe(city)},${safe(st)}`)
  .join('\n');

const cityOut = [...cities.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([key, acc]) => `${key}|${round(acc.lat / acc.n)}|${round(acc.lon / acc.n)}`)
  .join('\n');

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'us-zips.csv'), zipOut + '\n', 'utf8');
fs.writeFileSync(path.join(dataDir, 'us-cities.csv'), cityOut + '\n', 'utf8');

fs.writeFileSync(
  path.join(dataDir, 'GEONAMES-LICENCE.txt'),
  [
    'us-zips.csv and us-cities.csv are derived from the GeoNames postal code',
    'export for the United States:',
    '',
    '    https://download.geonames.org/export/zip/US.zip',
    '',
    'GeoNames data is licensed under Creative Commons Attribution 4.0:',
    '',
    '    https://creativecommons.org/licenses/by/4.0/',
    '',
    'This work is derived from it (ZIP centroids kept as-is; city coordinates',
    'averaged across each city\'s ZIPs). Attribution must be preserved if this',
    'application or these files are redistributed.',
    '',
    `Regenerate with: node scripts/build-geodata.js <path-to-US.txt>`,
    '',
  ].join('\n'),
  'utf8',
);

const kb = (p) => Math.round(fs.statSync(path.join(dataDir, p)).size / 1024);
console.log(`read ${rows} rows (${skipped} skipped)`);
console.log(`us-zips.csv    ${zips.size} ZIPs      ${kb('us-zips.csv')} KB`);
console.log(`us-cities.csv  ${cities.size} cities  ${kb('us-cities.csv')} KB`);
console.log('GEONAMES-LICENCE.txt written');
