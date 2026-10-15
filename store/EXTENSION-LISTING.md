# Browser extension listings

"Save to Elevate Internships" (`extension/`). Both stores are free to publish
in. The Chrome Web Store charges a one-time $5 registration, so it is left out
for now; the same Edge package can be submitted there later without changes.

Packages (made by `node scripts/build-extension.js`):

- `dist-extension/elevate-extension-edge.zip` — Microsoft Edge Add-ons
- `dist-extension/elevate-extension-firefox.zip` — Firefox Add-ons (AMO)

## Where to submit

| Store | Where | Account |
|---|---|---|
| Microsoft Edge Add-ons | partner.microsoft.com → Edge → Extensions → Create new extension | The same Partner Center account as the Microsoft Store app (free) |
| Firefox Add-ons | addons.mozilla.org/developers → Submit a New Add-on → "On this site" | A free Firefox account |

## Listing text

**Name:** Save to Elevate Internships

**Short description (under 132 characters):**
Save the internship you're looking at to your Elevate Internships tracker in one click, from LinkedIn, Handshake or any job site.

**Description:**

Found an internship on LinkedIn, Handshake, Indeed or a company's career page?
Click the Elevate button and it goes straight into your Elevate Internships
application tracker, with the title, company and location already filled in.

How it works:
1. Open any internship posting.
2. Click the Elevate Internships button in your toolbar.
3. Check the details, then click "Open in my tracker".
4. Elevate Internships opens with the Add form filled in. Press Add to save it.

Then track it from Saved to Applied, Interviewing and Offer, add the deadline,
and get a reminder the day before.

Private by design: the extension only reads the page you are on, and only when
you click its button. It stores nothing, sends nothing anywhere except the
Elevate Internships page it opens for you, and has no ads or analytics.

Works without an account (the tracker is saved in your browser), or sign in to
keep it on every device.

**Category:** Productivity

**Website / support:** https://elevateinternships.com

**Privacy policy URL:** https://elevateinternships.com/privacy

## Permission justifications (the stores ask for these)

| Permission | Why |
|---|---|
| `activeTab` | To read the job title, company and location from the page you are on, only when you click the button. |
| `scripting` | To run the one small function that reads those details from that page. |

**Data collection (Edge and Firefox forms):** none. The extension collects no
personal data, stores nothing, and sends nothing to any server; it only opens
elevateinternships.com with the details in the address so the site can fill in
its form.

**Firefox reviewer notes:** No build step and no minified code; the files in the
zip are the source. The manifest's `data_collection_permissions` is set to
`none`.

## Screenshots

The stores want at least one image, 1280×800 (Edge) or any size (Firefox).
Take one of the popup open on a job posting, and one of the tracker's Add form
filled in.
