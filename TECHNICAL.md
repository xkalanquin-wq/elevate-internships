# Elevate Internships

A tool for **business students**. Four tabs:

- **Finder** — real internship listings near you, filterable by season, remote or in person, and sorted by match, date or distance; plus certifications matched to your major and when that major recruits
- **Ledger** — what you have started, what you have finished, and what it cost. A finished certification can be added to your LinkedIn profile or shared in one click
- **Applications** — internships you saved, moved through Saved → Applied → Interviewing → Offer (or Closed), with notes
- **Stats** — your own progress

Plus one page per major at `/certifications/<major>` — the full certification list and recruiting timeline, sent with its content in the HTML so search engines can index it.

Works with **zero API keys**: every job source except Adzuna and USAJOBS needs no key at all.

```bash
npm install && npm run dev
```

Node 20+. Starts the API on `:3001` and the client on `:5173`.

**Putting it online:** see [DEPLOY.md](DEPLOY.md). The short version is that
`render.yaml` sets up the service, health check and domains on Render's free
plan from one Blueprint, with the database kept in Cloudflare Workers KV
between restarts (and a daily copy kept for 14 days). A `Dockerfile` covers
any other host. It needs a long-running Node process, so static hosts
(Vercel, Netlify, Cloudflare Pages) will not work.

| Operator task | Command |
|---|---|
| Activity spreadsheet (logins, completions, applications) | `npm run report` |
| Database snapshot | `npm run backup` — see [BACKUPS.md](BACKUPS.md) |
| Check certification links still load | `npm run verify-catalog` |

---

## The 23 business majors

Accounting · Finance · Business Analytics · Marketing · Management · Supply Chain
& Operations · Human Resources · Management Information Systems · Economics ·
Entrepreneurship · International Business · Risk Management & Insurance ·
Hospitality & Tourism Management · Real Estate · Business Administration ·
Sport Management · Logistics & Transportation · Healthcare Management ·
Professional Sales · Actuarial Science · Financial Planning · Retail Management
& Merchandising · Agribusiness

Type your major and the Finder works out the track, then offers its starter set
in one click. Variants resolve too — "MIS", "Sports Business", "Health Care
Administration", "Investment Banking", "Taxation", "Fashion Merchandising" all
route correctly. If nothing matches, the full catalog is shown rather than a
wrong guess.

---

## The catalog: 222 certifications, free *and* paid

Every entry is labelled honestly, because "free" is the most abused word in this
space:

| Tag | Meaning |
| --- | --- |
| **Free** | Free to complete, certificate included |
| **Free to audit** | Course free; certificate costs money |
| **Check your campus** | Free through your school (Bloomberg needs a terminal) |
| **Paid** | Costs money — the real figure is shown |
| **Reference** | Not a certificate; a resource worth reading |

Paid entries carry the actual price, including the parts people get caught by:

- **CPA** — ~$1,500 in exam fees *plus* a $1,500–$3,000 review course, and 150 credit hours
- **CFA Level I** — ~$350 enrolment plus ~$940–$1,250 per exam (student scholarships exist)
- **PL-300** — training free, exam ~$165
- **Salesforce Administrator** — all Trailhead training free, exam ~$200
- **CPCU** — ~$700–$1,000 per course × 8, but employers almost always pay
- **LinkedIn Learning** — ~$40/month retail, and free through most libraries

That last kind of note is the point: several entries exist mainly to tell you
*not* to pay.

Paid certifications go into the ledger exactly like free ones — same checkbox,
same date stamp, same progress meter and hours total.

### Verifying the catalog

```bash
npm run verify-catalog
```

Checks every URL and exits non-zero if any break. Pass a file path to check a
candidate list before merging it.

193 of 200 return 2xx. Seven are flagged `botBlocked` — PMI (CAPM, PMP,
PMI-ACP), Oracle (two exams), ACAMS and the CMT Association refuse all automated
requests, so they are reported separately rather than failing the run. Each was
confirmed by hand or taken from the provider's own site. Two other entries (Canva Design School, Six
Sigma Council) were **excluded** for the same reason, because they could not be
verified even once.

Track definitions are validated against the catalog at startup: a track naming a
certification that does not exist stops the server with a clear message rather
than silently producing a short track.

---

## Internships

Enter a **5-digit US ZIP** and a radius. The ZIP is geocoded to real
coordinates, and every listing that can be placed is filtered by true
great-circle distance in miles.

