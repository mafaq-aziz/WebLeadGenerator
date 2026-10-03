# WebLeadGenerator

**Local-only Instagram lead scraper + outreach drafts — Chrome extension
(Manifest V3).** In the browser it appears as *FICINO Instagram Lead Scraper*.

Two modes plus a draft-based outreach workflow:

- **Passive scan** — observes Instagram pages you already visit, extracts publicly
  visible business information, and saves **only leads that show no visible website**.
- **Auto Search** — type a search term in the popup and the extension takes over an
  Instagram tab: it opens the search results, auto-scrolls, opens each post, reads the
  caption for a phone/email, jumps to the author's profile, extracts everything visible,
  goes back to the queue, and stops after a configurable number of **leads (profiles
  with no website)**. **No business verification is applied in this mode** — every
  visited profile is extracted; only profiles that already have a website are excluded
  from the saved leads and from the target count.
- **Influencer filtering + outreach drafts** — profiles that look like influencers,
  vloggers or bloggers are flagged as `Ignore` (never deleted, never counted), and
  selected leads can be opened as **pre-filled, unsent drafts** — WhatsApp tabs with the
  message in the URL, Instagram DM tabs with the message typed into the composer — then
  you send each one manually with Enter.

All data stays in `chrome.storage.local`. Export to Excel or CSV from the popup.

No APIs. No backend. No remote code. No data leaves your machine.

## Requirements

- Google Chrome (or any Chromium 126+ browser)
- Node.js 18+ (only for tests/build/smoke — not needed to use the extension)

## Install (unpacked)

1. A ready-made `dist/` ships with this repository — if you just cloned or
   downloaded it, skip to step 2. After changing anything under `src/`, rebuild:

   ```
   npm install
   npm run build
   ```

2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder (the one containing `manifest.json`).
4. Pin the FICINO icon to the toolbar.

Chrome 137+ removed the `--load-extension` command-line flag, so loading must be done
through the extensions page (or via the CDP `Extensions.loadUnpacked` command, which is
what `npm run smoke` uses).

## Use

### Passive mode

1. Open a business profile on `https://www.instagram.com/<username>/`.
2. The content script reads the visible header, bio, category, follower counts and any
   open contact dialog — nothing is fetched, nothing is typed in, nothing is scraped
   from pages you did not visit.
3. If the profile scores as a business **and no website is found**, it is saved as a
   lead. Profiles with a website are counted in statistics but never stored.
   Messaging and social links (WhatsApp `wa.me`/`wa.link`, Messenger, Telegram,
   Instagram, Facebook, TikTok, …) are never counted as the business website — only a
   real site URL excludes a lead.
4. Post pages you open (`/p/…`, `/reel/…`) are also scanned for a phone number or
   email in the caption (including `tel:`/`mailto:` links). If found, the contact is
   stashed under the post's author and merged automatically when that author's profile
   is later extracted — in either mode.
5. Click the extension icon → **Dashboard** to browse, edit and export leads.

### Influencer filtering (non-destructive)

- While scanning, each saved profile is also checked against a conservative
  influencer detector: a creator-style **category** (digital creator, blogger, vlogger,
  youtuber, content creator, influencer, public figure, …), **two bio markers**
  (collab/collaboration, sponsorship, business/press inquiries, talent agency, booking
  agent), a bio marker **plus** a blogger-style username (`blog`, `vlog`, `daily`,
  `wanderlust`, …) or **100k+ followers**, or **500k+ followers** on its own.
- Matches are saved as status **`Ignore`** with `influencer: true` and the reasons —
  nothing is ever deleted, and you can flip any lead back to `New` in the status
  dropdown at any time.
- Ignored leads **do not count** toward the Auto Search target, and **Export all**
  skips them (the toast tells you how many were excluded). The *Influencers (ignored)*
  filter chip shows them; exporting a selection exports exactly what you selected.
- **Flag influencers** (top bar) re-scans every stored lead: new matches are flagged,
  stale flags are restored to `New`, and `Contacted`/`Reviewed` statuses are never
  touched.
