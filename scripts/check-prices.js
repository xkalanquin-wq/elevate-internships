// Watches the certification prices for changes. Run: npm run check-prices
//
// A price can only be checked where the provider's page shows it in its HTML;
// many build the page in the browser or keep fees on a separate page. So this
// works from a baseline: `npm run check-prices -- --update` records, for each
// certification, which of the dollar amounts in its price note appear on its
// page today. A plain run then reports any of those amounts that have gone
// from the page — usually a price change, sometimes a redesign — and any
// price note edited since the baseline was taken. Either means: look at the
// page, correct the catalog if the price moved, and take a new baseline.
//
// Exit code 1 when something needs a look, so the monthly GitHub job can open
// an issue. Pages that cannot be fetched are left to verify-catalog.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(here, '..', 'server', 'data', 'certifications.json');
const BASELINE = path.join(here, 'price-baseline.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const update = process.argv.includes('--update');

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));

/** "$1,215 … $3,050" -> ["1215", "3050"], each once. */
const amountsIn = (text) => [...new Set([...String(text || '').matchAll(/\$([\d,]+)/g)].map((m) => m[1].replace(/,/g, '')))].filter((a) => Number(a) > 0);

/** The page's visible text, flattened, or null when it cannot be read. */
async function pageText(url) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 25_000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: c.signal, headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (res.status < 200 || res.status >= 300) return null;
    return (await res.text())
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&#36;|&dollar;/g, '$');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the amount is on the page as a price: "$1,215", "$1215", "USD 1,215" or "1,215 USD". */
function shows(text, amount) {
  const n = Number(amount);
  const forms = [amount, n.toLocaleString('en-US')];
  return forms.some((f) => {
    const esc = f.replace(/,/g, ',?');
    return new RegExp(`(\\$\\s?|USD\\s?)${esc}(?![\\d,])|(?<![\\d,.])${esc}(\\.00)?\\s?USD`, 'i').test(text);
  });
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const priced = catalog.filter((c) => amountsIn(c.price).length && !c.botBlocked);
const next = {};
const gone = [];
const edited = [];
let unreadable = 0;

const queue = [...priced];
async function worker() {
  while (queue.length) {
    const cert = queue.shift();
    const before = baseline[cert.id];
    if (!update && !before) continue; // nothing on its page to watch
    if (!update && before.price !== cert.price) {
      edited.push(cert);
      continue;
    }
    const text = await pageText(cert.url);
    if (text === null) {
      unreadable += 1;
      if (before) next[cert.id] = before; // keep watching; a bad day is not a change
      continue;
    }
    const found = amountsIn(cert.price).filter((a) => shows(text, a));
    if (update) {
      if (found.length) next[cert.id] = { price: cert.price, url: cert.url, amounts: found };
    } else {
      const missing = before.amounts.filter((a) => !shows(text, a));
      if (missing.length) gone.push({ cert, missing });
      next[cert.id] = before;
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

if (update) {
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Baseline saved: ${Object.keys(sorted).length} of ${priced.length} priced certifications show their price on their page (${unreadable} could not be read).`);
  process.exit(0);
}

const watched = Object.keys(baseline).length;
console.log(`Watched ${watched} prices${unreadable ? ` (${unreadable} pages could not be read this time)` : ''}.`);
if (gone.length) {
  console.log('\nThese amounts are no longer on the provider page. Check whether the price changed:');
  for (const { cert, missing } of gone) console.log(`- ${cert.title} (${cert.id}): $${missing.join(', $')} not found. Listed: "${cert.price}" ${cert.url}`);
}
if (edited.length) {
  console.log('\nThese price notes changed since the baseline. If they are right, run `npm run check-prices -- --update`:');
  for (const cert of edited) console.log(`- ${cert.title} (${cert.id})`);
}
if (gone.length || edited.length) process.exitCode = 1;
else console.log('No price changes found.');