| Source | Key? | Covers |
| --- | --- | --- |
| **Employer boards** (Greenhouse, Lever, Ashby, SmartRecruiters) | No | ~150 companies' own official job feeds, weighted to finance, trading, consulting, marketing and consumer brands |
| Simplify | No | The daily-updated Simplify / Pitt CSC internship list — product, quant and analyst roles only |
| Himalayas | No | Remote internships open to US applicants |
| The Muse | No | Internship-level roles, queried per metro near your ZIP |
| Remotive | No | Remote internships |
| Jobicy | No | Remote internships, US-filtered |
| Adzuna | Yes | Local listings in your radius, 3 pages |
| USAJOBS | Yes | Federal roles on the Students hiring path |

Greenhouse, Lever, Ashby and SmartRecruiters expose every company's own board as public JSON.
These are the employers' official endpoints — no key, no scraping — and they
reach roles the aggregators miss. The tracked list is
`server/data/employers.json`; add a slug to include a company (and its display
name under `names`, so it dedupes against the aggregators), and dead slugs are
skipped silently.

Boards, Simplify and Himalayas are the same for every visitor, so they are
cached in memory — boards for 30 minutes, the two feeds for an hour. A stale
copy is served while it refreshes, and a failed refresh keeps the last good
copy. Himalayas asks for exactly this, plus a link back to its page and credit
as the source; both are done.

Merged, deduped on company + title, then ranked by keyword match, proximity and
recency. Three filters run first and each reports what it removed:

- **Older than 9 months** — boards leave dead internship postings up for years
- **Outside the US**
- **Beyond your radius** — by measured distance, not a guess

A listing whose location text cannot be matched to a city is **kept rather than
guessed at**, and the count of those is shown so you know the radius did not
apply to them. Remote roles are always kept and badged.

### Location accuracy

Board location strings are messy — `Hybrid - New York, NY`,
`San Francisco, California`, `Bellevue, Washington; Mountain View, California`,
`San Francisco - SF9`. The parser handles working-arrangement prefixes, full
state names, country suffixes and multi-site postings (where the **nearest**
office counts). Genuinely ambiguous bare city names — Springfield, Portland,
Columbus — are deliberately left unplaced instead of guessed.

**LinkedIn and Handshake have no usable API.** LinkedIn's Jobs API needs a
Talent Solutions partnership not open to individuals; Handshake is gated behind
your university login and has no public API at all. Scraping either would breach
their terms, so they appear in the *Search these directly* panel with your
keywords, location and radius prefilled. (Indeed and Glassdoor return 403 to any
automated request, so their links cannot be link-checked — they work fine in a
browser.)

---

## API keys

All optional. Copy `.env.example` to `.env`.

**Adzuna** — the one worth getting; it adds local listings.
Register at <https://developer.adzuna.com/> for an App ID and Key (free tier:
250 calls/day).

**USAJOBS** — <https://developer.usajobs.gov/APIRequest/Index>. Needs both the
key *and* the email you registered with; the API rejects requests whose
`User-Agent` is not that email.

**Anthropic** — enables "Suggest more". Suggestions are labelled
*"suggested, verify link"* and cannot be added until the link returns 2xx.

---

## Privacy, terms, and the cookie banner

Terms and Privacy Policy are in the footer. They describe what this code
**actually does** rather than boilerplate — including two things generic
templates miss:

- **Google Fonts** discloses your IP to Google on every page load
- **USAJOBS** requires your registered email to be sent as the `User-Agent`

The app sets **no tracking cookies** and runs **no third-party analytics** (the
server keeps its own anonymous page-view tally — see "Visit counts"), so a generic consent
banner would be decorative. Instead the banner gates the one genuinely
consent-worthy thing — Google Fonts. Decline and the request is never made; the
app falls back to system fonts. Accept and Decline carry equal weight, and the
choice is changeable from the footer.

The legal pages have **not been reviewed by a lawyer**. If you publish this,
take payment, or add accounts, get them reviewed.

---

## Accounts

Each person gets their own ledger, completions, tracks and stats. Nothing is
shared between accounts.

**Searching does not require an account** — only the Ledger and Stats do, since
those are the parts that are personal. That keeps the app usable at first
glance instead of putting a wall in front of it.

### The weekly new-internships email

Under a search, a signed-in person can turn on a weekly email of new matches
(`server/digest.js`). It re-runs their most recent search against the listings
already held in memory — employer boards, Simplify and Himalayas — so it costs
no job-board request and no Adzuna or USAJOBS quota. Listings already sent are
remembered, and a week with nothing new sends nothing.