- Leads whose bio carries a **permit/trade-license number** are excluded the same
  way, instantly: saved as `Ignore` with `influencer: true` and the reason
  `permit_number`, existing data is excluded once automatically when the dashboard
  opens (you'll see a toast), and every **Flag influencers** re-scan keeps them
  excluded. They fall under the same *Influencers (ignored)* chip and skip count.
  A bio only has to **mention** a permit (`Permit`, `permits`, `Licensed`, `License`,
  `TRN`, `Reg no`, `CR no`, or Arabic `رخصة`/`تصريح`/`سجل تجاري`, …) — no number is
  required. If nothing matches, the **Flag influencers** toast tells you how many
  leads were scanned ("No influencers found among N leads") so you can tell an empty
  scan from a wording we don't match yet.

### Outreach drafts (WhatsApp / Instagram DM)

The dashboard's **Outreach drafts** panel turns selected leads into drafts you review
and send yourself — the extension never presses Enter and never sends anything.

1. Edit the **WhatsApp message** and **Instagram message** templates and press
   **Save messages**. Placeholders: `{name}` `{username}` `{category}` `{location}`
   `{followers}` `{phone}` (unknown placeholders stay as written).
2. Select leads in the table (max 20 per batch — extra ids are reported as
   `batch_limit`), pick a channel, press **Prepare drafts (selected)**.
   - **WhatsApp** opens one tab per lead at
     `https://web.whatsapp.com/send?phone=…&text=…` — the official deep link prefills
     the chat with normalized phone digits and the rendered message. Tabs are strictly
     serialized: the next tab only opens after the previous one has reported fully
     loaded, plus a random 8–14 s settle delay — WhatsApp tabs never boot in parallel
     (one account, one live tab), so every draft actually gets written. A 20-lead batch
     takes a few minutes; the status shows `Preparing N/20` while it runs.
   - **Instagram DM** opens `https://www.instagram.com/direct/new/?to=<username>` per
     lead and a content script types the rendered message into the composer — using
     `insertText`, never keyboard events, and **never Enter**.
3. Leads without a phone/username, leads with a flagged (unverified) phone,
   `Ignore`d leads, and missing ids are skipped and listed under *failed* with the
   reason.
4. When every tab is prepared the panel shows a green banner, the status reads
   `Drafts ready: N prepared`, and **a three-beep sound plays — keep the dashboard tab
   open for the sound** (browsers only allow audio right after you click, so press
   *Prepare drafts* in the dashboard, not the popup).
5. Review each tab and press **Enter** yourself to send, one by one.
6. **Mark prepared as Contacted** sets the prepared leads' status in one step.
7. **Stop** (`OUTREACH_STOP`) aborts a run; if the browser restarts mid-run the state
   shows `Interrupted` and can simply be started again.

Tabs opened this way need no extra permissions: `chrome.tabs.create` and the WhatsApp /
DM URLs are plain navigation — the extension still only holds `storage` permission plus
Instagram/Linktree host access.

### Phone number verification

Numbers arrive in mixed formats and occasionally don't match what the profile actually
displays, so every saved phone is verified:

1. **Attribution (context-based country code)**: a bare number without `+` gets its
   country code inferred from context — the search term (`clothes in UAE`), the bio
   (cities, `.ae`/`.uk` domains, `dubai`, `london`, `karachi`, …), the username
   (`london_bakes`), the display name, category and source page (~50 countries are
   recognised). Bare UAE mobile numbers (`05XXXXXXXX`, e.g. `0505016078`) always
   resolve to `+971…` even without any context. Numbers starting with `+` or `00` are
   already international and stay as written; a bare number of 11+ digits is assumed
   international; anything that can't be resolved is marked `needs_cc`. The **Default
   country code for numbers without +CC** setting (toolbar popup) is the fallback for
   leftovers.
2. **Permit numbers are not phones**: bios often carry a trade-license/permit number
   (`Permit No. 5427536`, `TRN 100123456700003`, `License …`, `VAT …`). Numbers
   labelled this way are excluded from phone extraction everywhere — profile header,
   bio, post captions — so a permit can never become the lead's phone. If a permit
   number is already stored anyway (older data), it is flagged `permit_number`, never
   normalized, and skipped by outreach; a real phone sitting next to a permit
   (`License 5427536 · WhatsApp 0505016078`) is still picked up correctly. Any lead
   whose bio contains such a number is additionally excluded as influencer-style
   (see *Influencer filtering* above).
3. **Self-correction from the profile**: the stored bio is the source of truth. If the
   scraped number doesn't match what the bio shows (extraction picked the contact
   panel, a caption merge, or page noise), the number is **replaced with the bio's
   number automatically** — at save time and again for existing data — so wrong
   numbers fix themselves without review. The original value is kept in
   `phone_replaced_raw`, corrected cells show ↻ with a tooltip naming the old number,
   and the *Fix numbers* toast reports how many were corrected.
