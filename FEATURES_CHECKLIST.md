# Features checklist

Everything the site does today, recorded on 2026-10-05 at commit `2754412`, before the visual remodel. After the remodel, every item is checked again. Nothing may be removed, hidden or broken.

**Premium is switched off** (since 2026-10-13, `server/data/features.json`). Its items below — the Premium link, card, badge, daily alert, sample answers, Recruiting Kit and `/premium` — apply only when it is switched back on.

**How to use it:** tick each box only after testing that item on the remodeled site at 375px, 768px and 1440px wide, in light and dark mode.

## 1. Pages and addresses

### React app (client/src/App.jsx)
- [ ] `/`: tabs screen with Finder, Ledger, Applications (tracker) and Stats; roving-tabindex tablist; arrow, Home and End keys
- [ ] Ledger tab shows a done/total badge; Applications tab shows the tracked-job count
- [ ] Page-links row: Premium, Sponsor, Internships by major, Certifications by major (opens in-app), Career guides
- [ ] `/home`: kinetic landing page (Nav, Ticker, Hero, Internships, Certifications, Portal, Footer)
- [ ] `/account`: Account page
- [ ] `/verify?token=` and `/reset?token=`: AccountLink screens
- [ ] `/terms` and `/privacy`: Legal pages with "← Back to the app"
- [ ] `/certifications`: major index; `/certifications/<major>`: MajorPage; unknown major shows "No such major"
- [ ] Unknown path: NotFound page with a 404 status
- [ ] Sign-in overlay (`showAuth`), with no address change
- [ ] Browser back and forward work across every screen
- [ ] Each route's title, description, canonical and robots (PAGE_META; MajorPage sets its own)
- [ ] On screens with their own heading, the masthead line is a div instead of an H1, and the footer adds Certifications, Internships, Career guides, Premium and Sponsor

### Address parameters
- [ ] `?add=1&url=&title=&company=&location=` (browser extension) opens Applications with the Add form prefilled
- [ ] `?tab=finder|ledger|tracker|stats` opens that tab (manifest shortcuts, notification links)
- [ ] `?major=<name>` seeds the Finder major
- [ ] `?ref=<code>` is stored for 30 days (`el-ref`) and sent with sign-up
- [ ] `?paid=<session>` and `?canceled=1` on `/account` confirm Premium or show "Payment canceled"
- [ ] `/account#alerts` scrolls to the daily alert section
- [ ] The parameters above are stripped from the address bar afterwards (except on `/account`)

### Server-built pages (server/content.js; React doesn't run on these)
- [ ] `/internships` hub and `/internships/<major>`: sponsored mini-list, recent listings, roles, skills, timeline, starter certs, resume keywords, FAQs, guides, other majors, CTA to `/?major=`
- [ ] `/career-guides` and `/career-guides/<slug>`
- [ ] `/interview-questions` and `/interview-questions/<field>`: sample answers for Premium; locked teaser otherwise
- [ ] `/how-it-works`
- [ ] `/accessibility`, the accessibility statement (no ads), linked from both footers
- [ ] `/sponsor`, with the sponsored-listing form (only when payments are on) posting to `/sponsor/checkout`
- [ ] `/premium`, with its call-to-action to `/account`
- [ ] Shared shell: skip link, brand, nav (Find internships, Internships by major, Certifications, Career guides), breadcrumb, footer links, Google preferred-source pill, footer note (changes with ads on/off)
- [ ] `/certifications*` pages are sent server-rendered (`.ssr-major`), then React replaces them; the content must match for SEO

