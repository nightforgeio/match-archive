# NightForge — Free Fire MAX Match Archive
A public archive of every NightForge Free Fire MAX match: date, mode, event,
map, opponent, score, result, placement, entry fee and prize money. Visitors
filter by mode, event type, result and year, and search by opponent, event or
map. The owner maintains the records from `/admin/`. The public page always
reads the committed `data/matches.json`, so an admin edit only goes live after
it is exported or published.

---

## How the data flows

```
admin panel  ──edit──▶  local working draft (localStorage)
                              │
                              ├─▶ Export JSON  ──▶ you paste into data/*.json ──▶ git commit ──▶ live
                              │
                              └─▶ Publish to GitHub  ──▶ data/matches.json + data/team.json on the repo
```

**The public page never reads localStorage.** A visitor's browser holds
nothing, so anything saved only in the owner's browser would be invisible to
everyone else. `data/matches.json` is the single source of truth.

Two files carry the record:

| File                 | Holds                                              |
| -------------------- | -------------------------------------------------- |
| `data/matches.json`  | The match log — the schema, the ordered records     |
| `data/team.json`     | Team name, tagline, city, email, WhatsApp, socials  |

`data/team.json` also carries optional `taglineHi` and `aboutHi` strings.
When they are present the Hindi view of the page shows them; when they are
absent the English text is shown in both views. The admin panel has a field
for each.

### Match record shape

```json
{
  "id": "2026-02-14-cs-01",
  "date": "2026-02-14",
  "mode": "CS",
  "event": "Tournament",
  "eventName": "NightForge Weekly Cup #12",
  "map": "Bermuda",
  "opponent": "Team Velocity",
  "score": "3-1",
  "result": "W",
  "placement": 1,
  "entryFee": 500,
  "prize": 10000,
  "notes": "Decided on Bermuda.",
  "demo": false
}
```

- `mode` — `CS`, `BR` or `LW`. The codes are stored, but the site shows the
  official Free Fire MAX mode name next to them:

  | Code | Mode name      |
  | ---- | -------------- |
  | `CS` | Clash Squad    |
  | `BR` | Battle Royale  |
  | `LW` | Lone Wolf      |

- `event` — `Tournament`, `Scrim`, `Qualifier`, `Showmatch`, or `Other`
- `result` — `W`, `L` or `D`
- `map` — free text, so a seasonal or mode-specific map can be recorded
  accurately (Bermuda, Bermuda Remastered, Purgatory, Kalahari, Alpine,
  NeXTerra, Solara)
- `demo` — `true` marks a sample record. The public page shows a banner
  while any remain, and the admin can remove them all in one action.

### Sample records

`data/matches.json` currently ships **eight illustrative sample records**
(Dec 2025 – Feb 2026, six wins and two losses). They are placeholders, not
real NightForge history, and every one carries `"demo": true`. The public
page labels them and shows a warning banner while they exist. Replace them
with the real match log before launch, or remove them with the admin's
"Remove sample records" action.

---

## Adding a match

**The easy way — the admin panel**

1. Open `/admin/` and enter the admin password.
2. Click **Add match**.
3. Fill in the fields. Date, mode and event are required; the rest are
   optional and default to a sensible zero.
4. Click **Save**. The record is added to your local draft.
5. To make it live, either:
   - **Download `matches.json`** and replace `data/matches.json` in the
     repository, then commit — no token needed, or
   - **Publish to GitHub** — paste a fine-grained token with
     **Contents: write** permission for this repository, and the panel
     writes `data/matches.json` and `data/team.json` straight to the repo.

**The manual way — edit the JSON**

Edit `data/matches.json` directly, keep the ids unique, and commit.

### The draft

The admin keeps a working draft in `localStorage` under `nf_admin_draft`. The
draft is stored as `{ records, team, savedAt }` — the presence of the key,
not the length of the array, decides whether a draft exists. That means a
deliberate *delete every record* stays deleted after a reload instead of
silently restoring the published records.

**Discard local changes** reloads the published files and throws the draft
away.

---

## Admin panel

Open `admin/index.html` (or `/admin/` once deployed) and enter the admin
password. The password is stored as a SHA-256 hash in `admin/js/admin.js`
(`const PASS_HASH`) — the plaintext is not in this repository.