- Confirmed addresses only, so nobody can sign a stranger up.
- Sent 9am–8pm US Eastern, at most 15 per hourly check: Resend's free plan
  allows 100 emails a day, shared with resets and reminders.
- Every email has `List-Unsubscribe` headers and a `/unsubscribe?t=…` link that
  works without signing in. Opening the link only shows a button — mail
  scanners follow links — and the POST (also what one-click unsubscribe in mail
  apps sends) turns it off.

### How the auth works

- **Passwords** are hashed with **scrypt** (N=32768, r=8, per-user random salt),
  built into Node, so there is no native module to compile. Plain text is never
  stored, logged, or returned.
- **Sessions** are random 32-byte tokens in an `httpOnly` cookie. Only a SHA-256
  hash of each token is stored, so a leaked database cannot be replayed, and a
  session can be revoked server-side — which a stateless signed token cannot.
- **Sign-in is constant-work**: a failed lookup still runs a full hash against a
  dummy value, so response time cannot be used to discover which emails are
  registered. Measured at 76–81 ms for a known email vs 70–78 ms for an unknown
  one.
- Sign-in and sign-up are rate limited to 8 attempts per 15 minutes.
- Changing a password invalidates every other session.
- Minimum length is 10 characters and there are no composition rules, following
  NIST guidance that length matters and forced symbols mostly produce
  `Password1!`.

Node caps scrypt memory at 32 MB by default, which is just under what these
parameters need (`128 × N × r` ≈ 33.5 MB). `maxmem` is raised rather than
weakening the KDF.

### Upgrading an existing install

The ledger tables used to key on `item_id` alone, which would have stopped two
people completing the same certification. SQLite cannot drop a primary key, so
the store rebuilds those tables on first run and copies the rows across, tagged
to user `0`. **The first account created adopts them**, and the app says how
many it took, rather than letting data appear from nowhere.

## Owner-only server details

`OWNER_PASSCODE` is separate from user accounts. It gates
`/api/health/detail` — which integrations are configured, which storage backend
is live — not anybody's personal data. Stats moved to per-user accounts, so it
is no longer behind this.

- **unset** → server details open only from the machine running the app
- **set** → a valid owner session is required from anywhere

### Alerts when a job source or email breaks

`/api/health/sources` answers 503 when Adzuna, USAJOBS or email has failed
twice in a row with no success between, in a way the operator can fix — a
revoked or mistyped key, a bad request, a used-up quota — which `/api/health`
cannot see because the server still answers. A service that is busy or down
on its side (5xx, no answer in time) is shown on `/owner` but never alerts;
Adzuna is retried once on a 5xx. Point an uptime
monitor (UptimeRobot, 5-minute HTTP check) at it for an email when that
happens. The body says only `ok` or not; `/api/health/detail` has each
source's last result and error.

Results come from real searches and sends. When nobody has searched for three
hours, the check itself tries Adzuna and USAJOBS with one small fixed query
(every ten minutes while one is failing, so a fixed key clears the alert
quickly). The free feeds are recorded but never alert: when one is down there
is nothing to do except wait.

The passcode lives in `.env`, is never sent to the browser, and is compared in
constant time.

Stats itself is computed from your own ledger and search history. No analytics
service is involved — adding one would contradict the privacy policy.

### Visit counts

`/owner` (the same passcode) shows visits per day, where visitors came from and
which pages they loaded, plus each job source's latest result. The server keeps
the tally itself (`server/visits.js`): per day, a count of page loads by path
and by referring site name (or `utm_source`). No IP address, user-agent, cookie
or full referrer is stored, bots are left out, and days older than 120 are
dropped. Counts are held in memory and written to the database every two
minutes and before each Cloudflare copy. The privacy policy describes exactly
this — change both together.

---

## Metadata and social previews

Full SEO and social tags live in `client/index.html`: title, description,
keywords, canonical, robots, Open Graph (Facebook, LinkedIn, Slack, Discord),
and a `summary_large_image` X/Twitter card, plus a web manifest and theme
colours for light and dark.

### Site URL

Social crawlers do **not** resolve relative image paths, so `og:image`,
`og:url` and the canonical link must be absolute. They are substituted at build
time and default to the production domain:

```
https://elevateinternships.com
```

`npm run build` uses that automatically and prints which origin it used.
Override it only for a staging or preview deploy:

```bash
SITE_URL=https://staging.elevateinternships.com npm run build
```

The default lives in `PRODUCTION_SITE_URL` at the top of `vite.config.js`.

### robots.txt and sitemap.xml

Both are generated at build time from the same `SITE_URL`, so the absolute URLs
inside them cannot drift from the meta tags:

