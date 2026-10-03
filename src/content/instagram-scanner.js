(function (root) {
  'use strict';

  var Log = root.FicinoLog;
  var N = root.FicinoNormalizer;
  var S = root.FicinoSelectors;
  var Extractor = root.FicinoProfileExtractor;
  var Detector = root.FicinoBusinessDetector;
  var ObserverFactory = root.FicinoMutationObserver;

  var SETTINGS_KEY = 'settings';

  var state = {
    settings: {
      businessConfidenceThreshold: 70,
      autoScan: true,
      saveEmail: true,
      savePhone: true,
      debug: false,
      scannerActive: true
    },
    autoSearchActive: false,
    postContacts: Object.create(null),
    processed: Object.create(null),
    observer: null,
    ready: false
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
            if (Log) Log.warn('Scanner', 'message failed:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          resolve(response || null);
        });
      } catch (err) {
        if (Log) Log.warn('Scanner', 'sendMessage error:', err && err.message);
        resolve(null);
      }
    });
  }

  function loadSettings() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage) {
          resolve();
          return;
        }
        chrome.storage.local.get([SETTINGS_KEY, 'autoSearch'], function (items) {
          if (items && items[SETTINGS_KEY]) {
            Object.assign(state.settings, items[SETTINGS_KEY]);
          }
          if (items && items.autoSearch) {
            state.autoSearchActive = !!items.autoSearch.active;
            state.postContacts = items.autoSearch.postContacts || Object.create(null);
          }
          if (Log) Log.setEnabled(!!state.settings.debug);
          resolve();
        });
      } catch (err) {
        if (Log) Log.warn('Scanner', 'settings load failed:', err && err.message);
        resolve();
      }
    });
  }

  function watchSettings() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (changes.autoSearch) {
          var nextAuto = changes.autoSearch.newValue || {};
          state.autoSearchActive = !!nextAuto.active;
          if (nextAuto.postContacts) state.postContacts = nextAuto.postContacts;
          applyActiveState();
        }
        if (!changes[SETTINGS_KEY]) return;
        Object.assign(state.settings, changes[SETTINGS_KEY].newValue || {});
        if (Log) Log.setEnabled(!!state.settings.debug);
        if (Log && Log.isEnabled()) Log.debug('Scanner', 'settings updated:', JSON.stringify(state.settings));
        applyActiveState();
      });
    } catch (err) {
      if (Log) Log.warn('Scanner', 'settings watch failed:', err && err.message);
    }
  }

  function isScanningEnabled() {
    if (state.autoSearchActive) return false;
    return state.settings.scannerActive !== false && state.settings.autoScan !== false;
  }

  function applyActiveState() {
    if (!state.observer) return;
    if (isScanningEnabled()) {
      state.observer.start();
    } else {
      state.observer.stop();
      if (Log && Log.isEnabled()) Log.debug('Scanner', 'scanner paused');
    }
  }

  function levelFor(username) {
    var entry = state.processed[username];
    return entry ? entry.level : null;
  }

  function markProcessed(username, level, confidence) {
    var entry = state.processed[username];
    if (entry) {
      entry.lastSeen = Date.now();
      if (level === 'profile' && entry.level !== 'profile') {
        entry.level = 'profile';
        entry.confidence = confidence;
      }
      return entry;
    }
    entry = { level: level, confidence: confidence, firstSeen: Date.now(), lastSeen: Date.now() };
    state.processed[username] = entry;
    if (Object.keys(state.processed).length > 4000) {
      var now = Date.now();
      Object.keys(state.processed).forEach(function (key) {
        if (now - state.processed[key].lastSeen > 10 * 60 * 1000) delete state.processed[key];
      });
    }
    return entry;
  }

  function wasProcessedAtProfileLevel(username) {
    var entry = state.processed[username];
    return !!(entry && entry.level === 'profile');
  }

  function buildProfile(fields) {
    var profile = {
      id: '',
      instagram_username: fields.instagram_username || '',
      instagram_name: N.collapseWhitespace(fields.instagram_name || ''),
      instagram_url: N.normalizeProfileUrl(fields.instagram_username),
      bio: fields.bio || '',
      category: N.collapseWhitespace(fields.category || ''),
      phone_raw: '',
      phone_normalized: '',
      email: fields.email || '',
      website: '',
      location: N.collapseWhitespace(fields.location || ''),
      followers: N.collapseWhitespace(fields.followers || ''),
      source_page: fields.source_page || '',
      date_found: N.normalizeDate(new Date()),
      status: 'New',
      notes: '',
      confidence: 0,
      extraction_level: fields.extraction_level || 'link',
      website_found: false
    };
    if (fields.phone && fields.phone.normalized) {
      profile.phone_raw = fields.phone.raw || '';
      profile.phone_normalized = fields.phone.normalized;
    }
    return profile;
  }

  function contactFor(username) {
    var key = String(username || '').trim().toLowerCase().replace(/^@/, '');
    if (!key || !state.postContacts) return null;
    return state.postContacts[key] || null;
  }

  function evaluateAndSend(profile) {
    var username = profile.instagram_username;
    if (!username) return Promise.resolve(null);

    var contact = contactFor(username);
    if (contact) {
      if (!profile.phone_normalized && contact.phone_normalized) {
        profile.phone_raw = contact.phone_raw || '';
        profile.phone_normalized = contact.phone_normalized;
      }
      if (!profile.email && contact.email) profile.email = contact.email;
    }

    var detection = Detector.detectBusiness(profile);
    profile.confidence = detection.confidence;
    profile.keyword = detection.keyword || '';
    profile.reasons = detection.reasons || [];

    if (!state.settings.savePhone) {
      profile.phone_raw = '';
      profile.phone_normalized = '';
    }
    if (!state.settings.saveEmail) {
      profile.email = '';
    }

    if (Log && Log.isEnabled()) {
      Log.debug('Profile', 'Found @' + username, '| level:', profile.extraction_level,
        '| confidence:', detection.confidence, '| website:', profile.website || 'none');
    }

    if (Log && Log.isEnabled()) {
      if (profile.website) {
        Log.debug('Website Detection', 'Found for @' + username + ':', profile.website);
      } else if (profile.extraction_level === 'profile') {
        Log.debug('Website Detection', 'None found for @' + username);
      }
    }

    markProcessed(username, profile.extraction_level, detection.confidence);

    return sendMessage({
      type: 'PROCESS_CANDIDATE',
      payload: {
        profile: profile,
        confidence: detection.confidence,
        hasWebsite: !!profile.website
      }
    }).then(function (response) {
      if (response && Log && Log.isEnabled()) {
        Log.debug('Storage', response.saved ? 'Lead saved' : ('Not saved: ' + (response.reason || 'unknown')));
      }
      return response;
    });
  }

  function extractCurrentProfile() {
    var username = Extractor.currentUsername(document);
    if (!username) return Promise.resolve(null);
    if (wasProcessedAtProfileLevel(username)) return Promise.resolve(null);

    var header = Extractor.findHeader(document);
    if (!header) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var retryHeader = Extractor.findHeader(document);
          if (retryHeader) {
            resolve(extractCurrentProfile());
          } else {
            resolve(null);
          }
        }, 900);
      });
    }

    var phone = Extractor.extractPhone(document);
    var website = Extractor.extractWebsite(document);
    var profile = buildProfile({
      instagram_username: username,
      instagram_name: Extractor.extractBusinessName(document, username),
      bio: Extractor.extractBio(document),
      category: Extractor.extractCategory(document),
      email: Extractor.extractEmail(document),
      location: Extractor.extractLocation(document),
      followers: Extractor.extractFollowers(document),
      phone: phone,
      source_page: N.stripQueryAndHash(Extractor.pageUrl(document)),
      extraction_level: 'profile'
    });
    profile.website = website;
    profile.website_found = !!website;
    profile.contactUi = Extractor.extractContactUiSignals(document);
    return evaluateAndSend(profile);
  }

  function profileFromLink(candidate) {
    var username = candidate.username;
    if (!username || wasProcessedAtProfileLevel(username)) return null;

    var contextText = '';
    var contextEl = candidate.anchor;
    if (contextEl && contextEl.closest) {
      var container = contextEl.closest('li, article, [role="listitem"], div');
      if (container && container.textContent) {
        contextText = N.collapseWhitespace(container.textContent).slice(0, 500);
      }
    }
    if (!contextText) contextText = candidate.label || '';

    var email = (N.extractEmails(contextText)[0]) || '';
    var phones = N.extractPhones(contextText);
    var phone = phones.length ? phones[0] : null;
    var urlInText = N.looksLikeUrlInText(contextText);
    var website = '';
    if (urlInText && !/instagram\.com/i.test(urlInText)) {
      website = N.normalizeExternalUrl(urlInText);
      if (website && N.isNonWebsiteUrl(website)) website = '';
    }

    var name = candidate.label || '';
    if (name && name.toLowerCase() === username.toLowerCase()) name = '';
    if (name.length > 90) name = '';

    var profile = buildProfile({
      instagram_username: username,
      instagram_name: name,
      bio: contextText && contextText !== name ? contextText.slice(0, 300) : '',
      email: email,
      phone: phone,
      followers: N.parseFollowers(contextText),
      source_page: N.stripQueryAndHash(Extractor.pageUrl(document)),
      extraction_level: 'link'
    });
    profile.website = website;
    profile.website_found = !!website;
    profile.contactUi = [];
    return profile;
  }

  function processLinkCandidates(nodes) {
    var found = Object.create(null);
    nodes.forEach(function (node) {
      if (!node || node.nodeType !== 1) return;
      var links = [];
      if (node.tagName === 'A' && node.getAttribute('href')) {
        links.push(node);
      }
      try {
        var nested = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
        for (var i = 0; i < nested.length; i++) links.push(nested[i]);
      } catch (e) { /* ignore */ }

      links.forEach(function (a) {
        var href = a.getAttribute('href') || '';
        var username = N.usernameFromUrl(href);
        if (!username || !N.isValidUsername(username)) return;
        if (S.isReservedSegment(username)) return;
        if (found[username]) return;
        var label = Extractor.textOf(a) || a.getAttribute('aria-label') || '';
        found[username] = {
          username: username,
          url: N.normalizeProfileUrl(username, Extractor.pageUrl(document)),
          label: N.collapseWhitespace(label).slice(0, 140),
          anchor: a
        };
      });
    });

    var candidates = Object.keys(found).map(function (key) { return found[key]; });
    var jobs = candidates
      .filter(function (c) { return !state.processed[c.username]; })
      .map(function (c) {
        return function () {
          var profile = profileFromLink(c);
          if (!profile) return Promise.resolve(null);
          return evaluateAndSend(profile);
        };
      });

    return jobs.reduce(function (chain, job) {
      return chain.then(function () {
        if (!isScanningEnabled()) return null;
        return job();
      });
    }, Promise.resolve());
  }

  function stashPostContactIfPost() {
    var path = '';
    try {
      path = new URL(Extractor.pageUrl(document)).pathname;
    } catch (err) {
      return;
    }
    if (!/^\/(p|reel)\//.test(path)) return;
    var authors = Extractor.extractPostAuthors(document);
    if (!authors.length) return;
    var ranked = Extractor.rankPostAuthors(authors, {});
    var author = ranked.length ? ranked[0] : authors[0];
    var contact = Extractor.extractPostContact(document);
    if (!contact || (!contact.phone && !contact.email)) return;
    sendMessage({
      type: 'POST_CONTACT_STASH',
      payload: { username: author, phone: contact.phone, email: contact.email }
    });
  }

  function handleBatch(nodes) {
    if (!isScanningEnabled()) return;
    stashPostContactIfPost();
    var job = function () { return extractCurrentProfile(); };
    job().then(function () {
      return processLinkCandidates(nodes);
    }).catch(function (err) {
      if (Log) Log.warn('Scanner', 'batch failed:', err && err.message);
    });
  }

  function handleUrlChange() {
    if (!isScanningEnabled()) return;
    if (Log && Log.isEnabled()) Log.debug('Scanner', 'navigation detected:', Extractor.pageUrl(document));
    stashPostContactIfPost();
    setTimeout(function () {
      extractCurrentProfile().catch(function (err) {
        if (Log) Log.warn('Scanner', 'profile extract failed:', err && err.message);
      });
    }, 600);
  }

  function init() {
    if (state.ready) return;
    state.ready = true;

    loadSettings().then(function () {
      watchSettings();
      state.observer = ObserverFactory.createObserver({
        onBatch: handleBatch,
        onUrlChange: handleUrlChange,
        debounceMs: 450
      });
      applyActiveState();
      if (Log && Log.isEnabled()) Log.debug('Scanner', 'content script ready on', Extractor.pageUrl(document));
      setTimeout(function () {
        if (!isScanningEnabled()) return;
        stashPostContactIfPost();
        extractCurrentProfile().catch(function () { /* ignore */ });
      }, 500);
    });
  }

  if (root.document && (root.document.readyState === 'loading')) {
    root.document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  root.FicinoScanner = {
    init: init,
    getState: state,
    extractCurrentProfile: extractCurrentProfile,
    isScanningEnabled: isScanningEnabled
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
