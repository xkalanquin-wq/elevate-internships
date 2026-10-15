// IndexNow: tells Bing which pages exist as soon as a new version goes live,
// instead of waiting for its crawler to come round. Submissions are shared
// with the other IndexNow engines (Yandex, Seznam, Naver). Google does not
// take part; it reads the sitemap as before.
//
// The protocol proves the site is ours by fetching /<key>.txt and checking it
// holds the key. The key is public by design, so it lives in the repo.
//
// Every sitemap URL is sent once per build: the sitemap's text changes with
// each build (its lastmod dates), and the one last sent is remembered in the
// database, so a restart or a host waking from sleep does not send it again.

import crypto from 'node:crypto';
import fs from 'node:fs';

const KEY = /^[a-f0-9]{32}$/;
// The new version starts before the host sends it traffic, and on the first
// deploy only the new version serves the key file. Waiting a few minutes, and
// retrying after that, keeps IndexNow from checking the key against the old one.
const DELAYS_MS = [3, 10, 30, 60].map((m) => m * 60_000);

export function createIndexNow({
  keyFile,
  sitemapFile,
  siteUrl,
  getMeta,
  setMeta,
  endpoint = 'https://api.indexnow.org/indexnow',
  delaysMs = DELAYS_MS,
}) {
  const raw = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '';
  const key = KEY.test(raw) ? raw : null;

  /** Sends the sitemap's URLs if this build's sitemap has not been sent. Resolves to what happened. */
  async function submitOnce() {
    const origin = String(siteUrl || '').replace(/\/+$/, '');
    if (!key || !/^https:\/\//.test(origin) || !fs.existsSync(sitemapFile)) return 'off';

    const xml = fs.readFileSync(sitemapFile, 'utf8');
    const version = crypto.createHash('sha256').update(xml).digest('hex').slice(0, 16);
    if (getMeta('indexnow.sent') === version) return 'already sent';

    const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1].trim())
      .filter((u) => u === origin || u.startsWith(`${origin}/`));
    if (urlList.length === 0) return 'off';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
      signal: AbortSignal.timeout(20_000),
    });
    // 200 and 202 both mean accepted (202: key check still pending).
    if (res.ok) {
      setMeta('indexnow.sent', version);
      return `sent ${urlList.length}`;
    }
    const err = new Error(`HTTP ${res.status}`);
    // 400/403/422 are our mistake (bad key, wrong host) and will not fix
    // themselves; 429 and 5xx are worth another try.
    err.retry = res.status === 429 || res.status >= 500;
    throw err;
  }

  /** Background submit with retries. Never throws, never keeps the process alive. */
  function start() {
    let attempt = 0;
    const run = () =>
      submitOnce()
        .then((outcome) => {
          if (outcome.startsWith('sent')) console.log(`[indexnow] ${outcome} URLs`);
        })
        .catch((err) => {
          const retry = err.retry !== false && attempt < delaysMs.length;
          console.warn(`[indexnow] submit failed: ${err.message}${retry ? ' — will retry' : ''}`);
          if (retry) schedule();
        });
    const schedule = () => setTimeout(run, delaysMs[attempt++]).unref();
    schedule();
  }

  return { key, keyPath: key ? `/${key}.txt` : null, start, submitOnce };
}