```
dist/robots.txt     Allow /, Disallow /api/, points at the sitemap
dist/sitemap.xml    /, /privacy, /terms  (with lastmod)
```

They are emitted by the build rather than checked in as static files — a
hardcoded `Sitemap:` line would go stale the moment the domain changed.

After each deploy, the server also sends every sitemap URL to **IndexNow**
(Bing, and the engines that share its submissions), so new pages are picked up
without waiting for a crawl. It runs only in production with an https
`SITE_URL`, a few minutes after start, and once per build — the last sitemap
sent is remembered in the database. The key in `server/data/indexnow-key.txt`
is public by design and is served at `/<key>.txt`. See `server/indexnow.js`.

### Search and AI visibility

- **One phrase per page.** `store/SEO-KEYWORDS.md` maps every indexable page to
  the one search phrase it targets. The phrase is in the title (60 characters or
  less, via `seoTitle` in `server/seo.js`), the H1, the meta description, and
  the page's illustration file name and alt text.
- **Readable without JavaScript.** Most AI crawlers do not run scripts. The
  content pages are plain HTML, and the app pages (`/`, `/home`,
  `/certifications…`) have their explanatory copy written into the HTML from
  the same data the app renders (`server/data/hub-content.json`,
  `server/data/cert-guides.json`, `client/src/SeoSection.jsx`), so crawlers and
  people read the same page.
- **Questions students ask** sections carry FAQPage markup; guides carry
  Article markup; `/` carries WebApplication markup.
- **Illustrations** are SVG cards drawn from each page's own data and served
  at `/images/<name>.svg`.
- **`/llms.txt`** lists every page with a one-line summary; `robots.txt`
  welcomes the AI crawlers by name and keeps `/api/` and `/owner` private.
- **Redirects:** common guesses (`/about`, `/guides`, `/blog`, …) and
  capitalised or trailing-slash page addresses answer 301 to the real page.

### Premium, payments and sponsored listings

