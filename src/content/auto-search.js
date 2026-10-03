(function (root) {
  'use strict';

  var Log = root.FicinoLog;
  var N = root.FicinoNormalizer;
  var S = root.FicinoSelectors;
  var Extractor = root.FicinoProfileExtractor;
  var Detector = root.FicinoBusinessDetector;

  var MIN_CYCLE_MS = 2000;
  var MAX_CYCLE_MS = 4000;
  var HEADER_WAIT_TICKS = 6;
  var AUTHOR_WAIT_TICKS = 6;
  var STAGNATION_TICKS = 4;
  var PENDING_BATCH = 6;
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
    visitedPosts: [],
    visitedProfiles: [],
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
    holding: false,
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
        chrome.storage.local.get(['autoSearch', 'settings'], function (items) {
          if (items && items.autoSearch) Object.assign(mirror, items.autoSearch);
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
        if (!changes.autoSearch) return;
        var wasActive = mirror.active;
        Object.assign(mirror, changes.autoSearch.newValue || {});
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
    return sendMessage({ type: 'AUTOSEARCH_CLAIM' }).then(function (res) {
      ctl.granted = !!(res && res.granted);
      if (res && res.state) Object.assign(mirror, res.state);
      if (!ctl.granted) {
        if (res && (res.reason === 'wrong_tab' || res.reason === 'inactive')) stopLoop();
        return false;
      }
      if (Log && Log.isEnabled()) Log.debug('AutoSearch', 'claimed tab, phase ' + mirror.phase);
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
    return sendMessage({ type: 'AUTOSEARCH_NAVIGATE', payload: { url: url } }).then(function (res) {
      ctl.navPending = false;
      return res;
    });
  }

  function absoluteUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return 'https://www.instagram.com' + (path.charAt(0) === '/' ? path : '/' + path);
  }

  function reportPhase(phase) {
    if (mirror.phase === phase) return;
    mirror.phase = phase;
    sendMessage({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'phase', phase: phase } });
  }

  function takeNext() {
    if (!ctl.granted || !mirror.active || ctl.navPending) return;
    ctl.navPending = true;
    sendMessage({ type: 'AUTOSEARCH_ADVANCE' }).then(function (res) {
      if (!res || !res.ok || !mirror.active) {
        ctl.navPending = false;
        return;
      }
      var url = res.next ? absoluteUrl(res.next) : (res.searchUrl || mirror.searchUrl || '');
      if (!url) {
        ctl.navPending = false;
        sendMessage({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'exhausted', message: 'No more results' } });
        mirror.active = false;
        return;
      }
      navigate(url);
    });
  }

  function classifyPage(pathname) {
    if (/^\/accounts\//.test(pathname)) return 'blocked';
    if (/^\/(p|reel)\//.test(pathname)) return 'post';
    if (/^\/explore\/search\/keyword/.test(pathname) ||
        /^\/explore\/tags\//.test(pathname) ||
        /^\/results\/search/.test(pathname)) return 'search';
    var segment = pathname.split('/').filter(function (s) { return s.length > 0; })[0] || '';
    if (segment && !S.isReservedSegment(segment) && N.isValidUsername(segment)) return 'profile';
    return 'other';
  }

  function collectPostPaths(doc) {
    var d = doc || root.document;
    var out = [];
    var seen = Object.create(null);
    var anchors = Extractor.safe(function () { return d.querySelectorAll('a[href]'); }, null);
    if (!anchors) return out;
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href') || '';
      if (!/^\/(p|reel)\//.test(href)) continue;
      var path = href.split('#')[0].split('?')[0];
      if (!/^\/(p|reel)\/[^/]+\/?$/.test(path)) continue;
      if (path.charAt(path.length - 1) !== '/') path += '/';
      if (seen[path]) continue;
      seen[path] = true;
      out.push(path);
    }
    return out;
  }

  function contactFor(username) {
    var key = String(username || '').trim().toLowerCase().replace(/^@/, '');
    if (!key || !mirror.postContacts) return null;
    return mirror.postContacts[key] || null;
  }

  function buildProfile(username) {
    var phone = Extractor.extractPhone(root.document);
    var email = Extractor.extractEmail(root.document);
    var contact = contactFor(username);
    if ((!phone || !phone.normalized) && contact && contact.phone_normalized) {
      phone = { raw: contact.phone_raw, normalized: contact.phone_normalized };
    }
    if (!email && contact && contact.email) email = contact.email;
    var website = Extractor.extractWebsite(root.document);
    var profile = {
      id: '',
      instagram_username: username,
      instagram_name: N.collapseWhitespace(Extractor.extractBusinessName(root.document, username)),
      instagram_url: N.normalizeProfileUrl(username),
      bio: Extractor.extractBio(root.document),
      category: N.collapseWhitespace(Extractor.extractCategory(root.document)),
      phone_raw: '',
      phone_normalized: '',
      email: email,
      website: website,
      location: N.collapseWhitespace(Extractor.extractLocation(root.document)),
      followers: N.collapseWhitespace(Extractor.extractFollowers(root.document)),
      source_page: N.stripQueryAndHash(Extractor.pageUrl(root.document)),
      date_found: N.normalizeDate(new Date()),
      status: 'New',
      notes: '',
      confidence: 0,
      extraction_level: 'profile',
      website_found: !!website
    };
    if (phone && phone.normalized) {
      profile.phone_raw = phone.raw || '';
      profile.phone_normalized = phone.normalized;
    }
    if (!settings.savePhone) {
      profile.phone_raw = '';
      profile.phone_normalized = '';
    }
    if (!settings.saveEmail) profile.email = '';

    var detection = Detector.detectBusiness(profile);
    profile.confidence = detection.confidence;
    profile.keyword = detection.keyword || '';
    profile.reasons = detection.reasons || [];
    return profile;
  }

  function submitProfile(username) {
    if (ctl.submitting) return;
    ctl.submitting = true;
    var profile = buildProfile(username);
    if (Log && Log.isEnabled()) {
      Log.debug('AutoSearch', 'extracted @' + username + ' confidence ' + profile.confidence);
    }
    sendMessage({
      type: 'PROCESS_CANDIDATE',
      payload: {
        profile: profile,
        confidence: profile.confidence,
        hasWebsite: !!profile.website,
        saveAll: true
      }
    }).then(function () {
      return sendMessage({ type: 'AUTOSEARCH_PROGRESS', payload: { type: 'profileSubmitted', username: username } });
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

  function onSearch() {
    reportPhase('harvest');
    var fresh = collectPostPaths(root.document).filter(function (p) {
      return mirror.visitedPosts.indexOf(p) === -1 && mirror.pending.indexOf(p) === -1;
    });
    if (fresh.length) {
      ctl.stagnation = 0;
      sendMessage({ type: 'AUTOSEARCH_HARVEST', payload: { posts: fresh } }).then(function (res) {
        if (res && res.ok && Array.isArray(res.pending)) mirror.pending = res.pending;
      });
    } else {
      ctl.stagnation++;
    }
    try {
      var step = Math.max(500, Math.round((root.innerHeight || 800) * 0.85));
      root.scrollBy(0, step);
    } catch (err) { /* ignore */ }

    if (mirror.pending.length >= PENDING_BATCH) {
      takeNext();
      return;
    }
    if (ctl.stagnation >= STAGNATION_TICKS) {
      if (mirror.pending.length) {
        takeNext();
        return;
      }
      if (ctl.granted && mirror.active) {
        mirror.active = false;
        sendMessage({
          type: 'AUTOSEARCH_PROGRESS',
          payload: { type: 'exhausted', message: mirror.collected > 0 ? 'No more results' : 'No results found' }
        });
      }
    }
  }

  function onPost() {
    reportPhase('post');
    ctl.wait++;
    var authors = Extractor.extractPostAuthors(root.document);
    if (!authors.length) {
      if (ctl.wait > AUTHOR_WAIT_TICKS) takeNext();
      return;
    }
    var ranked = Extractor.rankPostAuthors(authors, { query: mirror.query });
    var target = ranked.length ? ranked[0] : authors[0];
    if (mirror.visitedProfiles.indexOf(String(target).toLowerCase()) !== -1) {
      takeNext();
      return;
    }
    var contact = Extractor.extractPostContact(root.document);
    if (contact && (contact.phone || contact.email)) {
      sendMessage({
        type: 'POST_CONTACT_STASH',
        payload: { username: target, phone: contact.phone, email: contact.email }
      });
    }
    navigate(N.normalizeProfileUrl(target));
  }

  function openLinktree(url, profile) {
    if (ctl.holding) return;
    ctl.holding = true;
    reportPhase('linktree');
    sendMessage({ type: 'AUTOSEARCH_HOLD', payload: { profile: profile } }).then(function (res) {
      ctl.holding = false;
      if (!res || !res.ok) return;
      navigate(url);
    });
  }

  function onProfile() {
    reportPhase('profile');
    var username = Extractor.currentUsername(root.document);
    if (!username) {
      ctl.wait++;
      return;
    }
    if (mirror.visitedProfiles.indexOf(username) !== -1) {
      takeNext();
      return;
    }
    if (!Extractor.findHeader(root.document)) {
      ctl.wait++;
      if (ctl.wait > HEADER_WAIT_TICKS) takeNext();
      return;
    }
    var linktree = Extractor.extractLinktree(root.document);
    if (linktree) {
      var probe = buildProfile(username);
      if (!probe.website) {
        openLinktree(linktree, probe);
        return;
      }
    }
    submitProfile(username);
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
      pathname = new URL(Extractor.pageUrl(root.document)).pathname;
    } catch (err) {
      pathname = '/';
    }

    if (pathname !== ctl.lastPath) {
      ctl.lastPath = pathname;
      ctl.wait = 0;
      ctl.stagnation = 0;
      ctl.submitting = false;
      ctl.holding = false;
      ctl.navPending = false;
    }

    var kind = classifyPage(pathname);

    if (kind === 'blocked') {
      ctl.granted = false;
      stopLoop();
      mirror.active = false;
      sendMessage({
        type: 'AUTOSEARCH_PROGRESS',
        payload: { type: 'blocked', message: 'Login required — open Instagram and log in' }
      });
      return;
    }

    if (kind === 'search') { onSearch(); return; }
    if (kind === 'post') { onPost(); return; }
    if (kind === 'profile') { onProfile(); return; }

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

  root.FicinoAutoSearch = {
    init: init,
    tick: tick,
    cycleDelay: cycleDelay,
    classifyPage: classifyPage,
    collectPostPaths: collectPostPaths,
    takeNext: takeNext,
    state: mirror,
    settings: settings,
    ctl: ctl
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
