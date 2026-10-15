/**
 * Builds server/data/us-places.csv: every US town, city, census-designated
 * place, township and county, from the Census Bureau's 2020 TIGER data.
 *
 *   node scripts/build-census-places.js
 *
 * Why: us-cities.csv comes from postal data, so it only knows the names the
 * Post Office uses. Places that share a neighbour's mailing name were missing
 * — Bloomington, MN ("Minneapolis"), The Woodlands, TX ("Spring"), Foster
 * City, CA ("San Mateo") — and listings there fell back to the middle of the
 * state. This table fills those gaps; us-cities.csv still wins where both
 * have a name (server/geo.js).
 *
 * Source: the Census Bureau's TIGERweb service (public domain, no licence
 * terms). Coordinates are each place's internal point.
 *
 * Output: name|state|lat|lon, the same shape as us-cities.csv.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'server', 'data', 'us-places.csv');

const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
// Census 2020 vintage, so the table does not shift under us year to year.
const LAYERS = [
  { name: 'incorporated places', url: `${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/25`, field: 'BASENAME', rank: 0 },
  { name: 'census designated places', url: `${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/26`, field: 'BASENAME', rank: 1 },
  { name: 'county subdivisions', url: `${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/22`, field: 'BASENAME', rank: 2 },
  // Counties by full name ("Wake County", "Orleans Parish"), then by bare name
  // ("Kitsap, WA") wherever no town in the state has that name.
  { name: 'counties', url: `${TIGER}/State_County/MapServer/55`, field: 'NAME', rank: 3 },
  { name: 'counties by bare name', url: `${TIGER}/State_County/MapServer/55`, field: 'BASENAME', rank: 4 },
];

// State FIPS -> postal code.
const FIPS = {
  '01': 'al', '02': 'ak', '04': 'az', '05': 'ar', '06': 'ca', '08': 'co', '09': 'ct', 10: 'de', 11: 'dc',
  12: 'fl', 13: 'ga', 15: 'hi', 16: 'id', 17: 'il', 18: 'in', 19: 'ia', 20: 'ks', 21: 'ky', 22: 'la',
  23: 'me', 24: 'md', 25: 'ma', 26: 'mi', 27: 'mn', 28: 'ms', 29: 'mo', 30: 'mt', 31: 'ne', 32: 'nv',
  33: 'nh', 34: 'nj', 35: 'nm', 36: 'ny', 37: 'nc', 38: 'nd', 39: 'oh', 40: 'ok', 41: 'or', 42: 'pa',
  44: 'ri', 45: 'sc', 46: 'sd', 47: 'tn', 48: 'tx', 49: 'ut', 50: 'vt', 51: 'va', 53: 'wa', 54: 'wv',
  55: 'wi', 56: 'wy',
};

async function fetchLayer({ url, field }) {
  const rows = [];
  const pageSize = 5000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: `${field},STATE,INTPTLAT,INTPTLON`,
      returnGeometry: 'false',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: 'json',
    });
    const res = await fetch(`${url}/query?${params}`);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`${url}: ${json.error.message}`);
    const page = (json.features || []).map((f) => f.attributes);
    rows.push(...page);
    if (page.length < pageSize && !json.exceededTransferLimit) break;
  }
  return rows.map((a) => ({ name: a[field], state: FIPS[a.STATE], lat: Number(a.INTPTLAT), lon: Number(a.INTPTLON) }));
}

// "Saint Paul" stays as written; server/geo.js tries "st"/"st." spellings.
const clean = (s) => String(s || '').toLowerCase().replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
const round = (n) => Math.round(n * 10000) / 10000;

// name|state -> { lat, lon, rank, count }. A lower rank wins; within one
// layer, a name that appears twice in a state (Pennsylvania has many
// "Washington township"s) is ambiguous and dropped.
const best = new Map();
for (const layer of LAYERS) {
  const rows = await fetchLayer(layer);
  const seenHere = new Map();
  for (const r of rows) {
    if (!r.state || !r.name || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    const key = `${clean(r.name)}|${r.state}`;
    seenHere.set(key, (seenHere.get(key) || 0) + 1);
    if (best.has(key) && best.get(key).rank < layer.rank) continue;
    best.set(key, { lat: r.lat, lon: r.lon, rank: layer.rank });
  }
  for (const [key, n] of seenHere) {
    if (n > 1 && best.get(key)?.rank === layer.rank) best.delete(key);
  }
  console.log(`${layer.name}: ${rows.length} rows`);
}

const lines = [...best.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([key, v]) => `${key}|${round(v.lat)}|${round(v.lon)}`);
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(`us-places.csv  ${lines.length} places  ${Math.round(fs.statSync(out).size / 1024)} KB`);