### Server utility pages
- [ ] `/owner`: passcode login and dashboard (visits, sources, pages, job sources, Sales, Premium funnel, Sponsored listings with approve/reject/end, Referral codes, Site health, By day, Lock this page)
- [ ] `/unsubscribe?t=`: button, then a confirmation
- [ ] `/sponsor/thanks?session_id=` and the sponsor form's error page
- [ ] `/go/s/:id`: sponsored click redirect
- [ ] 301 redirects (`/tracker`, `/pricing`, `/upgrade`, `/about`, …), lowercase and trailing-slash redirects
- [ ] `/images/*.svg`, `/ads.txt`, `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `/.well-known/assetlinks.json`, IndexNow key
- [ ] `/offline.html` (shown by the service worker when offline)

## 2. Global shell
- [ ] Masthead eyebrow, title and lede
- [ ] Signed in: Premium badge, name or email linking to `/account`, Sign out. Signed out: Sign in
- [ ] Theme button cycles System → Light → Dark and remembers the choice (`cl-theme`)
- [ ] Guest notice on non-Finder tabs with "Save it to an account"
- [ ] After sign-in, a notice reports imported guest items, with Dismiss
- [ ] SEO section under the Finder (heading, paragraphs, figure, steps, FAQs)
- [ ] Footer: Terms, Privacy, Interview questions, How it works, Send feedback (mailto), Font settings, Google preferred source, Install app, ads note
- [ ] Font-consent banner (Allow Google Fonts / Use system fonts / Privacy link); Font settings reopens it
- [ ] Confetti on offer and applied (big and small) and on ledger completion; off under reduced motion
- [ ] Error-boundary fallback screen

## 3. Finder
- [ ] Recent searches (last 5, one-click rerun; `cl-recent-searches`)
- [ ] ZIP: digits only, 5 long, live "✓ looks good" or error; Radius 10/25/50/100 (default 50)
- [ ] Major with a 23-major suggestion list and 6 quick-pick chips
- [ ] Interests: Enter or comma adds; chips with ×; "N of 12 added"; 9 idea chips including "search fund"
- [ ] Class year (optional)
- [ ] Honeypot field and 1-second bot trap
- [ ] Search button with busy state; "Suggest more" (only when enabled); error alert; focus moves to the first invalid field
- [ ] Loading skeleton
- [ ] Starter track card: name, note, recruiting timeline (expandable), "Add all N to Ledger" or "already in your ledger", links to the certifications and internship guide
- [ ] Results header with place, radius and count
- [ ] Weekly email opt-in (signed out: "Sign in to turn it on"; disabled until the email is verified; "Send the confirmation link")
- [ ] "Also search" LinkedIn, Handshake and Indeed, plus "N more sites ↓"
- [ ] Filters: Season (with counts), Where (all/onsite/remote), Sort (best/newest/closest)
- [ ] Sponsored listings above results, labeled Sponsored, Apply via `/go/s/:id`, Save
- [ ] Job cards: badges (new, underclass, remote, source), description, distance, posted age, matched keywords, "also on"
- [ ] Apply ↗ (records the click), ☆ Save / ✓ Stage (opens Applications), Report (mailto), "Mark as applied"
- [ ] Show more (25 at a time); empty states; Clear filters
- [ ] Adzuna attribution; source notes
- [ ] Free certifications section: affiliate note, rows with Open ↗, "+ Add to Ledger" / "✓ In ledger", cost tag, hours, price note
- [ ] "Search these directly" deep-link groups: Search funds (only when asked for), Major boards, Government, Student-focused, Finance, Startups and nonprofits, Experience instead of a posting
- [ ] Suggested by Claude, with "+ Verify and add"

## 4. Ledger
- [ ] Empty state with "Go to the Finder"
- [ ] Meter: X of N complete, hours left and total, tick strip
- [ ] Group sections with done/total
- [ ] Row: checkbox (role=checkbox), title, provider, description, links, cost tag, hours, done date, price note, × remove
- [ ] When done: "Add to LinkedIn profile ↗" and "Share on LinkedIn ↗" (not for reference items)
- [ ] "Clear all marks" with inline confirm

## 5. Applications (Tracker)
- [ ] Stages saved → applied → interviewing → offer, plus closed
- [ ] Empty state and the Add form
- [ ] Meter with per-stage counts
- [ ] Add form: URL, title, company, location, source (auto-detected), deadline, stage; validation and duplicate check
- [ ] Coming up (14 days, overdue kept) with "Add all to calendar ↓" (.ics)
- [ ] Reminders toggle (signed in) or sign-in prompt
- [ ] Per-stage sections sorted by next date
- [ ] Card: date chips (soon and overdue tones), note view and editor (500 max), "Move to <next> →", stage select, Posting ↗, + Note, + Dates (date and datetime-local), Add to calendar ↓, Remove, tracked/updated stamps

## 6. Stats
- [ ] Application stats: 4 cards and "Open Applications →"
- [ ] Certification stats: 3 cards, progress-by-group bars, 84-day heat strip (both with accessible labels)
- [ ] Recently completed; patterns (searched terms, providers); disclaimer
- [ ] Empty state and the applications-only state; guest stats computed locally
- [ ] The legacy owner-passcode form on a 401 (keep it as it is)

## 7. Account
- [ ] Signed-out prompt
- [ ] Name, email and notice banner
- [ ] Premium card: price, benefits, "Get Premium — $9.99" (Stripe), "purchases open soon" when off, test-mode note; when owned: until date, Recruiting Kit download, "Add six more months"
- [ ] Notifications: on/off for this device, device count, test notification, iOS guidance
- [ ] Daily new-internship alert (Premium): toggle and the latest alert list
- [ ] Your data: Download JSON, Download spreadsheet (CSV), Sign out
- [ ] Change password (hidden for Google-only accounts)
- [ ] Delete my account (type your email to confirm)

## 8. Sign in and account links
- [ ] Login, sign-up (name, email, password) and forgot-password modes; per-field errors with focus; honeypot; referral sent
- [ ] Guest data imported after sign-in
- [ ] Verify email (runs automatically once): working, done or error
- [ ] Reset password: new and confirm (10+ characters, must match), then signed in

## 9. Certifications by major (MajorPage)
- [ ] Index: heading, SEO block, "Pick your major" grid with counts, FAQs
- [ ] Major: "← All majors", count, heading, note, "Find <major> internships", internship guide link, "Add the starter set to Ledger" or badge
- [ ] Guide intro, figure, "How to choose", recruiting timeline
- [ ] Cost filter (any, free, free to audit, under $100) and Time filter (any, <10, <20, <50 hours), with live counts
- [ ] "Showing X of Y · Clear filters" (live region); empty-match message
- [ ] Starter set and "More for <major>" rows with Open ↗ and Add to Ledger; FAQs; affiliate note

## 10. Kinetic landing page (/home)
- [ ] Nav: skip link, tablist (Finder, Ledger, Stats), sliding indicator, condenses on scroll, Sign in/out, theme toggle
- [ ] Ticker (pauses on hover or focus, static under reduced motion, screen-reader list)
- [ ] Hero ZIP form that hands the ZIP to the Finder; "Browse certifications" opens the Ledger tab
- [ ] Internships section; Certifications track switcher with 6 previews and "Add this track to my ledger"
- [ ] Portal: signed-in stats or the sign-up pitch
- [ ] Footer: Terms, Privacy, Certifications by major, Internships by major, Career guides, feedback, preferred source, Install app

## 11. Other components
- [ ] Install app button (prompt on Android and desktop; instructions on iOS; hidden when installed)
- [ ] Legal pages load the contact email and the ads flag
- [ ] NotFound: path shown, "Go to the Finder", suggested links

## 12. Ads and Premium
- [ ] Auto ads only on content pages (`/internships*`, `/career-guides*`, `/interview-questions*`, `/how-it-works`); never in the React app, `/premium` or `/sponsor`
- [ ] No ads for Premium members; footer wording follows the ads setting
- [ ] Premium sample interview answers and the Recruiting Kit download

## 13. Data and offline
- [ ] localStorage keys keep the same names and shapes: `cl-theme`, `cl-consent`, `cl-recent-searches`, `cl-guest-ledger`, `cl-guest-tracker`, `el-ref`
- [ ] The session cookie `cl_session` is unchanged
- [ ] Guest mode works for the ledger, tracker and stats without an account
- [ ] Service worker: network-first pages with the offline fallback, cached assets, push notifications, notification click opens the right page
- [ ] Manifest: standalone display, icons, the three shortcuts
- [ ] Browser extension: popup reads the job and opens `/?add=1…`

## 14. Accessibility
- [ ] Skip links (app, kinetic, server pages)
- [ ] One H1 per page; visible focus ring on every control
- [ ] Field errors: role=alert, aria-invalid, aria-describedby
- [ ] aria-busy on search; live regions for the filter count and notices
- [ ] Labelled groups, checkboxes, chart images and the stage select (sr-only label)
- [ ] Reduced motion turns off ripple, confetti, reveals, marquee and transitions
- [ ] Targets: 44px tabs and page links (to become at least 44px everywhere)
- [ ] axe-core audit (test suite `a11y-check.mjs`): no WCAG 2.2 A/AA violations on any page or state, both themes; every page reflows at 320px

## Known issues found during the audit

These are recorded so the remodel neither breaks nor silently "fixes" them. Each one needs your decision before it changes.

1. Google sign-in works on the server, but there's no button for it in the app, and the `?auth=` result after Google sign-in isn't shown.
2. `/home` has no font-consent banner or Font settings, no Applications tab, no account link, and fewer footer links than the main app.
3. Stats still has an old owner-passcode form that only appears if a session expires.
4. The owner page's "Lock this page" button uses `btn-ghost`, a style that doesn't exist, so it looks like a primary button.
5. The Privacy Policy doesn't mention three browser-storage keys: `cl-consent`, `cl-guest-ledger` and `cl-guest-tracker`.
6. A saved light or dark choice briefly shows the system theme before the app loads, and the browser's theme color doesn't follow a manual switch.
7. The page's security rules allow scripts, images and fonts only from the site itself, plus Google Fonts. The remodel must not need anything from other sites.
