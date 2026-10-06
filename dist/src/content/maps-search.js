(function (root) {
  'use strict';

  var Log = root.FicinoLog;
  var N = root.FicinoNormalizer;

  var MIN_CYCLE_MS = 2000;
  var MAX_CYCLE_MS = 4000;
  var PLACE_WAIT_TICKS = 8;
  var STAGNATION_TICKS = 4;
  var OTHER_PAGE_LIMIT = 5;

  var mirror = {
    active: false,
    query: '',
    target: 0,
    collected: 0,
    phase: 'idle',
    message: '',
    tabId: null,
    searchUrl: '',
    visitedPlaces: [],
    visitedKeys: [],
    pending: []
  };

  var settings = {
    saveEmail: true,
    savePhone: true
  };

  var ctl = {
    granted: false,
    timer: null,
    lastPath: '',
    wait: 0,
    stagnation: 0,
    navPending: false,
    submitting: false,
    claimed: false
  };

  function sendMessage(payload) {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          resolve(null);
          return;
        }
        chrome.runtime.sendMessage(payload, function (response) {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response || null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  }

  function readState() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage) {
          resolve();
          return;
        }
        chrome.storage.local.get(['mapsSearch', 'settings'], function (items) {
          if (items && items.mapsSearch) Object.assign(mirror, items.mapsSearch);
          if (items && items.settings) {
            settings.saveEmail = items.settings.saveEmail !== false;
            settings.savePhone = items.settings.savePhone !== false;
          }
          resolve();
        });
      } catch (err) {
        resolve();
      }
    });
  }

  function watchStorage() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (changes.settings) {
          var next = changes.settings.newValue || {};
          settings.saveEmail = next.saveEmail !== false;
          settings.savePhone = next.savePhone !== false;
        }
        if (!changes.mapsSearch) return;
        var wasActive = mirror.active;
        Object.assign(mirror, changes.mapsSearch.newValue || {});
        if (mirror.active && !wasActive) {
          ensureRunning();
        } else if (!mirror.active) {
          ctl.granted = false;
          stopLoop();
        }
      });
    } catch (err) { /* ignore */ }
  }

  function claim() {
    return sendMessage({ type: 'MAPS_CLAIM' }).then(function (res) {
      ctl.granted = !!(res && res.granted);
      if (res && res.state) Object.assign(mirror, res.state);
      if (!ctl.granted) {
        if (res && (res.reason === 'wrong_tab' || res.reason === 'inactive')) stopLoop();
        return false;
      }
      if (Log && Log.isEnabled()) Log.debug('MapsSearch', 'claimed tab, phase ' + mirror.phase);
      return true;
    });
  }

  function ensureRunning() {
    claim().then(function (granted) {
      if (!granted || !mirror.active) return;
      startLoop();
    });
  }

  function cycleDelay() {
    return MIN_CYCLE_MS + Math.floor(Math.random() * (MAX_CYCLE_MS - MIN_CYCLE_MS + 1));
  }

  function startLoop() {
    if (ctl.timer) return;
    scheduleNext();
  }

  function scheduleNext() {
    if (ctl.timer) return;
    ctl.timer = setTimeout(function () {
      ctl.timer = null;
      if (!mirror.active || !ctl.granted) return;
      tick();
      scheduleNext();
    }, cycleDelay());
  }

  function stopLoop() {
    if (ctl.timer) {
      clearTimeout(ctl.timer);
      ctl.timer = null;
    }
  }

  function navigate(url) {
    if (!url || !mirror.active) return Promise.resolve(null);
    ctl.navPending = true;
    return sendMessage({ type: 'MAPS_NAVIGATE', payload: { url: url } }).then(function (res) {
      ctl.navPending = false;
      return res;
    });
  }

  function placeUrl(href) {
    if (!href) return '';
    try {
      var u = new URL(href, root.location.href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
      u.port = '';
      u.hash = '';
      if (u.hostname !== 'www.google.com') return '';
      if (u.pathname.indexOf('/maps/place/') !== 0) return '';
      return u.href;
    } catch (err) {
      return '';
    }
  }

  function reportPhase(phase) {
    if (mirror.phase === phase) return;
    mirror.phase = phase;
    sendMessage({ type: 'MAPS_PROGRESS', payload: { type: 'phase', phase: phase } });
  }

  function takeNext() {
    if (!ctl.granted || !mirror.active || ctl.navPending) return;
    ctl.navPending = true;
    sendMessage({ type: 'MAPS_ADVANCE' }).then(function (res) {
      if (!res || !res.ok || !mirror.active) {
        ctl.navPending = false;
        return;
      }
      var url = res.next || (res.searchUrl || mirror.searchUrl || '');
      if (!url) {
        ctl.navPending = false;
        sendMessage({ type: 'MAPS_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } });
        mirror.active = false;
        return;
      }
      navigate(url);
    });
  }

  function classifyPage(pathname) {
    if (/^\/maps\/search\//.test(pathname)) return 'results';
    if (/^\/maps\/place\//.test(pathname)) return 'place';
    return 'other';
  }

  function collectPlaceUrls(doc) {
    var d = doc || root.document;
    var out = [];
    var seen = Object.create(null);
    var anchors = d.querySelectorAll('a[href*="/maps/place/"]');
    for (var i = 0; i < anchors.length; i++) {
      var url = placeUrl(anchors[i].getAttribute('href') || '');
      if (!url || seen[url]) continue;
      seen[url] = true;
      out.push(url);
    }
    return out;
  }

  function scrollResults() {
    try {
      var feed = root.document.querySelector('div[role="feed"]') ||
        root.document.querySelector('[role="main"]');
      if (feed && feed.scrollHeight > feed.clientHeight + 50) {
        feed.scrollTop = feed.scrollHeight;
        return;
      }
      var docEl = root.document.documentElement;
      if (!docEl || docEl.scrollHeight <= (root.innerHeight || 800)) return;
      var step = Math.max(500, Math.round((root.innerHeight || 800) * 0.85));
      root.scrollBy(0, step);
    } catch (err) { /* ignore */ }
  }

  function onResults() {
    reportPhase('results');
    var fresh = collectPlaceUrls(root.document).filter(function (url) {
      return mirror.visitedPlaces.indexOf(url) === -1 && mirror.pending.indexOf(url) === -1;
    });
    if (fresh.length) {
      ctl.stagnation = 0;
      sendMessage({ type: 'MAPS_HARVEST', payload: { places: fresh } }).then(function (res) {
        if (res && res.ok && Array.isArray(res.pending)) mirror.pending = res.pending;
        if (mirror.active && ctl.granted && mirror.pending.length) takeNext();
      });
      scrollResults();
      return;
    }
    if (mirror.pending.length) {
      takeNext();
      return;
    }
    ctl.stagnation++;
    if (ctl.stagnation >= STAGNATION_TICKS) {
      if (ctl.granted && mirror.active) {
        mirror.active = false;
        sendMessage({
          type: 'MAPS_PROGRESS',
          payload: { type: 'exhausted', message: mirror.collected > 0 ? 'No more results' : 'No results found' }
        });
      }
      return;
    }
    scrollResults();
  }

  function text(el) {
    return el ? N.collapseWhitespace(el.textContent || '') : '';
  }

  function firstText(d, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = d.querySelector(selectors[i]);
      var value = text(el);
      if (value) return value;
    }
    return '';
  }

  function extractPlace(doc) {
    var d = doc || root.document;
    var nameEl = d.querySelector('h1') || d.querySelector('[role="heading"]');
    var name = text(nameEl);
    var address = firstText(d, ['[data-item-id="address"]', 'button[data-item-id="address"]']);
    var phoneLink = d.querySelector('a[href^="tel:"]');
    var phone = '';
    if (phoneLink) {
      phone = text(phoneLink) || String(phoneLink.getAttribute('href') || '').replace(/^tel:/i, '');
    }
    if (!phone) {
      var phoneEl = d.querySelector('[data-item-id^="phone:"]');
      if (phoneEl) {
        phone = text(phoneEl) ||
          String(phoneEl.getAttribute('data-item-id') || '').replace(/^phone:/i, '');
      }
    }
    var website = '';
    var websiteLink = d.querySelector('a[data-item-id="authority"]') ||
      d.querySelector('a[data-item-id^="website"]') ||
      d.querySelector('a[data-value="Website"]') ||
      d.querySelector('a[aria-label="Website"]') ||
      d.querySelector('a[jsaction*=".website"]');
    if (websiteLink) {
      website = N.normalizeExternalUrl(websiteLink.getAttribute('href') || '');
      var domain = N.domainOf(websiteLink.getAttribute('href') || '');
      if (!domain || /(^|\.)google\./i.test(domain)) website = '';
    }
    var category = firstText(d, ['[data-item-id="category"]', 'button[jsaction*="category"]']);
    if (!category && nameEl && nameEl.nextElementSibling) {
      var sibling = text(nameEl.nextElementSibling);
      if (sibling && sibling !== name && sibling.length <= 60) category = sibling;
    }
    return { name: name, category: category, address: address, phone: phone, website: website };
  }

  function mapsKeyFor(name, url) {
    var slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 40);
    if (!slug) slug = 'place';
    var src = String(url || '');
    var hash = 5381;
    for (var i = 0; i < src.length; i++) {
      hash = ((hash * 33) ^ src.charCodeAt(i)) >>> 0;
    }
    return slug + '-' + hash.toString(36);
  }

  function submitPlace(data) {
    if (ctl.submitting) return;
    ctl.submitting = true;
    var pageUrl = placeUrl(root.location.href) || root.location.href;
    var profile = {
      id: '',
      instagram_username: '',
      maps_key: mapsKeyFor(data.name, pageUrl),
      instagram_name: data.name,
      instagram_url: '',
      bio: '',
      category: data.category,
      phone_raw: '',
      phone_normalized: '',
      email: '',
      website: data.website || '',
      location: data.address,
      followers: '',
      source_page: pageUrl,
      date_found: N.normalizeDate(new Date()),
      status: 'New',
      notes: '',
      confidence: 100,
      extraction_level: 'maps_place',
      website_found: !!data.website
    };
    if (data.phone && settings.savePhone) profile.phone_raw = data.phone;
    if (!settings.saveEmail) profile.email = '';
    if (Log && Log.isEnabled()) {
      Log.debug('MapsSearch', 'extracted "' + data.name + '" website=' + (profile.website || 'none'));
    }
    sendMessage({
      type: 'PROCESS_CANDIDATE',
      payload: {
        profile: profile,
        confidence: 100,
        hasWebsite: !!profile.website,
        saveAll: true
      }
    }).then(function () {
      return sendMessage({ type: 'MAPS_PROGRESS', payload: { type: 'placeSubmitted', key: profile.maps_key } });
    }).then(function (res) {
      ctl.submitting = false;
      if (res && res.ok) mirror.collected = res.collected;
      if (res && res.finished) {
        mirror.active = false;
        return;
      }
      if (!res || !res.ok) return;
      takeNext();
    });
  }

  function onPlace() {
    reportPhase('place');
    var data = extractPlace(root.document);
    if (!data.name) {
      ctl.wait++;
      if (ctl.wait > PLACE_WAIT_TICKS) takeNext();
      return;
    }
    var pageUrl = placeUrl(root.location.href) || root.location.href;
    if (mirror.visitedKeys.indexOf(mapsKeyFor(data.name, pageUrl)) !== -1) {
      takeNext();
      return;
    }
    submitPlace(data);
  }

  function tick() {
    if (!mirror.active) return;
    if (!ctl.granted) {
      ensureRunning();
      return;
    }
    if (ctl.navPending) return;

    var pathname = '/';
    try {
      pathname = root.location.pathname || '/';
    } catch (err) {
      pathname = '/';
    }

    if (pathname !== ctl.lastPath) {
      ctl.lastPath = pathname;
      ctl.wait = 0;
      ctl.stagnation = 0;
      ctl.submitting = false;
      ctl.navPending = false;
    }

    var kind = classifyPage(pathname);
    if (kind === 'results') { onResults(); return; }
    if (kind === 'place') { onPlace(); return; }

    ctl.wait++;
    if (ctl.wait > OTHER_PAGE_LIMIT && mirror.searchUrl) {
      navigate(mirror.searchUrl);
    }
  }

  function init() {
    watchStorage();
    readState().then(function () {
      if (!mirror.active) return;
      ensureRunning();
    });
  }

  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  root.FicinoMapsSearch = {
    init: init,
    tick: tick,
    cycleDelay: cycleDelay,
    classifyPage: classifyPage,
    collectPlaceUrls: collectPlaceUrls,
    extractPlace: extractPlace,
    mapsKeyFor: mapsKeyFor,
    placeUrl: placeUrl,
    takeNext: takeNext,
    state: mirror,
    settings: settings,
    ctl: ctl
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
