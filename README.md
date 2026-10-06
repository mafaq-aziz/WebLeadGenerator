# WebLeadGenerator

**Local-only Instagram + Google Maps lead scraper + outreach drafts — Chrome
extension (Manifest V3).** In the browser it appears as *FICINO Instagram Lead Scraper*.

Three modes plus a draft-based outreach workflow:

- **Passive scan** — observes Instagram pages you already visit, extracts publicly
  visible business information, and saves **only leads that show no visible website**.
- **Auto Search** — type one or more search terms in the popup (one per line or
  comma-separated) and the extension takes over an
  Instagram tab: it opens the search results, auto-scrolls, opens each post, reads the
  caption for a phone/email, jumps to the author's profile, extracts everything visible,
  goes back to the queue, and stops after a configurable number of **leads (profiles
  with no website) per term**, then automatically continues with the next term.
  An empty keyword results page is retried as hashtags derived from the term
  (`medspas in uae` → `#medspas`, `#medspa`) before the term gives up.
  Every lead is stamped with the **search term that found it**, so results from
  different terms stay separate (filterable and exportable). **No business verification
  is applied in this mode** — every
  visited profile is extracted; only profiles that already have a website are excluded
  from the saved leads and from the target count.
- **Google Maps search** — the same popup search box has an **Instagram / Google
  Maps** source switch: on Google Maps it searches places instead of posts. The
  extension opens the Maps results, opens **every** place page in turn (name,
  category, address, phone, website from the place panel), and saves **only places
  without a website** — the same rule as Instagram. One box, one target, one
  progress display; starting one mode stops the other. Saved maps leads carry the
  place URL as `source_page`, the address as location, the panel phone and the
  search term, and the dashboard shows **Maps ↗** instead of an @username.
- **Influencer filtering + outreach drafts** — profiles that look like influencers,
  vloggers or bloggers are flagged as `Ignore` (never deleted, never counted), and
  selected leads can be messaged: WhatsApp opens pre-filled tabs (message in the URL)
  that you send yourself with Enter, while Instagram DM tabs are typed **and sent
  automatically** — Instagram does not persist unsent composer text.

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

The dashboard's **Outreach drafts** panel prepares selected leads for messaging —
one tab per lead, and the extension only ever types inside the tab it just opened
for that lead. Instagram messages are typed and sent automatically (Instagram discards
unsent composer text); WhatsApp tabs are pre-filled for you to review and send
yourself — the extension never sends anything on WhatsApp.

1. Edit the **WhatsApp message** and **Instagram message** templates and press
   **Save messages**. Placeholders: `{name}` `{username}` `{category}` `{location}`
   `{followers}` `{phone}` — bracket style works too and is case-insensitive
   (`[Brand Name]`, `[brand name]`, `[Username]`, `[Location]`, …); unknown
   placeholders stay as written.
2. Select leads in the table (max 20 per batch — extra ids are reported as
   `batch_limit`), pick a channel, press **Prepare drafts (selected)**.
   - **WhatsApp** opens one tab per lead at
     `https://web.whatsapp.com/send?phone=…&text=…` — the official deep link prefills
     the chat with normalized phone digits and the rendered message. Tabs are strictly
     serialized: the next tab only opens after the previous one has reported fully
     loaded, plus a random 13–24 s settle delay — WhatsApp tabs never boot in parallel
     (one account, one live tab), so every draft actually gets written. A 20-lead batch
     takes about 5–8 minutes; the status shows `Preparing N/20` while it runs.
   - **Instagram DM** opens the lead's profile `https://www.instagram.com/<username>/`
      — Instagram has no working desktop deep-link (`?to=` opens an empty dialog,
      `ig.me/m/…` is mobile-only, `/direct/t/<id>` needs a thread that does not exist
      yet), so the content script clicks the profile's **Message** button itself, waits
      for the thread to open, then types the message with `insertText` and **sends it** —
      Enter first, falling back to a Send-button click, then Enter again. The send is
      verified: the composer must clear, otherwise the lead is reported as failed
      (`send_failed`) with its text left in the composer so you can send it by hand
      (Instagram does not keep unsent drafts, so sends are never assumed). Failures
      report precisely: `no_message_button`, `wrong_profile`, `login_required`,
      `thread_open_failed`, `no_composer`, `send_failed`.
