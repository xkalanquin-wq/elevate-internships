// Premium ($9.99 for one semester) and sponsored listings ($49 for 30 days).
//
// Both are paid through Stripe Checkout (server/stripe.js) and stay switched
// off until STRIPE_SECRET_KEY is set. Neither renews automatically: Premium
// is a one-time payment for six months, and buying again adds six more.
//
// A payment is recorded from whichever arrives first — the buyer landing back
// on the site, or Stripe's webhook — and only once, because the checkout
// session id is unique in the payments table.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean } from './guard.js';
import { esc } from './html.js';
import { PREMIUM_ENABLED } from './features.js';
import { distanceMiles, geocodeZip } from './geo.js';
import { createCheckout, getCheckout, looksLikeSessionId, refund, stripeEnabled, stripeTestMode, verifyWebhook } from './stripe.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PREMIUM_CENTS = 999;
export const PREMIUM_DAYS = 183; // one semester: about six months
export const SPONSOR_CENTS = 4900;
export const SPONSOR_DAYS = 30;
const DAY_MS = 86_400_000;

export const KIT_FILE = path.join(here, 'private', 'Elevate-Internships-Recruiting-Kit.zip');
export const kitAvailable = () => fs.existsSync(KIT_FILE);

/** Letters, digits and dashes, 2-32 long, lower case: "uconn-jamie". Null otherwise. */
export function cleanRef(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(v) ? v : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function createCommerce({ store, sendMail, contactEmail, siteUrl, tracks, plainPage, countStep = () => {} }) {
  const origin = (req) => {
    const s = String(siteUrl() || '').replace(/\/+$/, '');
    return /^https?:\/\//.test(s) ? s : `${req.protocol}://${req.get('host')}`;
  };
  const majorIds = Object.keys(tracks).filter((id) => !id.startsWith('_') && Array.isArray(tracks[id].source));

  // ---- Premium ---------------------------------------------------------------

  function premiumState(user) {
    const full = user ? store.getUserById(user.id) : null;
    return {
      enabled: stripeEnabled(),
      testMode: stripeEnabled() && stripeTestMode(),
      price: PREMIUM_CENTS / 100,
      days: PREMIUM_DAYS,
      premium: store.isPremium(full),
      premiumUntil: full?.premium_until || null,
      kit: kitAvailable(),
    };
  }

  /**
   * Records a paid checkout session and delivers what was bought. Safe to call
   * more than once for the same session. Returns what happened.
   */
  async function fulfil(session) {
    if (!session || session.payment_status !== 'paid' || session.currency !== 'usd') return { ok: false, reason: 'not paid' };
    const kind = session.metadata?.kind;
    const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;

    if (kind === 'premium') {
      const userId = Number(session.client_reference_id || session.metadata?.user_id);
      const user = Number.isInteger(userId) ? store.getUserById(userId) : null;
      if (session.amount_total !== PREMIUM_CENTS) return { ok: false, reason: 'unexpected amount' };
      const fresh = store.recordPayment({
        userId: user ? user.id : null,
        kind,
        sessionId: session.id,
        paymentIntent,
        amountCents: session.amount_total,
        refCode: user?.ref_code || null,
      });
      if (fresh && user) {
        const now = Date.now();
        const base = Math.max(now, user.premium_until ? new Date(user.premium_until).getTime() : 0);
        store.setUserFields(user.id, { premium_until: new Date(base + PREMIUM_DAYS * DAY_MS).toISOString() });
        console.log(`[premium] account ${user.id} upgraded`);
      }
      return { ok: true, kind, fresh, userId: user?.id ?? null };
    }

    if (kind === 'sponsor') {
      const id = Number(session.metadata?.listing_id);
      const listing = Number.isInteger(id) ? store.getSponsored(id) : null;
      if (!listing || session.amount_total !== SPONSOR_CENTS) return { ok: false, reason: 'unknown listing' };
      const fresh = store.recordPayment({ kind, sessionId: session.id, paymentIntent, amountCents: session.amount_total });
      if (fresh && listing.status === 'unpaid') {
        store.updateSponsored(id, {
          status: 'pending',
          session_id: session.id,
          payment_intent: paymentIntent,
          amount_cents: session.amount_total,
          paid_at: new Date().toISOString(),
        });
        notifySponsorPaid(store.getSponsored(id)).catch(() => {});
      }
      return { ok: true, kind, fresh, listingId: id };
    }
    return { ok: false, reason: 'unknown kind' };
  }

  /** A full refund made in Stripe (or by rejecting a listing) takes back what it paid for. */
  function onRefund(paymentIntent) {
    const payment = store.paymentByIntent(paymentIntent);
    if (!payment || !store.markRefunded(payment.id)) return false;
    if (payment.kind === 'premium' && payment.user_id) {
      const user = store.getUserById(payment.user_id);
      if (user?.premium_until) {
        const until = new Date(user.premium_until).getTime() - PREMIUM_DAYS * DAY_MS;
        store.setUserFields(user.id, { premium_until: new Date(Math.max(until, Date.now())).toISOString() });
      }
    }
    if (payment.kind === 'sponsor') {
      const listing = store.listSponsored().find((s) => s.payment_intent === paymentIntent);
      if (listing && listing.status !== 'rejected') store.updateSponsored(listing.id, { status: 'refunded' });
    }
    return true;
  }

  // ---- Stripe webhook ------------------------------------------------------------

  /** Mounted with express.raw, before the JSON body parser, so the signature can be checked. */
  async function webhook(req, res) {
    const event = verifyWebhook(req.body, req.get('stripe-signature'));
    if (!event) return res.status(400).json({ error: 'Bad signature.' });
    try {
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        await fulfil(event.data?.object);
      } else if (event.type === 'charge.refunded') {
        const charge = event.data?.object;
        if (charge?.refunded) onRefund(typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id);
      }
    } catch (err) {
      console.error(`[stripe] webhook ${event.type} failed: ${err.message}`);
      return res.status(500).json({ error: 'Not processed.' });
    }
    res.json({ received: true });
  }

  // ---- Routes ------------------------------------------------------------------

  function routes(app, { requireUser, currentUser, payLimiter, writeLimiter, formBody }) {
    // Premium switched off (server/features.js): the app is told so, and the
    // checkout, confirm and Recruiting Kit routes do not exist.
    app.get('/api/premium', (req, res) => res.json(PREMIUM_ENABLED ? { offered: true, ...premiumState(currentUser(req)) } : { offered: false }));
    if (PREMIUM_ENABLED) premiumRoutes(app, { requireUser, payLimiter, writeLimiter });
    sponsorRoutes(app, { payLimiter, formBody });
  }

  function premiumRoutes(app, { requireUser, payLimiter, writeLimiter }) {
    app.post('/api/premium/checkout', requireUser, payLimiter, async (req, res) => {
      if (!stripeEnabled()) return res.status(400).json({ error: 'Payments are not switched on yet.' });
      try {
        const base = origin(req);
        const session = await createCheckout({
          name: 'Elevate Internships Premium — one semester',
          description: 'Six months of Premium. One payment; it does not renew.',
          amountCents: PREMIUM_CENTS,
          successUrl: `${base}/account?paid={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${base}/account?canceled=1`,
          email: req.user.email,
          clientReferenceId: String(req.user.id),
          metadata: { kind: 'premium', user_id: String(req.user.id) },
          // Clicks within the same two minutes get the same payment page.
          idempotencyKey: `premium-${req.user.id}-${Math.floor(Date.now() / 120_000)}`,
        });
        // For the Premium funnel on /owner: page loads, then this, then paid.
        countStep('premium-checkout');
        res.json({ url: session.url });
      } catch (err) {
        console.error(`[premium] checkout failed: ${err.message}`);
        res.status(502).json({ error: 'Could not open the payment page. Try again in a minute.' });
      }
    });

    /** Called by the account page after Stripe sends the buyer back. */
    app.post('/api/premium/confirm', requireUser, writeLimiter, async (req, res) => {
      const id = String(req.body?.sessionId || '');
      if (!stripeEnabled() || !looksLikeSessionId(id)) return res.status(400).json({ error: 'That payment could not be found.' });
      try {
        const session = await getCheckout(id);
        if (session.metadata?.kind !== 'premium' || String(session.client_reference_id) !== String(req.user.id)) {
          return res.status(400).json({ error: 'That payment belongs to a different account.' });
        }
        const result = await fulfil(session);
        if (!result.ok) return res.status(400).json({ error: 'That payment has not gone through.' });
        res.json(premiumState(req.user));
      } catch (err) {
        console.error(`[premium] confirm failed: ${err.message}`);
        res.status(502).json({ error: 'Could not check the payment with Stripe. Refresh in a minute.' });
      }
    });

    /** The Recruiting Kit, for Premium members. */
    app.get('/api/premium/kit', requireUser, (req, res) => {
      if (!store.isPremium(store.getUserById(req.user.id))) return res.status(403).json({ error: 'The Recruiting Kit comes with Premium.' });
      if (!kitAvailable()) return res.status(404).json({ error: 'The kit is not on this server.' });
      res.set('Cache-Control', 'private, no-store');
      res.download(KIT_FILE, 'Elevate Internships Recruiting Kit.zip');
    });
  }

  function sponsorRoutes(app, { payLimiter, formBody }) {
    // ---- Sponsored listings: the form on /sponsor posts here -----------------

    const form = (req) => ({
      company: clean(req.body?.company, 120),
      title: clean(req.body?.title, 160),
      url: String(req.body?.url || '').trim().slice(0, 500),
      zip: String(req.body?.zip || '').trim(),
      remote: req.body?.remote === 'on' || req.body?.remote === 'yes',
      majors: [].concat(req.body?.majors || []).map(String).filter((m) => majorIds.includes(m)).slice(0, majorIds.length),
      contactEmail: String(req.body?.email || '').trim().toLowerCase().slice(0, 200),
    });

    const problemPage = (res, message) =>
      res
        .status(400)
        .type('html')
        .send(plainPage('Check the form — Elevate Internships', `<h1>Almost there</h1><p>${esc(message)}</p><p><a href="/sponsor#post">Back to the form</a></p>`));

    app.post('/sponsor/checkout', payLimiter, formBody, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!stripeEnabled()) return problemPage(res, 'Online payment is not switched on yet. Email us instead and we will set your listing up.');
      if (req.body?.website) return res.redirect(303, '/sponsor'); // honeypot
      const f = form(req);
      if (!f.company || !f.title) return problemPage(res, 'Add the company name and the internship title.');
      let u;
      try {
        u = new URL(f.url);
      } catch {
        u = null;
      }
      if (!u || u.protocol !== 'https:') return problemPage(res, 'The application link must be a full https:// address.');
      if (!EMAIL_RE.test(f.contactEmail)) return problemPage(res, 'Add an email address we can reach you at.');
      if (!f.majors.length) return problemPage(res, 'Choose at least one major.');
      let place = null;
      if (!f.remote) {
        if (!/^\d{5}$/.test(f.zip)) return problemPage(res, 'Add the 5-digit ZIP code where the intern will work, or tick Remote.');
        place = await geocodeZip(f.zip);
        if (!place) return problemPage(res, `${f.zip} is not a ZIP code we could find.`);
      }
      const details = {
        ...f,
        url: u.href,
        location: f.remote ? 'Remote' : `${place.city}, ${place.state}`,
        zip: f.remote ? null : f.zip,
        lat: place?.lat ?? null,
        lon: place?.lon ?? null,
      };
      // The same form sent again within 30 minutes (a double click, Back and
      // resubmit) reuses its listing, and so its payment page.
      const id = store.findUnpaidSponsored(details, new Date(Date.now() - 30 * 60_000)) ?? store.createSponsored(details);
      try {
        const base = origin(req);
        const session = await createCheckout({
          name: 'Sponsored internship listing — 30 days',
          description: `${f.title} at ${f.company}`.slice(0, 300),
          amountCents: SPONSOR_CENTS,
          successUrl: `${base}/sponsor/thanks?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${base}/sponsor#post`,
          email: f.contactEmail,
          metadata: { kind: 'sponsor', listing_id: String(id) },
          idempotencyKey: `sponsor-${id}`,
        });
        res.redirect(303, session.url);
      } catch (err) {
        console.error(`[sponsor] checkout failed: ${err.message}`);
        problemPage(res, 'The payment page did not open. Try again in a minute.');
      }
    });

    app.get('/sponsor/thanks', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.set('X-Robots-Tag', 'noindex, nofollow');
      const id = String(req.query.session_id || '');
      let ok = false;
      if (stripeEnabled() && looksLikeSessionId(id)) {
        try {
          const session = await getCheckout(id);
          ok = session.metadata?.kind === 'sponsor' && (await fulfil(session)).ok;
        } catch (err) {
          console.error(`[sponsor] thanks check failed: ${err.message}`);
        }
      }
      const body = ok
        ? `<h1>Thank you — your listing is in review</h1><p>We check every sponsored listing by hand, usually within one business day. Once it is approved it appears at the top of matching searches for ${SPONSOR_DAYS} days, labeled <em>Sponsored</em>, and we email you.</p><p>If it is not approved, you get a full refund.</p><p><a href="/">Back to Elevate Internships</a></p>`
        : `<h1>We could not confirm that payment</h1><p>If you were charged, your listing is safe — we will see the payment and follow up by email. Otherwise, <a href="/sponsor#post">try the form again</a>.</p>`;
      res.type('html').send(plainPage('Sponsored listing — Elevate Internships', body));
    });

    /** A sponsored listing's link: counts the click, then goes to the employer. */
    app.get('/go/s/:id', (req, res) => {
      const id = Number(req.params.id);
      const listing = Number.isInteger(id) ? store.getSponsored(id) : null;
      if (!listing || listing.status !== 'live') return res.redirect(302, '/');
      // Crawlers, link checkers and scripts are not people clicking.
      const ua = req.get('user-agent') || '';
      if (ua && !/bot|crawl|spider|preview|slurp|headless|monitor|scanner|checker|curl|wget|python|node|undici|axios|java\/|go-http/i.test(ua)) {
        store.bumpSponsored([id], 'clicks');
      }
      res.set('X-Robots-Tag', 'noindex, nofollow');
      res.set('Referrer-Policy', 'no-referrer-when-downgrade');
      res.redirect(302, listing.url);
    });
  }

  // ---- Owner review ------------------------------------------------------------------

  async function mail(to, subject, lines) {
    if (!to) return;
    await sendMail({ to, subject, text: lines.join('\n') });
  }

  async function notifySponsorPaid(listing) {
    await mail(listing.contact_email, 'Your sponsored listing is in review', [
      `Thanks — we received your payment for "${listing.title}" at ${listing.company}.`,
      '',
      'We review every sponsored listing by hand, usually within one business day. Once approved, it runs for 30 days at the top of matching searches, labeled Sponsored, and we will email you.',
      '',
      'If it is not approved, you get a full refund.',
      '',
      '— Elevate Internships',
    ]);
    await mail(contactEmail(), `Sponsored listing to review: ${listing.company}`, [
      `${listing.title} — ${listing.company} (${listing.location})`,
      listing.url,
      `Majors: ${listing.majors.join(', ')}`,
      `Contact: ${listing.contact_email}`,
      '',
      'Approve or reject it at /owner.',
    ]);
  }

  /** Owner actions from /owner. Returns a message to show. */
  async function review(id, action) {
    const listing = store.getSponsored(id);
    if (!listing) return 'That listing does not exist.';
    const now = new Date();
    if (action === 'approve' && listing.status === 'pending') {
      store.updateSponsored(id, { status: 'live', starts_at: now.toISOString(), ends_at: new Date(now.getTime() + SPONSOR_DAYS * DAY_MS).toISOString() });
      await mail(listing.contact_email, 'Your sponsored listing is live', [
        `"${listing.title}" at ${listing.company} is now live on Elevate Internships for ${SPONSOR_DAYS} days.`,
        '',
        'It appears at the top of searches from students in the majors you chose, labeled Sponsored.',
        '',
        '— Elevate Internships',
      ]).catch(() => {});
      return `Approved: ${listing.title}. It is live for ${SPONSOR_DAYS} days.`;
    }
    if (action === 'reject' && listing.status === 'pending') {
      if (!listing.payment_intent) return 'No payment is attached to this listing, so there is nothing to refund.';
      try {
        await refund(listing.payment_intent);
      } catch (err) {
        return `Stripe did not make the refund (${err.message}). Nothing was changed; try again, or refund it in the Stripe dashboard.`;
      }
      store.updateSponsored(id, { status: 'rejected' });
      const payment = store.paymentByIntent(listing.payment_intent);
      if (payment) store.markRefunded(payment.id);
      await mail(listing.contact_email, 'About your sponsored listing', [
        `We could not approve "${listing.title}" at ${listing.company} for Elevate Internships, and your $${(SPONSOR_CENTS / 100).toFixed(2)} has been refunded in full. It can take 5-10 days to show on your statement.`,
        '',
        'Reply to this email if you would like to know why or to send a revised listing.',
        '',
        '— Elevate Internships',
      ]).catch(() => {});
      return `Rejected and refunded: ${listing.title}.`;
    }
    if (action === 'end' && listing.status === 'live') {
      store.updateSponsored(id, { status: 'ended', ends_at: now.toISOString() });
      return `Ended early: ${listing.title}. No refund was made.`;
    }
    return 'Nothing to do: that listing is not in a state where this applies.';
  }

  // ---- Showing sponsored listings --------------------------------------------------

  /**
   * Up to two live sponsored listings for a search: the listing's majors must
   * include the search's field (or it has none), and it must be remote or
   * within the search radius.
   */
  function sponsoredFor({ fieldId, origin: from, radiusMiles }, limit = 2) {
    const hits = store
      .liveSponsored()
      .filter((s) => !s.majors.length || (fieldId && s.majors.includes(fieldId)))
      .filter((s) => s.remote || (from && s.lat != null && distanceMiles(from, { lat: s.lat, lon: s.lon }) <= radiusMiles))
      // Newest first, so a listing that just started is not always second.
      .sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)))
      .slice(0, limit);
    return hits.map((s) => ({
      id: `sponsored:${s.id}`,
      sponsoredId: s.id,
      title: s.title,
      company: s.company,
      location: s.location,
      remote: s.remote,
      url: s.url,
      applyUrl: `/go/s/${s.id}`,
      source: 'Sponsored',
      sponsored: true,
      postedAt: s.starts_at,
      distanceMiles: !s.remote && from && s.lat != null ? distanceMiles(from, { lat: s.lat, lon: s.lon }) : null,
    }));
  }

  return { premiumState, fulfil, onRefund, webhook, routes, review, sponsoredFor };
}