4. **Flags for what can't be decided**: numbers that exist only in a post
   caption/contact panel while the bio is empty (`caption_source`), bios listing
   several numbers (`multiple_numbers`), permit/license numbers (`permit_number`),
   bare numbers with no resolvable country (`needs_cc`) and structurally broken
   numbers (`too_short`, `too_long`, `suspicious`) stay flagged — the number is kept,
   but flagged leads are excluded from WhatsApp outreach.
5. **Cleaning existing data**: **Fix numbers** (dashboard top bar) runs the same
   verification over every stored lead (also runs once automatically when stored
   phones look unverified) and adds a **Bad number** filter chip. Unresolved cells
   show ⚠ — press ✎ to type the correct number; a trusted manual fix clears the flag
   permanently (invalid or country-less input is refused with a toast).
6. WhatsApp outreach skips flagged leads and lists the reason under *failed*
   (`permit_number`, `caption_source`, `needs_cc`, `too_short`, …) instead of opening
   a chat with a wrong number; Instagram DM drafts don't need a phone and are
   unaffected.

### Auto Search mode

1. Click the extension icon → **Auto Search**.
2. Enter a search term (a `#hashtag` opens the hashtag page, anything else opens
   keyword search) and the number of leads to collect (1–500, remembered for next
   time).
3. Press **Start Search**. The extension takes over the first open Instagram tab (or
   opens one) and drives it: harvest post links from the results grid → auto-scroll →
   open a post (reading its caption for a phone/email) → open the author's profile →
   extract → return to the queue → repeat. Every step waits a **random 2–4 seconds** —
   there is no fixed rhythm, and the randomization applies to scrolling, navigation and
   profile checks alike.
4. Progress shows live in the popup (`Searching results… · 12 / 30`). Press **Stop
   Search** at any time; the run also stops itself at the target, at a login wall, or
   when results are exhausted.
5. Every visited profile is extracted — the confidence threshold is bypassed — but
   **only profiles that end up saved as leads (no website) count toward the target**.
   Profiles that display a website are still visited and counted in statistics
   (*With website*) but do not advance the counter.
6. **Linktree resolution**: if the only link in the bio is a Linktree
   (`linktr.ee/…`), the run opens the Linktree page in the driven tab and checks its
   links. A real website found there excludes the profile (counted under *With
   website*, does not count toward the target); no website found means the profile is
   saved as a lead and counts. WhatsApp / social links on the Linktree are ignored, so
   they can never fake a website.
7. **Caption contacts**: phone numbers and emails found in a post's caption are stashed
   under the post's author and merged into the profile when it is extracted — so a
   brand that hides its number in posts still ends up with `phone_normalized`/`email`
   on the saved lead (when the save-phone/save-email settings allow it). Caption-sourced
   numbers are flagged `caption_source` for review (see *Phone number verification*).
8. **Collab posts**: a post co-authored by an influencer and a brand lists both
   accounts. The run ranks every author (business keywords in the handle, search-term
   matches; name-like handles and blogger markers such as `blog`/`daily`/`vlogs` are
   deprioritized) and opens only the best-ranked one — so the brand's profile is
   opened, not the influencer's. If that author was already visited, the post is
   skipped entirely; the influencer account is never opened.

While an Auto Search run is active the passive scanner pauses so each profile is
submitted exactly once.

### Toolbar popup

- Auto Search: term, target, start/stop, progress bar
- Start/stop passive scanning (per-session toggle)
- Live counters: scanned, businesses, with/without website, saved, duplicates
- **Default country code for numbers without +CC** (fallback used by *Fix numbers*)
- Open dashboard

### Dashboard

- Search and filter leads (including the *Influencers (ignored)* and *Bad number* chips),
  edit status/notes
- **Flag influencers** re-scan for creator-style profiles
- **Fix numbers** verifies every stored phone and auto-corrects numbers that
  contradict the profile bio (↻ marks corrected cells); unresolved cells show ⚠ and
  ✎ to type a trusted correction
- **Outreach drafts** panel: channel (WhatsApp / Instagram DM), message templates with
  placeholders, prepare/stop, live status, ready-banner with a beep
- Delete individual leads or clear all
- **Export Excel** (`.xlsx`) and **Export CSV** (UTF-8 with BOM) — both include
  per-lead **WhatsApp Message** and **Instagram Message** columns rendered from your
  templates; *Export all* excludes `Ignore`d influencer leads and says how many