3. Leads without a phone/username, leads with a flagged (unverified) phone,
   `Ignore`d leads, and missing ids are skipped and listed under *failed* with the
   reason.
4. When every tab is prepared the panel shows a green banner, the status reads
   `Drafts ready: N prepared`, and **a three-beep sound plays — keep the dashboard tab
   open for the sound** (browsers only allow audio right after you click, so press
   *Prepare drafts* in the dashboard, not the popup).
5. WhatsApp: review each pre-filled tab and press **Enter** yourself to send, one by
   one. Instagram messages are already sent by the time the banner appears — anything
   that did not go out shows up in the banner as `N not prepared (<reason> ×…)`.
6. **Mark prepared as Contacted** sets the prepared leads' status in one step.
7. **Stop** (`OUTREACH_STOP`) aborts a run; if the browser restarts mid-run the state
   shows `Interrupted` and can simply be started again.

Tabs opened this way need no extra permissions: `chrome.tabs.create` and the WhatsApp /
DM URLs are plain navigation — the extension still only holds `storage` permission plus
Instagram/Linktree/Google Maps host access.

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
2. Enter your search terms — one per line (or comma-separated). A `#hashtag` opens the
   hashtag page, anything else opens keyword search. Also set the number of leads to
   collect **per term** (1–500, remembered for next time).
3. Press **Start Search**. The extension takes over the first open Instagram tab (or
   opens one) and drives it: harvest post links from the results grid → auto-scroll →
   open a post (reading its caption for a phone/email) → open the author's profile →
   extract → return to the queue → repeat. Every step waits a **random 2–4 seconds** —
   there is no fixed rhythm, and the randomization applies to scrolling, navigation and
   profile checks alike.
4. Progress shows live in the popup (`Searching results… · 12 / 30 · term 2/3 · total 45`).
   When a term hits its target (or its results run out), the run **automatically
   continues with the next term**; press **Stop Search** at any time. The run also
   stops itself at a login wall, or when the last term is done.
5. **Empty keyword pages fall back to hashtags**: Instagram's keyword results
   sometimes come back with no posts at all (the same search works again later).
   When a term's keyword page is empty *and no post was ever seen under that
   term*, the run tries hashtags derived from the term instead of giving up —
   `medspas in uae` → `#medspas` → `#medspa` → next term — and the status
   names the surface (`No posts there — trying #medspas`). A term that has
   harvested posts is never re-tried, so a working keyword page always wins.
6. **Terms stay separate**: every saved lead carries a `search_term` field with the
   term(s) that found it (a lead found again under another term accumulates both).
   The dashboard's **Search term** dropdown filters by term with per-term counts, each
   row shows the term as a badge, the term is included in the search box and exported
   as a **Search Term** column, and passive leads (found outside a run) fall under
   *No search term*.
7. Every visited profile is extracted — the confidence threshold is bypassed — but
   **only profiles that end up saved as leads (no website) count toward the target**.
   Profiles that display a website are still visited and counted in statistics
   (*With website*) but do not advance the counter.
8. **Linktree resolution**: if the only link in the bio is a Linktree
   (`linktr.ee/…`), the run opens the Linktree page in the driven tab and checks its
   links. A real website found there excludes the profile (counted under *With
   website*, does not count toward the target); no website found means the profile is
   saved as a lead and counts. WhatsApp / social links on the Linktree are ignored, so
   they can never fake a website.
9. **Caption contacts**: phone numbers and emails found in a post's caption are stashed
   under the post's author and merged into the profile when it is extracted — so a
   brand that hides its number in posts still ends up with `phone_normalized`/`email`
   on the saved lead (when the save-phone/save-email settings allow it). Caption-sourced
   numbers are flagged `caption_source` for review (see *Phone number verification*).
10. **Collab posts**: a post co-authored by an influencer and a brand lists both
   accounts. The run ranks every author (business keywords in the handle, search-term
   matches; name-like handles and blogger markers such as `blog`/`daily`/`vlogs` are
   deprioritized) and opens only the best-ranked one — so the brand's profile is
   opened, not the influencer's. If that author was already visited, the post is
   skipped entirely; the influencer account is never opened.