> **Premium is switched off** (since 2026-10-13, at the owner's request). Its code is all here;
> `server/data/features.json` (`"premium": false`) hides its page, links, account section,
> daily alerts, Recruiting Kit and sample answers, and removes its payment routes. Set it to
> `true`, rebuild and run the test suite to bring it back. Sponsored listings stay on.

`server/commerce.js` and `server/stripe.js`. Both stay off until
`STRIPE_SECRET_KEY` is set, and card details never reach this server: it
creates a Stripe Checkout session, sends the buyer to Stripe's page, and on the
way back (or from the webhook) asks Stripe whether it was paid. The checkout
session id is unique in the `payments` table, so the return page and the
webhook can both report a payment and it counts once.

- **Premium**: $9.99 for 183 days (one semester), a one-time payment that never
  renews; buying again adds 183 days. It includes the daily alert, the Recruiting
  Kit (`server/private/Elevate-Internships-Recruiting-Kit.zip`, served only to
  Premium members at `/api/premium/kit`), the interview bank's sample answers,
  and no ads. A full refund made in Stripe takes the 183 days back (webhook).
- **Sponsored listings**: $49 for 30 days, bought from the form on `/sponsor`.
  A paid listing waits in `/owner` until approved; **Reject** refunds it through
  Stripe and emails the employer. Live listings appear above search results
  (never mixed into them) for the chosen majors, within the search radius or
  anywhere if remote, labeled Sponsored, and link through `/go/s/<id>`, which
  counts clicks. `/owner` shows times shown and clicks.
- **Webhook**: add `https://elevateinternships.com/api/stripe/webhook` in Stripe
  with `checkout.session.completed` and `charge.refunded`, and put its signing
  secret in `STRIPE_WEBHOOK_SECRET`.

### Notifications

`server/push.js` sends Web Push notifications (free; delivered by the browser
maker's push service): the day-before reminder for anyone who turns them on at
`/account`, and Premium's daily new-internship alert, which re-runs the latest
search against the cached listings between 9am and 8pm Eastern. The signing
(VAPID) keys are created on first start and kept in the database's `meta`
table. On iPhone, notifications only work once the site is added to the Home
Screen.

### Referral codes

`/?ref=uconn-jamie` (letters, digits and dashes) is kept in the browser for 30
days and sent with the sign-up form; visits from it are counted as
`ref:uconn-jamie`. `/owner` lists sign-ups and Premium purchases per code.

### AdSense

`ADSENSE_CLIENT=ca-pub-…` alone adds the verification `<meta>` tag and
`/ads.txt`, which is what Google needs to review the site. `ADSENSE_ADS=on`
also loads Google's ad script (auto ads) on the no-JavaScript content pages —
never in the app, never on `/premium` or `/sponsor`, and never for Premium
members. Those pages get their own Content-Security-Policy with a per-response
nonce and `'strict-dynamic'`, as Google recommends, and the privacy policy and
footers switch to wording that says ads are shown. Before turning it on, publish
Google's consent message for EEA/UK/Swiss visitors in AdSense (Privacy &
messaging).

### Reliability and limits

- **Rate limits** (`server/guard.js`): 600 requests a minute per visitor across the
  site, plus stricter limits on search (20/min), sign-in and account emails
  (8 per 15 min), payments and test notifications (10 per 15 min), writes
  (120/min) and browser error reports (10/min).
- **Daily caps** (`server/limits.js`): Adzuna 240 requests, email 95 (bulk mail
  80% of that, so password resets always get through), paid AI suggestions 50.
  Counts survive restarts and show on `/owner`.
- **Errors** (`server/errorlog.js`, `server/asyncerrors.js`): every route's thrown
  or rejected error goes to one handler that answers plainly and logs it; the
  last 60 distinct errors, from the server and from visitors' browsers
  (`/api/client-error`), are listed on `/owner` with a count. A crash saves the
  database before the host restarts the service. The app shows a "Reload"
  screen instead of a blank page if something fails while drawing.
- **Timeouts**: the browser gives up on a request after 30 s (90 s for a
  search) with a clear message; outbound calls (job sources, Stripe, email,
  push, Cloudflare) each have their own timeout.
- **Duplicates**: Stripe checkouts carry idempotency keys, a resubmitted
  sponsor form reuses its listing, and a payment is recorded once whichever
  of the return page and the webhook arrives first.
- **Speed**: responses are gzip/brotli-compressed; identical searches within
  five minutes share one answer; Adzuna answers are cached an hour; catalog
  APIs are cacheable for five minutes; results show 25 at a time;
  `/api/applications` takes `limit` and `offset`.
- **Database**: indexes for every per-request lookup (checked with
  `EXPLAIN QUERY PLAN`), and saved searches are trimmed to the latest 50 per
  account.
- **Upload sizes**: JSON bodies 256 KB, forms 8 KB, the Stripe webhook 1 MB.
  The site accepts no file uploads.
- **Update monitoring**: `/api/health` reports the live version (the deployed
  commit); `.github/dependabot.yml` opens a weekly pull request for library
  updates and immediate ones for security fixes. UptimeRobot watches
  `/api/health` and `/api/health/sources`.

### Security

- **Secrets** live only in the host's environment variables; nothing in the
  built files or the git history contains a key (scanned). `.env` files are
  ignored by git.
- **Accounts**: passwords are hashed with scrypt; session tokens and email-link
  tokens are stored only as SHA-256 hashes. The session cookie is `HttpOnly`,
  `SameSite=Lax` and `Secure` in production.
- **Access**: every personal route requires a session and every query is
  scoped to that session's account (the SQLite equivalent of row-level
  security); ids from the browser never choose whose data is read.
- **Tampering**: the server sets dates, prices, Premium status and stages
  itself, and ignores any other field a request sends.
- **Sign-in**: 8 attempts per visitor per 15 minutes, and 10 wrong passwords
  per account per 15 minutes from anywhere. Hidden bot-trap fields on sign-up,
  password reset, search and the sponsor form.
- **Queries** are all parameterized; the few column names built into SQL come
  from fixed lists. **Input** is validated and length-limited on the server;
  **output** is escaped in every server-rendered page and email, and React
  escapes everything in the app.