To rotate the password, generate a new hash and paste it in:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('YOUR_NEW_PASSWORD','utf8').digest('hex'))"
```

Then run the guard with the new password so the suite verifies it:

```bash
ADMIN_PASSWORD='YOUR_NEW_PASSWORD' node tests/admin-hash.test.js
```

`tests/admin-hash.test.js` asserts three things: your password opens the
panel, the old demo password no longer does, and the plaintext has not been
written into any tracked file or into the published data.

> **Note:** the admin panel is client-side. The gate is a local hash, and
> because the JavaScript and the hash are both public, it is a casual
> access barrier — not secure server-side authentication. The panel holds
> no sensitive data, and the GitHub token is never stored: it is read from
> the password field at publish time, held in memory for that one request,
> and cleared afterwards.

### Publishing to GitHub

1. Create a **fine-grained** personal access token with **Contents: write**
   permission for this repository only.
2. Open the admin panel, paste the token into the publish field.
3. Click **Publish**. The panel writes `data/matches.json`, and
   `data/team.json` when the team name is filled in. The team file is
   skipped rather than blanked if the name is empty, so a half-filled form
   can never wipe live team details.

The token is never written to `localStorage` and never appears in the page
source.

---

## Project layout

```
index.html              the public archive
css/style.css           the design system
js/data.js              data loading, normalization, statistics
js/i18n.js              English / Hindi strings
js/app.js               rendering, filters, search, mobile menu
admin/                  the owner panel
  index.html
  css/admin.css
  js/admin.js
data/                   the published record (the source of truth)
fonts/                  local variable fonts — no third-party requests
assets/                 icons and the Open Graph image
manifest.json           the PWA manifest
sw.js                   the service worker
scripts/
  build-sw.sh           bakes a content hash into the service worker
  check.sh              the full check — run it before every commit
  deploy-config.sh      rewrites the URLs for the live domain
tests/                  the test suites
```

---

## Tests

```bash
node tests/data-layer.test.js        # data layer, normalization, statistics
node tests/app-dom.test.js          # public page in jsdom (needs jsdom)
node --test tests/i18n-parity.test.js # English / Hindi key parity
node tests/css-contract.test.js      # tap targets, contrast, reduced motion
node tests/deploy-contract.test.js   # manifest, service worker, SEO files
ADMIN_PASSWORD='...' node tests/admin.test.js       # admin end-to-end
ADMIN_PASSWORD='...' node tests/admin-hash.test.js  # the gate hash guard

bash scripts/check.sh                # everything, plus lint and secret scan
```

`scripts/check.sh` is the gate. It runs every suite, rebuilds the service
worker version, and scans the repository for credential patterns.

---

## Deploying

1. Edit `.deploy.env` and set `SITE_URL` to the live domain:

   ```
   SITE_URL=https://nightforgeio.github.io/match-archive
   ```

2. Run the deploy config so the canonical URL, the Open Graph image and the
   sitemap all point at the live domain:

   ```bash
   bash scripts/deploy-config.sh
   ```

3. Commit and push. GitHub Pages serves the repository root.

4. In the repository settings, set **Pages → Source → Deploy from a branch**,
   branch `master`, folder `/ (root)`.

### The service worker

`sw.js` caches the app shell, but the match records are **network-first** —
a new result shows up on the next visit, never behind a stale cache. The
cache name is a content hash of the shell files, so it changes automatically
when the shell changes. `scripts/build-sw.sh` bakes it in, and
`scripts/check.sh` runs that before the tests.

---

## Accessibility

- Every interactive control is at least 44×44px.
- Body and muted text pass 4.5:1 against the background; the accent has its
  own ink colour for text sitting on top of it.
- The whole page works in English and Hindi, and the language choice is
  remembered.
- `prefers-reduced-motion: reduce` disables every transition and shows all
  reveal-animated content.
- The page is readable with JavaScript off — the reveal styles only apply
  when scripting is available.
- One `<h1>`, labelled landmarks, a skip link, and a live region for the
  result count.

---

## Notes for the owner

- The contact details in `data/team.json` (`hello@nightforge.io`,
  `919999999999`) are placeholders. Replace them with the real ones before
  launch, and fill in the Instagram and YouTube handles.
- The record is ordered newest first on the page, regardless of the order in
  the JSON file.
- Statistics are recomputed from the same array the list renders, so the
  numbers and the cards can never disagree. Win rate counts decided matches
  only, so a draw does not dilute the denominator.
