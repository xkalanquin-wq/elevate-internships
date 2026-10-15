// Checks every URL in a catalog file. Run: npm run verify-catalog [file]
// Defaults to the live catalog; pass a path to check a candidate list first.
//
// --dead-only (used by the monthly GitHub job): fail only on links that are
// really gone — 404, 410 or a site that no longer exists. From GitHub's
// servers many providers answer 403 or never answer, though the page opens
// fine in a browser, so those are listed without failing the run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const deadOnly = process.argv.includes('--dead-only');
const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const target = fileArg ? path.resolve(process.cwd(), fileArg) : path.join(here, '..', 'server', 'data', 'certifications.json');

/** A link that is really gone, as opposed to one this machine cannot reach. */
const dead = (r) => r.status === 404 || r.status === 410 || /ENOTFOUND|EAI_AGAIN|CERT|certificate/i.test(r.error || '');

const catalog = JSON.parse(fs.readFileSync(target, 'utf8'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

/** Any 2xx counts as reachable — some sites answer 202 through a bot filter. */
const ok = (s) => s >= 200 && s < 300;

async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 20_000);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: c.signal, headers: { 'User-Agent': UA } });
      if (ok(res.status)) return { status: res.status };
      if (method === 'GET') return { status: res.status };
    } catch (err) {
      if (method === 'GET') return { status: 0, error: [err.message, err.cause?.code || err.cause?.message].filter(Boolean).join(': ') };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0 };
}

console.log(`Checking ${catalog.length} URLs in ${path.relative(process.cwd(), target)}\n`);

const bad = [];
const blocked = [];
const unreachable = [];

// A little concurrency, or 100+ sequential HTTP checks takes minutes.
const queue = [...catalog];
async function worker() {
  while (queue.length) {
    const cert = queue.shift();
    const r = await check(cert.url);
    let mark = ok(r.status) ? 'OK ' : '!! ';

    if (!ok(r.status)) {
      // Some providers refuse any automated request (403/429) however the
      // request is shaped. That is not the same as a dead link, so flag it
      // separately instead of failing the run forever.
      if (cert.botBlocked && (r.status === 403 || r.status === 429 || r.status === 0)) {
        blocked.push({ id: cert.id, status: r.status, url: cert.url });
        mark = 'BOT';
      } else if (deadOnly && !dead(r)) {
        unreachable.push({ id: cert.id, ...r, url: cert.url });
        mark = '?? ';
      } else {
        bad.push({ id: cert.id, ...r, url: cert.url });
      }
    }
    console.log(`${mark}${String(r.status).padEnd(3)} ${cert.id.padEnd(28)} ${cert.url}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const good = catalog.length - bad.length - blocked.length - unreachable.length;
console.log(`\n${good}/${catalog.length} reachable (2xx).`);

if (blocked.length) {
  console.log(`${blocked.length} known to block automated checks (verified manually, not a failure):`);
  for (const b of blocked) console.log(`  ${b.id} -> ${b.status}`);
}

if (unreachable.length) {
  console.log(`${unreachable.length} did not answer normally from here, which is not proof they are broken (check by hand if one keeps appearing):`);
  for (const u of unreachable) console.log(`  ${u.id} -> ${u.status}${u.error ? ` (${u.error})` : ''}`);
}

if (bad.length) {
  console.log('Needs a look:');
  for (const b of bad) console.log(`  ${b.id} -> ${b.status}${b.error ? ` (${b.error})` : ''}`);
  process.exitCode = 1;
}