While an Auto Search or Google Maps run is active the passive scanner pauses so
each profile is submitted exactly once and every lead keeps the run's search term
(passive finds without an active run land under *No search term* by design).

### Google Maps search mode

1. In the popup, press the **Google Maps** switch next to the search box (the box
   itself is shared — same terms field, same target field, same Start/Stop button).
2. Enter place searches (`spa in dubai`, `laser clinic Dubai`, …), one per line or
   comma-separated, and the number of **places to collect per term** (1–500).
3. Press **Start Search**. The extension opens
   `google.com/maps/search/?q=…` in a tab it drives exactly like Auto Search —
   same random 2–4 second pacing: it harvests every `/maps/place/…` link from the
   results, **scrolls the results feed to load more results (infinite scroll, not
   just the first screenful)**, opens each place page one at a time, and reads the
   place panel (name, category, address, `tel:`/`data-item-id` phone, website).
4. **Only places with no website are saved** — places that list a website are
   opened and counted in statistics (*With website*) but skipped, exactly like the
   Instagram rule. Saved leads get a `maps_key` identity (no fake @username), the
   place URL as `source_page`, the address as `location`, the panel phone (verified
   like every other number) and the current **search term**. When a term reaches
   its target (or its results run out) the run continues with the next term; the
   last term stops the run.
5. The dashboard's **Instagram / Maps** column shows **Maps ↗** for maps leads
   (click to reopen the place); `@username` cells stay as they are. WhatsApp
   outreach works with maps leads out of the box — only Instagram DM drafts need a
   username and skip maps leads for that reason.
6. Press the **Instagram** switch to go back. Starting one mode always stops the
   other (`Stopped — Google Maps search started` / `Stopped — Instagram search
   started`), so only one run is ever active.

Google Maps may show a consent/cookie interstitial on `consent.google.com`, a
host the extension has no access to — the driver cannot answer it. If the run
reports *blocked* or finds no results, complete the interstitial by hand in the
driven tab and start the search again.

### Toolbar popup

- Auto Search: **Instagram / Google Maps** source switch over one shared search
  box (terms, per-term target, start/stop, live progress with `term i/N` and
  session total — whichever source is active)
- Start/stop passive scanning (per-session toggle)
- Live counters: scanned, businesses, with/without website, saved, duplicates
- **Default country code for numbers without +CC** (fallback used by *Fix numbers*)
- Open dashboard

### Dashboard

- Search and filter leads (including the *Influencers (ignored)* and *Bad number* chips),
  edit status/notes — the name column is **Instagram / Maps**: `@username` links
  for Instagram leads, **Maps ↗** (the place page) for Google Maps leads
- **Search term** dropdown: shows every term that produced leads with per-term counts
  (*No search term* collects passive/manual finds) — selecting one filters the table;
  each row carries its term as a badge, and the term is also part of the search box
- **Merge selected**: with two or more rows checked, combines them into the
  first-checked lead (longest name/bio/category/location, best phone, first
  email/website, highest confidence, union of search terms and notes with a
  `Merged from @…` provenance line) and removes the others — confirm first
- **Flag influencers** re-scan for creator-style profiles
- **Fix numbers** verifies every stored phone and auto-corrects numbers that
  contradict the profile bio (↻ marks corrected cells); unresolved cells show ⚠ and
  ✎ to type a trusted correction
- **Outreach drafts** panel: channel (WhatsApp / Instagram DM), message templates with
  placeholders, prepare/stop, live status, ready-banner with a beep
- Delete individual leads or clear all
- **Export Excel** (`.xlsx`) and **Export CSV** (UTF-8 with BOM) — both include
  the **Search Term** column plus per-lead **WhatsApp Message** and **Instagram
  Message** columns rendered from your
  templates; *Export all* excludes `Ignore`d influencer leads and says how many
- Settings: confidence threshold (default 70), `debug` logging toggle

## Privacy

