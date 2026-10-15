# Putting Career Launchpad on elevateinternships.com

Everything that can be written down is already in the repo: `render.yaml`
defines the service, health check, domains and environment, and the
`Dockerfile` covers every other host. What is left is the part only you can
do — creating accounts, entering secrets, and pointing DNS.

**Time:** about 30 minutes, most of it waiting for DNS.
**Cost:** nothing beyond the domain. The site runs on Render's free plan; the
database is kept in Cloudflare Workers KV (free tier) so accounts survive the
free plan's restarts; Resend's free tier covers password-reset email.

**The free plan's trade-off:** the site sleeps after 15 minutes with no
visitors, and the next visit waits about a minute while it wakes. Fine for a
portfolio link. If real users start relying on it, see *Moving to a paid
plan* at the end.

---

## Before you start: have these ready

| What | Where | Why |
|---|---|---|
| The repo on GitHub | see step 1 | Render deploys from it |
| A Resend API key | [resend.com](https://resend.com) → API Keys | Without it, password-reset links go to the server log and never reach anyone |
| An address for privacy requests | any inbox you read | The privacy page prints it; without it, the rights the policy promises cannot be exercised |
| A Cloudflare KV namespace and API token | step 2 | Where the database lives between restarts |

---

## 1. Push the code to GitHub

It is committed locally already. Create an **empty** repository on GitHub
(private is fine, and don't let it add a README), then:

```bash
git remote add origin https://github.com/<you>/career-launchpad.git
git push -u origin main
```

Git for Windows opens a browser to sign you in the first time.

---

## 2. Create the Cloudflare storage

In the Cloudflare dashboard:

1. **Storage & Databases → Workers KV → Create a namespace.** Name it
   `career-launchpad-db`. Copy its **ID**.
2. Your **Account ID** is on the account home page (right-hand column, or in
   the URL after `dash.cloudflare.com/`).
3. **My Profile → API Tokens → Create Token → Create Custom Token.**
   - Name: `career-launchpad-render`
   - Permissions: **Account · Workers KV Storage · Edit**
   - Account Resources: your account only

   Create it and put the token straight into your password manager. Cloudflare
   shows it once.

The token can read and write KV in your account and nothing else — no DNS, no
billing, no domains.

---

## 3. Create the site from the Blueprint

1. Sign in to [render.com](https://render.com) with GitHub.
2. **New → Blueprint**, choose the repository.
3. Render reads `render.yaml` and asks for six values:

   | Prompt | Enter |
   |---|---|
   | `OWNER_PASSCODE` | a long passphrase you will remember — it unlocks the Stats page |
   | `CONTACT_EMAIL` | the privacy-request address from above |
   | `RESEND_API_KEY` | the key from Resend |
   | `CF_ACCOUNT_ID` | from step 2 |
   | `CF_KV_NAMESPACE_ID` | from step 2 |
   | `CF_API_TOKEN` | from step 2 |

   Everything else is set for you, including a generated `OWNER_SECRET`.
4. **Deploy Blueprint.** It builds and deploys — a few minutes.

What the Blueprint sets up so you don't have to:

- **Build** `npm ci --include=dev && npm run build`, **start** `npm run serve`.
  The `--include=dev` matters: `NODE_ENV` is already `production` at build
  time, which makes a plain `npm ci` skip Vite.
- **One instance only** — SQLite wants a single writer, and two copies would
  overwrite each other's saves in Cloudflare.
- **Health check** on `/api/health`, so a bad deploy never replaces a good one.

What `server/cloudsave.js` does with the three `CF_*` values:

- On boot, downloads the saved database before anything opens it. If the
  download fails, the server **refuses to start** rather than start empty and
  then save an empty database over the real one. Render retries.
- Uploads the database within two minutes of any change, and once more when
  Render stops the server (sleep, redeploy, restart).
- Keeps one dated copy a day under `backup/launchpad-YYYY-MM-DD.db`, which
  Cloudflare deletes after 14 days.

---

## 4. Read the first boot log

**Logs** tab. You want these lines:

```
[cloudsave] no saved copy yet — starting with an empty database
[api] http://localhost:10000  storage=sqlite  catalog=200  tracks=14
[security] mode=production  https=enforced
[cloudsave] on — database is copied to Cloudflare KV every 2 minutes when it changes
```

On every later boot the first line reads `[cloudsave] restored NN KB from
Cloudflare KV` instead.

Any line starting `[security] WARNING` names a setting that is missing and
says what breaks without it. `[cloudsave] FATAL` or `FAILED` means the `CF_*`
values are wrong — usually the token's permission. If the deploy fails
mentioning `better-sqlite3`, the app has refused to fall back to a store that
loses writes — that is deliberate; see *If something breaks*.

---

## 5. Try it on the Render address

Before touching DNS, use the `https://career-launchpad-xxxx.onrender.com`
address Render shows you:

- [ ] Search a ZIP code — results come back with distances
- [ ] Create an account, add a track, tick something off
- [ ] Sign out, use **Forgot password**, and confirm the email arrives
- [ ] Open `/privacy` — your contact address appears as a link
- [ ] **Manual Deploy → Restart service**, wait for it, and sign in again.
      This is the test that the Cloudflare copy works.

---

## 6. Point the domain (Cloudflare DNS)

The Blueprint already attached `elevateinternships.com` and `www.` to the
service. **Settings → Custom Domains** shows the records to add. In Cloudflare,
**DNS → Records**:

| Type | Name | Value | Proxy |
|---|---|---|---|
| `CNAME` | `www` | `career-launchpad-xxxx.onrender.com` | **DNS only** |
| `A` or `CNAME` | `@` | what Render shows for the apex | **DNS only** |

Use exactly what Render displays — it is the source of truth.

**Leave the cloud grey (DNS only).** With Cloudflare's proxy on, every visitor
appears to come from a Cloudflare address, so the sign-in rate limiter would
lump everyone together, and Render cannot issue its certificate.

Render issues the HTTPS certificate once DNS resolves — usually minutes,
occasionally an hour. The canonical URLs, sitemap and social-preview tags
already point at `https://elevateinternships.com`, so nothing else changes.

---

## 7. Verify the live domain

```bash
curl -sI http://elevateinternships.com         | head -1   # 301 → https
curl -sI https://elevateinternships.com        | head -1   # 200
curl -sI https://elevateinternships.com/nope   | head -1   # 404
curl -s  https://elevateinternships.com/api/health          # {"ok":true,...}
```

Then repeat the step-5 checklist on the real domain.

---

## 8. Before you tell anyone about it

- [ ] Have someone qualified read `/terms` and `/privacy`. You hold email
      addresses now; depending on who signs up, GDPR or CCPA may apply.
- [ ] Decide who, if anyone, gets `OWNER_PASSCODE`.
- [ ] Run `npm run verify-catalog` locally — course links rot over time.

---

## Day to day

| Task | How |
|---|---|
| Ship a change | `git push` — Render redeploys automatically. Writes in the last two minutes before a redeploy can be lost, so avoid deploying while people are active |
| Activity spreadsheet | Cloudflare → Workers KV → `career-launchpad-db` → download `launchpad.db` into your local `data/`, then `npm run report` |
| Restore an older day | Download `backup/launchpad-YYYY-MM-DD.db` and upload it over `launchpad.db` in the same namespace, then restart the service on Render |
| Optional: more listings | Render → Environment: add `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (free at developer.adzuna.com) |
| Keep a copy off Cloudflare (monthly) | Put `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID` and `CF_API_TOKEN` in a local `.env`, then `npm run backup:download`. It saves a checked copy to Documents → Elevate Internships backups. `-- --list` shows the daily copies; `-- --daily 2026-09-20` downloads one |
| Turn on payments | Create a Stripe account, then Render → Environment: `STRIPE_SECRET_KEY` (start with `sk_test_…`). In Stripe → Developers → Webhooks add `https://elevateinternships.com/api/stripe/webhook` with `checkout.session.completed` and `charge.refunded`, and set its secret as `STRIPE_WEBHOOK_SECRET`. Test with card 4242 4242 4242 4242, then switch both to live values |
| Show ads (after AdSense approval) | In AdSense publish the EEA/UK consent message, then Render → Environment: `ADSENSE_ADS=on` |
| Review sponsored listings | `/owner` → Sponsored listings → Approve, or Reject (refunds automatically) |

---

## Moving to a paid plan

When the minute-long wake-up starts to matter: in `render.yaml` set
`plan: starter`, add the disk back —

```yaml
    disk:
      name: data
      mountPath: /opt/render/project/src/data
      sizeGB: 1
```

— and add `BACKUP_EVERY_HOURS=24`. Keep the `CF_*` values for the first
deploy so the database is restored onto the new disk, then remove them. About
$7.25 a month. See [BACKUPS.md](BACKUPS.md) for backups on a disk.

---

## Not using Render

The `Dockerfile` works on Fly.io, Railway (*deploy from Dockerfile*), or any
VPS. The rules are the same everywhere:

- Either mount a persistent volume at **`/app/data`**, or set the three `CF_*`
  values so the database is kept in Cloudflare
- Run **one** instance
- Set `NODE_ENV=production`, `TRUST_PROXY=1`, `OWNER_PASSCODE`,
  `OWNER_SECRET`, `CONTACT_EMAIL`, `RESEND_API_KEY`
- Health check `GET /api/health`

**Do not use Vercel, Netlify or Cloudflare Pages.** They run no long-lived
server, which this app needs.

---

## If something breaks

| Symptom | Cause |
|---|---|
| Build fails: `vite: not found` | Build command lost `--include=dev` |
| Deploy fails mentioning `better-sqlite3` | Native module could not load. On Render, confirm `NODE_VERSION=22`. The app refuses the JSON fallback in production on purpose |
| `[cloudsave] FATAL: … HTTP 403` | The API token lacks *Workers KV Storage · Edit*, or is for another account |
| `[cloudsave] FATAL: … HTTP 404` or `10013` | `CF_KV_NAMESPACE_ID` or `CF_ACCOUNT_ID` is wrong |
| Accounts vanish after the site sleeps | The `CF_*` values are missing — the log has no `[cloudsave] on` line |
| Redirect loop | `TRUST_PROXY` missing |
| Signed out on every refresh | `NODE_ENV` is not `production`, so the cookie is not marked `Secure` |
| Reset emails never arrive | Resend key wrong or domain not verified — the log contains the link that would have been sent |
| Certificate never issues | The Cloudflare record is proxied (orange cloud). Set it to DNS only |
