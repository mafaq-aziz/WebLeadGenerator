#!/usr/bin/env node
/* FICINO lead scraper test suite: pure logic + jsdom DOM fixtures + export round-trip. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');

let passed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log('  ok   ' + name);
    })
    .catch((err) => {
      failures.push({ name, err });
      console.log('  FAIL ' + name + '\n       ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err));
    });
}

function load(rel) {
  const full = path.join(root, rel);
  const code = fs.readFileSync(full, 'utf8');
  new Function(code).call(globalThis);
}

function makeMockChrome() {
  const store = {};
  const listeners = [];
  const tabListeners = { updated: [], removed: [] };
  const tabCalls = { created: [], updated: [], sent: [], list: [{ id: 5, active: true, url: 'https://www.instagram.com/' }] };
  const chromeMock = {
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
          setTimeout(() => cb(out), 0);
        },
        set(items, cb) {
          Object.assign(store, items);
          if (cb) setTimeout(() => cb(), 0);
        }
      },
      onChanged: {
        addListener(fn) { listeners.push(fn); },
        _emit(changes, area) { listeners.forEach((fn) => fn(changes, area)); }
      }
    },
    runtime: {
      lastError: null,
      sendMessage() {},
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    },
    tabs: {
      create(opts, cb) {
        const tab = { id: 101 + tabCalls.created.length, url: opts.url, active: !!opts.active };
        tabCalls.created.push(tab);
        if (cb) setTimeout(() => cb(tab), 0);
        return tab;
      },
      update(id, opts, cb) {
        tabCalls.updated.push({ id, url: opts.url, active: !!opts.active });
        const tab = { id, url: opts.url };
        if (cb) setTimeout(() => cb(tab), 0);
        return tab;
      },
      sendMessage(tabId, msg, cb) {
        tabCalls.sent.push({ tabId, msg });
        setTimeout(() => cb && cb({ ok: true }), 0);
      },
      query(info, cb) {
        setTimeout(() => cb(tabCalls.list.filter((t) => !info || !info.url || String(t.url || '').indexOf('https://www.instagram.com') === 0)), 0);
      },
      onRemoved: { addListener(fn) { tabListeners.removed.push(fn); } },
      onUpdated: { addListener(fn) { tabListeners.updated.push(fn); } }
    },
    _store: store,
    _tabCalls: tabCalls,
    _fireUpdated(tabId, info) {
      tabListeners.updated.slice().forEach((fn) => { try { fn(tabId, info); } catch (e) { /* ignore */ } });
    },
    _fireRemoved(tabId) {
      tabListeners.removed.slice().forEach((fn) => { try { fn(tabId); } catch (e) { /* ignore */ } });
    }
  };
  return chromeMock;
}

const GLOBAL_KEYS = ['document', 'location', 'history', 'MutationObserver', 'getComputedStyle', 'addEventListener', 'removeEventListener'];

function attachGlobals(win) {
  const saved = {};
  GLOBAL_KEYS.forEach((k) => {
    saved[k] = globalThis[k];
    try {
      Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true });
    } catch (e) {
      globalThis[k] = win[k];
    }
  });
  return function restore() {
    GLOBAL_KEYS.forEach((k) => {
      try {
        if (saved[k] === undefined) delete globalThis[k];
        else Object.defineProperty(globalThis, k, { value: saved[k], configurable: true, writable: true });
      } catch (e) {
        if (saved[k] === undefined) delete globalThis[k];
        else globalThis[k] = saved[k];
      }
    });
  };
}

function loadServiceWorker() {
  const listeners = [];
  const installed = [];
  const chromeMock = makeMockChrome();
  chromeMock.runtime.onMessage = { addListener: (fn) => listeners.push(fn) };
  chromeMock.runtime.onInstalled = { addListener: (fn) => installed.push(fn) };
  chromeMock.runtime.onStartup = { addListener: () => {} };
  globalThis.chrome = chromeMock;
  globalThis.importScripts = function () {
    const args = Array.prototype.slice.call(arguments);
    args.forEach((rel) => load(path.join('src', 'background', rel)));
  };
  load('src/background/service-worker.js');
  return {
    chrome: chromeMock,
    dispatch: function (message, sender) {
      return new Promise((resolve, reject) => {
        if (!listeners.length) return reject(new Error('no message listener registered'));
        const timer = setTimeout(() => reject(new Error('no response for ' + message.type)), 3000);
        const keep = listeners[0](message, sender || {}, (resp) => {
          clearTimeout(timer);
          resolve(resp);
        });
        if (keep !== true) {
          clearTimeout(timer);
          resolve(undefined);
        }
      });
    }
  };
}