- Only permission: `storage` + host access to `https://www.instagram.com/*`,
  `https://linktr.ee/*` (so Auto Search can open a profile's Linktree and read it
  with a content script) and `https://www.google.com/*` (so the Google Maps search
  mode can read the results and place pages it drives — no Google service is ever
  *fetched* by the extension; everything is read from the pages the mode itself
  opens).
- Outreach drafts only *open tabs* (`chrome.tabs.create` needs no permission): the
  WhatsApp deep link and the Instagram profile page are ordinary navigations, the message is
  either in the URL or typed by the dm-drafter content script on `instagram.com` — no extra
  host access to `web.whatsapp.com` is requested and none is needed.
- Data is written exclusively to `chrome.storage.local` on your computer.
- No network requests are made by the extension (verified by `scripts/check.js`, which
  fails the build on any remote `<script src>`, `fetch` to a non-Instagram origin, or
  host permission outside `instagram.com`/`linktr.ee`/`google.com`).
- Exported files are produced in-browser via Blob download.

## Development

```
npm run check    # syntax + MV3 manifest validation + no-remote-code scan
npm run test     # 94 unit/integration tests (jsdom, mocked chrome.*, real SW handlers)
npm run build    # copy source into dist/ and verify manifest references
npm run verify   # check + test + build
npm run smoke    # real headless Chrome end-to-end test
```

### Smoke test details

`scripts/smoke.js`:

1. Generates a self-signed certificate for `www.instagram.com` + `www.google.com`
   and serves an Instagram-shaped fixture over HTTPS on a random localhost port
   (plus a direct-message page, a stand-in for `web.whatsapp.com`, and Google Maps
   results/place-page fixtures).
2. Launches headless Chrome with `--remote-debugging-pipe
   --enable-unsafe-extension-debugging` and a throwaway profile, mapping
   `www.instagram.com`, `linktr.ee`, `web.whatsapp.com` and `www.google.com` to the
   fixture via `--host-resolver-rules`.
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
    with an empty `website`, stamped it with the session's **search term**
    (`search_term === 'skin clinic'`), counted the harvested post links
    (`autoSearch.searchHarvested > 0`, proving a populated keyword page never
    triggers the hashtag fallback), and stopped itself at the target
    (`autoSearch.phase === 'done'`, `collected >= 2`, counting only saved leads).
7. Opens the dashboard over CDP and runs the phone verification flow: `CLEAN_PHONES`
   flags the caption-sourced number as `caption_source`, then `SET_PHONE` accepts the
   correct number and clears the flag on the stored lead.
8. Sends `OUTREACH_START` for the saved lead twice:
   **Instagram DM** — asserts the profile fixture's **Message** button was clicked
   (the tab navigates to `/direct/t/…`), the runner reported `state: 'done'` with
   1 prepared / 0 failed, and the rendered template was typed and **verified-sent**
   from the thread composer; **WhatsApp** — asserts the opened
   tab URL is `web.whatsapp.com/send?phone=393331234567&text=…` with the rendered
   message in it (prefilled, not sent).
9. Sends `MERGE_LEADS` for the auto-search lead plus the passive profile lead:
    asserts the merge reports 2 merged into the first-selected id, the lead list
    shrinks by exactly one, the merged-away lead is gone, and the survivor keeps
    the unioned `search_term`.
