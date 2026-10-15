import React, { useEffect, useState } from 'react';
import { PREMIUM_ENABLED } from './features.js';

/**
 * The operator's contact address, from CONTACT_EMAIL on the server. Fetched at
 * runtime so the host can set or change it without a rebuild. While it loads,
 * or if it was never set, the sentence still reads correctly — it just cannot
 * offer a link.
 */
function useSite() {
  const [site, setSite] = useState({ contactEmail: null, ads: false });
  useEffect(() => {
    let live = true;
    fetch('/api/site')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setSite({ contactEmail: d.contactEmail || null, ads: Boolean(d.ads) });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return site;
}
const useContactEmail = () => useSite().contactEmail;

function Contact({ email }) {
  return email ? <a href={`mailto:${email}`}>{email}</a> : <>the operator of this site</>;
}

const UPDATED = 'October 13, 2026';

/* These describe what this codebase actually does. If you change how data
   moves — add analytics, a hosted backend, accounts — update these too. */

function Privacy() {
  const { contactEmail, ads } = useSite();
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-date">Last updated {UPDATED}</p>

      <div className="legal-callout">
        <strong>The short version.</strong>{' '}
        {ads
          ? 'The app itself has no advertising and no tracking cookies; some guide pages show ads from Google, which uses its own cookies (see section 4). There are no third-party analytics —'
          : 'There is no advertising, no tracking cookies, and no third-party analytics —'}{' '}
        the site only counts its own page views, without cookies or IP addresses. Creating an
        account stores your email address and a hashed password; searching works without one. Your ZIP code never
        leaves the server. You can export everything you have saved, and delete your account outright, at any time.
      </div>

      <h2 className="legal-section">1. Who runs this</h2>
      <p>
        Elevate Internships is operated by whoever runs this site — the person or group who deployed it at this domain.
        They control the server and the database it writes to, and they are the data controller for anything described
        below. The source is also published for anyone who wants to run their own private copy instead; this policy
        describes the hosted one you are using now.
      </p>

      <h2 className="legal-section">2. What is stored, and where</h2>
      <p>
        Data is written to a database on the server (SQLite, or a JSON file in small deployments). What it holds
        depends on whether you have an account.
      </p>
      <p>
        When the server has no permanent disk of its own, the operator can have it keep that database in{' '}
        <strong>Cloudflare Workers KV</strong> instead, so accounts survive a restart. A copy is saved there within a few
        minutes of any change, and one dated copy a day is kept for 14 days as a backup. Cloudflare stores these
        copies for the operator and does not use them for anything else.
      </p>
      <p>
        <strong>Without an account</strong>, nothing about you is stored on the server. Your ledger and any
        internships you track live in your own browser's <code>localStorage</code> and never leave it — which also means they do not follow you to another
        device, and clearing site data erases them.
      </p>
      <p>
        <strong>With an account</strong>, the server stores:
      </p>
      <ul>
        <li>Your email address, and your name if you chose to give one</li>
        <li>
          A hash of your password — scrypt, salted, never the password itself. It cannot be reversed back into your
          password.
        </li>
        <li>Certifications you added to your ledger, and which you marked complete, with the date</li>
        <li>Which starter tracks you began</li>
        <li>Your recent searches — ZIP code, major, and interests</li>
        <li>Session records, so signing in on one device does not sign you out on another</li>
        <li>
          How many times you have signed in, and when you last did. A count and a date — not a record of each
          individual visit.
        </li>
        <li>
          Internships you opened an apply link for, with the job title and company. This is used to show you what you
          have already applied to, and to count activity across the site. Opening the same posting twice is recorded
          once.
        </li>
        <li>
          Internships you save to the Applications tracker: the job title, company, location and link, the stage you
          set (saved, applied, interviewing, offer or closed), any note you write, the application deadline and
          interview time you enter, your time zone (so reminders arrive on the right day), when you first marked it
          applied, and when you last changed it. Only you can see these, and they are included in your data export.
        </li>
        <li>
          Whether you turned on reminder emails. They are off unless you switch them on in the Applications tab. When
          on, the day before a deadline or interview you get one email listing what is due, sent through the email
          provider named below; turn them off there at any time.
        </li>
        <li>
          If you turn on notifications: for each browser, the address its push service gave it and the keys used to
          encrypt messages to it. They are deleted when you turn notifications off there, or when the browser says the
          address no longer works.
          {PREMIUM_ENABLED &&
            " Premium's daily alert also keeps which listings it has already sent you and the last few it sent, so they can be shown on your account page."}
        </li>
        {PREMIUM_ENABLED && (
          <li>
            If you buy Premium: the date, the amount, whether it was refunded, and the date Premium runs until. Card
            details go straight to Stripe and never reach this site.
          </li>
        )}
        <li>
          If you arrived through a referral link (for example from a campus ambassador), the referral code, recorded
          once when you create your account.
        </li>
        <li>
          Whether you turned on the weekly new-internships email, and if so, which listings it has already sent you
          (so none is sent twice) and when it last ran. It is off unless you switch it on under a search in the Finder,
          and it is only sent to an address you have confirmed. Each email has a link to stop it, which works without
          signing in.
        </li>
      </ul>
      <p>
        Your data is kept separate from every other account. Nobody else who signs in can see your ledger, your
        searches or your progress.
      </p>
      <p>
        Your browser additionally stores two <code>localStorage</code> values: <code>cl-theme</code>, remembering
        whether you chose light, dark, or system, and <code>cl-recent-searches</code>, your last five searches (ZIP
        code, radius, major and interests) so you can run them again in one click. Neither leaves your browser. If you
        open a referral link, a third, <code>el-ref</code>, holds its code for 30 days so it can be sent with the
        sign-up form; it is not sent anywhere else.
      </p>
      <p>
        <strong>One cookie is set, and only after you sign in:</strong> <code>cl_session</code>, which holds a random
        session token. It is <code>HttpOnly</code> (JavaScript cannot read it), <code>SameSite=Lax</code>, and expires
        after 30 days. It is strictly necessary to keep you signed in — it is not used for tracking or analytics, and
        nothing is set at all while you are signed out.
      </p>
      <p>
        To erase everything, delete your account from the account page (which also signs you out), and clear this
        site's storage in your browser.
      </p>

      <h2 className="legal-section">3. What is sent to other services</h2>
      <p>When you run a search, the server queries job boards on your behalf. Each receives your search terms:</p>
      <ul>
        <li>
          <strong>The Muse, Remotive, Jobicy</strong> — always queried; they need no key. They receive your location
          and keywords.
        </li>
        <li>
          <strong>Greenhouse, Lever, Ashby and SmartRecruiters</strong> — the public job boards of individual
          employers. These receive nothing about your search: each board is fetched whole and filtered on this server.
        </li>
        <li>
          <strong>Simplify and Himalayas</strong> — a public internship list and a remote-jobs feed. These receive
          nothing about your search either: each is fetched about once an hour and filtered on this server.
        </li>
        <li>
          <strong>Adzuna</strong> — only if the operator has set an API key. Receives your location, radius, and
          keywords.
        </li>
        <li>
          <strong>USAJOBS</strong> — only if the operator has set an API key. Receives your location and keywords.{' '}
          <em>
            Note: the USAJOBS API requires the email address you registered with to be sent as the request's
            User-Agent header. If USAJOBS is enabled, the operator's email is transmitted with every query — never yours.
          </em>
        </li>
        <li>
          <strong>Anthropic</strong> — only if the operator has set <code>ANTHROPIC_API_KEY</code> and you press “Suggest more.” Your
          major, interests, and class year are sent to the Claude API.
        </li>
      </ul>
      <p>
        These requests are made by the server, not by your browser, so the job boards see the server's IP address
        rather than yours. They do receive the words you searched for. Their handling of that is governed by their
        privacy policies, not this one. API keys stay on the server and are never sent to the browser.
      </p>
      <p>
        <strong>Your ZIP code is never sent to a third party.</strong> The app ships a complete table of US postal
        codes and cities, so turning your ZIP into coordinates and measuring the distance to a listing happens on the
        server with no lookup request to any geocoding service.
      </p>
      <p>
        The server keeps ordinary web-server logs, which typically include your IP address, the page requested and the
        time. These are operational records for security and debugging, not analytics, and they are not combined with
        your account to build a profile.
      </p>
      <p>
        <strong>Page-view counts.</strong> The server keeps a daily tally of how many pages were loaded, which pages
        they were, and the site that linked here (only its name, such as <code>linkedin.com</code>, or the{' '}
        <code>utm_source</code> tag in the link). It does not store your IP address, your browser's details, or
        anything else that identifies you or tells one visitor from another; no cookie is set for it and no outside
        analytics service is involved. Automated visitors are left out. The tallies are kept for 120 days and only the
        operator can see them.
      </p>
      <p>
        <strong>Error reports.</strong> If a page hits a programming error, your browser sends the error message, the
        page's path (such as <code>/account</code>) and where in the site's code it happened, so it can be fixed. Nothing
        you typed and nothing that identifies you is included. The server keeps the 60 most recent errors, and only the
        operator can see them.
      </p>
      <p>
        <strong>Notifications.</strong> If you turn them on, reminders and alerts are delivered by your browser maker's
        push service — Google for Chrome and Edge on Android, Microsoft for Edge on Windows, Mozilla for Firefox, Apple
        for Safari. The message is encrypted so the push service cannot read it; it sees only that a notification was
        sent to your browser. Turn them off on the account page or in your browser at any time.
      </p>
      <p>
        <strong>Payments.</strong> {PREMIUM_ENABLED ? 'Premium and sponsored listings are' : 'Sponsored listings are'} paid through <strong>Stripe</strong>, on Stripe's own
        page. Stripe receives your card details and email address and handles them under its own privacy policy; this
        site receives only whether the payment went through, the amount and a payment reference.
      </p>
      <p>
        Password-reset and address-confirmation emails, and reminder emails if you turn them on, are sent through an
        email delivery service (Resend, or another provider the operator chooses). It receives your email address and
        the message, and only when you ask for one of those emails. A reminder names the internships due the next day.
        The weekly new-internships email, if you turn it on, lists new listings that match your most recent search;
        it goes only to a confirmed address, and every one has a link to stop it.
      </p>

      <h2 className="legal-section">4. Google Fonts{ads ? ' and Google ads' : ''}</h2>
      <p>
        The interface is designed around EB Garamond, Source Sans 3 and IBM Plex Mono, served by Google Fonts. Loading
        them means your browser requests files from <code>fonts.googleapis.com</code> and{' '}
        <code>fonts.gstatic.com</code>, which discloses your IP address and user-agent to Google.
      </p>
      <p>
        <strong>That request is only made if you allow it.</strong> The first time you visit, a banner asks. Choose
        system fonts and Google is never contacted — the page uses fonts already on your device instead, and nothing
        else changes. You can change your answer later from the Font settings link in the footer of the main app.
      </p>
      {ads && (
        <p>
          <strong>Ads.</strong> Some guide and information pages ({PREMIUM_ENABLED ? 'not the app, and never for Premium members' : 'not the app'}) show ads
          served by Google AdSense. Google and its partners use cookies and similar technology to show those ads and to
          measure them, which can include ads based on your visits to this and other sites. You can turn off
          personalized ads at{' '}
          <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
            Google's Ads Settings
          </a>{' '}
          and read how Google uses data at{' '}
          <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">
            policies.google.com/technologies/partner-sites
          </a>
          . Visitors in the European Economic Area, the UK and Switzerland are asked for consent first.
        </p>
      )}

      <h2 className="legal-section">5. Links to other sites</h2>
      <p>
        Apply buttons and the “Search these directly” panel open LinkedIn, Handshake, Indeed, SimplyHired, USAJOBS,
        the Virtual Student Federal Service, WayUp, RippleMatch, Chegg Internships, and Forage. Nothing is sent to those
        sites until you click. When you do,
        the link carries your search keywords and location in the URL, and your browser may send a referrer. Once you
        are on their site, their terms and privacy policies apply.
      </p>
      <p>
        <strong>Affiliate links.</strong> Some links to paid certifications may be affiliate links. If you pay for a
        course after clicking one, this site may earn a commission from the provider, at no extra cost to you. The
        link carries a code that tells the provider (or its affiliate network) the visit came from here; the provider
        may set its own cookies on its site, and its privacy policy applies. Nothing about your account is shared.
        Commissions never affect which certifications are listed or how they are ranked, and each page with such a
        link says so.
      </p>
      <p>
        If you are signed in, pressing <strong>Apply</strong> on a listing records that you opened it — the job title,
        the company and the date. That record stays here; nothing about your account is sent to the employer, and this
        app cannot see whether you went on to apply.
      </p>

      <h2 className="legal-section">6. What is never collected</h2>
      <p>
        No phone number, resume, date of birth or address is ever requested, and card details never reach this site.
        There are no third-party analytics and no tracking pixels{ads ? '; the only advertising is the Google ads described in section 4' : ', no advertising, and no tracking cookies'} — the only
        measurement of our own is the page-view tally described above. Nothing is sold, rented, or
        shared with data brokers, and no profile is built about you.
      </p>
      <p>
        An account requires only an email address and a password. A name is optional and is used solely to greet you.
      </p>

      <h2 className="legal-section">7. Your rights over your data</h2>
      <ul>
        <li>
          <strong>Export it.</strong> The account page gives you everything stored about you as JSON or CSV, on
          demand.
        </li>
        <li>
          <strong>Delete it.</strong> Deleting your account removes your record, your ledger, your completions and
          your saved searches from the database. It is immediate and cannot be undone. Copies in the daily backups
          described above expire on their own within 14 days.
        </li>
        <li>
          <strong>Correct it.</strong> Your password can be changed from the account page. To change your name or
          email address, write to <Contact email={contactEmail} />.
        </li>
      </ul>
      <p>
        Depending on where you live, laws such as the GDPR or the CCPA may give you further rights. To exercise them,
        or to ask anything about your data, write to <Contact email={contactEmail} />.
      </p>

      <h2 className="legal-section">8. How long it is kept</h2>
      <p>
        Account data is kept until you delete your account. Sessions expire after 30 days. Saved searches are kept so
        the app can show your recent ones, and are removed with your account. Backup copies, where they exist, are
        kept for 14 days. A record of each payment (date, amount, refund) is kept after an account is deleted, without
        anything linking it to you, because a business has to keep its sales records.
      </p>

      <h2 className="legal-section">9. Children</h2>
      <p>
        The app is aimed at university students and is not directed at children under 13. If you believe a child has
        created an account, write to <Contact email={contactEmail} /> and it will be removed.
      </p>

      <h2 className="legal-section">10. Changes</h2>
      <p>
        If this policy changes in a way that affects what is collected or who receives it, the date above changes with
        it. The date reflects this version.
      </p>
    </>
  );
}

function Terms() {
  const contact = useContactEmail();
  // Section 6 is Premium; with Premium switched off it is left out and the
  // sections after it move up one.
  const after = (n) => (PREMIUM_ENABLED ? n : n - 1);
  return (
    <>
      <h1>Terms and Conditions</h1>
      <p className="legal-date">Last updated {UPDATED}</p>

      <div className="legal-callout">
        <strong>The short version.</strong> This is a free tool that helps you find listings and free courses
        {PREMIUM_ENABLED ? ', with an optional paid Premium' : ''}. It makes no promise that any listing is current, that
        any course is free, or that you will get an interview. Verify anything before you rely on it.
      </div>

      <h2 className="legal-section">1. What this is</h2>
      <p>
        Elevate Internships is a tool for finding internships and certifications, and for tracking applications and
        which certifications you have finished. The core tool is free of charge and provided as-is.
        {PREMIUM_ENABLED && ' Premium (section 6) is optional.'}
      </p>

      <h2 className="legal-section">2. Listings come from third parties</h2>
      <p>
        Internship listings are retrieved from The Muse, Remotive, Jobicy and Himalayas, from the Simplify internship
        list, from employers' own public job boards on Greenhouse, Lever, Ashby and SmartRecruiters, and — where the operator has configured a key — from Adzuna and USAJOBS. This
        application does not create, verify, endorse, or control any listing. It does not scrape any website.
      </p>
      <p>
        Listings may be filled, withdrawn, or inaccurate. The app hides postings older than nine months and those
        outside the United States, but a listing that passes those filters is still not guaranteed to be open. Always
        confirm on the employer's own site before applying.
      </p>

      <h2 className="legal-section">3. Certifications and cost labels</h2>
      <p>
        Each certification is labelled <em>Free</em>, <em>Free to audit</em>, <em>Free via campus</em>, or{' '}
        <em>Reference</em>, as accurately as could be determined when the catalog was assembled. Providers change their
        pricing without notice, and some charge for an exam while the training remains free.
      </p>
      <p>
        <strong>Confirm the current price on the provider's own page before you enroll or pay anything.</strong> This
        application is not affiliated with or endorsed by any listed provider. Some certification links may be
        affiliate links that earn a commission if you buy a course after clicking; pages with such links say so, and
        commissions never affect which certifications are listed or how they are ranked. Anything paid for as a
        sponsorship is labeled <em>Sponsored</em>.
      </p>

      <h2 className="legal-section">4. Not career, legal, or financial advice</h2>
      <p>
        Track suggestions, rankings, and “why this fits” notes are produced by keyword matching, not by a careers
        adviser. They are suggestions to consider, not professional guidance about your education or career.
      </p>

      <h2 className="legal-section">5. AI-generated suggestions</h2>
      <p>
        If you enable the optional “Suggest more” feature, results come from a language model and may be inaccurate or
        may reference courses that no longer exist. They are labelled “suggested, verify link,” and the app checks that
        a link responds before letting you add it. A link that responds is not proof that the course is free, current,
        or worthwhile.
      </p>

      {PREMIUM_ENABLED && (
        <>
          <h2 className="legal-section">6. Premium</h2>
          <p>
            Premium costs $9.99 (US dollars) for one semester, which is six months from the day you pay; buying again
            adds another six months. It is a one-time payment and <strong>does not renew automatically</strong>. It
            includes daily new-internship notifications, the Recruiting Kit download, sample answers in the interview
            question bank, and no ads. Payment is taken by Stripe.
          </p>
          <p>
            <strong>Refunds:</strong> if Premium is not for you, email <Contact email={contact} /> within 14 days of
            paying for a full refund, and Premium ends. The Recruiting Kit is for your own personal use; do not share or
            resell it. If a Premium feature is discontinued, you will get a prorated refund on request.
          </p>
        </>
      )}

      <h2 className="legal-section">{after(7)}. Sponsored listings</h2>
      <p>
        Employers can pay $49 to feature an internship for 30 days. Every sponsored listing is reviewed by hand before it
        appears and is labeled <em>Sponsored</em>; a listing that is not approved is refunded in full. Sponsored listings
        are advertising, not recommendations: check them on the employer's site like any other listing. Listings that
        ask students to pay to apply are not accepted.
      </p>

      <h2 className="legal-section">{after(8)}. Your responsibilities</h2>
      <ul>
        <li>Keep your password to yourself; you are responsible for what happens under your account</li>
        <li>Do not use this tool to scrape, bulk-harvest, or redistribute listings</li>
        <li>Do not try to reach another person's account or data</li>
        <li>Check each employer's and provider's terms before applying or enrolling</li>
      </ul>

      <h2 className="legal-section">{after(9)}. Third-party terms</h2>
      <p>
        Data retrieved through Adzuna, USAJOBS, The Muse, Remotive, Jobicy, Himalayas, Simplify, and Anthropic remains subject to each
        provider's terms of service. Enabling a source means accepting its terms. Payments are also subject to
        Stripe's terms.
      </p>

      <h2 className="legal-section">{after(10)}. Attribution</h2>
      <p>
        US postal code and city coordinates are derived from the{' '}
        <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">
          GeoNames
        </a>{' '}
        postal code export, used under the{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
          Creative Commons Attribution 4.0
        </a>{' '}
        licence. If you redistribute this application, that attribution has to travel with it — see{' '}
        <code>server/data/GEONAMES-LICENCE.txt</code>.
      </p>
      <p>
        Remote listings marked <strong>Himalayas</strong> come from{' '}
        <a href="https://himalayas.app/" target="_blank" rel="noopener noreferrer">
          Himalayas
        </a>{' '}
        and link to its page for each job. Listings marked <strong>Simplify</strong> come from the{' '}
        <a href="https://github.com/SimplifyJobs" target="_blank" rel="noopener noreferrer">
          Simplify and Pitt CS Club internship list
        </a>
        .
      </p>

      <h2 className="legal-section">{after(11)}. No warranty</h2>
      <p>
        The software is provided “as is,” without warranty of any kind, express or implied, including merchantability,
        fitness for a particular purpose, and non-infringement. No promise is made that it will run without error, that
        results will be complete or accurate, or that any source will stay available.
      </p>

      <h2 className="legal-section">{after(12)}. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, no liability is accepted for any indirect, incidental, or consequential
        loss arising from use of this application — including a missed deadline, an expired listing, a course that
        turned out to cost money, or any hiring decision.
        {PREMIUM_ENABLED && ' For Premium, total liability is limited to the amount you paid for it.'}
      </p>

      <h2 className="legal-section">{after(13)}. Changes</h2>
      <p>
        These terms may be updated as the app changes. The date at the top reflects this version; continuing to use
        the site after a change means you accept the updated terms.
      </p>

      <div className="legal-note">
        <strong>Please read:</strong> these documents were drafted to describe what this code actually does, and they
        have not been reviewed by a lawyer. They are a starting point for a personal project. If you publish this app,
        take payment, add accounts, or collect any personal data, have a qualified lawyer review them — and note that
        laws such as the GDPR and CCPA may then impose obligations these pages do not cover.
      </div>
    </>
  );
}

export default function Legal({ page, onBack }) {
  return (
    <article className="legal">
      <button type="button" className="btn ghost small" onClick={onBack}>
        ← Back to the app
      </button>
      {page === 'privacy' ? <Privacy /> : <Terms />}
    </article>
  );
}