- **Encryption at rest** for the secrets the server must read back (the
  notification signing key and each browser's notification keys): AES-256-GCM
  with a key from `DATA_KEY` or `OWNER_SECRET` (`server/seal.js`). Cloudflare
  also encrypts the stored database.
- **Headers**: CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy` on the API, and HTTP redirected to HTTPS.
- **Dependencies**: `npm audit` reports 0 vulnerabilities; Dependabot opens
  pull requests for new fixes.

### Browser extension

`extension/` is "Save to Elevate Internships", a Manifest V3 extension for Edge,
Chrome and Firefox. Its popup reads the job title, company and location from the
current tab (JobPosting structured data first, then the page title) using only
the `activeTab` permission, and opens `/?add=1&url=…&title=…&company=…&location=…`,
which opens the tracker's Add form filled in. Nothing is saved until the person
presses Add.

### Routes

The legal pages have real URLs, so they can be linked, bookmarked and crawled:

| Path | |
| --- | --- |
| `/` | the app (Finder, Ledger, Stats are tabs, not routes) |
| `/terms` | Terms and Conditions |
| `/privacy` | Privacy Policy |
| `/certifications` | All 23 majors |
| `/certifications/<major>` | One major: certifications and recruiting timeline, rendered server-side by `server/majors.js` |
| `/internships`, `/internships/<major>` | Search pages: roles, skills, resume keywords, FAQs, timeline, certifications and recent real listings per major. Plain HTML from `server/content.js`, copy in `server/data/majors-content.json` |
| `/career-guides`, `/career-guides/<slug>` | Five guides from `server/data/guides.json`; the free-certifications, timelines and resume-keyword sections are generated from site data |
| `/how-it-works` | Editorial standards: where listings come from, how certifications are chosen, how to report a problem |
| `/accessibility` | Accessibility statement: the WCAG 2.2 AA target, what was done, how it is tested, known limits, how to report a barrier |
| `/interview-questions`, `/interview-questions/<field>` | 48 interview questions in six fields from `server/data/interview-questions.json`; sample answers only for Premium members, and none while Premium is switched off |
| `/premium` | What Premium includes, the price and the refund policy. A 404 while Premium is switched off |
| `/sponsor` | Sponsorship, and the form to buy a sponsored listing |
| `/account` | The app: notifications, data export, password, account deletion, and Premium with its daily alert when switched on (noindex) |

The search pages send no JavaScript: they reuse the app's stylesheet and link into the app for the ZIP search (`/?major=Finance` prefills the Finder). Per-listing pages with JobPosting markup were deliberately left out — the listings are third-party, often lack full descriptions and change hourly, which is the thin duplicate content Google's job-posting guidelines warn against.

Each sets its own `<title>`, description and canonical, so a shared `/privacy`
link previews as the privacy policy rather than as the app. Footer links are
real `<a href>` elements — crawlers do not follow `<button>` clicks — with a
handler that keeps navigation client-side and leaves modifier-clicks alone.

Unknown paths return a genuine **404** rather than 200-with-the-app, and render
a real not-found page (not the app silently loading) that names the path, links
back, and sets `noindex` so a mistyped URL is never indexed.

### Form validation

Validated in both places, for different reasons. The client checks are a
courtesy to the person typing; `server/index.js` re-checks everything, because
client validation is not a security control.

| Field | Rule |
| --- | --- |
| ZIP | required, 5 digits, rejects `00000` |
| Major | optional, ≤80 chars, must contain letters, no links or markup |
| Interest | ≤40 chars each, max 12, no duplicates, no links |

Errors appear **next to the field**, not in a summary, and only after that
field is blurred or the form is submitted — so it does not shout at someone
mid-way through typing their first digit. Each error carries `role="alert"`
with `aria-invalid` on the input, and submitting an invalid form moves focus to
the first problem so keyboard users are not stranded.

One subtlety worth knowing if you edit the server checks: they test the **raw**
request body. `normalizeQuery` truncates, so validating the cleaned value would
silently accept anything oversized.

### The preview image

```bash
npm run og
```

Regenerates three PNGs into `client/public/`:

| File | Size | Used by |
| --- | --- | --- |
| `og-image.png` | 1200×630 | Open Graph — Facebook, LinkedIn, Slack, Discord |
| `twitter-image.png` | 1200×600 | X `summary_large_image` |
| `og-square.png` | 630×630 | 1:1 croppers, and the Apple touch icon |

The card is drawn as SVG in `scripts/make-og-image.js` and rasterised with
`sharp`. **Raster matters** — X and Facebook will not render an SVG as a preview
image, so shipping the SVG alone would look fine locally and silently fail on
every platform.

The renderer only has system fonts, so the card uses Georgia and a monospace —
the same fallbacks the app already declares behind Fraunces and IBM Plex Mono.
Edit the copy or the stat chips in that script and re-run; chip widths are
computed from their text, so labels can change freely.

## The installable app

The site doubles as an app. There is one codebase: the app is the website,
installed. Every push to `main` updates the site and every installed copy at
once, with no store review for code changes.

- `client/public/site.webmanifest`: name, icons, colours, and shortcuts
  (`/?tab=finder`, `/?tab=tracker`, `/certifications`).
- `client/public/sw.js`: the service worker. Pages always come from the
  network, falling back to `offline.html` when there is none. Hashed
  `/assets/*` files are cache-first, and `/api/*` is never touched. Bump
  `VERSION` to drop old caches.
- `client/src/install.js` and `InstallApp.jsx`: the footer's "Install the app"
  button. It uses the browser's prompt on Chrome, Edge and Samsung Internet,
  and shows Share → Add to Home Screen steps on iPhone and iPad.
- Icons: `npm run icons` (`scripts/make-app-icons.js`) redraws
  `client/public/icons/` from the favicon's shapes.
- Store packages (Microsoft Store, Samsung Galaxy Store) are built from the
  live URL with PWABuilder. The Android package's signing fingerprint goes in
  `server/data/assetlinks.json`, served at `/.well-known/assetlinks.json`.
  Without it the Android app shows a browser address bar.

## Transport security

HTTPS is enforced **in production only** — forcing it on localhost would just
break local development, since there is no certificate for `127.0.0.1`.

Set `NODE_ENV=production` when you deploy. That turns on:

- **HTTP → HTTPS redirect** (301 for GET/HEAD, 307 otherwise so request bodies survive)
- **HSTS**, `max-age=31536000; includeSubDomains`, sent only over a real TLS connection
- **`Secure`** on the owner session cookie (already `HttpOnly` and `SameSite=Lax`)
- **`upgrade-insecure-requests`** in the CSP

Set `TRUST_PROXY=1` behind a load balancer (Heroku, Fly, Render, nginx). Without
it Express will not believe `X-Forwarded-Proto`, and the redirect loops forever.
`FORCE_HTTPS=false` disables the redirect for the rare case of a trusted sidecar
that already terminates TLS — the server warns at boot when you use it.

Security headers on every response: a Content-Security-Policy limiting scripts
to `'self'` (Google Fonts is allowed for styles and fonts only),
`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `X-Powered-By` removed.

## Secrets

No secret ever reaches the browser. API keys are read from `process.env` in
server code only and used in server-side `fetch` calls; the client has no
`import.meta.env` or `VITE_*` reference at all, so nothing can be inlined into
the bundle at build time. The owner passcode is compared server-side in constant
time and never sent to the client.

`/api/health` is deliberately thin — which integrations are configured is
reconnaissance for an attacker and useless to a visitor, so that detail lives on
`/api/health/detail` behind the owner gate, and reports **presence only**, never
values.

To audit the bundle yourself:

```bash
npm run build && grep -RIEn "api[_-]?key|secret|passcode|sk-ant" dist/
```

The only hits are React's own `__SECRET_INTERNALS_…` symbol and the strings
`OWNER_PASSCODE` / `ANTHROPIC_API_KEY` appearing as **names** in on-screen text
that tells you what to put in `.env`. No values.

## Abuse protection

There is no public form to spam, so the real exposure is metered APIs and
outbound fetches:

| Endpoint | Limit |
| --- | --- |
| `/api/search` | 20/min (fans out to five APIs, two metered) |
| `/api/suggest` | 5/min (costs real money per call) |
| `/api/owner/login` | 8 per 15 min |
| `/api/check-url` | 30/min |
| writes | 120/min |

`/api/check-url` fetches a URL the client supplies, so it is restricted to
public http(s) hosts — localhost, private ranges and cloud metadata
(`169.254.169.254`) are refused. All user input is length-capped and stripped of
control characters; request bodies are capped at 256 KB.

The search form additionally carries a **honeypot** field and a submission
timing check: a hidden input no person can see or tab to, and a one-second floor
on how fast the form can be submitted after rendering. Both are also enforced
server-side, and both respond with an empty success rather than an error, so a
bot is not told which check caught it.

Worth being clear about the limits: there is no public sign-up, comment box or
contact form here, so there is no user-generated content to spam. The real
exposure is **API abuse** — burning Adzuna's 250/day free tier or running up
Claude API charges — which is what the rate limits above actually protect.

---

## Storage

SQLite via `better-sqlite3`, falling back automatically to a JSON file if the
native module will not build. It logs which backend it chose; `/api/health`
reports it. Force the fallback with `STORE_BACKEND=json npm run dev`.

Both persist the ledger, your marks, started tracks, and recent searches across
restarts.

---

## Accessibility

All five color tokens clear WCAG AA (4.5:1) against their surface in **both**
themes. Every interactive element has a visible `:focus-visible` ring. The tabs
implement the full ARIA pattern — `aria-controls`, `role="tabpanel"`, roving
`tabindex`, arrow/Home/End keys with focus following selection. There is a skip
link, and pointer targets meet WCAG 2.2 AA's 24×24 CSS px minimum.

Search hits five APIs, so it renders skeleton rows with `aria-busy` rather than
freezing. Respects `prefers-reduced-motion` and handles notched phones via
`env(safe-area-inset-bottom)`.

The public statement is `/accessibility` (`accessibilityPage()` in
`server/content.js`, linked from both footers). Every claim on it is checked by
the test suite, so change the page and its review date together. The automated
audit runs axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules on 20 pages
and in-use states (search results, a filled ledger, the font banner) at 375 px in
light mode and 1280 px in dark mode, and checks that each page reflows at 320 px
without sideways scrolling. On 2026-10-13 it found no violations.

### Responsive

Verified at **360, 375, 768 and desktop**, across all three tabs plus the legal
and 404 pages, in both themes: no horizontal overflow, no pointer target under
24px, no text under 12px.

Two decisions worth knowing if you edit the breakpoints:

- **Touch sizing keys off `(pointer: coarse)`, not width.** A tablet at 768px is
  still a finger and a narrow desktop window is still a mouse; sizing by
  viewport width gets both wrong.
- **The 24px minimum is applied at every size, not just on mobile.** WCAG 2.2
  target size is not a phone-only rule — a 20px checkbox fails on desktop too.

The mobile media queries live at the **end** of the stylesheet on purpose. They
override component rules, and CSS resolves ties by source order — placed
mid-file they silently lost to anything defined below them.

### Images and alt text

There are **no `<img>` tags** in the app — every graphic is inline SVG or CSS,
so there is no `alt` attribute to set. The equivalent was done instead:

- Decorative SVG (the checkbox tick, the ledger meter bars) is `aria-hidden`,
  because the surrounding control or text already carries the meaning
- Informative graphics use `role="img"` with a label that carries the **data**,
  not a description of the picture. The completions heatmap announces
  *"2 items across 1 day. Busiest day: 2"* rather than "a heatmap"
- The social preview images have `og:image:alt` and `twitter:image:alt`
- `favicon.svg` carries `role="img"` and a label

Audited against the live DOM with data loaded: 0 images missing alt, 0 unlabelled
SVGs, 0 `role="img"` without a label, 0 controls without an accessible name.

---

## Layout

```
server/
  index.js          Routes
  sources.js        Adzuna, USAJOBS, Muse, Remotive, Jobicy
  rank.js           Merge, dedupe, filter, score
  fields.js         Major detection and track assembly
  deeplinks.js      Search URLs for the no-API sites
  suggest.js        Optional Claude suggestions + URL checking
  guard.js          Rate limiting, input cleaning, SSRF guard
  owner.js          Owner-only auth for Stats
  store.js          SQLite with JSON fallback
  data/             certifications.json · tracks.json
client/src/
  App.jsx  Finder.jsx  Ledger.jsx  Stats.jsx  Legal.jsx
  ConsentBanner.jsx  consent.js  api.js  styles.css
scripts/
  verify-catalog.js
```

## Design

Direction set with the **ui-ux-pro-max** skill: *Minimalism & Swiss Style*
(returned consistently across two independent queries) with an institutional
palette — navy `#1E3A5F` and a research accent — which the skill's colour
domain returned for "education / university / institutional trust".

The skill's suggested *page pattern* was deliberately ignored. It returned
landing-page structures (Portfolio Grid, then Funnel) that describe a marketing
page, not a tabbed tool, so only the style, palette and typography were taken.

**Type:** EB Garamond for headings (institutional register), Source Sans 3 for
body — Garamond is not legible enough at 15px to set body copy — and IBM Plex
Mono kept for numbers, where tabular figures genuinely help scanning. Every
family has a system fallback, so declining the font consent costs nothing
structural.

880px max width, 4px radii, one spacing scale, no gradients. Light and dark
follow the system; the header toggle cycles system → light → dark.

### Contrast is verified, not assumed

```bash
npm run contrast
```

Checks every foreground token against the surfaces it actually renders on, in
both themes, and exits non-zero on a failure. Change the palette there first,
then in `styles.css`.

Two tokens exist for borders, for a reason: `--rule` is the decorative hairline
between rows, and `--field-border` is for input and control boundaries. WCAG
1.4.11 requires 3:1 for **UI component boundaries** but not for decorative
separators, so only the latter is held to it — darkening every divider to 3:1
would make the page heavy for no accessibility gain.

`.claude/skills/` holds the **ui-ux-pro-max** skill from
<https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>, used for the
accessibility pass. It needs Python 3:

```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py "focus keyboard contrast" --domain ux
```