- Settings: confidence threshold (default 70), `debug` logging toggle

## Privacy

- Only permission: `storage` + host access to `https://www.instagram.com/*` and
  `https://linktr.ee/*` (the second host exists solely so Auto Search can open a
  profile's Linktree and read it with a content script).
- Outreach drafts only *open tabs* (`chrome.tabs.create` needs no permission): the
  WhatsApp deep link and the Instagram DM page are ordinary navigations, the message is
  either in the URL or typed by the `/direct/*` content script — no extra host access
  to `web.whatsapp.com` is requested and none is needed.
- Data is written exclusively to `chrome.storage.local` on your computer.
- No network requests are made by the extension (verified by `scripts/check.js`, which
  fails the build on any remote `<script src>`, `fetch` to a non-Instagram origin, or
  host permission outside `instagram.com`/`linktr.ee`).
- Exported files are produced in-browser via Blob download.

## Development

```
npm run check    # syntax + MV3 manifest validation + no-remote-code scan
npm run test     # 77 unit/integration tests (jsdom, mocked chrome.*, real SW handlers)
npm run build    # copy source into dist/ and verify manifest references
npm run verify   # check + test + build
npm run smoke    # real headless Chrome end-to-end test
```

### Smoke test details

`scripts/smoke.js`:

1. Generates a self-signed certificate for `www.instagram.com` and serves an
   Instagram-shaped fixture over HTTPS on a random localhost port (plus a direct-message
   page under `/direct/` and a stand-in for `web.whatsapp.com`).
2. Launches headless Chrome with `--remote-debugging-pipe
   --enable-unsafe-extension-debugging` and a throwaway profile, mapping
   `www.instagram.com`, `linktr.ee` and `web.whatsapp.com` to the fixture via
   `--host-resolver-rules`.
3. Installs `dist/` with the CDP `Extensions.loadUnpacked` command.
4. Opens the fixture page, waits for the content script message to wake the service
   worker, then reads `chrome.storage.local` over CDP.
5. Asserts the passive lead was saved with an empty `website`,
   `website_not_found_on_instagram: true`, confidence ≥ 70, status `New`, and correct
   name/category/URL — and that `statistics.scanned >= 2`.
6. Injects an auto-search session (target 2), then asserts the controller harvested
   the fixture's post links, opened the post author's profile (the first post is a
   **collab** listing an influencer and the brand — the brand must be opened and the
   influencer must never appear in `visitedProfiles`/leads), **stashed the phone and
   email found in the post caption** (`autoSearch.postContacts`, later merged onto the
   lead as `phone_normalized`/`email`), **opened and resolved its Linktree**
   (server-side hit counter), submitted it with `saveAll`, saved the `a1_shop` lead
   with an empty `website`, and stopped itself at the target
   (`autoSearch.phase === 'done'`, `collected >= 2`, counting only saved leads).
7. Opens the dashboard over CDP and runs the phone verification flow: `CLEAN_PHONES`
   flags the caption-sourced number as `caption_source`, then `SET_PHONE` accepts the
   correct number and clears the flag on the stored lead.
8. Sends `OUTREACH_START` for the saved lead twice:
   **Instagram DM** — asserts the `/direct/new/?to=a1_shop` fixture tab loaded, the
   runner reported `state: 'done'` with 1 prepared / 0 failed, and the composer
   contains the rendered template (typed, not sent); **WhatsApp** — asserts the opened
   tab URL is `web.whatsapp.com/send?phone=393331234567&text=…` with the rendered
   message in it (prefilled, not sent).

## Architecture

```
manifest.json                     MV3 manifest; content_script order matters
src/
  shared/logger.js                gated console logging (off unless settings.debug)
  shared/templates.js             outreach message templates, placeholder rendering,
                                  WhatsApp/IG draft URLs, exportable (non-ignored) filter
  storage/storage.js              chrome.storage.local schema, defaults, stats, dedupe,
                                  outreach draft-run state
  content/
    normalizer.js                 usernames, URLs, phones (permit-aware extraction,
                                  context/prefix country attribution), emails,
                                  follower counts
    selectors.js                  CSS selectors, host filters, reserved paths
    profile-extractor.js          all DOM reads (header, bio, dialogs, text URLs,
                                  post captions incl. tel:/mailto: contacts; collab
                                  post author collection + brand-first ranking)
    business-detector.js          scoring model; keyword word-boundary matching
    influencer-detector.js        conservative influencer/vlogger/blogger scoring
    mutation-observer.js          SPA navigation + late-rendered nodes
    instagram-scanner.js          passive orchestrator; sends PROCESS_CANDIDATE to the SW
    dm-drafter.js                 runs on /direct/* only; types the prepared draft into
                                  the composer (insertText, never Enter)
    auto-search.js                active loop: harvest posts -> caption contact stash
                                  -> author profile -> extract; holds profiles whose
                                  only link is a Linktree
    linktree-resolver.js          runs on linktr.ee during Auto Search; reports the first
                                  real website link (or none) back to the SW
  background/service-worker.js    single writer for leads/statistics; auto-search queue,
                                  tab driving (claim/navigate/advance), Linktree
                                  hold/resolve handlers, post-contact stash, influencer
                                  flagging, and the target counter (counts only saved,
                                  non-ignored leads)
  background/outreach-runner.js   paced draft preparation: one tab per lead (WhatsApp
                                  deep link / IG DM); every tab must finish loading
                                  before the next one opens (WhatsApp 8-14 s apart,
                                  IG 1.5-3.5 s), types via dm-drafter, tracks
                                  prepared/failed, activates the first tab when done;
                                  recovers interrupted runs
  export/excel.js                 bundled SheetJS workbook builder (+ message columns)
  export/csv.js                   CSV with BOM + RFC quoting (shares column model)
  popup/                          toolbar UI
  dashboard/                      management UI, settings, export buttons, outreach
                                  panel with templates, beep and flag-influencers
lib/xlsx/xlsx.full.min.js         vendored SheetJS (local, no CDN)
scripts/                          check, build, icons, smoke
tests/                            66-test suite
```

Content scripts never write storage directly: they extract a candidate and send it to
the service worker, which is the only writer. This keeps duplicate suppression and
statistics consistent under concurrent page activity.

## Limitations

- Passive mode only sees pages you actually visit. Auto Search drives one Instagram
   tab sequentially with randomized 2–4 second pacing, one page at a time — it is not a
  crawler and will not run in multiple tabs at once.
- Auto Search bypasses business verification by design; personal profiles found
  through search are extracted and, when they show no website, saved as leads that
  count toward the target.
- Caption contact scanning reads text only: phone numbers or emails **burned into a
  post image** (no caption text, no link) cannot be read — OCR is intentionally out of
  scope.
- Collab-post author selection is heuristic (handle keywords, search-term matches,
  name/blogger markers). Two equally brand-like co-authors fall back to DOM order;
  fetching both profiles to compare is intentionally not done (one page at a time).
- Instagram renders content dynamically; data hidden behind interactions you did not
  make (e.g. an unopened contact dialog) is not seen.
- Website detection is heuristic: a real site URL anywhere in the bio, header, or
  rendered contact area counts as "has website" and excludes the lead. Messaging and
  social links (WhatsApp, Messenger, TikTok, other link-in-bio services, …) never
  count as a website. A Linktree is only *opened and checked* during an Auto Search
  run; in passive mode a Linktree is treated as "no website yet" and the profile is
  saved (their real site may still hide inside the Linktree).
- Passive scoring is heuristic too — a low-confidence business may be skipped, and a
  personal profile with business keywords may be counted.
- Heavy automated browsing can trigger Instagram rate limits or login challenges; the
  run stops itself with a "Login required" status when that happens.
- Export contains whatever was stored locally; deleting the extension or clearing
  site data removes the leads.
- Influencer detection is a conservative heuristic: it deliberately misses ambiguous
  accounts rather than hiding real businesses. Check the *Influencers (ignored)* chip
  once in a while and flip anything back to `New` (or run **Flag influencers** after
  editing bios).
- Outreach prepares drafts only — it never sends, never re-sends, and never opens a
  second chat for a lead you already contacted. The completion **beep plays in the
  dashboard tab** (keep it open); WhatsApp drafts require being logged into
  WhatsApp Web, and Instagram drafts depend on the current DM composer markup — if
  Instagram changes it, the draft is reported as failed (`no_composer`) instead of
  typing blindly.
- Batches are capped at 20 tabs per run (extra ids are reported as `batch_limit`) so a
  mis-click cannot open hundreds of tabs.
- The smoke test requires `openssl` on PATH (or `C:\msys64\ucrt64\bin\openssl.exe`).