10. Sends `MAPS_START` for `spa in dubai` (target 12) and asserts the Google Maps
    run opened the results fixture — an **8-link results feed that appends 8 more
    links only when scrolled**, so the run can only reach 12 by scrolling the feed
    (proves the infinite-scroll pagination) — visited at least 12 place pages
    (server-side hit counter), **saved the places without a website** (`maps_key`,
    place URL as `source_page`, address as `location`, phones
    `+971501234567`/`+971507778888` on the named fixtures, `search_term` stamped,
    empty username/url), **excluded the place that lists a website**
    (Glow Med Spa, counted in `statistics.withWebsite >= 1`), persisted the source
    switch (`settings.autoSearchSource === 'maps'`), and finished at target
    (`mapsSearch.phase === 'done'`, `totalCollected === 12`).

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
    dm-drafter.js                 runs on all instagram.com pages; on a lead's profile
                                  it clicks the Message button, waits for the thread,
                                  types the prepared draft (insertText), sends it
                                  (Enter, Send button fallback) and reports
                                  send_failed unless the composer cleared
    auto-search.js                active loop: harvest posts -> caption contact stash
                                  -> author profile -> extract; holds profiles whose
                                  only link is a Linktree
    maps-search.js                Google Maps driver (runs on google.com/maps):
                                  claim -> harvest /maps/place/ links -> open each
                                  place -> extract the panel (name, category,
                                  address, tel:, website) -> submit with saveAll;
                                  cycles with the same 2-4 s pacing
    linktree-resolver.js          runs on linktr.ee during Auto Search; reports the first
                                  real website link (or none) back to the SW
  background/service-worker.js    single writer for leads/statistics; auto-search queue
                                  (multi-term: sequential per-term runs with automatic
                                  advance, keyword→hashtag surface fallback when a
                                  search page comes up empty, search-term stamping on
                                  saved leads) and the Google Maps queue (same
                                  multi-term/advance/stop-other-mode semantics,
                                  `maps_key` lead identity, place URL validation),
                                  tab driving (claim/navigate/advance), Linktree
                                  hold/resolve handlers, post-contact stash, influencer
                                  flagging, the target counter (counts only saved,
                                  non-ignored leads), and MERGE_LEADS (combine
                                  selected leads into the first selected)
  background/outreach-runner.js   paced draft preparation: one tab per lead (WhatsApp
                                  deep link / IG profile + Message click); every tab must
                                  finish loading before the next one opens (WhatsApp
                                  13-24 s apart, IG 5-8 s), types via dm-drafter, tracks
                                  prepared/failed, activates the first tab when done;
                                  recovers interrupted runs
  export/excel.js                 bundled SheetJS workbook builder (+ message columns)
  export/csv.js                   CSV with BOM + RFC quoting (shares column model)
  popup/                          toolbar UI (Instagram / Google Maps source switch
                                  over one shared search box)
  dashboard/                      management UI, settings, export buttons, search-term
                                  filter, merge-selected, outreach
                                   panel with templates, beep and flag-influencers
lib/xlsx/xlsx.full.min.js         vendored SheetJS (local, no CDN)
scripts/                          check, build, icons, smoke
 tests/                            94-test suite
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
- Instagram's keyword search occasionally serves **no posts at all** (for the search
  box too, typically clearing up after a while). Auto Search detects the empty term
  and retries it as derived hashtags before moving on, but if Instagram empties
  hashtag pages as well, there is nothing the extension can scrape that session —
  check Instagram for a "Try Again Later" / restriction notice and rerun later.
- The Google Maps mode reads only what the driven place pages render — name,
  category, address, phone and website come from the visible panel (no Places API,
  no hidden data). Google's consent/cookie interstitial lives on
  `consent.google.com`, a host the extension deliberately does not access, so the
  driver cannot answer it: if it appears, complete it by hand and restart the run.
  As with Instagram, heavy automated pacing can trigger a challenge — the run
  reports *blocked* instead of retrying through it.
- Export contains whatever was stored locally; deleting the extension or clearing
  site data removes the leads.
- Influencer detection is a conservative heuristic: it deliberately misses ambiguous
  accounts rather than hiding real businesses. Check the *Influencers (ignored)* chip
  once in a while and flip anything back to `New` (or run **Flag influencers** after
  editing bios).
- Outreach only ever types and presses Enter inside the tab it opened for that lead —
  it never re-sends, never opens a second chat for a lead you already contacted, and
  never sends anything on WhatsApp (those drafts are yours to send). Instagram sends
  are verified (the composer must clear) and reported as `send_failed` otherwise, with
  the unsent text left in its tab. The completion **beep plays in the dashboard tab**
  (keep it open); WhatsApp drafts require being logged into WhatsApp Web, and
  Instagram messages depend on the current DM composer markup — if Instagram changes
  it, the lead is reported as failed (`no_composer`, `insert_failed`, or
  `send_failed`) instead of typing blindly.
- Batches are capped at 20 tabs per run (extra ids are reported as `batch_limit`) so a
  mis-click cannot open hundreds of tabs.
- The smoke test requires `openssl` on PATH (or `C:\msys64\ucrt64\bin\openssl.exe`).
