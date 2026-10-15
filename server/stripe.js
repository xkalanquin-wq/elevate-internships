// Stripe Checkout, through Stripe's REST API directly (no SDK dependency).
//
// The card form is Stripe's own hosted page: this server only creates a
// checkout session, sends the person there, and afterwards asks Stripe whether
// it was paid. Card details never reach this server.
//
// Off until STRIPE_SECRET_KEY is set. STRIPE_WEBHOOK_SECRET is optional but
// recommended: without it a payment is still recorded when the buyer lands
// back on the site, but not if they close the tab before that.

import crypto from 'node:crypto';

const API = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const secret = () => String(process.env.STRIPE_SECRET_KEY || '').trim();

export const stripeEnabled = () => /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secret());
export const stripeTestMode = () => /^(sk|rk)_test_/.test(secret());

/** Stripe's form encoding: nested objects become a[b][c]=v. */
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call(method, path, body, idempotencyKey = null) {
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Stripe-Version': '2024-06-20',
      // Stripe answers a repeated request with the same key with the first
      // result, so a double click or a resubmitted form cannot open two payments.
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? encode(body).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Stripe's message explains the problem and never contains the key.
    throw new Error(`Stripe ${res.status}: ${String(json?.error?.message || 'request failed').slice(0, 200)}`);
  }
  return json;
}

/**
 * A one-time payment for one item. Returns { id, url }; send the browser to url.
 * `metadata` comes back unchanged on the session, which is how a payment is
 * matched to what was bought.
 */
export function createCheckout({ name, description, amountCents, successUrl, cancelUrl, email, clientReferenceId, metadata, idempotencyKey = null }) {
  const session = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: email || undefined,
    client_reference_id: clientReferenceId || undefined,
    metadata,
    payment_intent_data: { metadata, description: name },
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: { name, ...(description ? { description } : {}) },
        },
      },
    },
  };
  return call('POST', '/v1/checkout/sessions', session, idempotencyKey);
}

/** Session ids are cs_test_… or cs_live_…; anything else is not worth a request. */
export const looksLikeSessionId = (id) => /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(String(id || ''));

export const getCheckout = (id) => call('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);

/** Refunds a whole payment. */
export const refund = (paymentIntent) => call('POST', '/v1/refunds', { payment_intent: paymentIntent }, `refund-${paymentIntent}`);

/**
 * Checks a webhook's Stripe-Signature header against the raw request body.
 * Returns the parsed event, or null if the signature is wrong or too old.
 */
export function verifyWebhook(rawBody, header, { toleranceSec = 300, now = Date.now() } = {}) {
  const key = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!key || !header || !Buffer.isBuffer(rawBody)) return null;
  const parts = String(header)
    .split(',')
    .map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return null;
  if (Math.abs(now / 1000 - t) > toleranceSec) return null;
  const expected = crypto.createHmac('sha256', key).update(`${t}.`).update(rawBody).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}
