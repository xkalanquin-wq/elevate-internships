// Optional Claude-backed "suggest more certifications". Only reachable when
// ANTHROPIC_API_KEY is set. Suggestions are labelled and link-checked before
// the client is allowed to add them.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export function suggestEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function suggestCertifications(query, catalog) {
  const known = catalog.map((c) => `${c.title} (${c.provider})`).join('; ');

  const prompt = `A student is looking for free certifications.

Major: ${query.major || 'unspecified'}
Interests: ${(query.interests || []).join(', ') || 'unspecified'}
Class year: ${query.classYear || 'unspecified'}

They already have these in their catalog, so do not repeat any of them:
${known}

Suggest up to 6 more certifications or course programs that are genuinely free to complete (or free to audit). Only suggest ones you are confident exist at a stable URL. Reply with JSON only, no prose, in this shape:
{"suggestions":[{"title":"","provider":"","url":"","hours":0,"cost":"free|audit|check","tags":[""],"desc":"","why":""}]}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API returned HTTP ${res.status}`);
  const json = await res.json();
  const text = (json.content || []).map((b) => b.text || '').join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse a JSON object from the model response.');

  const parsed = JSON.parse(match[0]);
  const list = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

  return list
    .filter((s) => s && s.title && /^https?:\/\//.test(s.url || ''))
    .slice(0, 6)
    .map((s, i) => ({
      id: `suggested:${Date.now()}:${i}`,
      title: String(s.title),
      provider: String(s.provider || 'Unknown'),
      url: String(s.url),
      hours: Number(s.hours) || 0,
      cost: ['free', 'audit', 'check', 'ref'].includes(s.cost) ? s.cost : 'check',
      tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
      desc: String(s.desc || ''),
      why: String(s.why || ''),
      suggested: true,
    }));
}

/**
 * A link must answer 200 before it can be added. HEAD first because it is
 * cheap, but always fall through to GET on any non-200 — plenty of sites
 * mishandle HEAD (Kaggle answers 404 to HEAD and 200 to GET), and rejecting
 * those would block perfectly good certifications.
 */
export async function checkUrl(url) {
  if (!/^https?:\/\//i.test(url)) return { ok: false, status: 0, reason: 'Not an http(s) URL.' };

  // A real browser UA: several providers refuse anything that looks like a bot.
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  };

  let last = { ok: false, status: 0 };

  for (const method of ['HEAD', 'GET']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: controller.signal, headers });
      if (res.status === 200) return { ok: true, status: 200, method };
      last = { ok: false, status: res.status };
    } catch (err) {
      last = { ok: false, status: 0, reason: String(err.message || err) };
    } finally {
      clearTimeout(timer);
    }
  }

  return last;
}