async function run() {
  console.log('[1] normalizer');
  const chromeMock = makeMockChrome();
  globalThis.chrome = chromeMock;

  load('src/shared/logger.js');
  load('src/storage/storage.js');
  load('src/content/normalizer.js');
  load('src/content/selectors.js');
  load('src/content/profile-extractor.js');
  load('src/content/business-detector.js');
  load('src/content/mutation-observer.js');
  load('src/shared/templates.js');
  load('src/content/influencer-detector.js');
  load('src/export/excel.js');
  load('src/export/csv.js');

  const N = globalThis.FicinoNormalizer;
  const S = globalThis.FicinoSelectors;
  const D = globalThis.FicinoBusinessDetector;
  const MO = globalThis.FicinoMutationObserver;
  const E = globalThis.FicinoExcelExport;
  const C = globalThis.FicinoCsvExport;
  const EX = globalThis.FicinoProfileExtractor;

  await test('username: strips @, slashes, query', () => {
    assert.strictEqual(N.normalizeUsername('@cool_shop/'), 'cool_shop');
    assert.strictEqual(N.normalizeUsername('https://www.instagram.com/cool_shop/?hl=en'), 'cool_shop');
    assert.strictEqual(N.normalizeUsername('  bad user! '), 'baduser');
  });

  await test('username: valid/invalid shapes', () => {
    assert.ok(N.isValidUsername('abc.def_1'));
    assert.ok(!N.isValidUsername(''));
    assert.ok(!N.isValidUsername('has space'));
    assert.ok(!N.isValidUsername('a'.repeat(40)));
  });

  await test('usernameFromUrl extracts profile segment, rejects bad hosts', () => {
    assert.strictEqual(N.usernameFromUrl('https://www.instagram.com/nike/'), 'nike');
    assert.strictEqual(N.usernameFromUrl('/salon_lahore/'), 'salon_lahore');
    assert.strictEqual(N.usernameFromUrl('https://example.com/whatever'), '');
    assert.strictEqual(N.usernameFromUrl('https://www.instagram.com/'), '');
    assert.ok(S.isReservedSegment('explore'), 'reserved segments filtered by callers');
  });

  await test('normalizeProfileUrl canonical form', () => {
    assert.strictEqual(N.normalizeProfileUrl('nike'), 'https://www.instagram.com/nike/');
    assert.strictEqual(N.normalizeProfileUrl('@nike/'), 'https://www.instagram.com/nike/');
  });

  await test('normalizeExternalUrl strips protocol/www/tracking', () => {
    assert.strictEqual(N.normalizeExternalUrl('http://www.Example.com/'), 'https://example.com');
    assert.strictEqual(N.normalizeExternalUrl('example.com'), 'https://example.com');
    assert.strictEqual(N.normalizeExternalUrl('https://example.com/page?utm_source=ig&x=1'), 'https://example.com/page?x=1');
    assert.strictEqual(N.normalizeExternalUrl('not a url'), '');
  });

  await test('domain equality treats www/protocol variants as same site', () => {
    assert.ok(N.urlsEqual('https://example.com', 'http://www.example.com/'));
    assert.ok(!N.urlsEqual('https://example.com', 'https://other.com'));
  });

  await test('isNonWebsiteUrl: messaging and link-in-bio links are not websites', () => {
    assert.strictEqual(N.isNonWebsiteUrl('https://wa.me/39123456'), true);
    assert.strictEqual(N.isNonWebsiteUrl('https://wa.link/promo'), true);
    assert.strictEqual(N.isNonWebsiteUrl('https://api.whatsapp.com/send?phone=1'), true);
    assert.strictEqual(N.isNonWebsiteUrl('https://linktr.ee/a1_shop'), true);
    assert.strictEqual(N.isNonWebsiteUrl('https://m.me/some_shop'), true);
    assert.strictEqual(N.isNonWebsiteUrl('https://their-site.com'), false);
    assert.strictEqual(N.isNonWebsiteUrl(''), false);
    assert.strictEqual(N.isNonWebsiteUrl(null), false);
  });

  await test('phone extraction: intl and local formats, rejects years', () => {
    const phones = N.extractPhones('Call +92 300 1234567 or 0300 1234567 today 2024');
    assert.ok(phones.length >= 2, 'expected >=2 phones, got ' + JSON.stringify(phones));
    assert.strictEqual(phones[0].normalized, '+923001234567');
    assert.ok(phones.some((p) => p.normalized === '03001234567'));
    assert.ok(!phones.some((p) => p.normalized === '2024'));
  });

  await test('phone: rejects too-short digit runs', () => {
    assert.deepStrictEqual(N.extractPhones('room 12 and door 4'), []);
  });

  await test('email extraction with conservative regex', () => {
    const emails = N.extractEmails('Mail hello@example.com or info@business.pk now');
    assert.deepStrictEqual(emails, ['hello@example.com', 'info@business.pk']);
    assert.deepStrictEqual(N.extractEmails('no email here'), []);
  });

  await test('text normalization collapses whitespace but keeps bio meaning', () => {
    assert.strictEqual(N.collapseWhitespace('  a \n  b  '), 'a b');
    assert.strictEqual(N.collapseMultiline('line1  \n\n\nline2'), 'line1\n\nline2');
  });

  await test('followers parsing from header text', () => {
    assert.strictEqual(N.parseFollowers('1,234 Followers 56 Following 89 Posts'), '1,234');
    assert.strictEqual(N.parseFollowers('12K Followers'), '12K');
    assert.strictEqual(N.parseFollowers('nothing here'), '');
  });

  console.log('[2] business detection');
  await test('strong business scores >= 70 (category + phone + keyword)', () => {
    const result = D.detectBusiness({
      instagram_username: 'abc_clinic',
      instagram_name: 'ABC Aesthetics Clinic',
      bio: 'Premium aesthetics clinic in Dubai',
      category: 'Beauty, cosmetic & personal care',
      phone_normalized: '+971501234567'
    });
    assert.ok(result.confidence >= 70, 'score was ' + result.confidence);
    assert.strictEqual(D.bandFor(result.confidence) === 'unlikely', false);
  });

  await test('personal profile scores <= 30', () => {
    const result = D.detectBusiness({
      instagram_username: 'random_person_123',
      instagram_name: 'Alex',
      bio: 'Food | Travel | Life'
    });
    assert.ok(result.confidence <= 30, 'score was ' + result.confidence);
    assert.strictEqual(D.bandFor(result.confidence), 'unlikely');
  });

  await test('keyword matching is word-boundary aware (car vs cargo)', () => {
    assert.ok(D.keywordHit('Car rental service', S.BUSINESS_KEYWORDS));
    assert.ok(!D.keywordHit('Cargo ship enthusiast', S.BUSINESS_KEYWORDS));
  });

  await test('band boundaries match spec', () => {
    assert.strictEqual(D.bandFor(30), 'unlikely');
    assert.strictEqual(D.bandFor(31), 'possible');
    assert.strictEqual(D.bandFor(60), 'possible');
    assert.strictEqual(D.bandFor(61), 'likely');
    assert.strictEqual(D.bandFor(80), 'likely');
    assert.strictEqual(D.bandFor(81), 'strong');
    assert.strictEqual(D.bandFor(100), 'strong');
  });

  console.log('[3] DOM fixtures (jsdom)');
  let JSDOM;
  try {
    ({ JSDOM } = require('jsdom'));
  } catch (e) {
    console.log('  SKIP jsdom not installed');
  }

  if (JSDOM) {
    const EX = globalThis.FicinoProfileExtractor;

    function dom(html, url) {
      return new JSDOM(html, { url: url || 'https://www.instagram.com/' });
    }

    function profileFixture(opts) {
      const o = opts || {};
      return `<!DOCTYPE html><html><head>
        <meta name="description" content="${o.metaDesc || ''}" />
        <title>${o.title || 'Instagram'}</title>
      </head><body>
        <main>
          <header>
            <section>
              <h2>${o.heading || o.username}</h2>
              ${o.name ? `<span dir="auto">${o.name}</span>` : ''}
              ${o.category ? `<span dir="auto">${o.category}</span>` : ''}
              <div dir="auto">${(o.bio || '').replace(/\n/g, '<br>')}</div>
              ${o.website ? `<a href="${o.website}">${o.website.replace(/^https?:\/\//, '')}</a>` : ''}
              ${o.phone ? `<a href="tel:${o.phone.replace(/\s/g, '')}">${o.phone}</a>` : ''}
              ${o.email ? `<a href="mailto:${o.email}">${o.email}</a>` : ''}
              <ul><li>1,234 Followers</li></ul>
            </section>
          </header>
        </main>
      </body></html>`;
    }

    await test('Test A: business profile WITH website is detected and excluded', () => {
      const d = dom(profileFixture({
        username: 'abc_aesthetics',
        heading: 'ABC Aesthetics',
        name: 'ABC Aesthetics',
        category: 'Beauty, cosmetic & personal care',
        bio: 'Premium aesthetics clinic in Dubai\nBook now',
        website: 'https://abc-aesthetics.ae'
      }), 'https://www.instagram.com/abc_aesthetics/');
      const doc = d.window.document;
      const website = EX.extractWebsite(doc);
      assert.ok(website, 'website should be detected');
      assert.ok(/abc-aesthetics\.ae/.test(website), 'got: ' + website);

      const profile = {
        instagram_username: EX.extractUsername(doc),
        instagram_name: EX.extractBusinessName(doc, 'abc_aesthetics'),
        bio: EX.extractBio(doc),
        category: EX.extractCategory(doc),
        website: website,
        phone_raw: '', phone_normalized: '',
        email: EX.extractEmail(doc)
      };
      const det = D.detectBusiness(profile);
      assert.ok(det.confidence >= 70, 'detected as business, score ' + det.confidence);
      assert.ok(profile.website, 'must be excluded because website present');
    });

    await test('Test B: business profile WITHOUT website is saved', () => {
      const d = dom(profileFixture({
        username: 'xyz_beauty',
        heading: 'XYZ Beauty Studio',
        name: 'XYZ Beauty Studio',
        category: 'Beauty salon',
        bio: 'Beauty studio | Lahore\nAppointments via WhatsApp',
        phone: '+92 300 1234567'
      }), 'https://www.instagram.com/xyz_beauty/');
      const doc = d.window.document;
      const website = EX.extractWebsite(doc);
      assert.strictEqual(website, '', 'no external link expected');

      const profile = {
        instagram_username: EX.extractUsername(doc),
        instagram_name: EX.extractBusinessName(doc, 'xyz_beauty'),
        bio: EX.extractBio(doc),
        category: EX.extractCategory(doc),
        website: website,
        phone: EX.extractPhone(doc),
        email: EX.extractEmail(doc),
        location: EX.extractLocation(doc),
        followers: EX.extractFollowers(doc)
      };
      profile.phone_raw = profile.phone.raw;
      profile.phone_normalized = profile.phone.normalized;
      const det = D.detectBusiness(profile);
      assert.ok(det.confidence >= 70, 'score ' + det.confidence);
      assert.ok(!profile.website, 'no website -> eligible to save');
      assert.strictEqual(profile.phone_normalized, '+923001234567');
      assert.ok(profile.followers, 'followers parsed');
    });

    await test('Test C: personal profile is ignored', () => {
      const d = dom(profileFixture({
        username: 'random_person_123',
        heading: 'random_person_123',
        bio: 'Food | Travel | Life'
      }), 'https://www.instagram.com/random_person_123/');
      const doc = d.window.document;
      const profile = {
        instagram_username: EX.extractUsername(doc),
        instagram_name: EX.extractBusinessName(doc, 'random_person_123'),
        bio: EX.extractBio(doc),
        category: EX.extractCategory(doc),
        website: EX.extractWebsite(doc)
      };
      assert.strictEqual(profile.category, '', 'no category expected');
      assert.strictEqual(profile.website, '', 'no website expected');
      const det = D.detectBusiness(profile);
      assert.ok(det.confidence < 70, 'score ' + det.confidence + ' must be below threshold');
    });

    await test('extractProfileLinks finds candidates and skips reserved paths', () => {
      const d = dom(`<!DOCTYPE html><html><body>
        <div id="grid">
          <a href="/shop_one/">shop_one</a>
          <a href="/explore/">Explore</a>
          <a href="/p/ABC123/">post</a>
          <a href="https://www.instagram.com/shop_two/">shop_two</a>
          <a href="/reels/">Reels</a>
        </div>
      </body></html>`, 'https://www.instagram.com/explore/');
      const links = EX.extractProfileLinks(d.window.document);
      const names = links.map((l) => l.username).sort();
      assert.deepStrictEqual(names, ['shop_one', 'shop_two']);
    });

    await test('bio extraction picks the long dir=auto block, not the name', () => {
      const d = dom(profileFixture({
        username: 'derma_glow',
        heading: 'Derma Glow Clinic',
        name: 'Derma Glow Clinic',
        category: 'Skin care clinic',
        bio: 'Board certified dermatologists\nSkin, laser & hair treatments\nCall for appointments'
      }), 'https://www.instagram.com/derma_glow/');
      const bio = EX.extractBio(d.window.document);
      assert.ok(/dermatologists/i.test(bio), 'bio was: ' + bio);
      assert.ok(!/^Derma Glow/.test(bio), 'name should not be the bio: ' + bio);
    });

    await test('category extraction from profile header', () => {
      const d = dom(profileFixture({
        username: 'tasty_bites',
        heading: 'Tasty Bites',
        name: 'Tasty Bites',
        category: 'Restaurant',
        bio: 'Best burgers in town'
      }), 'https://www.instagram.com/tasty_bites/');
      const category = EX.extractCategory(d.window.document);
      assert.ok(/restaurant/i.test(category), 'category was: ' + category);
    });

    await test('contact dialog exposes phone/email when rendered', () => {
      const d = dom(`<!DOCTYPE html><html><body>
        <main><header><section>
          <h2>FixIt Repairs</h2>
          <span dir="auto">FixIt Repairs</span>
          <span dir="auto">Electronics repair shop</span>
          <div dir="auto">We fix phones and laptops</div>
        </section></header></main>
        <div role="dialog">
          <span>Phone</span><a href="tel:+971551234567">+971 55 123 4567</a>
          <span>Email</span><a href="mailto:fix@it.com">fix@it.com</a>
          <span>Address</span><span>Al Barsha, Dubai</span>
        </div>
      </body></html>`, 'https://www.instagram.com/fixit_repairs/');
      const doc = d.window.document;
      const phone = EX.extractPhone(doc);
      assert.strictEqual(phone.normalized, '+971551234567');
      assert.strictEqual(EX.extractEmail(doc), 'fix@it.com');
      assert.ok(/Barsha/.test(EX.extractLocation(doc)), 'location: ' + EX.extractLocation(doc));
    });

    await test('website detection: social links do not count as the business website', () => {
      const d = dom(profileFixture({
        username: 'studio_x',
        heading: 'Studio X',
        bio: 'Photography studio',
        website: 'https://www.facebook.com/studiox'
      }), 'https://www.instagram.com/studio_x/');
      // facebook.com is blocked by isExternalHost (social), so no business website is found
      const website = EX.extractWebsite(d.window.document);
      assert.strictEqual(website, '', 'facebook link should not be treated as website, got: ' + website);
    });

    await test('website detection: bio text URL also counts', () => {
      const d = dom(`<!DOCTYPE html><html><body><main><header><section>
        <h2>Webby Co</h2><span dir="auto">Webby Co</span>
        <div dir="auto">Visit us at www.webbyco.com for more</div>
      </section></header></main></body></html>`, 'https://www.instagram.com/webby_co/');
      const website = EX.extractWebsite(d.window.document);
      assert.ok(website, 'website from bio text expected, got: ' + JSON.stringify(website));
    });

    await test('website detection: whatsapp and linktree links are not websites', () => {
      const wa = dom(profileFixture({
        username: 'wa_brand',
        heading: 'WA Brand',
        bio: 'Message us for orders',
        website: 'https://wa.me/393331234567'
      }), 'https://www.instagram.com/wa_brand/');
      const waSite = EX.extractWebsite(wa.window.document);
      assert.strictEqual(waSite, '', 'whatsapp link must not count as website, got: ' + waSite);

      const lt = dom(profileFixture({
        username: 'lt_brand',
        heading: 'LT Brand',
        bio: 'All my links',
        website: 'https://linktr.ee/lt_brand'
      }), 'https://www.instagram.com/lt_brand/');
      const ltSite = EX.extractWebsite(lt.window.document);
      assert.strictEqual(ltSite, '', 'linktree must not count as website, got: ' + ltSite);
      const ltUrl = EX.extractLinktree(lt.window.document);
      assert.ok(/^https:\/\/linktr\.ee\/lt_brand$/.test(ltUrl), 'linktree url expected, got: ' + ltUrl);

      const txt = dom(profileFixture({
        username: 'txt_brand',
        heading: 'Txt Brand',
        bio: 'Reach us on wa.me/39333999999 for bookings'
      }), 'https://www.instagram.com/txt_brand/');
      const txtSite = EX.extractWebsite(txt.window.document);
      assert.strictEqual(txtSite, '', 'wa.me in bio text must not count as website, got: ' + txtSite);

      const real = dom(profileFixture({
        username: 'real_site',
        heading: 'Real Site',
        bio: 'Our page',
        website: 'https://real-site.com'
      }), 'https://www.instagram.com/real_site/');
      const realSite = EX.extractWebsite(real.window.document);
      assert.ok(/real-site\.com/.test(realSite), 'real website must still be detected, got: ' + realSite);
      assert.strictEqual(EX.extractLinktree(real.window.document), '');
    });

    await test('Test E: MutationObserver fires on dynamically added nodes', async () => {
      const d = dom(`<!DOCTYPE html><html><body><div id="feed"></div></body></html>`,
        'https://www.instagram.com/explore/');
      const restore = attachGlobals(d.window);
      try {
        let batches = 0;
        const obs = MO.createObserver({ onBatch: () => { batches++; }, debounceMs: 30 });
        obs.start();
        const div = d.window.document.createElement('div');
        const a = d.window.document.createElement('a');
        a.setAttribute('href', '/late_loaded_profile/');
        div.appendChild(a);
        d.window.document.getElementById('feed').appendChild(div);
        await new Promise((r) => setTimeout(r, 150));
        assert.strictEqual(batches, 1, 'expected one batch, got ' + batches);
        obs.stop();
      } finally {
        restore();
      }
    });

    await test('Test F: observer detects SPA navigation via history.pushState', async () => {
      const d = dom(`<!DOCTYPE html><html><body></body></html>`, 'https://www.instagram.com/explore/');
      const restore = attachGlobals(d.window);
      try {
        const seen = [];
        const obs = MO.createObserver({
          onBatch: () => {},
          onUrlChange: (url) => seen.push(url),
          debounceMs: 30
        });
        obs.start();
        d.window.history.pushState({}, '', '/some_brand/');
        await new Promise((r) => setTimeout(r, 120));
        assert.ok(seen.some((u) => /some_brand/.test(u)), 'url change not detected: ' + seen.join(','));
        obs.stop();
      } finally {
        restore();
      }
    });
  }

  console.log('[4] storage + duplicate prevention (mocked chrome.storage)');
  await test('Test D: same profile encountered 10 times -> one lead', async () => {
    const Storage = globalThis.FicinoStorage;
    chromeMock._store.leads = [];
    chromeMock._store.statistics = Object.assign({}, Storage.DEFAULT_STATS);
    const leads = [];
    for (let i = 0; i < 10; i++) {
      const existing = await Storage.getLeads();
      const key = 'dup_profile';
      const found = existing.find((l) => l.instagram_username === key);
      if (found) {
        found.confidence = Math.max(found.confidence, 80);
        await Storage.setLeads(existing);
      } else {
        leads.push({ instagram_username: key, confidence: 80, id: 'ig_' + i });
        await Storage.setLeads(existing.concat(leads.slice(-1)));
      }
    }
    const final = await Storage.getLeads();
    assert.strictEqual(final.length, 1, 'expected 1 lead, got ' + final.length);
  });

  await test('settings persist and merge with defaults', async () => {
    const Storage = globalThis.FicinoStorage;
    await Storage.saveSettings({ businessConfidenceThreshold: 55 });
    const s = await Storage.getSettings();
    assert.strictEqual(s.businessConfidenceThreshold, 55);
    assert.strictEqual(s.autoScan, true);
    await Storage.saveSettings({ businessConfidenceThreshold: 70 });
  });

  await test('bumpStats increments counters', async () => {
    const Storage = globalThis.FicinoStorage;
    await Storage.resetStats();
    await Storage.bumpStats({ scanned: 3, businesses: 2 });
    await Storage.bumpStats({ scanned: 1 });
    const stats = await Storage.getStats();
    assert.strictEqual(stats.scanned, 4);
    assert.strictEqual(stats.businesses, 2);
    await Storage.resetStats();
  });

  console.log('[5] export');
  await test('Test H: Excel workbook builds with all required columns', () => {
    globalThis.XLSX = require(path.join(root, 'node_modules', 'xlsx'));
    const leads = [{
      id: 'ig_x_1',
      instagram_username: 'abc_clinic',
      instagram_name: 'ABC Clinic',
      instagram_url: 'https://www.instagram.com/abc_clinic/',
      bio: 'We care, with "quotes" and, commas',
      category: 'Medical clinic',
      phone_raw: '+92 300 1234567',
      phone_normalized: '+923001234567',
      email: 'info@abc.pk',
      website: '',
      location: 'Lahore',
      followers: '1,234',
      source_page: 'https://www.instagram.com/abc_clinic/',
      search_term: 'skin clinic',
      date_found: '2026-01-01 10:00',
      confidence: 85,
      status: 'New',
      notes: 'Good prospect'
    }];
    const wb = E.buildWorkbook(leads);
    const out = globalThis.XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const parsed = globalThis.XLSX.read(out, { type: 'buffer' });
    const rows = globalThis.XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]]);
    assert.strictEqual(rows.length, 1);
    const expectedHeaders = [
      'Instagram Username', 'Business Name', 'Instagram URL', 'Bio', 'Category',
      'Phone', 'Email', 'Website', 'Location', 'Followers', 'Source Page',
      'Search Term', 'Date Found', 'Business Confidence', 'Status', 'Notes',
      'WhatsApp Message', 'Instagram Message'
    ];
    expectedHeaders.forEach((h) => {
      assert.ok(h in rows[0], 'missing column: ' + h);
    });
    assert.strictEqual(rows[0]['Instagram Username'], 'abc_clinic');
    assert.strictEqual(rows[0]['Business Confidence'], 85);
    assert.strictEqual(rows[0]['Website'], '');
    assert.strictEqual(rows[0]['Phone'], '+92 300 1234567');
    assert.strictEqual(rows[0]['Bio'], 'We care, with "quotes" and, commas');
    assert.strictEqual(rows[0]['Search Term'], 'skin clinic', 'search term column exported');
    assert.ok(String(rows[0]['WhatsApp Message']).indexOf('ABC Clinic') !== -1, 'wa message must render the business name');
    assert.ok(String(rows[0]['Instagram Message']).indexOf('ABC Clinic') !== -1, 'ig message must render the business name');
  });

  await test('CSV output: BOM, header order, quoting', () => {
    const leads = [{
      instagram_username: 'a,b',
      instagram_name: 'Has "comma"',
      instagram_url: 'https://www.instagram.com/a_b/',
      bio: 'line1\nline2',
      category: '', phone_raw: '', phone_normalized: '', email: '',
      website: '', location: '', followers: '', source_page: '',
      date_found: '2026-01-01 10:00', confidence: 90, status: 'New', notes: ''
    }];
    const csv = C.toCsv(leads);
    const lines = csv.split('\r\n');
    assert.strictEqual(lines[0], 'Instagram Username,Business Name,Instagram URL,Bio,Category,Phone,Email,Website,Location,Followers,Source Page,Search Term,Date Found,Business Confidence,Status,Notes,WhatsApp Message,Instagram Message');
    assert.ok(csv.indexOf('"a,b"') !== -1, 'comma escaped');
    assert.ok(csv.indexOf('""comma""') !== -1, 'quotes escaped');
    assert.ok(csv.indexOf('line1\nline2') !== -1, 'newline kept inside quotes');
  });

  console.log('[6] service worker decision logic (real handler)');
  await test('Test A/B/D through PROCESS_CANDIDATE: website excluded, no-website saved, dupes merged', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });

    const withSite = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: {
        confidence: 88,
        hasWebsite: true,
        profile: { instagram_username: 'has_site', instagram_name: 'Has Site', website: 'https://x.com' }
      }
    });
    assert.strictEqual(withSite.saved, false);
    assert.strictEqual(withSite.reason, 'has_website');

    const noSite = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: {
        confidence: 88,
        hasWebsite: false,
        profile: { instagram_username: 'no_site', instagram_name: 'No Site', website: '', phone_raw: '+92 300 1234567' }
      }
    });
    assert.strictEqual(noSite.saved, true, 'business without website must be saved');

    const personal = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: {
        confidence: 12,
        hasWebsite: false,
        profile: { instagram_username: 'boring_person', website: '' }
      }
    });
    assert.strictEqual(personal.saved, false);
    assert.strictEqual(personal.reason, 'below_threshold');

    for (let i = 0; i < 9; i++) {
      const dup = await sw.dispatch({
        type: 'PROCESS_CANDIDATE',
        payload: {
          confidence: 95,
          hasWebsite: false,
          profile: { instagram_username: 'no_site', instagram_name: 'No Site Renamed', website: '', email: 'a@b.com' }
        }
      });
      assert.strictEqual(dup.reason, 'duplicate');
      assert.strictEqual(dup.updated, true);
    }

    const snapshot = await sw.dispatch({ type: 'GET_SNAPSHOT' });
    assert.strictEqual(snapshot.leads.length, 1, 'expected 1 lead, got ' + snapshot.leads.length);
    assert.ok(!snapshot.leads.some((l) => l.instagram_username === 'has_site'), 'website lead must not be stored');

    const savedLead = snapshot.leads.find((l) => l.instagram_username === 'no_site');
    assert.ok(savedLead, 'no_site lead missing');
    assert.strictEqual(savedLead.email, 'a@b.com', 'duplicate merge should enrich the lead');
    assert.strictEqual(savedLead.instagram_name, 'No Site Renamed');
    assert.strictEqual(savedLead.website, '');
    assert.strictEqual(savedLead.website_not_found_on_instagram, true);
    assert.strictEqual(savedLead.status, 'New');

    const stats = snapshot.statistics;
    assert.strictEqual(stats.scanned, 12, 'scanned was ' + stats.scanned);
    assert.strictEqual(stats.businesses, 11, 'businesses was ' + stats.businesses);
    assert.strictEqual(stats.withWebsite, 1);
    assert.strictEqual(stats.withoutWebsite, 10);
    assert.strictEqual(stats.duplicates, 9);
    assert.strictEqual(stats.saved, 1);
  });

  await test('DELETE_LEADS and UPDATE_LEAD behave', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    const saved = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 80, hasWebsite: false, profile: { instagram_username: 'del_me', website: '' } }
    });
    assert.strictEqual(saved.saved, true);

    const upd = await sw.dispatch({ type: 'UPDATE_LEAD', payload: { id: saved.id, status: 'Contacted', notes: 'called' } });
    assert.strictEqual(upd.updated, true);
    let snap = await sw.dispatch({ type: 'GET_SNAPSHOT' });
    assert.strictEqual(snap.leads[0].status, 'Contacted');
    assert.strictEqual(snap.leads[0].notes, 'called');

    const del = await sw.dispatch({ type: 'DELETE_LEADS', payload: { ids: [saved.id] } });
    assert.strictEqual(del.removed, 1);
    snap = await sw.dispatch({ type: 'GET_SNAPSHOT' });
    assert.strictEqual(snap.leads.length, 0);

    const invalid = await sw.dispatch({ type: 'PROCESS_CANDIDATE', payload: { confidence: 90, profile: {} } });
    assert.strictEqual(invalid.reason, 'invalid_candidate');
  });

  console.log('[7] content script end-to-end (jsdom + mocked extension APIs)');
  if (JSDOM) {
    await test('scanner sends PROCESS_CANDIDATE for profile and for dynamically added links', async () => {
      const html = `<!DOCTYPE html><html><head><title>Instagram</title></head><body>
        <main><header><section>
          <h2>E2E Clinic</h2>
          <span dir="auto">E2E Clinic</span>
          <span dir="auto">Skin care clinic</span>
          <div dir="auto">Dermatology and laser treatments<br>Walk ins welcome</div>
          <ul><li>2,040 Followers</li></ul>
        </section></header></main>
        <div id="feed"></div>
      </body></html>`;
      const d = new JSDOM(html, {
        url: 'https://www.instagram.com/e2e_clinic/',
        pretendToBeVisual: true,
        runScripts: 'outside-only'
      });
      const win = d.window;

      const sent = [];
      const store = {
        autoSearch: {
          active: false,
          postContacts: {
            e2e_clinic: { phone_raw: '+39 333 123 4567', phone_normalized: '+393331234567', email: 'clinic@e2e.example', at: 1 }
          }
        }
      };
      const changeListeners = [];
      win.chrome = {
        storage: {
          local: {
            get(keys, cb) {
              const out = {};
              (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
              setTimeout(() => cb(out), 0);
            },
            set(items, cb) {
              Object.assign(store, items);
              setTimeout(() => {
                if (items.settings) {
                  changeListeners.forEach((fn) => fn({ settings: { newValue: items.settings } }, 'local'));
                }
                if (cb) cb();
              }, 0);
            }
          },
          onChanged: { addListener: (fn) => changeListeners.push(fn) }
        },
        runtime: {
          lastError: null,
          sendMessage(message, cb) {
            sent.push(message);
            setTimeout(() => cb && cb({ saved: true, reason: 'saved' }), 0);
          },
          onMessage: { addListener() {} }
        }
      };

      const files = [
        'src/shared/logger.js',
        'src/content/normalizer.js',
        'src/content/selectors.js',
        'src/content/profile-extractor.js',
        'src/content/business-detector.js',
        'src/content/mutation-observer.js',
        'src/content/instagram-scanner.js'
      ];
      files.forEach((rel) => win.eval(fs.readFileSync(path.join(root, rel), 'utf8')));

      await new Promise((r) => setTimeout(r, 1200));

      const profileMsgs = sent.filter((m) => m.type === 'PROCESS_CANDIDATE');
      assert.ok(profileMsgs.length >= 1, 'expected profile candidate, got ' + JSON.stringify(sent));
      const first = profileMsgs[0].payload;
      assert.strictEqual(first.profile.instagram_username, 'e2e_clinic');
      assert.strictEqual(first.profile.extraction_level, 'profile');
      assert.ok(first.confidence >= 70, 'confidence ' + first.confidence);
      assert.strictEqual(first.profile.website, '');
      assert.strictEqual(first.profile.phone_normalized, '+393331234567',
        'stashed post phone must merge into the passive candidate');
      assert.strictEqual(first.profile.email, 'clinic@e2e.example',
        'stashed post email must merge into the passive candidate');

      const feed = win.document.getElementById('feed');
      const wrap = win.document.createElement('div');
      wrap.innerHTML = '<a href="/dynamic_shop/">dynamic_shop</a>';
      feed.appendChild(wrap);

      await new Promise((r) => setTimeout(r, 1600));

      const all = sent.filter((m) => m.type === 'PROCESS_CANDIDATE');
      const linkMsg = all.find((m) => m.payload.profile.instagram_username === 'dynamic_shop');
      assert.ok(linkMsg, 'dynamic link candidate not sent: ' + JSON.stringify(all.map((m) => m.payload.profile.instagram_username)));
      assert.strictEqual(linkMsg.payload.profile.extraction_level, 'link');

      const scanner = win.FicinoScanner;
      assert.ok(scanner, 'scanner namespace missing');
      assert.strictEqual(scanner.isScanningEnabled(), true);

      await new Promise((resolve) => {
        win.chrome.storage.local.set({ settings: Object.assign({}, store.settings, { scannerActive: false }) }, resolve);
      });
      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(scanner.isScanningEnabled(), false, 'pause setting should disable scanning');

      await new Promise((resolve) => {
        win.chrome.storage.local.set({ settings: Object.assign({}, store.settings, { scannerActive: true }) }, resolve);
      });
      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(scanner.isScanningEnabled(), true, 'resuming should re-enable scanning');

      win.close();
    });

    await test('passive scanner stashes the caption contact from post pages', async () => {
      const html = `<!DOCTYPE html><html><head><title>Instagram</title></head><body>
        <main><article>
          <header><a href="/luna_daily/">luna_daily</a><span>and</span><a href="/spy_shop/">spy_shop</a></header>
          <div dir="auto">Call +39 333 123 4567 or write spy@spy-shop.it for orders</div>
        </article></main>
      </body></html>`;
      const d = new JSDOM(html, {
        url: 'https://www.instagram.com/p/SPY1/',
        pretendToBeVisual: true,
        runScripts: 'outside-only'
      });
      const win = d.window;
      const sent = [];
      const store = { autoSearch: { active: false, postContacts: {} } };
      const changeListeners = [];
      win.chrome = {
        storage: {
          local: {
            get(keys, cb) {
              const out = {};
              (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
              setTimeout(() => cb(out), 0);
            },
            set(items, cb) {
              Object.assign(store, items);
              setTimeout(() => {
                if (items.settings) {
                  changeListeners.forEach((fn) => fn({ settings: { newValue: items.settings } }, 'local'));
                }
                if (items.autoSearch) {
                  changeListeners.forEach((fn) => fn({ autoSearch: { newValue: items.autoSearch } }, 'local'));
                }
                if (cb) cb();
              }, 0);
            }
          },
          onChanged: { addListener: (fn) => changeListeners.push(fn) }
        },
        runtime: {
          lastError: null,
          sendMessage(message, cb) {
            sent.push(message);
            setTimeout(() => cb && cb({ saved: true, reason: 'saved' }), 0);
          },
          onMessage: { addListener() {} }
        }
      };

      const files = [
        'src/shared/logger.js',
        'src/content/normalizer.js',
        'src/content/selectors.js',
        'src/content/profile-extractor.js',
        'src/content/business-detector.js',
        'src/content/mutation-observer.js',
        'src/content/instagram-scanner.js'
      ];
      files.forEach((rel) => win.eval(fs.readFileSync(path.join(root, rel), 'utf8')));

      await new Promise((r) => setTimeout(r, 1200));

      const stash = sent.find((m) => m.type === 'POST_CONTACT_STASH');
      assert.ok(stash, 'post page must stash the caption contact: ' + JSON.stringify(sent.map((m) => m.type)));
      assert.strictEqual(stash.payload.username, 'spy_shop',
        'collab post must stash under the business-looking author');
      assert.strictEqual(stash.payload.phone && stash.payload.phone.normalized, '+393331234567');
      assert.ok(stash.payload.email, 'caption email expected: ' + JSON.stringify(stash.payload));

      win.close();
    });
  }

  console.log('[8] auto search mode');
  await test('PROCESS_CANDIDATE saveAll bypasses confidence threshold', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });

    const low = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 15, hasWebsite: false, saveAll: true, profile: { instagram_username: 'low_conf', website: '' } }
    });
    assert.strictEqual(low.saved, true, 'saveAll must save below threshold');

    const noFlag = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 15, hasWebsite: false, profile: { instagram_username: 'low_conf2', website: '' } }
    });
    assert.strictEqual(noFlag.reason, 'below_threshold', 'without saveAll the threshold still applies');

    const withSite = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 10, hasWebsite: true, saveAll: true, profile: { instagram_username: 'site_low', website: 'https://x.com' } }
    });
    assert.strictEqual(withSite.reason, 'has_website', 'saveAll still excludes profiles that already have a website');
  });

  await test('AUTOSEARCH_START opens search in an instagram tab and resets state', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];

    const started = await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'salon london', target: 25 } });
    assert.strictEqual(started.started, true);
    assert.strictEqual(started.tabId, 5);
    assert.ok(started.searchUrl.indexOf('q=salon%20london') !== -1, 'search url: ' + started.searchUrl);
    assert.strictEqual(sw.chrome._tabCalls.updated.length, 1, 'existing tab should be updated');
    assert.strictEqual(sw.chrome._tabCalls.updated[0].url, started.searchUrl);

    const state = sw.chrome._store.autoSearch;
    assert.strictEqual(state.active, true);
    assert.strictEqual(state.phase, 'harvest');
    assert.strictEqual(state.target, 25);
    assert.strictEqual(state.collected, 0);
    assert.deepStrictEqual(state.pending, []);

    const snap = await sw.dispatch({ type: 'GET_SNAPSHOT' });
    assert.strictEqual(snap.settings.autoSearchQuery, 'salon london');
    assert.strictEqual(snap.settings.autoSearchTarget, 25);

    sw.chrome._tabCalls.list = [];
    const tag = await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: '#hairstyles', target: 5 } });
    assert.strictEqual(tag.started, true);
    assert.ok(tag.searchUrl.indexOf('/explore/tags/hairstyles/') !== -1, 'tag url: ' + tag.searchUrl);
    assert.strictEqual(sw.chrome._tabCalls.created.length, 1, 'no instagram tab -> create one');
    assert.strictEqual(tag.tabId, sw.chrome._tabCalls.created.length + 100);

    const blank = await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: '   ' } });
    assert.strictEqual(blank.started, false);
    assert.strictEqual(blank.error, 'query_required');
  });

  await test('AUTOSEARCH_CLAIM grants only the driving tab', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'cafe', target: 3 } });

    const ok = await sw.dispatch({ type: 'AUTOSEARCH_CLAIM' }, { tab: { id: 5 } });
    assert.strictEqual(ok.granted, true);

    const wrong = await sw.dispatch({ type: 'AUTOSEARCH_CLAIM' }, { tab: { id: 9 } });
    assert.strictEqual(wrong.granted, false, 'another tab must not claim the run');

    const noTab = await sw.dispatch({ type: 'AUTOSEARCH_CLAIM' }, {});
    assert.strictEqual(noTab.granted, false);

    await sw.dispatch({ type: 'AUTOSEARCH_STOP' });
    const stopped = await sw.dispatch({ type: 'AUTOSEARCH_CLAIM' }, { tab: { id: 5 } });
    assert.strictEqual(stopped.granted, false, 'stopped run grants nothing');
    assert.strictEqual(sw.chrome._store.autoSearch.phase, 'stopped');
  });

  await test('harvest merges post links, advance walks the queue in order', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'gym', target: 10 } });
    const sender = { tab: { id: 5 } };

    const h = await sw.dispatch({
      type: 'AUTOSEARCH_HARVEST',
      payload: { posts: ['/p/B/', '/p/A/', '/p/A/', 'bad', '/reel/C/?igsh=x', '/p/B/'] }
    }, sender);
    assert.strictEqual(h.ok, true);
    assert.deepStrictEqual(h.pending, ['/p/B/', '/p/A/', '/reel/C/']);

    const a1 = await sw.dispatch({ type: 'AUTOSEARCH_ADVANCE' }, sender);
    assert.strictEqual(a1.ok, true);
    assert.strictEqual(a1.next, '/p/B/');

    const h2 = await sw.dispatch({ type: 'AUTOSEARCH_HARVEST', payload: { posts: ['/p/B/', '/p/D/'] } }, sender);
    assert.deepStrictEqual(h2.pending, ['/p/A/', '/reel/C/', '/p/D/'], 'visited posts must not rejoin the queue');

    const a2 = await sw.dispatch({ type: 'AUTOSEARCH_ADVANCE' }, sender);
    assert.strictEqual(a2.next, '/p/A/');
    const a3 = await sw.dispatch({ type: 'AUTOSEARCH_ADVANCE' }, sender);
    assert.strictEqual(a3.next, '/reel/C/');
    const a4 = await sw.dispatch({ type: 'AUTOSEARCH_ADVANCE' }, sender);
    assert.strictEqual(a4.next, '/p/D/');
    const a5 = await sw.dispatch({ type: 'AUTOSEARCH_ADVANCE' }, sender);
    assert.strictEqual(a5.next, null, 'empty queue yields null so controller returns to search');
    assert.ok(a5.searchUrl.indexOf('q=gym') !== -1, 'searchUrl: ' + a5.searchUrl);

    const wrongTab = await sw.dispatch({ type: 'AUTOSEARCH_ADVANCE' }, { tab: { id: 9 } });
    assert.strictEqual(wrongTab.ok, false, 'wrong tab cannot drive the queue');
  });

  await test('AUTOSEARCH_PROGRESS counts only saved leads and finishes at the target', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'spa', target: 2 } });
    const sender = { tab: { id: 5 } };

    const saved1 = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 80, hasWebsite: false, profile: { instagram_username: 'Shop_One', website: '' } }
    });
    assert.strictEqual(saved1.saved, true);

    const p1 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: '@Shop_One' } }, sender);
    assert.strictEqual(p1.ok, true);
    assert.strictEqual(p1.collected, 1, 'profile saved as lead must count');
    assert.strictEqual(p1.finished, false);

    const dup = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'shop_one' } }, sender);
    assert.strictEqual(dup.collected, 1, 'same username must not double count');

    await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 90, hasWebsite: true, profile: { instagram_username: 'has_site_shop', website: 'https://their-site.example' } }
    });
    const skip = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'has_site_shop' } }, sender);
    assert.strictEqual(skip.ok, true);
    assert.strictEqual(skip.collected, 1, 'profile with a website must not count toward the target');
    assert.ok(sw.chrome._store.autoSearch.visitedProfiles.indexOf('has_site_shop') !== -1,
      'visitedProfiles still tracks every visited profile');

    const saved2 = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 75, hasWebsite: false, profile: { instagram_username: 'second_shop', website: '' } }
    });
    assert.strictEqual(saved2.saved, true);
    const p2 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'second_shop' } }, sender);
    assert.strictEqual(p2.finished, true);
    const state = sw.chrome._store.autoSearch;
    assert.strictEqual(state.active, false, 'target reached must stop the run');
    assert.strictEqual(state.phase, 'done');
    assert.strictEqual(state.collected, 2);
    assert.deepStrictEqual(state.visitedProfiles, ['shop_one', 'has_site_shop', 'second_shop']);

    const after = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'third' } }, sender);
    assert.strictEqual(after.ok, false, 'finished run rejects further progress');

    const phase = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'x' } }, { tab: { id: 9 } });
    assert.strictEqual(phase.ok, false, 'wrong tab rejected');
  });

  await test('AUTOSEARCH_PROGRESS phase / blocked / exhausted transitions', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'nails', target: 4 } });
    const sender = { tab: { id: 5 } };

    const ph = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'phase', phase: 'post' } }, sender);
    assert.strictEqual(ph.ok, true);
    assert.strictEqual(sw.chrome._store.autoSearch.phase, 'post');

    const blocked = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'blocked', message: 'Login required' } }, sender);
    assert.strictEqual(blocked.ok, true);
    assert.strictEqual(sw.chrome._store.autoSearch.active, false);
    assert.strictEqual(sw.chrome._store.autoSearch.phase, 'blocked');

    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'nails', target: 4 } });
    const ex1 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex1.ok, true);
    assert.strictEqual(ex1.fallback, true, 'empty keyword page falls back to hashtags');
    assert.strictEqual(sw.chrome._store.autoSearch.active, true);
    assert.strictEqual(sw.chrome._store.autoSearch.surfaceIndex, 1);
    assert.ok(sw.chrome._store.autoSearch.searchUrl.indexOf('/explore/tags/nails/') !== -1,
      'first hashtag fallback: ' + sw.chrome._store.autoSearch.searchUrl);

    const ex2 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex2.fallback, true, 'singular hashtag is the last surface');
    assert.strictEqual(sw.chrome._store.autoSearch.active, true);
    assert.ok(sw.chrome._store.autoSearch.searchUrl.indexOf('/explore/tags/nail/') !== -1,
      'singular hashtag fallback: ' + sw.chrome._store.autoSearch.searchUrl);

    const ex3 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex3.advanced, false, 'all surfaces and terms exhausted -> stop');
    assert.strictEqual(sw.chrome._store.autoSearch.phase, 'exhausted');
    assert.strictEqual(sw.chrome._store.autoSearch.active, false);
  });

  await test('AUTOSEARCH_START parses multiple search terms and queues them', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];

    const started = await sw.dispatch({
      type: 'AUTOSEARCH_START',
      payload: { query: 'hair salon, nail bar\nbrow studio, hair salon', target: 10 }
    });
    assert.strictEqual(started.started, true);
    assert.strictEqual(started.terms, 3, 'comma/newline split with dedupe');
    assert.ok(started.searchUrl.indexOf('q=hair%20salon') !== -1, 'first term drives the first search: ' + started.searchUrl);

    const state = sw.chrome._store.autoSearch;
    assert.deepStrictEqual(state.queries, ['hair salon', 'nail bar', 'brow studio']);
    assert.strictEqual(state.query, 'hair salon');
    assert.strictEqual(state.queryIndex, 0);
    assert.strictEqual(state.totalCollected, 0);
    assert.strictEqual(state.surfaces.length, 3, 'keyword + two tag surfaces stored at start');
    assert.strictEqual(state.surfaceIndex, 0);
    assert.strictEqual(state.searchHarvested, 0);

    const snap = await sw.dispatch({ type: 'GET_SNAPSHOT' });
    assert.strictEqual(snap.settings.autoSearchQuery, 'hair salon, nail bar, brow studio');
    assert.strictEqual(snap.settings.autoSearchTarget, 10);

    const blank = await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { queries: ['  ', ',,'] } });
    assert.strictEqual(blank.started, false);
    assert.strictEqual(blank.error, 'query_required');
  });

  await test('reaching the target advances to the next search term and keeps leads separate', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { queries: ['beauty', 'brows'], target: 1 } });
    const sender = { tab: { id: 5 } };

    const saved1 = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 80, hasWebsite: false, profile: { instagram_username: 'term_one_shop', website: '' } }
    });
    assert.strictEqual(saved1.saved, true);
    assert.strictEqual(sw.chrome._store.leads.find((l) => l.instagram_username === 'term_one_shop').search_term,
      'beauty', 'lead stamped with the term that found it');

    const p1 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'term_one_shop' } }, sender);
    assert.strictEqual(p1.ok, true);
    assert.strictEqual(p1.finished, false, 'more terms remain, so the run is not finished');
    assert.strictEqual(p1.advanced, true);
    assert.strictEqual(p1.totalCollected, 1);

    const mid = sw.chrome._store.autoSearch;
    assert.strictEqual(mid.active, true, 'session continues on the next term');
    assert.strictEqual(mid.query, 'brows');
    assert.strictEqual(mid.queryIndex, 1);
    assert.strictEqual(mid.collected, 0, 'per-term counter resets');
    assert.strictEqual(mid.totalCollected, 1, 'session total keeps counting');
    assert.deepStrictEqual(mid.pending, [], 'queued posts from the previous term are dropped');
    assert.ok(mid.searchUrl.indexOf('q=brows') !== -1, 'searchUrl: ' + mid.searchUrl);

    const saved2 = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 80, hasWebsite: false, profile: { instagram_username: 'term_two_shop', website: '' } }
    });
    assert.strictEqual(saved2.saved, true);
    assert.strictEqual(sw.chrome._store.leads.find((l) => l.instagram_username === 'term_two_shop').search_term,
      'brows', 'second term stamps its own leads');

    const p2 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'term_two_shop' } }, sender);
    assert.strictEqual(p2.finished, true, 'last term reached its target');
    const done = sw.chrome._store.autoSearch;
    assert.strictEqual(done.active, false);
    assert.strictEqual(done.phase, 'done');
    assert.strictEqual(done.totalCollected, 2);
  });

  await test('exhausted search page advances to the next term instead of stopping', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { queries: ['spa', 'yoga'], target: 5 } });
    const sender = { tab: { id: 5 } };
    sw.chrome._store.autoSearch.searchHarvested = 9;
    const baseline = sw.chrome._tabCalls.updated.length;

    const ex = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex.ok, true);
    assert.strictEqual(ex.advanced, true);
    const state = sw.chrome._store.autoSearch;
    assert.strictEqual(state.active, true, 'session continues on the next term');
    assert.strictEqual(state.query, 'yoga');
    assert.ok(state.searchUrl.indexOf('q=yoga') !== -1, 'searchUrl: ' + state.searchUrl);
    assert.strictEqual(sw.chrome._tabCalls.updated.length, baseline + 1, 'tab navigated to the next search');
    assert.ok(sw.chrome._tabCalls.updated[sw.chrome._tabCalls.updated.length - 1].url.indexOf('q=yoga') !== -1);

    sw.chrome._store.autoSearch.searchHarvested = 4;
    const ex2 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex2.advanced, false, 'the last term exhausts the run');
    assert.strictEqual(sw.chrome._store.autoSearch.active, false);
    assert.strictEqual(sw.chrome._store.autoSearch.phase, 'exhausted');
  });

  await test('empty keyword search falls back through hashtag surfaces', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];

    const started = await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'medspas in uae', target: 8 } });
    assert.strictEqual(started.started, true);

    const state = sw.chrome._store.autoSearch;
    assert.deepStrictEqual(state.surfaces, [
      'https://www.instagram.com/explore/search/keyword/?q=medspas%20in%20uae',
      'https://www.instagram.com/explore/tags/medspas/',
      'https://www.instagram.com/explore/tags/medspa/'
    ], 'keyword URL first, then derived tags');
    assert.strictEqual(state.surfaceIndex, 0);
    assert.strictEqual(state.searchHarvested, 0);
    assert.strictEqual(state.searchUrl, state.surfaces[0]);

    const sender = { tab: { id: 5 } };
    const baseline = sw.chrome._tabCalls.updated.length;

    const ex1 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex1.fallback, true);
    assert.strictEqual(ex1.finished, false);
    assert.strictEqual(sw.chrome._store.autoSearch.active, true, 'fallback keeps the run alive');
    assert.strictEqual(sw.chrome._store.autoSearch.surfaceIndex, 1);
    assert.ok(sw.chrome._store.autoSearch.searchUrl.indexOf('/explore/tags/medspas/') !== -1);
    assert.ok(sw.chrome._store.autoSearch.message.indexOf('#medspas') !== -1,
      'message names the fallback surface: ' + sw.chrome._store.autoSearch.message);
    assert.strictEqual(sw.chrome._tabCalls.updated.length, baseline + 1, 'tab navigated to the hashtag page');
    assert.ok(sw.chrome._tabCalls.updated[sw.chrome._tabCalls.updated.length - 1].url.indexOf('/explore/tags/medspas/') !== -1);

    const ex2 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex2.fallback, true, 'singular tag is the final rung');
    assert.strictEqual(sw.chrome._store.autoSearch.surfaceIndex, 2);
    assert.ok(sw.chrome._store.autoSearch.searchUrl.indexOf('/explore/tags/medspa/') !== -1);

    const ex3 = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex3.advanced, false, 'every surface and the only term are used up');
    assert.strictEqual(sw.chrome._store.autoSearch.active, false);
  });

  await test('harvested posts skip the hashtag fallback for that term', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'facials', target: 5 } });
    const sender = { tab: { id: 5 } };
    const baseline = sw.chrome._tabCalls.updated.length;

    const h = await sw.dispatch({ type: 'AUTOSEARCH_HARVEST', payload: { posts: ['/p/X/', '/p/Y/'] } }, sender);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(sw.chrome._store.autoSearch.searchHarvested, 2, 'harvest counts seen posts');

    const ex = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } }, sender);
    assert.strictEqual(ex.advanced, false, 'posts were seen, so the term ends instead of falling back');
    assert.strictEqual(sw.chrome._store.autoSearch.phase, 'exhausted');
    assert.strictEqual(sw.chrome._store.autoSearch.surfaceIndex, 0, 'no fallback surface was entered');
    assert.strictEqual(sw.chrome._tabCalls.updated.length, baseline, 'no hashtag navigation happened');
  });

  await test('leads are stamped with the search term of the active session tab', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'boutique', target: 5 } });

    const inTab = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 80, hasWebsite: false, profile: { instagram_username: 'stamped_shop', website: '' } }
    }, { tab: { id: 5 } });
    assert.strictEqual(inTab.saved, true);
    let lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'stamped_shop');
    assert.strictEqual(lead.search_term, 'boutique', 'session tab stamps the current term');

    sw.chrome._store.autoSearch.queries = ['shoes'];
    sw.chrome._store.autoSearch.query = 'shoes';

    const outside = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 80, hasWebsite: false, profile: { instagram_username: 'browser_find', website: '' } }
    }, { tab: { id: 9 } });
    assert.strictEqual(outside.saved, true);
    lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'browser_find');
    assert.strictEqual(lead.search_term, undefined, 'a browsing tab outside the session must not stamp');

    const revisit = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 80, hasWebsite: false, profile: { instagram_username: 'browser_find', website: '' } }
    }, { tab: { id: 5 } });
    assert.strictEqual(revisit.reason, 'duplicate');
    lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'browser_find');
    assert.strictEqual(lead.search_term, 'shoes', 'session tab stamps on re-visit via the merge');
  });

  await test('MERGE_LEADS combines selected leads into the first selected', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    const mk = (id, username, extra) => Object.assign({
      id, instagram_username: username,
      instagram_url: 'https://www.instagram.com/' + username + '/',
      instagram_name: '', bio: '', category: '', email: '', website: '', location: '',
      phone_raw: '', phone_normalized: '', followers: '', status: 'New', notes: '',
      confidence: 50, search_term: '', date_found: '2026-01-02 10:00'
    }, extra || {});
    sw.chrome._store.leads = [
      mk('id_a', 'alpha_shop', {
        instagram_name: 'Alpha', bio: 'Short bio', email: 'a@x.example',
        search_term: 'salon', notes: 'first pass'
      }),
      mk('id_b', 'beta_shop', {
        instagram_name: 'Beta Beauty Studio Long', bio: 'A much longer bio with details',
        email: 'b@x.example', phone_raw: '+393331112233', phone_normalized: '+393331112233',
        search_term: 'brows', confidence: 90, status: 'Reviewed'
      }),
      mk('id_c', 'keep_me', { instagram_name: 'Keep' })
    ];

    const tooFew = await sw.dispatch({ type: 'MERGE_LEADS', payload: { ids: ['id_a'] } });
    assert.strictEqual(tooFew.ok, false);
    assert.strictEqual(tooFew.reason, 'need_two');

    const missing = await sw.dispatch({ type: 'MERGE_LEADS', payload: { ids: ['id_a', 'nope'] } });
    assert.strictEqual(missing.ok, false);
    assert.strictEqual(missing.reason, 'not_found');
    assert.strictEqual(sw.chrome._store.leads.length, 3, 'failed merges leave leads untouched');

    const res = await sw.dispatch({ type: 'MERGE_LEADS', payload: { ids: ['id_b', 'id_a'] } });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.merged, 2);
    assert.strictEqual(res.id, 'id_b', 'the first selected lead survives');

    const leads = sw.chrome._store.leads;
    assert.strictEqual(leads.length, 2, 'the merged-away lead is removed');
    assert.ok(!leads.some((l) => l.id === 'id_a'), 'id_a removed');
    assert.ok(leads.some((l) => l.id === 'id_c'), 'unrelated lead untouched');

    const base = leads.find((l) => l.id === 'id_b');
    assert.strictEqual(base.instagram_name, 'Beta Beauty Studio Long', 'longest non-empty name wins');
    assert.strictEqual(base.bio, 'A much longer bio with details');
    assert.strictEqual(base.email, 'b@x.example', 'first selected non-empty email wins');
    assert.strictEqual(base.phone_normalized, '+393331112233', 'phone taken from the lead with a clean number');
    assert.strictEqual(base.search_term, 'brows, salon', 'search terms unioned in selection order');
    assert.ok(base.notes.indexOf('first pass') !== -1, 'notes joined');
    assert.ok(base.notes.indexOf('Merged from @alpha_shop') !== -1, 'merge provenance recorded');
    assert.strictEqual(base.status, 'Reviewed', 'base status kept when not New');
    assert.strictEqual(base.confidence, 90, 'highest confidence kept');
  });

  await test('AUTOSEARCH_NAVIGATE allows only instagram/linktree urls on the driving tab', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'x', target: 1 } });
    const sender = { tab: { id: 5 } };
    const baseline = sw.chrome._tabCalls.updated.length;

    const ok = await sw.dispatch({ type: 'AUTOSEARCH_NAVIGATE', payload: { url: 'https://www.instagram.com/p/ABC/' } }, sender);
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(sw.chrome._tabCalls.updated.length, baseline + 1);

    const lt = await sw.dispatch({ type: 'AUTOSEARCH_NAVIGATE', payload: { url: 'https://linktr.ee/their_shop' } }, sender);
    assert.strictEqual(lt.ok, true, 'linktree navigation must be allowed: ' + JSON.stringify(lt));
    assert.strictEqual(sw.chrome._tabCalls.updated.length, baseline + 2);

    const badHost = await sw.dispatch({ type: 'AUTOSEARCH_NAVIGATE', payload: { url: 'https://evil.example/p/' } }, sender);
    assert.strictEqual(badHost.ok, false);
    const badTab = await sw.dispatch({ type: 'AUTOSEARCH_NAVIGATE', payload: { url: 'https://www.instagram.com/p/ABC/' } }, { tab: { id: 9 } });
    assert.strictEqual(badTab.ok, false);
    assert.strictEqual(sw.chrome._tabCalls.updated.length, baseline + 2, 'rejected navigations must not touch tabs');
  });

  await test('auto search linktree: HOLD keeps profile, RESOLVE saves or excludes, then advances', async () => {
    const sw = loadServiceWorker();
    sw.chrome._tabCalls.list = [{ id: 5, active: true, url: 'https://www.instagram.com/' }];
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'beauty', target: 3 } });
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    const sender = { tab: { id: 5 } };
    await sw.dispatch({ type: 'AUTOSEARCH_HARVEST', payload: { posts: ['/p/A/', '/p/B/'] } }, sender);

    const held = await sw.dispatch({
      type: 'AUTOSEARCH_HOLD',
      payload: { profile: { instagram_username: 'lt_shop', confidence: 80, bio: 'bio', website: '' } }
    }, sender);
    assert.strictEqual(held.ok, true, JSON.stringify(held));
    assert.ok(sw.chrome._store.autoSearch.hold, 'hold must be stored');
    assert.strictEqual(sw.chrome._store.autoSearch.phase, 'linktree');

    const res = await sw.dispatch({ type: 'AUTOSEARCH_RESOLVE', payload: { website: '' } }, sender);
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.strictEqual(sw.chrome._store.autoSearch.hold, null, 'hold must be cleared');
    assert.strictEqual(sw.chrome._store.autoSearch.collected, 1, 'resolved profile must count');
    const lastNav = sw.chrome._tabCalls.updated[sw.chrome._tabCalls.updated.length - 1];
    assert.strictEqual(lastNav.url, 'https://www.instagram.com/p/A/', 'must advance to next post');

    const snap = await sw.dispatch({ type: 'GET_SNAPSHOT' });
    const lead = (snap.leads || []).find((l) => l.instagram_username === 'lt_shop');
    assert.ok(lead, 'resolved profile without website must be saved as lead');
    assert.strictEqual(lead.website, '');

    await sw.dispatch({ type: 'AUTOSEARCH_HARVEST', payload: { posts: ['/p/C/'] } }, sender);
    const held2 = await sw.dispatch({
      type: 'AUTOSEARCH_HOLD',
      payload: { profile: { instagram_username: 'site_brand', confidence: 80 } }
    }, sender);
    assert.strictEqual(held2.ok, true, JSON.stringify(held2));
    const res2 = await sw.dispatch({ type: 'AUTOSEARCH_RESOLVE', payload: { website: 'https://their-site.com' } }, sender);
    assert.strictEqual(res2.ok, true, JSON.stringify(res2));
    assert.strictEqual(sw.chrome._store.autoSearch.collected, 1,
      'profile with a website must not count toward the target');
    const snap2 = await sw.dispatch({ type: 'GET_SNAPSHOT' });
    assert.ok(!(snap2.leads || []).some((l) => l.instagram_username === 'site_brand'),
      'profile whose linktree contains a website must not become a lead');
  });

  await test('POST_CONTACT_STASH stores post contacts and they merge into saved leads', async () => {
    const sw = loadServiceWorker();

    const invalid = await sw.dispatch({ type: 'POST_CONTACT_STASH', payload: { username: 'not a user!', phone: {}, email: '' } });
    assert.strictEqual(invalid.ok, false, 'invalid username must be rejected');

    const empty = await sw.dispatch({ type: 'POST_CONTACT_STASH', payload: { username: 'cap_shop', phone: {}, email: '' } });
    assert.strictEqual(empty.ok, false, 'empty contact must be rejected');

    const ok = await sw.dispatch({
      type: 'POST_CONTACT_STASH',
      payload: {
        username: 'Cap_Shop',
        phone: { raw: '+39 333 123 4567', normalized: '+393331234567' },
        email: 'orders@cap-shop.it'
      }
    });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    const entry = sw.chrome._store.autoSearch.postContacts.cap_shop;
    assert.ok(entry, 'contact must be stored under the normalized username');
    assert.strictEqual(entry.phone_normalized, '+393331234567');
    assert.strictEqual(entry.email, 'orders@cap-shop.it');

    const saved = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 80, hasWebsite: false, profile: { instagram_username: 'cap_shop', website: '', phone_raw: '', phone_normalized: '', email: '' } }
    });
    assert.strictEqual(saved.saved, true);
    const lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'cap_shop');
    assert.ok(lead, 'lead must be saved');
    assert.strictEqual(lead.phone_normalized, '+393331234567', 'stashed post phone must merge into the lead');
    assert.strictEqual(lead.email, 'orders@cap-shop.it', 'stashed post email must merge into the lead');
  });

  if (JSDOM) {
    const EX2 = globalThis.FicinoProfileExtractor;

    await test('extractPostAuthor reads the author from a post header', () => {
      const d = new JSDOM(`<!DOCTYPE html><html><body>
        <article>
          <header><a href="/a1_shop/">a1_shop</a></header>
          <div>caption here</div>
        </article>
      </body></html>`, { url: 'https://www.instagram.com/p/ABC123/' });
      assert.strictEqual(EX2.extractPostAuthor(d.window.document), 'a1_shop');

      const dialogDoc = new JSDOM(`<!DOCTYPE html><html><body>
        <div role="dialog"><header><a href="/dialog_user/">dialog_user</a></header></div>
        <article><header><a href="/ignored/">ignored</a></header></article>
      </body></html>`, { url: 'https://www.instagram.com/p/XYZ/' });
      assert.strictEqual(EX2.extractPostAuthor(dialogDoc.window.document), 'dialog_user');

      const bare = new JSDOM(`<!DOCTYPE html><html><body><div>no author</div></body></html>`,
        { url: 'https://www.instagram.com/p/NONE/' });
      assert.strictEqual(EX2.extractPostAuthor(bare.window.document), '');
    });

    await test('extractPostAuthor: headerless article and meta fallback', () => {
      const headerless = new JSDOM(`<!DOCTYPE html><html><body>
        <main><article>
          <a href="/first_user/"><img alt="avatar"></a>
          <a href="/explore/tags/salon/">salon</a>
          <a href="/tagged2/">tagged</a>
        </article></main>
      </body></html>`, { url: 'https://www.instagram.com/p/H1/' });
      assert.strictEqual(EX2.extractPostAuthor(headerless.window.document), 'first_user');

      const metaOnly = new JSDOM(`<!DOCTYPE html><html><head>
        <meta name="description" content="1,234 likes, 56 comments - cool_biz on Instagram: &quot;hello world&quot;">
      </head><body><div>no dom author</div></body></html>`,
        { url: 'https://www.instagram.com/p/M1/' });
      assert.strictEqual(EX2.extractPostAuthor(metaOnly.window.document), 'cool_biz');

      const blocked = new JSDOM(`<!DOCTYPE html><html><head>
        <meta name="description" content="Videos on Instagram">
      </head><body><div>x</div></body></html>`,
        { url: 'https://www.instagram.com/p/M2/' });
      assert.strictEqual(EX2.extractPostAuthor(blocked.window.document), '');
    });

    await test('extractPostContact: finds phone and email on a post page', () => {
      const full = new JSDOM(`<!DOCTYPE html><html><body>
        <main><article>
          <header><a href="/cap_shop/">cap_shop</a></header>
          <div dir="auto">Call us for orders</div>
          <a href="tel:+393331234567">Call now</a>
          <a href="mailto:orders@cap-shop.it">Email us</a>
        </article></main>
      </body></html>`, { url: 'https://www.instagram.com/p/CAP1/' });
      const found = EX2.extractPostContact(full.window.document);
      assert.ok(found.phone && found.phone.normalized === '+393331234567',
        'tel anchor phone expected: ' + JSON.stringify(found));
      assert.strictEqual(found.email, 'orders@cap-shop.it');

      const captionOnly = new JSDOM(`<!DOCTYPE html><html><body>
        <main><article>
          <header><a href="/cap_shop/">cap_shop</a></header>
          <div dir="auto">WhatsApp or call +39 333 123 4567 — write shop@cap-shop.it</div>
        </article></main>
      </body></html>`, { url: 'https://www.instagram.com/p/CAP2/' });
      const fromCaption = EX2.extractPostContact(captionOnly.window.document);
      assert.ok(fromCaption.phone && fromCaption.phone.normalized === '+393331234567',
        'caption phone expected: ' + JSON.stringify(fromCaption));
      assert.strictEqual(fromCaption.email, 'shop@cap-shop.it');

      const empty = new JSDOM(`<!DOCTYPE html><html><body><div>no contact</div></body></html>`,
        { url: 'https://www.instagram.com/p/CAP3/' });
      const none = EX2.extractPostContact(empty.window.document);
      assert.strictEqual(none.phone, null);
      assert.strictEqual(none.email, '');
    });

    await test('extractPostAuthors: collab post lists every author', () => {
      const collab = new JSDOM(`<!DOCTYPE html><html><body>
        <main><article>
          <header><a href="/alice_styles/">alice_styles</a><span>and</span><a href="/a1_shop/">a1_shop</a></header>
          <div dir="auto">caption here</div>
        </article></main>
      </body></html>`, { url: 'https://www.instagram.com/p/COL1/' });
      assert.deepStrictEqual(EX2.extractPostAuthors(collab.window.document), ['alice_styles', 'a1_shop']);
      assert.strictEqual(EX2.extractPostAuthor(collab.window.document), 'alice_styles',
        'extractPostAuthor keeps first-in-DOM behaviour');

      const metaTwo = new JSDOM(`<!DOCTYPE html><html><head>
        <meta name="description" content="1,234 likes, 56 comments - alice_styles and a1_shop on Instagram: &quot;hi&quot;">
      </head><body><div>x</div></body></html>`, { url: 'https://www.instagram.com/p/COL2/' });
      assert.deepStrictEqual(EX2.extractPostAuthors(metaTwo.window.document), ['alice_styles', 'a1_shop']);

      const single = new JSDOM(`<!DOCTYPE html><html><body>
        <article><header><a href="/solo_shop/">solo_shop</a></header></article>
      </body></html>`, { url: 'https://www.instagram.com/p/SOLO/' });
      assert.deepStrictEqual(EX2.extractPostAuthors(single.window.document), ['solo_shop']);

      const dup = new JSDOM(`<!DOCTYPE html><html><body>
        <article>
          <header><a href="/solo_shop/">solo_shop</a></header>
          <a href="/solo_shop/">tagged</a>
        </article>
      </body></html>`, { url: 'https://www.instagram.com/p/DUP/' });
      assert.deepStrictEqual(EX2.extractPostAuthors(dup.window.document), ['solo_shop']);
    });

    await test('rankPostAuthors prefers the business-looking author', () => {
      assert.strictEqual(EX2.rankPostAuthors(['alice_styles', 'a1_shop'], {})[0], 'a1_shop');
      assert.strictEqual(EX2.rankPostAuthors(['alice_styles', 'nordic_nails'], { query: 'nordic nails' })[0],
        'nordic_nails');
      assert.strictEqual(EX2.rankPostAuthors(['luna.daily', 'urban_decor'], {})[0], 'urban_decor',
        'influencer handle (first name + daily marker) must lose to a neutral handle');
      assert.deepStrictEqual(EX2.rankPostAuthors(['plain_one', 'plain_two'], {}),
        ['plain_one', 'plain_two'], 'ties keep DOM order');
      assert.deepStrictEqual(EX2.rankPostAuthors(['Alice_Shops', 'alice_shops'], {}), ['Alice_Shops'],
        'duplicate authors collapse to one');
      assert.deepStrictEqual(EX2.rankPostAuthors([], {}), []);
    });

    await test('auto-search controller: classify, harvest and profile submit with saveAll', async () => {
      const html = `<!DOCTYPE html><html><head><title>Instagram</title></head><body>
        <main><header><section>
          <h2>Auto Clinic</h2>
          <span dir="auto">Auto Clinic</span>
          <span dir="auto">Skin care clinic</span>
          <div dir="auto">Dermatology treatments<br>Walk ins welcome</div>
          <ul><li>2,040 Followers</li></ul>
        </section></header></main>
        <div id="feed">
          <a href="/p/POST1/">post one</a>
          <a href="/p/POST2/?igsh=1">post two</a>
          <a href="/p/POST1/">post one again</a>
          <a href="/reel/REEL1/">reel</a>
          <a href="/dynamic_shop/">dynamic_shop</a>
        </div>
      </body></html>`;
      const d = new JSDOM(html, {
        url: 'https://www.instagram.com/e2e_clinic/',
        pretendToBeVisual: true,
        runScripts: 'outside-only'
      });
      const win = d.window;

      const sent = [];
      const store = {
        autoSearch: {
          active: true, query: 'clinic', target: 2, collected: 0, phase: 'idle', message: '',
          tabId: 7, searchUrl: 'https://www.instagram.com/explore/search/keyword/?q=clinic',
          visitedPosts: [], visitedProfiles: [], pending: [], updatedAt: 0,
          postContacts: {
            e2e_clinic: { phone_raw: '+39 333 123 4567', phone_normalized: '+393331234567', email: 'clinic@e2e.example', at: 1 }
          }
        },
        settings: { saveEmail: true, savePhone: true }
      };
      const changeListeners = [];
      win.chrome = {
        storage: {
          local: {
            get(keys, cb) {
              const out = {};
              (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
              setTimeout(() => cb(out), 0);
            },
            set(items, cb) {
              Object.assign(store, items);
              setTimeout(() => {
                const changes = {};
                Object.keys(items).forEach((k) => { changes[k] = { newValue: items[k] }; });
                changeListeners.forEach((fn) => fn(changes, 'local'));
                if (cb) cb();
              }, 0);
            }
          },
          onChanged: { addListener(fn) { changeListeners.push(fn); } }
        },
        runtime: {
          lastError: null,
          sendMessage(message, cb) {
            sent.push(message);
            let resp = null;
            if (message.type === 'AUTOSEARCH_CLAIM') resp = { granted: true, state: store.autoSearch };
            else if (message.type === 'PROCESS_CANDIDATE') resp = { saved: true, reason: 'saved' };
            else if (message.type === 'AUTOSEARCH_PROGRESS' && message.payload.type === 'profileSubmitted') {
              resp = { ok: true, collected: 1, target: 2, finished: false };
            } else if (message.type === 'AUTOSEARCH_ADVANCE') {
              resp = { ok: true, next: '/p/POST1/', searchUrl: store.autoSearch.searchUrl };
            } else resp = { ok: true };
            setTimeout(() => cb && cb(resp), 0);
          },
          onMessage: { addListener() {} }
        }
      };

      const files = [
        'src/shared/logger.js',
        'src/content/normalizer.js',
        'src/content/selectors.js',
        'src/content/profile-extractor.js',
        'src/content/business-detector.js',
        'src/content/auto-search.js'
      ];
      files.forEach((rel) => win.eval(fs.readFileSync(path.join(root, rel), 'utf8')));

      const AS = win.FicinoAutoSearch;
      assert.ok(AS, 'auto search namespace missing');

      assert.strictEqual(AS.classifyPage('/explore/search/keyword/'), 'search');
      assert.strictEqual(AS.classifyPage('/explore/tags/salon/'), 'search');
      assert.strictEqual(AS.classifyPage('/results/search/'), 'search');
      assert.strictEqual(AS.classifyPage('/p/ABC/'), 'post');
      assert.strictEqual(AS.classifyPage('/reel/XYZ/'), 'post');
      assert.strictEqual(AS.classifyPage('/accounts/login/'), 'blocked');
      assert.strictEqual(AS.classifyPage('/e2e_clinic/'), 'profile');
      assert.strictEqual(AS.classifyPage('/'), 'other');

      const posts = AS.collectPostPaths(win.document);
      assert.deepStrictEqual(Array.from(posts), ['/p/POST1/', '/p/POST2/', '/reel/REEL1/']);

      await new Promise((r) => setTimeout(r, 400));

      assert.ok(sent.find((m) => m.type === 'AUTOSEARCH_CLAIM'), 'controller must claim the run');
      assert.ok(AS.ctl.timer, 'loop must be scheduled with a random delay');

      for (let i = 0; i < 5; i++) {
        const d = AS.cycleDelay();
        assert.ok(d >= 2000 && d <= 4000, 'cycle delay must be random 2-4s, got ' + d);
      }

      AS.tick();
      await new Promise((r) => setTimeout(r, 400));

      const proc = sent.filter((m) => m.type === 'PROCESS_CANDIDATE');
      assert.ok(proc.length >= 1, 'expected profile submission: ' + JSON.stringify(sent.map((m) => m.type)));
      assert.strictEqual(proc[0].payload.saveAll, true, 'auto search must bypass business verification');
      assert.strictEqual(proc[0].payload.profile.instagram_username, 'e2e_clinic');
      assert.strictEqual(proc[0].payload.profile.extraction_level, 'profile');
      assert.strictEqual(proc[0].payload.profile.phone_normalized, '+393331234567',
        'stashed post phone must merge into the submitted profile');
      assert.strictEqual(proc[0].payload.profile.email, 'clinic@e2e.example',
        'stashed post email must merge into the submitted profile');

      const prog = sent.find((m) => m.type === 'AUTOSEARCH_PROGRESS' && m.payload.type === 'profileSubmitted');
      assert.ok(prog, 'progress message missing');
      assert.strictEqual(prog.payload.username, 'e2e_clinic');

      const nav = sent.find((m) => m.type === 'AUTOSEARCH_NAVIGATE');
      assert.ok(nav, 'controller should advance to the queued post');
      assert.strictEqual(nav.payload.url, 'https://www.instagram.com/p/POST1/');

      win.close();
    });

    await test('auto-search controller: post page stashes caption contact before opening the profile', async () => {
      const html = `<!DOCTYPE html><html><head><title>Instagram</title></head><body>
        <main><article>
          <header><a href="/caption_shop/">caption_shop</a></header>
          <div dir="auto">Call +39 333 123 4567 for orders — shop@cap-shop.it</div>
        </article></main>
      </body></html>`;
      const d = new JSDOM(html, {
        url: 'https://www.instagram.com/p/PCAP1/',
        pretendToBeVisual: true,
        runScripts: 'outside-only'
      });
      const win = d.window;
      const sent = [];
      const store = {
        autoSearch: {
          active: true, query: 'shop', target: 2, collected: 0, phase: 'idle', message: '',
          tabId: 7, searchUrl: 'https://www.instagram.com/explore/search/keyword/?q=shop',
          visitedPosts: [], visitedProfiles: [], pending: [], updatedAt: 0
        },
        settings: { saveEmail: true, savePhone: true }
      };
      const changeListeners = [];
      win.chrome = {
        storage: {
          local: {
            get(keys, cb) {
              const out = {};
              (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
              setTimeout(() => cb(out), 0);
            },
            set(items, cb) {
              Object.assign(store, items);
              setTimeout(() => {
                const changes = {};
                Object.keys(items).forEach((k) => { changes[k] = { newValue: items[k] }; });
                changeListeners.forEach((fn) => fn(changes, 'local'));
                if (cb) cb();
              }, 0);
            }
          },
          onChanged: { addListener(fn) { changeListeners.push(fn); } }
        },
        runtime: {
          lastError: null,
          sendMessage(message, cb) {
            sent.push(message);
            let resp = { ok: true };
            if (message.type === 'AUTOSEARCH_CLAIM') resp = { granted: true, state: store.autoSearch };
            setTimeout(() => cb && cb(resp), 0);
          },
          onMessage: { addListener() {} }
        }
      };

      const files = [
        'src/shared/logger.js',
        'src/content/normalizer.js',
        'src/content/selectors.js',
        'src/content/profile-extractor.js',
        'src/content/business-detector.js',
        'src/content/auto-search.js'
      ];
      files.forEach((rel) => win.eval(fs.readFileSync(path.join(root, rel), 'utf8')));

      const AS = win.FicinoAutoSearch;
      assert.ok(AS, 'auto search namespace missing');
      await new Promise((r) => setTimeout(r, 400));
      AS.tick();
      await new Promise((r) => setTimeout(r, 400));

      const stash = sent.find((m) => m.type === 'POST_CONTACT_STASH');
      assert.ok(stash, 'post page must stash the caption contact: ' + JSON.stringify(sent.map((m) => m.type)));
      assert.strictEqual(stash.payload.username, 'caption_shop');
      assert.strictEqual(stash.payload.phone && stash.payload.phone.normalized, '+393331234567');
      assert.ok(stash.payload.email, 'caption email expected: ' + JSON.stringify(stash.payload));

      const nav = sent.find((m) => m.type === 'AUTOSEARCH_NAVIGATE');
      assert.ok(nav, 'controller must open the author profile');
      assert.strictEqual(nav.payload.url, 'https://www.instagram.com/caption_shop/');

      win.close();
    });

    await test('auto-search controller: collab post opens the brand, not the influencer', async () => {
      const html = `<!DOCTYPE html><html><head><title>Instagram</title></head><body>
        <main><article>
          <header><a href="/alice_styles/">alice_styles</a><span>and</span><a href="/a1_shop/">a1_shop</a></header>
          <div dir="auto">Call +39 333 123 4567 — shop@cap-shop.it</div>
        </article></main>
      </body></html>`;
      const d = new JSDOM(html, {
        url: 'https://www.instagram.com/p/COLLAB1/',
        pretendToBeVisual: true,
        runScripts: 'outside-only'
      });
      const win = d.window;
      const sent = [];
      const store = {
        autoSearch: {
          active: true, query: 'beauty store', target: 2, collected: 0, phase: 'idle', message: '',
          tabId: 7, searchUrl: 'https://www.instagram.com/explore/search/keyword/?q=beauty%20store',
          visitedPosts: [], visitedProfiles: [], pending: [], updatedAt: 0
        },
        settings: { saveEmail: true, savePhone: true }
      };
      const changeListeners = [];
      win.chrome = {
        storage: {
          local: {
            get(keys, cb) {
              const out = {};
              (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
              setTimeout(() => cb(out), 0);
            },
            set(items, cb) {
              Object.assign(store, items);
              setTimeout(() => {
                const changes = {};
                Object.keys(items).forEach((k) => { changes[k] = { newValue: items[k] }; });
                changeListeners.forEach((fn) => fn(changes, 'local'));
                if (cb) cb();
              }, 0);
            }
          },
          onChanged: { addListener(fn) { changeListeners.push(fn); } }
        },
        runtime: {
          lastError: null,
          sendMessage(message, cb) {
            sent.push(message);
            let resp = { ok: true };
            if (message.type === 'AUTOSEARCH_CLAIM') resp = { granted: true, state: store.autoSearch };
            setTimeout(() => cb && cb(resp), 0);
          },
          onMessage: { addListener() {} }
        }
      };

      const files = [
        'src/shared/logger.js',
        'src/content/normalizer.js',
        'src/content/selectors.js',
        'src/content/profile-extractor.js',
        'src/content/business-detector.js',
        'src/content/auto-search.js'
      ];
      files.forEach((rel) => win.eval(fs.readFileSync(path.join(root, rel), 'utf8')));

      const AS = win.FicinoAutoSearch;
      await new Promise((r) => setTimeout(r, 400));
      AS.tick();
      await new Promise((r) => setTimeout(r, 400));

      const navs = sent.filter((m) => m.type === 'AUTOSEARCH_NAVIGATE');
      assert.ok(navs.length >= 1, 'controller must navigate: ' + JSON.stringify(sent.map((m) => m.type)));
      assert.strictEqual(navs[0].payload.url, 'https://www.instagram.com/a1_shop/',
        'collab post must open the brand profile, got: ' + navs[0].payload.url);
      assert.ok(!navs.find((m) => m.payload.url.indexOf('alice_styles') !== -1),
        'influencer profile must never be opened');

      const stash = sent.find((m) => m.type === 'POST_CONTACT_STASH');
      assert.ok(stash, 'caption contact must be stashed');
      assert.strictEqual(stash.payload.username, 'a1_shop', 'contact belongs to the chosen brand author');

      win.close();
    });

    await test('auto-search controller: skips the post when the best author was already visited', async () => {
      const html = `<!DOCTYPE html><html><head><title>Instagram</title></head><body>
        <main><article>
          <header><a href="/alice_styles/">alice_styles</a><span>and</span><a href="/a1_shop/">a1_shop</a></header>
          <div dir="auto">caption</div>
        </article></main>
      </body></html>`;
      const d = new JSDOM(html, {
        url: 'https://www.instagram.com/p/COLLAB2/',
        pretendToBeVisual: true,
        runScripts: 'outside-only'
      });
      const win = d.window;
      const sent = [];
      const store = {
        autoSearch: {
          active: true, query: 'beauty store', target: 5, collected: 1, phase: 'idle', message: '',
          tabId: 7, searchUrl: 'https://www.instagram.com/explore/search/keyword/?q=beauty%20store',
          visitedPosts: [], visitedProfiles: ['a1_shop'], pending: [], updatedAt: 0
        },
        settings: { saveEmail: true, savePhone: true }
      };
      const changeListeners = [];
      win.chrome = {
        storage: {
          local: {
            get(keys, cb) {
              const out = {};
              (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
              setTimeout(() => cb(out), 0);
            },
            set(items, cb) {
              Object.assign(store, items);
              setTimeout(() => {
                const changes = {};
                Object.keys(items).forEach((k) => { changes[k] = { newValue: items[k] }; });
                changeListeners.forEach((fn) => fn(changes, 'local'));
                if (cb) cb();
              }, 0);
            }
          },
          onChanged: { addListener(fn) { changeListeners.push(fn); } }
        },
        runtime: {
          lastError: null,
          sendMessage(message, cb) {
            sent.push(message);
            let resp = { ok: true };
            if (message.type === 'AUTOSEARCH_CLAIM') resp = { granted: true, state: store.autoSearch };
            setTimeout(() => cb && cb(resp), 0);
          },
          onMessage: { addListener() {} }
        }
      };

      const files = [
        'src/shared/logger.js',
        'src/content/normalizer.js',
        'src/content/selectors.js',
        'src/content/profile-extractor.js',
        'src/content/business-detector.js',
        'src/content/auto-search.js'
      ];
      files.forEach((rel) => win.eval(fs.readFileSync(path.join(root, rel), 'utf8')));

      const AS = win.FicinoAutoSearch;
      await new Promise((r) => setTimeout(r, 400));
      AS.tick();
      await new Promise((r) => setTimeout(r, 400));

      assert.ok(sent.find((m) => m.type === 'AUTOSEARCH_ADVANCE'),
        'visited best author must advance to the next queued post');
      const navs = sent.filter((m) => m.type === 'AUTOSEARCH_NAVIGATE');
      assert.ok(!navs.find((m) => /alice_styles|a1_shop/.test(m.payload.url)),
        'no profile may be opened: ' + JSON.stringify(navs.map((m) => m.payload.url)));
      assert.ok(!sent.find((m) => m.type === 'POST_CONTACT_STASH'),
        'no contact stash for a skipped post');

      win.close();
    });

    await test('auto-search controller: linktree profile holds and opens the linktree', async () => {
      const html = `<!DOCTYPE html><html><head><title>Instagram</title></head><body>
        <main><header><section>
          <h2>lt_shop</h2>
          <span dir="auto">LT Shop</span>
          <span dir="auto">Beauty store</span>
          <div dir="auto">Cosmetics and skincare<br>Walk-ins welcome</div>
          <a href="https://linktr.ee/lt_shop">linktr.ee/lt_shop</a>
          <ul><li>980 Followers</li></ul>
        </section></header></main>
      </body></html>`;
      const d = new JSDOM(html, {
        url: 'https://www.instagram.com/lt_shop/',
        pretendToBeVisual: true,
        runScripts: 'outside-only'
      });
      const win = d.window;
      const sent = [];
      const store = {
        autoSearch: {
          active: true, query: 'beauty', target: 2, collected: 0, phase: 'idle', message: '',
          tabId: 7, searchUrl: 'https://www.instagram.com/explore/search/keyword/?q=beauty',
          visitedPosts: [], visitedProfiles: [], pending: [], updatedAt: 0
        },
        settings: { saveEmail: true, savePhone: true }
      };
      const changeListeners = [];
      win.chrome = {
        storage: {
          local: {
            get(keys, cb) {
              const out = {};
              (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
              setTimeout(() => cb(out), 0);
            },
            set(items, cb) {
              Object.assign(store, items);
              setTimeout(() => {
                const changes = {};
                Object.keys(items).forEach((k) => { changes[k] = { newValue: items[k] }; });
                changeListeners.forEach((fn) => fn(changes, 'local'));
                if (cb) cb();
              }, 0);
            }
          },
          onChanged: { addListener(fn) { changeListeners.push(fn); } }
        },
        runtime: {
          lastError: null,
          sendMessage(message, cb) {
            sent.push(message);
            let resp = { ok: true };
            if (message.type === 'AUTOSEARCH_CLAIM') resp = { granted: true, state: store.autoSearch };
            setTimeout(() => cb && cb(resp), 0);
          },
          onMessage: { addListener() {} }
        }
      };

      const files = [
        'src/shared/logger.js',
        'src/content/normalizer.js',
        'src/content/selectors.js',
        'src/content/profile-extractor.js',
        'src/content/business-detector.js',
        'src/content/auto-search.js'
      ];
      files.forEach((rel) => win.eval(fs.readFileSync(path.join(root, rel), 'utf8')));

      const AS = win.FicinoAutoSearch;
      await new Promise((r) => setTimeout(r, 400));
      AS.tick();
      await new Promise((r) => setTimeout(r, 400));

      const hold = sent.find((m) => m.type === 'AUTOSEARCH_HOLD');
      assert.ok(hold, 'linktree profile must be held, got: ' + JSON.stringify(sent.map((m) => m.type)));
      assert.strictEqual(hold.payload.profile.instagram_username, 'lt_shop');
      assert.strictEqual(hold.payload.profile.website, '', 'linktree must not be treated as the website');

      const nav = sent.find((m) => m.type === 'AUTOSEARCH_NAVIGATE');
      assert.ok(nav, 'controller must open the linktree');
      assert.strictEqual(nav.payload.url, 'https://linktr.ee/lt_shop');

      assert.ok(!sent.find((m) => m.type === 'PROCESS_CANDIDATE'), 'must not submit before the linktree is checked');

      win.close();
    });

    await test('linktree resolver: picks the real website and skips social/messaging links', async () => {
      const d = new JSDOM(`<!DOCTYPE html><html><body>
        <a href="https://www.instagram.com/lt_shop/">Instagram</a>
        <a href="https://wa.me/391230000">WhatsApp</a>
        <a href="https://their-site.com">their site</a>
        <a href="https://linktr.ee/privacy">Privacy</a>
      </body></html>`, { url: 'https://linktr.ee/lt_shop', runScripts: 'outside-only' });
      const win = d.window;
      const sent = [];
      win.chrome = {
        storage: {
          local: {
            get(keys, cb) {
              setTimeout(() => cb({ autoSearch: { active: true, hold: { instagram_username: 'lt_shop' } } }), 0);
            }
          }
        },
        runtime: {
          lastError: null,
          sendMessage(message, cb) {
            sent.push(message);
            setTimeout(() => cb && cb({ ok: true }), 0);
          }
        }
      };

      win.eval(fs.readFileSync(path.join(root, 'src/content/normalizer.js'), 'utf8'));
      win.eval(fs.readFileSync(path.join(root, 'src/content/linktree-resolver.js'), 'utf8'));
      await new Promise((r) => setTimeout(r, 150));

      const resolve = sent.find((m) => m.type === 'AUTOSEARCH_RESOLVE');
      assert.ok(resolve, 'resolver must report back, got: ' + JSON.stringify(sent.map((m) => m.type)));
      assert.strictEqual(resolve.payload.website, 'https://their-site.com');
      win.close();
    });

    await test('dm-drafter types the draft, sends it with Enter, and reports send failures', async () => {
      const d = new JSDOM(`<!DOCTYPE html><html><body>
        <div role="dialog">
          <div contenteditable="true" aria-label="Message"></div>
        </div>
      </body></html>`, { url: 'https://www.instagram.com/direct/new/', runScripts: 'outside-only' });
      const win = d.window;
      const listeners = [];
      const keyEvents = [];
      const sentTexts = [];
      let autoSend = true;
      win.document.addEventListener('keydown', (e) => {
        keyEvents.push(e.key);
        if (e.key === 'Enter' && autoSend) {
          const c = win.document.querySelector('div[contenteditable="true"]');
          if (c && c.textContent.trim()) {
            sentTexts.push(c.textContent);
            c.textContent = '';
          }
        }
      });
      win.chrome = { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } } };
      win.eval(fs.readFileSync(path.join(root, 'src/content/dm-drafter.js'), 'utf8'));
      assert.strictEqual(listeners.length, 1, 'must register exactly one message listener');

      const respond = (text) => new Promise((resolve) => {
        const keep = listeners[0]({ type: 'OUTREACH_DRAFT', text }, {}, resolve);
        assert.strictEqual(keep, true, 'listener must keep the channel open for the async reply');
      });

      const resp = await respond('Hi A1 Salon, quick chat?');
      assert.strictEqual(resp.ok, true, JSON.stringify(resp));
      assert.strictEqual(resp.sent, true, 'instagram drafts are sent right after typing');
      const composer = win.document.querySelector('div[contenteditable="true"]');
      assert.deepStrictEqual(sentTexts, ['Hi A1 Salon, quick chat?'], 'the message must sit in the composer when Enter fires');
      assert.strictEqual(composer.textContent, '', 'a sent message leaves the composer');
      assert.deepStrictEqual(keyEvents, ['Enter'], 'exactly one Enter keydown must be dispatched');

      autoSend = false;
      const stuck = await respond('Another draft');
      assert.strictEqual(stuck.ok, false, JSON.stringify(stuck));
      assert.strictEqual(stuck.reason, 'send_failed', 'unverified sends must be reported as failures');
      assert.strictEqual(composer.textContent, 'Another draft', 'unsent text stays in the composer for a manual send');
      assert.deepStrictEqual(keyEvents, ['Enter', 'Enter', 'Enter'], 'Enter, Enter retry after the button attempt');

      const third = await respond('Third try');
      assert.strictEqual(third.ok, false);
      assert.strictEqual(third.reason, 'composer_not_empty');
      assert.strictEqual(composer.textContent, 'Another draft', 'existing text must not be overwritten');
      assert.strictEqual(keyEvents.length, 3, 'refusal dispatches no keys');

      win.close();
    });

    await test('dm-drafter falls back to the Send button when Enter is ignored', async () => {
      const d = new JSDOM(`<!DOCTYPE html><html><body>
        <div role="dialog">
          <div contenteditable="true" aria-label="Message"></div>
          <div role="button" aria-label="Send"></div>
        </div>
      </body></html>`, { url: 'https://www.instagram.com/direct/new/', runScripts: 'outside-only' });
      const win = d.window;
      const listeners = [];
      const keyEvents = [];
      win.document.addEventListener('keydown', (e) => keyEvents.push(e.key));
      win.document.querySelector('[role="button"]').addEventListener('click', () => {
        const c = win.document.querySelector('div[contenteditable="true"]');
        if (c && c.textContent.trim()) c.textContent = '';
      });
      win.chrome = { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } } };
      win.eval(fs.readFileSync(path.join(root, 'src/content/dm-drafter.js'), 'utf8'));

      const resp = await new Promise((resolve) => {
        listeners[0]({ type: 'OUTREACH_DRAFT', text: 'Button send' }, {}, resolve);
      });
      assert.strictEqual(resp.ok, true, JSON.stringify(resp));
      assert.strictEqual(resp.sent, true);
      assert.strictEqual(win.document.querySelector('div[contenteditable="true"]').textContent, '');
      assert.deepStrictEqual(keyEvents, ['Enter'], 'Enter is tried first, the click fallback completes the send');

      win.close();
    });

    await test('dm-drafter opens the lead profile, clicks Message, then types and sends', async () => {
      const d = new JSDOM(`<!DOCTYPE html><html><body>
        <header>
          <div role="button">Follow</div>
          <div role="button" id="msgBtn">Message</div>
        </header>
      </body></html>`, { url: 'https://www.instagram.com/prof_shop/', runScripts: 'outside-only' });
      const win = d.window;
      const listeners = [];
      const keyEvents = [];
      const sentTexts = [];
      win.document.addEventListener('keydown', (e) => {
        keyEvents.push(e.key);
        if (e.key === 'Enter') {
          const c = win.document.querySelector('div[contenteditable="true"]');
          if (c && c.textContent.trim()) {
            sentTexts.push(c.textContent);
            c.textContent = '';
          }
        }
      });
      let clicks = 0;
      win.document.getElementById('msgBtn').addEventListener('click', () => {
        clicks++;
        win.history.pushState({}, '', '/direct/t/555000/');
        const dlg = win.document.createElement('div');
        dlg.setAttribute('role', 'dialog');
        dlg.innerHTML = '<div contenteditable="true" aria-label="Message"></div>';
        win.document.body.appendChild(dlg);
      });
      win.chrome = { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } } };
      win.eval(fs.readFileSync(path.join(root, 'src/content/dm-drafter.js'), 'utf8'));

      const resp = await new Promise((resolve) => {
        listeners[0]({ type: 'OUTREACH_DRAFT', text: 'Hi Prof', recipient: 'prof_shop' }, {}, resolve);
      });
      assert.strictEqual(resp.ok, true, JSON.stringify(resp));
      assert.strictEqual(resp.sent, true);
      assert.strictEqual(clicks, 1, 'the Message button on the lead profile must be clicked once');
      assert.strictEqual(win.location.pathname, '/direct/t/555000/', 'the thread must be open before typing');
      assert.deepStrictEqual(sentTexts, ['Hi Prof'], 'the draft lands in the opened thread composer');
      assert.deepStrictEqual(keyEvents, ['Enter'], 'exactly one Enter for the verified send');

      win.close();
    });

    await test('dm-drafter reports a missing Message button instead of typing blindly', async () => {
      const d = new JSDOM(`<!DOCTYPE html><html><body>
        <header><div role="button">Follow</div></header>
      </body></html>`, { url: 'https://www.instagram.com/ghost_shop/', runScripts: 'outside-only' });
      const win = d.window;
      const listeners = [];
      win.chrome = { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } } };
      win.eval(fs.readFileSync(path.join(root, 'src/content/dm-drafter.js'), 'utf8'));

      const resp = await new Promise((resolve) => {
        listeners[0]({ type: 'OUTREACH_DRAFT', text: 'Hi', recipient: 'ghost_shop', deadlineMs: 500 }, {}, resolve);
      });
      assert.strictEqual(resp.ok, false, JSON.stringify(resp));
      assert.strictEqual(resp.reason, 'no_message_button');
      assert.strictEqual(win.document.body.textContent.indexOf('Hi'), -1, 'nothing may be typed without a target chat');

      win.close();
    });

    await test('dm-drafter refuses to draft on a profile that is not the lead', async () => {
      const d = new JSDOM(`<!DOCTYPE html><html><body>
        <header><div role="button">Message</div></header>
      </body></html>`, { url: 'https://www.instagram.com/someone_else/', runScripts: 'outside-only' });
      const win = d.window;
      const listeners = [];
      let clicks = 0;
      win.document.addEventListener('click', () => { clicks++; });
      win.chrome = { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } } };
      win.eval(fs.readFileSync(path.join(root, 'src/content/dm-drafter.js'), 'utf8'));

      const resp = await new Promise((resolve) => {
        listeners[0]({ type: 'OUTREACH_DRAFT', text: 'Hi', recipient: 'expected_lead' }, {}, resolve);
      });
      assert.strictEqual(resp.ok, false, JSON.stringify(resp));
      assert.strictEqual(resp.reason, 'wrong_profile');
      assert.strictEqual(clicks, 0, 'no button may be clicked on someone else\'s profile');

      win.close();
    });

    await test('dm-drafter reports a login wall instead of waiting forever', async () => {
      const d = new JSDOM(`<!DOCTYPE html><html><body><form id="login"></form></body></html>`,
        { url: 'https://www.instagram.com/accounts/login/?next=%2Fprof_shop%2F', runScripts: 'outside-only' });
      const win = d.window;
      const listeners = [];
      win.chrome = { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } } };
      win.eval(fs.readFileSync(path.join(root, 'src/content/dm-drafter.js'), 'utf8'));

      const resp = await new Promise((resolve) => {
        listeners[0]({ type: 'OUTREACH_DRAFT', text: 'Hi', recipient: 'prof_shop' }, {}, resolve);
      });
      assert.strictEqual(resp.ok, false, JSON.stringify(resp));
      assert.strictEqual(resp.reason, 'login_required');

      win.close();
    });
  }

  console.log('[9] influencer filtering + outreach drafts');

  async function waitFor(predicate, timeoutMs) {
    const start = Date.now();
    for (;;) {
      if (predicate()) return;
      if (Date.now() - start > (timeoutMs || 3000)) throw new Error('waitFor timeout');
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  async function driveWaTabs(sw, count) {
    for (let i = 0; i < count; i++) {
      await waitFor(() => sw.chrome._tabCalls.created.length === i + 1, 2000);
      sw.chrome._fireUpdated(sw.chrome._tabCalls.created[i].id, { status: 'complete' });
    }
  }

  await test('templates: placeholders, WhatsApp/Instagram links, exportable filter', () => {
    const T = globalThis.FicinoTemplates;
    assert.strictEqual(T.render('Hi {name} in {location}!', { instagram_name: 'Bob', location: 'Paris' }), 'Hi Bob in Paris!');
    assert.strictEqual(T.render('Hey {unknown}', {}), 'Hey {unknown}', 'unknown placeholders stay as-is');
    assert.strictEqual(T.render('Yo {username}', { instagram_username: '@cool' }), 'Yo cool');
    assert.strictEqual(
      T.render('Hi [Brand Name] team! Following as [username].', { instagram_name: 'A1 Beauty Store', instagram_username: 'a1_shop' }),
      'Hi A1 Beauty Store team! Following as a1_shop.',
      'bracket-style brand name must be substituted'
    );
    assert.strictEqual(T.render('[brand name] | [BRAND NAME] | [ Brand Name ]', { instagram_name: 'X' }), 'X | X | X', 'bracket tokens are case/space insensitive');
    assert.strictEqual(T.render('[keep this]', {}), '[keep this]', 'unknown bracket text stays literal');
    assert.strictEqual(T.render('[Brand Name] and {name}', { instagram_name: 'X' }), 'X and X', 'both placeholder styles can mix');
    assert.strictEqual(T.render('Hi [Brand Name]!', { instagram_username: 'a1_shop' }), 'Hi a1_shop!', 'bracket name falls back to username like {name}');
    assert.strictEqual(T.waPhoneDigits({ phone_raw: '+92 300 1234567' }), '923001234567');
    assert.strictEqual(T.waPhoneDigits({ phone_raw: '0300-1234567' }), '3001234567');
    assert.strictEqual(T.waPhoneDigits({ phone_raw: '12' }), '', 'too-short numbers are rejected');
    assert.strictEqual(
      T.waSendUrl({ phone_raw: '+92 300 1234567' }, 'Hello & bye'),
      'https://web.whatsapp.com/send?phone=923001234567&text=' + encodeURIComponent('Hello & bye')
    );
    assert.strictEqual(T.waSendUrl({}), '');
    assert.strictEqual(T.igSendUrl({ instagram_username: '@the_shop' }), 'https://www.instagram.com/the_shop/');
    assert.strictEqual(T.igSendUrl({}), '');
    assert.ok(T.isIgnored({ status: 'Ignore' }));
    assert.ok(!T.isIgnored({ status: 'New' }));
    const kept = T.exportable([{ id: 'a', status: 'New' }, { id: 'b', status: 'Ignore' }]);
    assert.strictEqual(kept.length, 1, 'ignored leads are excluded from export-all');
    assert.strictEqual(kept[0].id, 'a');
  });

  await test('influencer detector: flags creators, leaves businesses alone', () => {
    const IDet = globalThis.FicinoInfluencerDetector;
    assert.ok(IDet.detect({ category: 'Digital creator' }).flag, 'strong category flags immediately');
    assert.ok(IDet.detect({ category: 'Lifestyle blogger' }).flag);
    assert.ok(IDet.detect({ bio: 'For collaborations and sponsorship' }).flag, 'two bio markers flag');
    assert.ok(IDet.detect({ bio: 'For collabs DM me', instagram_username: 'sara.blog' }).flag, 'bio marker + username marker');
    assert.ok(IDet.detect({ bio: 'For collabs', followers: '150k' }).flag, 'bio marker + 100k followers');
    assert.ok(IDet.detect({ followers: '1.2m' }).flag, 'mega followers flag on their own');
    assert.strictEqual(IDet.detect({ category: 'Vlogger' }).reasons[0].indexOf('category:'), 0);

    assert.ok(!IDet.detect({ category: 'Beauty salon', bio: 'Hair and nails in Lahore', instagram_username: 'glow_salon', followers: '8,400' }).flag, 'salon stays untouched');
    assert.ok(!IDet.detect({ bio: 'press on nails sets available' }).flag, 'false positive guard');
    assert.ok(!IDet.detect({ bio: 'For sponsorship only', instagram_username: 'green_leaves', followers: '1,200' }).flag, 'single bio marker alone is not enough');

    assert.strictEqual(IDet.parseFollowers('1,234'), 1234);
    assert.strictEqual(IDet.parseFollowers('45k'), 45000);
    assert.deepStrictEqual(IDet.countHits('for collabs and collabs', ['collab']), ['collabs'], 'matched words dedupe');
  });

  await test('PROCESS_CANDIDATE saves influencers as Ignore, never deletes', async () => {
    const sw = loadServiceWorker();
    globalThis.FicinoOutreach.setPace(1);
    await sw.dispatch({ type: 'CLEAR_LEADS' });

    const normal = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: { instagram_username: 'normal_shop', website: '', bio: 'Best salon in town', category: 'Beauty salon' } }
    });
    assert.strictEqual(normal.saved, true);

    const infl = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 90, hasWebsite: false, profile: { instagram_username: 'vlog_sara', website: '', bio: 'For collaborations', category: 'Digital creator', phone_raw: '+92 300 1111111' } }
    });
    assert.strictEqual(infl.saved, true, 'influencers are saved, just flagged');

    const snap = await sw.dispatch({ type: 'GET_SNAPSHOT' });
    const normalLead = snap.leads.find((l) => l.instagram_username === 'normal_shop');
    const inflLead = snap.leads.find((l) => l.instagram_username === 'vlog_sara');
    assert.strictEqual(normalLead.status, 'New');
    assert.ok(!normalLead.influencer, 'business must not be flagged');
    assert.strictEqual(inflLead.status, 'Ignore');
    assert.strictEqual(inflLead.influencer, true);
    assert.ok(inflLead.influencer_reasons && inflLead.influencer_reasons.length > 0, 'flagged lead keeps its reasons');
  });

  await test('collected target ignores influencer leads', async () => {
    const sw = loadServiceWorker();
    globalThis.FicinoOutreach.setPace(1);
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    await sw.dispatch({ type: 'AUTOSEARCH_START', payload: { query: 'salon', target: 3 } });
    const sender = { tab: { id: 5 } };

    await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 90, hasWebsite: false, profile: { instagram_username: 'creator_zed', website: '', category: 'Influencer' } }
    });
    const infl = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'creator_zed' } }, sender);
    assert.strictEqual(infl.collected, 0, 'influencer lead must not count toward the target');

    await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: { instagram_username: 'real_shop', website: '' } }
    });
    const norm = await sw.dispatch({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: 'real_shop' } }, sender);
    assert.strictEqual(norm.collected, 1, 'business lead still counts');
  });

  await test('FLAG_INFLUENCERS flags new matches, restores stale flags, keeps touched statuses', async () => {
    const sw = loadServiceWorker();
    globalThis.FicinoOutreach.setPace(1);
    sw.chrome._store.leads = [
      { id: 'ig_a', instagram_username: 'plain_shop', status: 'New', bio: 'Best salon in town', category: 'Beauty salon', confidence: 80 },
      { id: 'ig_b', instagram_username: 'big_creator', status: 'New', bio: '', category: 'Vlogger', confidence: 80 },
      { id: 'ig_c', instagram_username: 'restored_shop', status: 'Ignore', influencer: true, influencer_reasons: ['category: blogger'], bio: 'Hair salon in karachi', category: 'Beauty salon', confidence: 80 },
      { id: 'ig_d', instagram_username: 'contacted_creator', status: 'Contacted', bio: 'For collabs, sponsorship: hi@me.com', confidence: 80 }
    ];

    const res = await sw.dispatch({ type: 'FLAG_INFLUENCERS' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.flagged, 2, 'big_creator + contacted_creator, got ' + res.flagged);
    assert.strictEqual(res.restored, 1, 'stale flag must revert to New');

    const leads = sw.chrome._store.leads;
    assert.strictEqual(leads.find((l) => l.id === 'ig_a').status, 'New', 'business stays New');
    assert.ok(!leads.find((l) => l.id === 'ig_a').influencer);
    assert.strictEqual(leads.find((l) => l.id === 'ig_b').status, 'Ignore');
    assert.strictEqual(leads.find((l) => l.id === 'ig_b').influencer, true);
    assert.strictEqual(leads.find((l) => l.id === 'ig_c').status, 'New', 'restored lead goes back to New');
    assert.strictEqual(leads.find((l) => l.id === 'ig_c').influencer, false);
    assert.strictEqual(leads.find((l) => l.id === 'ig_d').status, 'Contacted', 'Contacted is never flipped');
    assert.strictEqual(leads.find((l) => l.id === 'ig_d').influencer, true);
  });

  await test('permit leads: excluded instantly as influencer-style leads', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });

    const saved = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: { instagram_username: 'permit_clinic', website: '', bio: 'Permit No. 5427536 · Dubai', phone_raw: '5427536', category: 'Clinic' } }
    });
    assert.strictEqual(saved.saved, true, JSON.stringify(saved));
    const lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'permit_clinic');
    assert.ok(lead, 'lead saved');
    assert.strictEqual(lead.status, 'Ignore', 'permit leads are excluded at save time');
    assert.strictEqual(lead.influencer, true, JSON.stringify(lead));
    assert.ok(lead.influencer_reasons.indexOf('permit_number') !== -1, JSON.stringify(lead.influencer_reasons));
    assert.strictEqual(lead.phone_issue, 'permit_number', JSON.stringify(lead));

    sw.chrome._store.leads = sw.chrome._store.leads.concat([
      { id: 'e1', instagram_username: 'old_permit', bio: 'License 5427536', status: 'New', confidence: 80 },
      { id: 'e2', instagram_username: 'contacted_permit', bio: 'TRN 100123456700003', status: 'Contacted', confidence: 80 },
      { id: 'e3', instagram_username: 'clean_lead', bio: 'Great shop in town', phone_raw: '+92 300 1234567', status: 'New', confidence: 80 },
      { id: 'e4', instagram_username: 'permits_word', bio: 'permits accepted at the front desk', status: 'New', confidence: 80 },
      { id: 'e5', instagram_username: 'permit_no_number', bio: 'Permit holder · Dubai Marina', status: 'New', confidence: 80 }
    ]);
    const res = await sw.dispatch({ type: 'EXCLUDE_PERMITS' });
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.strictEqual(res.matched, 5, JSON.stringify(res));
    assert.strictEqual(res.excluded, 3, 'only New leads flip to Ignore: ' + JSON.stringify(res));
    const leads = sw.chrome._store.leads;
    assert.strictEqual(leads.find((l) => l.id === 'e1').status, 'Ignore');
    assert.strictEqual(leads.find((l) => l.id === 'e1').influencer, true);
    assert.strictEqual(leads.find((l) => l.id === 'e1').influencer_reasons.indexOf('permit_number') !== -1, true);
    assert.strictEqual(leads.find((l) => l.id === 'e2').status, 'Contacted', 'Contacted is never flipped');
    assert.strictEqual(leads.find((l) => l.id === 'e2').influencer, true, 'flag is backfilled anyway');
    assert.strictEqual(leads.find((l) => l.id === 'e3').status, 'New', 'business leads untouched');
    assert.ok(!leads.find((l) => l.id === 'e3').influencer);
    assert.strictEqual(leads.find((l) => l.id === 'e4').status, 'Ignore', 'the word permits alone is enough');
    assert.strictEqual(leads.find((l) => l.id === 'e4').influencer, true, JSON.stringify(leads.find((l) => l.id === 'e4')));
    assert.strictEqual(leads.find((l) => l.id === 'e5').status, 'Ignore', 'a permit mention with no number is enough');
    assert.strictEqual(leads.find((l) => l.id === 'e5').influencer, true);
    const settings = await globalThis.FicinoStorage.getSettings();
    assert.strictEqual(settings.permitExcludeVersion, 2, 'marked done');

    const again = await sw.dispatch({ type: 'EXCLUDE_PERMITS' });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.excluded, 0, 'second run is a no-op');

    const flag = await sw.dispatch({ type: 'FLAG_INFLUENCERS' });
    assert.strictEqual(flag.ok, true, JSON.stringify(flag));
    assert.strictEqual(sw.chrome._store.leads.find((l) => l.id === 'e1').status, 'Ignore', 're-scan never restores permit leads');
    assert.strictEqual(sw.chrome._store.leads.find((l) => l.instagram_username === 'permit_clinic').status, 'Ignore');
  });

  await test('concurrent saves of the same profile never duplicate the lead', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    const payload = {
      confidence: 85, hasWebsite: false,
      profile: { instagram_username: 'race_shop', website: '', bio: 'Nice salon in town', phone_raw: '+92 300 1112223', category: 'Salon' }
    };
    const results = await Promise.all([
      sw.dispatch({ type: 'PROCESS_CANDIDATE', payload: payload }),
      sw.dispatch({ type: 'PROCESS_CANDIDATE', payload: payload }),
      sw.dispatch({ type: 'PROCESS_CANDIDATE', payload: payload })
    ]);
    const rows = sw.chrome._store.leads.filter((l) => l.instagram_username === 'race_shop');
    assert.strictEqual(rows.length, 1, 'exactly one row: ' + JSON.stringify(sw.chrome._store.leads.map((l) => l.instagram_username)));
    assert.strictEqual(results.filter((r) => r.saved).length, 1, JSON.stringify(results));
    assert.strictEqual(results.filter((r) => r.reason === 'duplicate').length, 2, JSON.stringify(results));
  });

  await test('FLAG_INFLUENCERS alone flags permit bios: word, plural, licensed, Arabic, no number', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    sw.chrome._store.leads = [
      { id: 'b1', instagram_username: 'permit_barber', bio: 'Permit holder · Dubai Marina', status: 'New', confidence: 80 },
      { id: 'b2', instagram_username: 'permits_cafe', bio: 'permits accepted at the front desk', status: 'New', confidence: 80 },
      { id: 'b3', instagram_username: 'licensed_salon', bio: 'Licensed & insured beauty salon', status: 'New', confidence: 80 },
      { id: 'b4', instagram_username: 'arabic_clinic', bio: 'رخصة تجارية 5427536 · عيادة', status: 'New', confidence: 80 },
      { id: 'b5', instagram_username: 'plain_shop', bio: 'Great coffee in town', status: 'New', confidence: 80 },
      { id: 'b6', instagram_username: 'contacted_permit', bio: 'TRN 100123456700003', status: 'Contacted', confidence: 80 }
    ];

    const res = await sw.dispatch({ type: 'FLAG_INFLUENCERS' });
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.strictEqual(res.total, 6, JSON.stringify(res));
    assert.strictEqual(res.flagged, 5, 'every permit/licensed lead is flagged: ' + JSON.stringify(res));
    const leads = sw.chrome._store.leads;
    ['b1', 'b2', 'b3', 'b4'].forEach((id) => {
      const l = leads.find((x) => x.id === id);
      assert.strictEqual(l.status, 'Ignore', id + ' must be Ignore: ' + JSON.stringify(l));
      assert.strictEqual(l.influencer, true, id + ' must be influencer');
      assert.ok(l.influencer_reasons.indexOf('permit_number') !== -1, id + ' reasons: ' + JSON.stringify(l.influencer_reasons));
    });
    assert.strictEqual(leads.find((l) => l.id === 'b5').status, 'New', 'clean lead untouched');
    assert.ok(!leads.find((l) => l.id === 'b5').influencer);
    assert.strictEqual(leads.find((l) => l.id === 'b6').status, 'Contacted', 'Contacted never flips');
    assert.strictEqual(leads.find((l) => l.id === 'b6').influencer, true, 'flag still backfilled');
    assert.ok(leads.find((l) => l.id === 'b6').influencer_reasons.indexOf('permit_number') !== -1);

    const again = await sw.dispatch({ type: 'FLAG_INFLUENCERS' });
    assert.strictEqual(again.flagged, 0, 'second scan is stable: ' + JSON.stringify(again));
    assert.strictEqual(again.restored, 0, 'permit leads are never restored: ' + JSON.stringify(again));
  });

  await test('outreach: WhatsApp tabs open one at a time, only after the previous finished loading', async () => {
    const sw = loadServiceWorker();
    globalThis.FicinoOutreach.setPace(1);
    await sw.dispatch({ type: 'CLEAR_LEADS' });

    const leadA = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: { instagram_username: 'a1_shop', instagram_name: 'A1 Salon', website: '', phone_raw: '+92 300 1234567', category: 'Salon' } }
    });
    const leadB = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: { instagram_username: 'b2_cafe', instagram_name: 'B2 Cafe', website: '', phone_raw: '+92 300 7654321', category: 'Cafe' } }
    });

    const bad = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'telegram', ids: [leadA.id] } });
    assert.strictEqual(bad.started, false);
    assert.strictEqual(bad.reason, 'bad_channel');
    const noIds = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'whatsapp', ids: [] } });
    assert.strictEqual(noIds.reason, 'no_ids');

    const started = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'whatsapp', ids: [leadA.id, leadB.id, 'missing_id'] } });
    assert.strictEqual(started.started, true);
    assert.strictEqual(started.total, 2, 'total counts eligible leads only');
    assert.strictEqual(started.skipped, 1);

    await waitFor(() => sw.chrome._store.outreach && sw.chrome._store.outreach.state === 'running', 2000);
    await waitFor(() => sw.chrome._tabCalls.created.length === 1, 2000);
    assert.strictEqual(sw.chrome._store.outreach.prepared.length, 0, 'nothing is prepared before the tab finished loading');

    sw.chrome._fireUpdated(sw.chrome._tabCalls.created[0].id, { status: 'loading' });
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(sw.chrome._tabCalls.created.length, 1, 'the next tab must wait for the previous one to finish loading');
    assert.strictEqual(sw.chrome._store.outreach.prepared.length, 0, 'loading status must not count as prepared');

    sw.chrome._fireUpdated(sw.chrome._tabCalls.created[0].id, { status: 'complete' });
    await waitFor(() => sw.chrome._tabCalls.created.length === 2, 2000);
    sw.chrome._fireUpdated(sw.chrome._tabCalls.created[1].id, { status: 'complete' });

    await waitFor(() => sw.chrome._store.outreach && sw.chrome._store.outreach.state === 'done');
    const outreach = sw.chrome._store.outreach;
    assert.strictEqual(outreach.prepared.length, 2, 'prepared: ' + JSON.stringify(outreach));
    assert.strictEqual(outreach.failed.length, 1);
    assert.strictEqual(outreach.failed[0].reason, 'not_found');

    const urls = sw.chrome._tabCalls.created.map((t) => t.url);
    assert.strictEqual(urls.length, 2);
    assert.ok(urls.every((u) => u.indexOf('https://web.whatsapp.com/send?phone=') === 0), JSON.stringify(urls));
    assert.ok(decodeURIComponent(urls[0]).indexOf('A1 Salon') !== -1, 'message must contain the rendered name: ' + urls[0]);
    assert.ok(urls[0].indexOf('923001234567') !== -1, 'phone digits must be normalized: ' + urls[0]);
    assert.ok(sw.chrome._tabCalls.updated.some((t) => t.active === true), 'first draft tab is activated when everything is ready');
    assert.strictEqual(sw.chrome._tabCalls.sent.length, 0, 'WhatsApp drafts use deep links only, no injection');
  });

  await test('outreach: Instagram drafts wait for the DM page, then type and send', async () => {
    const sw = loadServiceWorker();
    globalThis.FicinoOutreach.setPace(1);
    await sw.dispatch({ type: 'CLEAR_LEADS' });

    const lead = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: { instagram_username: 'ig_lead', instagram_name: 'IG Lead', website: '' } }
    });
    const started = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'instagram', ids: [lead.id] } });
    assert.strictEqual(started.started, true);

    await waitFor(() => sw.chrome._tabCalls.created.length === 1, 2000);
    const tabId = sw.chrome._tabCalls.created[0].id;
    assert.ok(sw.chrome._tabCalls.created[0].url.indexOf('instagram.com/ig_lead') !== -1);
    assert.strictEqual(sw.chrome._tabCalls.sent.length, 0, 'draft must wait until the DM page finished loading');

    sw.chrome._fireUpdated(tabId, { status: 'complete' });
    await waitFor(() => sw.chrome._store.outreach && sw.chrome._store.outreach.state === 'done');

    const sent = sw.chrome._tabCalls.sent;
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].tabId, tabId);
    assert.strictEqual(sent[0].msg.type, 'OUTREACH_DRAFT');
    assert.ok(sent[0].msg.text.indexOf('IG Lead') !== -1, 'draft text must be rendered: ' + sent[0].msg.text);
    assert.strictEqual(sent[0].msg.recipient, 'ig_lead', 'the drafter must be told which profile to message');
    assert.strictEqual(sw.chrome._store.outreach.prepared.length, 1);
    assert.strictEqual(sw.chrome._store.outreach.prepared[0].tabId, tabId);
  });

  await test('outreach: skips ignored and phoneless leads, caps batches at 20', async () => {
    const sw = loadServiceWorker();
    globalThis.FicinoOutreach.setPace(1);
    await sw.dispatch({ type: 'CLEAR_LEADS' });

    const ignored = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 90, hasWebsite: false, profile: { instagram_username: 'influ_one', website: '', category: 'Influencer', phone_raw: '+92 300 9999999' } }
    });
    const noPhone = await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: { instagram_username: 'no_phone_shop', website: '' } }
    });

    const skipped = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'whatsapp', ids: [ignored.id, noPhone.id] } });
    assert.strictEqual(skipped.started, false, 'nothing eligible: ' + JSON.stringify(skipped));
    assert.strictEqual(skipped.reason, 'no_eligible');
    const failedReasons = (sw.chrome._store.outreach.failed || []).map((f) => f.reason);
    assert.deepStrictEqual(failedReasons, ['ignored', 'no_phone']);
    assert.strictEqual(sw.chrome._store.outreach.state, 'idle');

    sw.chrome._store.leads = [];
    for (let i = 0; i < 22; i++) {
      sw.chrome._store.leads.push({ id: 'ig_bulk_' + i, instagram_username: 'bulk' + i, status: 'New', phone_raw: '+92 300 1234567', confidence: 80 });
    }
    const bulkIds = sw.chrome._store.leads.map((l) => l.id);
    const started = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'whatsapp', ids: bulkIds } });
    assert.strictEqual(started.started, true);
    assert.strictEqual(started.total, 20, 'batch cap protects against tab flooding');
    assert.strictEqual(started.skipped, 2);
    await driveWaTabs(sw, 20);
    await waitFor(() => sw.chrome._store.outreach && sw.chrome._store.outreach.state === 'done');
    assert.strictEqual(sw.chrome._store.outreach.prepared.length, 20);
  });

  await test('phone attribution: country codes inferred from search/bio context', async () => {
    const a1 = N.attributePhone('0501234567', { keyword: 'Clothes in UAE' }, '');
    assert.strictEqual(a1.valid, true);
    assert.strictEqual(a1.needsCc, false);
    assert.strictEqual(a1.normalized, '+971501234567', 'search term with UAE resolves the code');

    const fromBio = N.attributePhone('02071234567', { bio: 'Award winning bakery in London' }, '');
    assert.strictEqual(fromBio.normalized, '+442071234567', 'bio city decides the code');

    const fromUsername = N.attributePhone('02071234567', { username: 'london_bakes' }, '');
    assert.strictEqual(fromUsername.normalized, '+442071234567', 'username hint works too');

    const explicit = N.attributePhone('+39 333 123 4567', { keyword: 'Clothes in UAE' }, '');
    assert.strictEqual(explicit.normalized, '+393331234567', 'explicit +CC always wins over context');

    const zeroZero = N.attributePhone('00971501234567', {}, '');
    assert.strictEqual(zeroZero.normalized, '+971501234567', '00 prefix is international');

    const bare = N.attributePhone('0300 7654321', { username: 'b2_cafe' }, '');
    assert.strictEqual(bare.valid, true);
    assert.strictEqual(bare.needsCc, true, 'bare number with no hint is not guessed');
    assert.strictEqual(bare.normalized, '', 'unattributable numbers are left unnormalized');

    const withFallback = N.attributePhone('0300 7654321', {}, '92');
    assert.strictEqual(withFallback.normalized, '+923007654321', 'fallback country code applies');

    const withCountryDigits = N.attributePhone('971501234567', {}, '');
    assert.strictEqual(withCountryDigits.normalized, '+971501234567', 'international without + is kept');

    const uaePrefix = N.attributePhone('0505016078', {}, '');
    assert.strictEqual(uaePrefix.normalized, '+971505016078', 'bare UAE 05-mobile gets +971 with no context');
    assert.strictEqual(uaePrefix.needsCc, false);
    assert.strictEqual(N.attributePhone('0505016078', {}, '92').normalized, '+971505016078',
      'the 05 format beats a mismatched fallback code');

    const short = N.attributePhone('123', {}, '971');
    assert.strictEqual(short.valid, false);
    assert.strictEqual(short.issue, 'too_short');

    const junk = N.attributePhone('0000000000', {}, '971');
    assert.strictEqual(junk.valid, false);
    assert.strictEqual(junk.issue, 'suspicious', 'repeated-digit junk is rejected');

    const empty = N.attributePhone('', {}, '971');
    assert.strictEqual(empty.issue, 'no_number');
  });

  await test('phone cleanup: verifies existing numbers and flags wrong ones', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    sw.chrome._store.leads = [
      { id: 'p1', instagram_username: 'good_shop', keyword: 'Clothes in UAE', bio: 'Best clothes in Dubai. Call 050 123 4567', phone_raw: '0501234567', status: 'New' },
      { id: 'p2', instagram_username: 'wrong_shop', bio: 'WhatsApp us 050 999 8877 · Dubai', phone_raw: '0501234567', status: 'New' },
      { id: 'p3', instagram_username: 'cap_shop', bio: '', phone_raw: '+393331234567', status: 'New' },
      { id: 'p4', instagram_username: 'panel_shop', bio: 'Fresh daily', phone_raw: '+971555123456', status: 'New' },
      { id: 'p5', instagram_username: 'nocc_shop', bio: 'Groceries', phone_raw: '0501234567', status: 'New' }
    ];
    sw.chrome._store.autoSearch = {
      postContacts: { cap_shop: { phone_raw: '+39 333 123 4567', phone_normalized: '+393331234567', email: '', at: 1 } }
    };

    const first = await sw.dispatch({ type: 'CLEAN_PHONES' });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.scanned, 5);
    assert.strictEqual(first.cleaned, 5, JSON.stringify(first));
    assert.strictEqual(first.flagged, 1, JSON.stringify(first));
    assert.strictEqual(first.valid, 4, JSON.stringify(first));
    assert.strictEqual(first.corrected, 1, JSON.stringify(first));

    const by = (id) => sw.chrome._store.leads.find((l) => l.id === id);
    assert.strictEqual(by('p1').phone_normalized, '+971501234567', 'attributed from keyword/bio');
    assert.strictEqual(by('p1').phone_issue, undefined, 'number found in bio is trusted');
    assert.strictEqual(by('p2').phone_normalized, '+971509998877', 'bio number replaces the wrong scraped one');
    assert.strictEqual(by('p2').phone_issue, undefined, 'corrected numbers need no review');
    assert.strictEqual(by('p2').phone_corrected, true, 'correction is recorded');
    assert.strictEqual(by('p2').phone_replaced_raw, '0501234567', 'original value kept for audit');
    assert.ok(by('p2').phone_raw.indexOf('999') !== -1, 'stored raw comes from the bio: ' + by('p2').phone_raw);
    assert.strictEqual(by('p3').phone_issue, 'caption_source', 'post-caption numbers are suspect when the bio is empty');
    assert.strictEqual(by('p4').phone_issue, undefined, 'panel number with empty bio is kept');
    assert.strictEqual(by('p5').phone_normalized, '+971501234567', 'UAE 05-prefix resolves without any context');
    assert.strictEqual(by('p5').phone_issue, undefined, 'resolvable numbers need no flag');

    const second = await sw.dispatch({ type: 'CLEAN_PHONES' });
    assert.strictEqual(second.cleaned, 0, 'cleanup is idempotent');
    assert.strictEqual(second.corrected, 0, 'no double corrections');
    assert.strictEqual(second.flagged, 1);
    const settings = sw.chrome._store.settings || {};
    assert.strictEqual(settings.phoneCleanupVersion, 1, 'cleanup marks itself done');
  });

  await test('phone attribution: applied when leads are saved', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    sw.chrome._store.autoSearch = {
      postContacts: { shadow_shop: { phone_raw: '+92 300 7654321', phone_normalized: '+923007654321', email: '', at: 1 } }
    };

    await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: {
        instagram_username: 'dubai_moda', instagram_name: 'Dubai Moda', website: '',
        keyword: 'Clothes in UAE', bio: 'Modest wear. WhatsApp 050 123 4567',
        phone_raw: '050 123 4567', category: 'Clothing'
      } }
    });
    let lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'dubai_moda');
    assert.ok(lead, 'lead must be saved');
    assert.strictEqual(lead.phone_normalized, '+971501234567', 'bare local number gets the context code');
    assert.strictEqual(lead.phone_issue, undefined, 'number present in the bio is trusted');

    await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: {
        instagram_username: 'shady_deals', website: '', bio: 'Deals every day',
        phone_raw: '+92 300 1234567'
      } }
    });
    lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'shady_deals');
    assert.strictEqual(lead.phone_normalized, '+923001234567');
    assert.strictEqual(lead.phone_issue, undefined, 'explicit number without bio phones is kept');

    await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: {
        instagram_username: 'shadow_shop', website: '', bio: 'Retail therapy'
      } }
    });
    lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'shadow_shop');
    assert.strictEqual(lead.phone_normalized, '+923007654321', 'stashed post phone still merges');
    assert.strictEqual(lead.phone_issue, 'caption_source', 'caption-only numbers are flagged at save time');
  });

  await test('phone self-correction: the profile bio replaces a wrong number', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    sw.chrome._store.autoSearch = {
      postContacts: { fixed_shop: { phone_raw: '+39 333 123 4567', phone_normalized: '+393331234567', email: '', at: 1 } }
    };

    await sw.dispatch({
      type: 'PROCESS_CANDIDATE',
      payload: { confidence: 85, hasWebsite: false, profile: {
        instagram_username: 'fixed_shop', website: '', keyword: 'salons in Dubai',
        bio: 'Beauty salon in Dubai. Call +971 50 999 8877',
        phone_raw: '+39 333 123 4567'
      } }
    });
    const lead = sw.chrome._store.leads.find((l) => l.instagram_username === 'fixed_shop');
    assert.ok(lead, 'lead must be saved');
    assert.strictEqual(lead.phone_normalized, '+971509998877', 'bio number replaces the wrong scraped one');
    assert.strictEqual(lead.phone_issue, undefined, 'corrected numbers are usable, not flagged');
    assert.strictEqual(lead.phone_raw, '+971 50 999 8877', 'stored raw comes from the bio');
    assert.strictEqual(lead.phone_replaced_raw, '+39 333 123 4567', 'original value kept for audit');
    assert.strictEqual(lead.phone_corrected, true, 'correction is recorded');

    globalThis.FicinoOutreach.setPace(1);
    const res = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'whatsapp', ids: [lead.id] } });
    assert.strictEqual(res.total, 1, JSON.stringify(res));
    assert.strictEqual(res.skipped, 0, JSON.stringify(res));
    await driveWaTabs(sw, 1);
    await waitFor(() => sw.chrome._store.outreach && sw.chrome._store.outreach.state === 'done');
    const url = sw.chrome._tabCalls.created[0].url;
    assert.ok(url.indexOf('phone=971509998877') !== -1, 'WA link uses the corrected digits: ' + url);
  });

  await test('phone permits: permit/license numbers in bios are not phones', async () => {
    const bio = 'Permit No. 5427536 · TRN 100123456700003 · Call 0505016078';
    const phones = N.extractPhones(bio);
    assert.strictEqual(phones.length, 1, JSON.stringify(phones));
    assert.strictEqual(phones[0].normalized, '0505016078', 'the real phone next to permits is kept');
    const permits = N.findPermitNumbers(bio);
    assert.ok(permits.indexOf('5427536') !== -1, JSON.stringify(permits));
    assert.ok(permits.indexOf('100123456700003') !== -1, JSON.stringify(permits));
    assert.strictEqual(N.extractPhones('License 5427536 · Dubai').length, 0, 'a lone permit is never a phone');

    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    sw.chrome._store.leads = [
      { id: 't1', instagram_username: 'permit_shop', bio: 'Permit No. 5427536 · Dubai', phone_raw: '5427536', status: 'New' },
      { id: 't2', instagram_username: 'mixed_shop', bio: 'License 5427536 · WhatsApp 0505016078', phone_raw: '0505016078', status: 'New' }
    ];
    const clean = await sw.dispatch({ type: 'CLEAN_PHONES' });
    assert.strictEqual(clean.ok, true, JSON.stringify(clean));
    const t1 = sw.chrome._store.leads.find((l) => l.id === 't1');
    assert.strictEqual(t1.phone_issue, 'permit_number', JSON.stringify(t1));
    assert.strictEqual(t1.phone_normalized, '', 'permit numbers are never normalized as phones');
    const t2 = sw.chrome._store.leads.find((l) => l.id === 't2');
    assert.strictEqual(t2.phone_normalized, '+971505016078', 'the real number beside a permit is kept');
    assert.strictEqual(t2.phone_issue, undefined, JSON.stringify(t2));

    globalThis.FicinoOutreach.setPace(1);
    const out = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'whatsapp', ids: ['t1', 't2'] } });
    assert.strictEqual(out.total, 1, JSON.stringify(out));
    assert.strictEqual(out.skipped, 1, JSON.stringify(out));
    await driveWaTabs(sw, 1);
    await waitFor(() => sw.chrome._store.outreach && sw.chrome._store.outreach.state === 'done');
    const reasons = (sw.chrome._store.outreach.failed || []).map((f) => f.reason);
    assert.ok(reasons.indexOf('permit_number') !== -1, JSON.stringify(reasons));
    const url = sw.chrome._tabCalls.created[0].url;
    assert.ok(url.indexOf('phone=971505016078') !== -1, 'WA link uses the real phone: ' + url);
  });

  await test('outreach: skips flagged and unattributable phone numbers', async () => {
    const sw = loadServiceWorker();
    globalThis.FicinoOutreach.setPace(1);
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    sw.chrome._store.leads = [
      { id: 'f1', instagram_username: 'flagged_one', status: 'New', phone_raw: '0501234567', phone_issue: 'not_in_bio', confidence: 80 },
      { id: 'f2', instagram_username: 'bare_one', status: 'New', phone_raw: '02071234567', bio: 'Groceries in town', confidence: 80 },
      { id: 'f3', instagram_username: 'uae_one', status: 'New', phone_raw: '0501234567', keyword: 'Clothes in UAE', bio: 'Call 050 123 4567', confidence: 80 }
    ];
    const res = await sw.dispatch({ type: 'OUTREACH_START', payload: { channel: 'whatsapp', ids: ['f1', 'f2', 'f3'] } });
    assert.strictEqual(res.started, true, JSON.stringify(res));
    assert.strictEqual(res.total, 1, 'only the attributed lead is eligible');
    assert.strictEqual(res.skipped, 2);

    await driveWaTabs(sw, 1);
    await waitFor(() => sw.chrome._store.outreach && sw.chrome._store.outreach.state === 'done');
    const reasons = (sw.chrome._store.outreach.failed || []).map((f) => f.reason);
    assert.ok(reasons.indexOf('not_in_bio') !== -1, JSON.stringify(reasons));
    assert.ok(reasons.indexOf('needs_cc') !== -1, JSON.stringify(reasons));
    assert.strictEqual(sw.chrome._store.outreach.prepared.length, 1);
    const url = sw.chrome._tabCalls.created[0].url;
    assert.ok(url.indexOf('phone=971501234567') !== -1, 'WA link uses the attributed digits: ' + url);
  });

  await test('SET_PHONE: manual number fixes clear the flag', async () => {
    const sw = loadServiceWorker();
    await sw.dispatch({ type: 'CLEAR_LEADS' });
    sw.chrome._store.leads = [
      { id: 'm1', instagram_username: 'manual_one', status: 'New', phone_raw: '0501234567', phone_issue: 'needs_cc', bio: 'Shop in Dubai', confidence: 80 },
      { id: 'm2', instagram_username: 'bare_two', status: 'New', phone_raw: '0501234567', phone_issue: 'needs_cc', bio: 'Groceries', confidence: 80 }
    ];

    const rejected = await sw.dispatch({ type: 'SET_PHONE', payload: { id: 'm1', phone_raw: '+12' } });
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.reason, 'too_short');

    const stillBare = await sw.dispatch({ type: 'SET_PHONE', payload: { id: 'm2', phone_raw: '02071234567' } });
    assert.strictEqual(stillBare.ok, false, 'bare input without resolvable code is refused');
    assert.strictEqual(stillBare.reason, 'needs_cc');

    const ok = await sw.dispatch({ type: 'SET_PHONE', payload: { id: 'm1', phone_raw: '+971 50 123 4567' } });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    const lead = sw.chrome._store.leads.find((l) => l.id === 'm1');
    assert.strictEqual(lead.phone_raw, '+971 50 123 4567');
    assert.strictEqual(lead.phone_normalized, '+971501234567');
    assert.strictEqual(lead.phone_issue, undefined, 'manual fixes are trusted');

    const missing = await sw.dispatch({ type: 'SET_PHONE', payload: { id: 'nope', phone_raw: '+971501234567' } });
    assert.strictEqual(missing.ok, false);
    assert.strictEqual(missing.reason, 'not_found');
  });

  await test('settings: default country code and cleanup version defaults', async () => {
    loadServiceWorker();
    const settings = await globalThis.FicinoStorage.getSettings();
    assert.strictEqual(settings.defaultCountryCode, '');
    assert.strictEqual(settings.phoneCleanupVersion, 0);
    assert.strictEqual(settings.permitExcludeVersion, 0);
  });

  console.log('');
  if (failures.length) {
    console.error(`${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`${passed} passed, 0 failed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
