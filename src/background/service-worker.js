(function (root) {
  'use strict';

  importScripts(
    '../shared/logger.js',
    '../storage/storage.js',
    '../content/normalizer.js',
    '../shared/templates.js',
    '../content/influencer-detector.js',
    'outreach-runner.js'
  );

  var Log = root.FicinoLog;
  var Storage = root.FicinoStorage;
  var N = root.FicinoNormalizer;
  var Influencer = root.FicinoInfluencerDetector;
  var Outreach = root.FicinoOutreach;

  var pendingStats = Object.create(null);
  var flushTimer = null;

  function normalizeKey(username) {
    return String(username || '').trim().toLowerCase().replace(/^@/, '');
  }

  var leadsChain = Promise.resolve();

  function mutateLeads(fn) {
    var run = leadsChain.then(function () { return Storage.getLeads(); }).then(fn);
    leadsChain = run.then(function () {}, function () {});
    return run;
  }

  function findLeadIndex(leads, username) {
    var key = normalizeKey(username);
    if (!key) return -1;
    for (var i = 0; i < leads.length; i++) {
      if (normalizeKey(leads[i].instagram_username) === key) return i;
    }
    return -1;
  }

  function queueStat(key, delta) {
    pendingStats[key] = (pendingStats[key] || 0) + delta;
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flushStats();
    }, 600);
  }

  function flushStats() {
    var patch = pendingStats;
    pendingStats = Object.create(null);
    if (!Object.keys(patch).length) return Promise.resolve();
    return Storage.bumpStats(patch).catch(function (err) {
      if (Log) Log.error('Background', 'stats flush failed:', err && err.message);
    });
  }

  function mergeLead(existing, incoming) {
    var merged = Object.assign({}, existing);
    var fields = [
      'instagram_name', 'bio', 'category', 'phone_raw', 'phone_normalized',
      'email', 'website', 'location', 'followers', 'source_page'
    ];
    fields.forEach(function (field) {
      var nextValue = incoming[field];
      if (nextValue === undefined || nextValue === null || nextValue === '') return;
      merged[field] = nextValue;
    });
    if (typeof incoming.confidence === 'number' && incoming.confidence > (existing.confidence || 0)) {
      merged.confidence = incoming.confidence;
      merged.keyword = incoming.keyword || existing.keyword || '';
      merged.reasons = incoming.reasons || existing.reasons || [];
    }
    merged.instagram_url = N.normalizeProfileUrl(merged.instagram_username) || merged.instagram_url;
    merged.last_seen = N.normalizeDate(new Date());
    return merged;
  }

  function phoneContext(lead) {
    return {
      keyword: lead.keyword,
      bio: lead.bio,
      location: lead.location,
      username: lead.instagram_username,
      name: lead.instagram_name,
      website: lead.website,
      source_page: lead.source_page
    };
  }

  function permitInBio(bio) {
    var text = String(bio || '');
    if (N.mentionsPermit(text)) return true;
    return N.findPermitNumbers(text).length > 0;
  }

  function verifyLead(lead, settings, postContacts) {
    var source = lead.phone_raw || lead.phone_normalized || '';
    if (!source) {
      lead.phone_normalized = '';
      delete lead.phone_issue;
      return lead;
    }
    var ctx = phoneContext(lead);
    var fallback = settings && settings.defaultCountryCode;
    var res = N.attributePhone(source, ctx, fallback);
    var bioPhones = N.extractPhones(String(lead.bio || ''));
    var bioDigits = [];
    var bioFirst = null;
    bioPhones.forEach(function (p) {
      var a = N.attributePhone(p.raw, ctx, fallback);
      if (a.valid) {
        bioDigits.push(a.digits);
        if (!bioFirst) bioFirst = { raw: p.raw, res: a };
      }
    });
    if (bioFirst && (!res.valid || bioDigits.indexOf(res.digits) === -1)) {
      if (!lead.phone_replaced_raw) lead.phone_replaced_raw = source;
      lead.phone_raw = bioFirst.raw;
      lead.phone_corrected = true;
      res = bioFirst.res;
      if (Log && Log.isEnabled()) {
        Log.debug('Phone', 'corrected @' + lead.instagram_username + ': ' + source + ' -> ' + bioFirst.raw);
      }
    }
    var issue = '';
    if (!res.valid) {
      issue = res.issue || 'invalid';
      lead.phone_normalized = '';
    } else {
      lead.phone_normalized = res.needsCc ? '' : res.normalized;
      var inBio = bioDigits.indexOf(res.digits) !== -1;
      var captionMatch = false;
      if (!inBio && postContacts) {
        var key = normalizeKey(lead.instagram_username);
        var caption = postContacts[key] || null;
        if (caption && (caption.phone_normalized || caption.phone_raw)) {
          var c = N.attributePhone(caption.phone_raw || caption.phone_normalized, ctx, fallback);
          captionMatch = !!(c.valid && c.digits === res.digits);
        }
      }
      var permits = N.findPermitNumbers(String(lead.bio || ''));
      var permitHit = false;
      for (var pi = 0; pi < permits.length && !permitHit; pi++) {
        var pn = permits[pi];
        if (res.digits === pn || res.local === pn ||
          (res.digits.length > pn.length && res.digits.slice(-pn.length) === pn)) permitHit = true;
      }
      if (permitHit) {
        issue = 'permit_number';
        lead.phone_normalized = '';
      } else if (inBio) {
        if (bioDigits.length > 1) issue = 'multiple_numbers';
      } else if (captionMatch) {
        issue = 'caption_source';
      }
      if (!issue && res.needsCc) issue = 'needs_cc';
    }
    if (issue) lead.phone_issue = issue;
    else delete lead.phone_issue;
    return lead;
  }

  function processCandidate(payload) {
    var profile = payload && payload.profile ? payload.profile : null;
    var confidence = payload && typeof payload.confidence === 'number' ? payload.confidence : 0;
    var hasWebsite = !!(payload && payload.hasWebsite);
    var saveAll = !!(payload && payload.saveAll);

    if (!profile || !profile.instagram_username) {
      return Promise.resolve({ saved: false, reason: 'invalid_candidate' });
    }

    queueStat('scanned', 1);

    var username = normalizeKey(profile.instagram_username);

    return Promise.all([Storage.getSettings(), Storage.getAutoSearch()]).then(function (parts) {
      var settings = parts[0];
      var autoState = parts[1];
      var postContacts = (autoState && autoState.postContacts) || {};
      var contact = autoState && autoState.postContacts ? autoState.postContacts[username] : null;
      if (contact) {
        var merged = null;
        if (!profile.phone_normalized && contact.phone_normalized) {
          merged = Object.assign({}, profile, {
            phone_raw: contact.phone_raw || '',
            phone_normalized: contact.phone_normalized
          });
        }
        if (!profile.email && contact.email) {
          merged = Object.assign({}, merged || profile, { email: contact.email });
        }
        if (merged) profile = merged;
      }
      var threshold = Number(settings.businessConfidenceThreshold) || 70;
      if (confidence >= threshold) {
        queueStat('businesses', 1);
      } else if (!saveAll) {
        return { saved: false, reason: 'below_threshold' };
      }

      var influ = Influencer ? Influencer.detect(profile) : { flag: false, reasons: [] };
      var permitHit = permitInBio(profile.bio);
      var excludeReasons = (influ.reasons || []).slice();
      if (permitHit && excludeReasons.indexOf('permit_number') === -1) excludeReasons.push('permit_number');
      var exclude = !!(influ.flag || permitHit);
      if (exclude && Log && Log.isEnabled()) {
        Log.debug('Influencer', 'excluded @' + profile.instagram_username + ': ' + excludeReasons.join('; '));
      }

      if (hasWebsite || profile.website) {
        queueStat('withWebsite', 1);
        return mutateLeads(function (leads) {
          var index = findLeadIndex(leads, profile.instagram_username);
          if (index >= 0) {
            leads[index] = verifyLead(mergeLead(leads[index], profile), settings, postContacts);
            return Storage.setLeads(leads).then(function () {
              return { saved: false, reason: 'has_website', updated: true };
            });
          }
          return { saved: false, reason: 'has_website' };
        });
      }

        queueStat('withoutWebsite', 1);

        return mutateLeads(function (leads) {
          var index = findLeadIndex(leads, profile.instagram_username);
          if (index >= 0) {
            queueStat('duplicates', 1);
            leads[index] = verifyLead(mergeLead(leads[index], profile), settings, postContacts);
          if (exclude) {
            var current = leads[index].status;
            if (!current || current === 'New') {
              leads[index].status = 'Ignore';
              leads[index].influencer = true;
              leads[index].influencer_reasons = excludeReasons;
            } else if (!leads[index].influencer) {
              leads[index].influencer = true;
              leads[index].influencer_reasons = excludeReasons;
            }
          }
          return Storage.setLeads(leads).then(function () {
            if (Log && Log.isEnabled()) Log.debug('Storage', 'Duplicate merged:', profile.instagram_username);
            return { saved: false, reason: 'duplicate', updated: true };
          });
        }

        var lead = Object.assign({}, profile, {
          id: 'ig_' + username + '_' + Date.now().toString(36),
          instagram_username: String(profile.instagram_username).replace(/^@/, ''),
          instagram_url: N.normalizeProfileUrl(profile.instagram_username),
          date_found: N.normalizeDate(new Date()),
          status: exclude ? 'Ignore' : (profile.status || 'New'),
          notes: profile.notes || '',
          confidence: confidence,
          website: '',
          website_found: false,
          website_not_found_on_instagram: true,
          influencer: exclude,
          influencer_reasons: exclude ? excludeReasons : [],
          last_seen: N.normalizeDate(new Date())
        });
        verifyLead(lead, settings, postContacts);

        leads.push(lead);
        queueStat('saved', 1);

        return Storage.setLeads(leads).then(function () {
          if (Log && Log.isEnabled()) Log.debug('Storage', 'Lead saved:', lead.instagram_username);
          return { saved: true, reason: 'saved', id: lead.id };
        });
      });
    }).catch(function (err) {
      if (Log) Log.error('Storage', 'failed to process candidate:', err && err.message);
      return { saved: false, reason: 'storage_error' };
    });
  }

  function deleteLeads(ids) {
    var idSet = Object.create(null);
    (ids || []).forEach(function (id) { idSet[id] = true; });
    return mutateLeads(function (leads) {
      var kept = leads.filter(function (lead) { return !idSet[lead.id]; });
      var removed = leads.length - kept.length;
      return Storage.setLeads(kept).then(function () {
        return { removed: removed };
      });
    });
  }

  function clearLeads() {
    return flushStats().then(function () {
      return mutateLeads(function () { return Storage.clearLeads(); });
    }).then(function () {
      if (Log && Log.isEnabled()) Log.debug('Storage', 'all leads cleared');
      return { cleared: true };
    });
  }

  function updateLead(patch) {
    if (!patch || !patch.id) return Promise.resolve({ updated: false });
    return mutateLeads(function (leads) {
      var index = -1;
      for (var i = 0; i < leads.length; i++) {
        if (leads[i].id === patch.id) { index = i; break; }
      }
      if (index < 0) return { updated: false };
      var lead = Object.assign({}, leads[index]);
      if (patch.status !== undefined) lead.status = patch.status;
      if (patch.notes !== undefined) lead.notes = patch.notes;
      if (patch.delete === true) {
        leads.splice(index, 1);
      } else {
        leads[index] = lead;
      }
      return Storage.setLeads(leads).then(function () { return { updated: true }; });
    });
  }

  function initSettings() {
    return Storage.getSettings().then(function (settings) {
      if (Log) Log.setEnabled(!!settings.debug);
      return Storage.saveSettings(settings);
    }).catch(function (err) {
      if (Log) Log.error('Background', 'init failed:', err && err.message);
    });
  }

  function searchUrlFor(query) {
    var q = String(query || '').trim();
    if (!q) return '';
    if (q.charAt(0) === '#') {
      var tag = q.replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, '');
      if (!tag) return '';
      return 'https://www.instagram.com/explore/tags/' + encodeURIComponent(tag) + '/';
    }
    return 'https://www.instagram.com/explore/search/keyword/?q=' + encodeURIComponent(q);
  }

  function findOrCreateInstagramTab(url) {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
        resolve(null);
        return;
      }
      chrome.tabs.query({ url: 'https://www.instagram.com/*' }, function (tabs) {
        var pick = null;
        for (var i = 0; i < (tabs || []).length; i++) {
          if (tabs[i].active) { pick = tabs[i]; break; }
        }
        if (!pick && tabs && tabs.length) pick = tabs[0];
        if (pick) {
          chrome.tabs.update(pick.id, { url: url }, function () { resolve(pick.id); });
        } else if (chrome.tabs.create) {
          chrome.tabs.create({ url: url, active: true }, function (tab) {
            resolve(tab && typeof tab.id === 'number' ? tab.id : null);
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  function senderTabId(sender) {
    return sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
  }

  function autoSearchGuard(sender) {
    return Storage.getAutoSearch().then(function (state) {
      var tabId = senderTabId(sender);
      if (!state.active) return { ok: false, state: state, reason: 'inactive' };
      if (state.tabId == null) {
        if (tabId == null) return { ok: false, state: state, reason: 'no_tab' };
        return Storage.setAutoSearch({ tabId: tabId }).then(function (next) {
          return { ok: true, state: next };
        });
      }
      if (tabId != null && tabId !== state.tabId) return { ok: false, state: state, reason: 'wrong_tab' };
      if (tabId == null) return { ok: false, state: state, reason: 'no_tab' };
      return { ok: true, state: state };
    });
  }

  function autoSearchStart(payload) {
    var query = String(payload && payload.query || '').trim();
    if (!query) return Promise.resolve({ started: false, error: 'query_required' });
    var target = parseInt(payload && payload.target, 10);
    if (!isFinite(target)) target = 30;
    if (target < 1) target = 1;
    if (target > 500) target = 500;
    var url = searchUrlFor(query);
    if (!url) return Promise.resolve({ started: false, error: 'query_required' });

    return findOrCreateInstagramTab(url).then(function (tabId) {
      return Storage.saveSettings({ autoSearchQuery: query, autoSearchTarget: target }).then(function () {
        return Storage.setAutoSearch({
          active: true,
          phase: 'harvest',
          query: query,
          target: target,
          collected: 0,
          message: 'Starting…',
          tabId: tabId,
          searchUrl: url,
          visitedPosts: [],
          visitedProfiles: [],
          pending: [],
          hold: null
        });
      }).then(function (state) {
        if (Log && Log.isEnabled()) Log.debug('AutoSearch', 'started "' + query + '" target ' + target);
        return { started: true, tabId: state.tabId, searchUrl: url };
      });
    });
  }

  function autoSearchStop() {
    return Storage.setAutoSearch({ active: false, phase: 'stopped', message: 'Stopped by user', hold: null })
      .then(function () { return { stopped: true }; });
  }

  function autoSearchClaim(sender) {
    return autoSearchGuard(sender).then(function (g) {
      return { granted: g.ok, state: g.state, reason: g.reason };
    });
  }

  function autoSearchNavigate(payload, sender) {
    var url = String(payload && payload.url || '');
    if (url.indexOf('https://www.instagram.com/') !== 0 && url.indexOf('https://linktr.ee/') !== 0) {
      return Promise.resolve({ ok: false, reason: 'bad_url' });
    }
    return autoSearchGuard(sender).then(function (g) {
      if (!g.ok) return { ok: false, reason: g.reason };
      return tabsUpdate(g.state.tabId, url);
    });
  }

  function tabsUpdate(tabId, url) {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.update) {
        resolve({ ok: false, reason: 'no_tabs' });
        return;
      }
      chrome.tabs.update(tabId, { url: url }, function () {
        resolve({ ok: true });
      });
    });
  }

  function autoSearchHarvest(payload, sender) {
    return autoSearchGuard(sender).then(function (g) {
      if (!g.ok) return { ok: false, reason: g.reason };
      var posts = payload && Array.isArray(payload.posts) ? payload.posts : [];
      var pending = g.state.pending.slice();
      var visited = g.state.visitedPosts.slice();
      posts.forEach(function (p) {
        if (typeof p !== 'string') return;
        var path = p.split('#')[0].split('?')[0];
        if (!/^\/(p|reel)\//.test(path)) return;
        if (path.charAt(path.length - 1) !== '/') path += '/';
        if (visited.indexOf(path) !== -1) return;
        if (pending.indexOf(path) !== -1) return;
        if (pending.length >= 300) return;
        pending.push(path);
      });
      if (pending.length === g.state.pending.length) {
        return { ok: true, pending: pending, collected: g.state.collected, target: g.state.target };
      }
      return Storage.setAutoSearch({ pending: pending }).then(function (next) {
        if (Log && Log.isEnabled()) Log.debug('AutoSearch', 'harvested, queue ' + next.pending.length);
        return { ok: true, pending: next.pending, collected: next.collected, target: next.target };
      });
    });
  }

  function autoSearchAdvance(sender) {
    return autoSearchGuard(sender).then(function (g) {
      if (!g.ok) return { ok: false, next: null, reason: g.reason };
      var pending = g.state.pending.slice();
      var visited = g.state.visitedPosts.slice();
      var next = pending.length ? pending.shift() : null;
      if (next && visited.indexOf(next) === -1) {
        visited.push(next);
        if (visited.length > 4000) visited = visited.slice(-4000);
      }
      return Storage.setAutoSearch({ pending: pending, visitedPosts: visited }).then(function () {
        if (Log && Log.isEnabled()) Log.debug('AutoSearch', 'advance -> ' + (next || 'search'));
        return { ok: true, next: next, searchUrl: g.state.searchUrl, active: true };
      });
    });
  }

  function bumpCollected(state, rawUsername) {
    var username = normalizeKey(rawUsername);
    if (!username) return Promise.resolve(null);
    var visited = state.visitedProfiles.slice();
    var isNewVisit = visited.indexOf(username) === -1;
    if (isNewVisit) {
      if (visited.length > 4000) visited = visited.slice(-4000);
      visited.push(username);
    }
    return Storage.getLeads().then(function (leads) {
      var collected = state.collected;
      var index = findLeadIndex(leads, username);
      var qualifies = index >= 0 && leads[index].status !== 'Ignore';
      if (qualifies && isNewVisit) collected += 1;
      var finished = collected >= state.target;
      var patch = {
        collected: collected,
        visitedProfiles: visited,
        active: !finished,
        phase: finished ? 'done' : state.phase,
        message: finished ? ('Collected ' + state.target + ' leads') : state.message
      };
      return Storage.setAutoSearch(patch).then(function (next) {
        if (Log && Log.isEnabled()) {
          Log.debug('AutoSearch', username + (qualifies ? ' lead' : ' skip') + ' ' + next.collected + '/' + state.target);
        }
        return { collected: next.collected, finished: finished };
      });
    });
  }

  function flagInfluencers() {
    if (!Influencer) return Promise.resolve({ ok: false, reason: 'no_detector' });
    return mutateLeads(function (leads) {
      var flagged = 0;
      var restored = 0;
      leads.forEach(function (lead) {
        var result = Influencer.detect(lead);
        var permitHit = permitInBio(lead && lead.bio);
        if (result.flag || permitHit) {
          var reasons = (result.reasons || []).slice();
          if (permitHit && reasons.indexOf('permit_number') === -1) reasons.push('permit_number');
          var changed = false;
          if (!lead.influencer) {
            lead.influencer = true;
            changed = true;
          }
          if (!lead.influencer_reasons || !lead.influencer_reasons.length) {
            lead.influencer_reasons = reasons;
            changed = true;
          }
          if (!lead.status || lead.status === 'New') {
            lead.status = 'Ignore';
            changed = true;
          }
          if (changed) flagged += 1;
        } else if (lead.influencer && lead.status === 'Ignore') {
          lead.status = 'New';
          lead.influencer = false;
          lead.influencer_reasons = [];
          restored += 1;
        }
      });
      if (!flagged && !restored) return { ok: true, flagged: 0, restored: 0, total: leads.length };
      return Storage.setLeads(leads).then(function () {
        if (Log && Log.isEnabled()) {
          Log.debug('Influencer', 'batch: flagged ' + flagged + ', restored ' + restored);
        }
        return { ok: true, flagged: flagged, restored: restored, total: leads.length };
      });
    });
  }

  function excludePermits() {
    return Storage.getSettings().then(function (settings) {
      return mutateLeads(function (leads) {
        var matched = 0;
        var excluded = 0;
        var changed = false;
        leads.forEach(function (lead) {
          if (!lead) return;
          if (!permitInBio(lead.bio)) return;
          matched += 1;
          if (!lead.influencer) {
            lead.influencer = true;
            changed = true;
          }
          if (!lead.influencer_reasons || lead.influencer_reasons.indexOf('permit_number') === -1) {
            lead.influencer_reasons = (lead.influencer_reasons || []).concat(['permit_number']);
            changed = true;
          }
          if (!lead.status || lead.status === 'New') {
            lead.status = 'Ignore';
            changed = true;
            excluded += 1;
          }
        });
        var done = function () {
          return { ok: true, matched: matched, excluded: excluded, total: leads.length };
        };
        var store = changed ? Storage.setLeads(leads) : Promise.resolve();
        return store.then(function () {
          if (settings && settings.permitExcludeVersion === 2) return done();
          return Storage.saveSettings({ permitExcludeVersion: 2 }).then(done);
        });
      });
    }).catch(function (err) {
      if (Log) Log.error('Permit', 'exclude failed:', err && err.message);
      return { ok: false, reason: 'storage_error' };
    });
  }

  function cleanPhones() {
    return Promise.all([Storage.getSettings(), Storage.getAutoSearch()]).then(function (parts) {
      var settings = parts[0];
      var autoState = parts[1];
      return mutateLeads(function (leads) {
        var postContacts = (autoState && autoState.postContacts) || {};
      var stats = { scanned: leads.length, cleaned: 0, flagged: 0, valid: 0, corrected: 0 };
      var changed = false;
      leads.forEach(function (lead) {
        if (!lead) return;
        var beforeNorm = lead.phone_normalized || '';
        var beforeIssue = lead.phone_issue || '';
        var beforeRaw = lead.phone_raw || '';
        verifyLead(lead, settings, postContacts);
        var rawChanged = (lead.phone_raw || '') !== beforeRaw;
        if (rawChanged) stats.corrected += 1;
        if (rawChanged || (lead.phone_normalized || '') !== beforeNorm || (lead.phone_issue || '') !== beforeIssue) {
          stats.cleaned += 1;
          changed = true;
        }
        if (lead.phone_raw || lead.phone_normalized) {
          if (lead.phone_issue) stats.flagged += 1;
          else stats.valid += 1;
        }
      });
      var done = function () {
        return {
          ok: true, scanned: stats.scanned, cleaned: stats.cleaned,
          flagged: stats.flagged, valid: stats.valid, corrected: stats.corrected
        };
      };
      var store = changed ? Storage.setLeads(leads) : Promise.resolve();
      return store.then(function () {
        if (settings.phoneCleanupVersion === 1) return done();
        return Storage.saveSettings({ phoneCleanupVersion: 1 }).then(done);
      });
      });
    }).catch(function (err) {
      if (Log) Log.error('Phone', 'cleanup failed:', err && err.message);
      return { ok: false, reason: 'storage_error' };
    });
  }

  function setPhone(payload) {
    var id = payload && payload.id;
    var raw = payload && typeof payload.phone_raw === 'string' ? payload.phone_raw.trim().slice(0, 60) : '';
    if (!id) return Promise.resolve({ ok: false, reason: 'no_id' });
    if (!raw) return Promise.resolve({ ok: false, reason: 'empty' });
    return Storage.getSettings().then(function (settings) {
      return mutateLeads(function (leads) {
        var index = -1;
        leads.forEach(function (lead, i) {
          if (lead && lead.id === id) index = i;
        });
        if (index < 0) return { ok: false, reason: 'not_found' };
        var lead = leads[index];
        var res = N.attributePhone(raw, phoneContext(lead), settings.defaultCountryCode);
        if (!res.valid) return { ok: false, reason: res.issue || 'invalid' };
        if (res.needsCc) return { ok: false, reason: 'needs_cc' };
        lead.phone_raw = res.raw;
        lead.phone_normalized = res.normalized;
        delete lead.phone_issue;
        return Storage.setLeads(leads).then(function () {
          if (Log && Log.isEnabled()) Log.debug('Phone', 'manual fix @' + lead.instagram_username + ' → ' + res.normalized);
          return { ok: true, phone_raw: lead.phone_raw, phone_normalized: lead.phone_normalized };
        });
      });
    }).catch(function (err) {
      if (Log) Log.error('Phone', 'manual fix failed:', err && err.message);
      return { ok: false, reason: 'storage_error' };
    });
  }

  function stashPostContact(payload) {
    var username = normalizeKey(payload && payload.username);
    if (!username || !N.isValidUsername(username)) {
      return Promise.resolve({ ok: false, reason: 'invalid_username' });
    }
    var phone = (payload && payload.phone) || {};
    var raw = String(phone.raw || '').slice(0, 60);
    var normalized = String(phone.normalized || '').slice(0, 40);
    var email = '';
    if (payload && payload.email) {
      var found = N.extractEmails(String(payload.email));
      if (found.length) email = String(found[0]).slice(0, 120);
    }
    if (!normalized && !email) return Promise.resolve({ ok: false, reason: 'empty' });
    return Storage.getAutoSearch().then(function (state) {
      var map = Object.assign({}, state.postContacts || {});
      map[username] = {
        phone_raw: normalized ? raw : '',
        phone_normalized: normalized,
        email: email,
        at: Date.now()
      };
      var keys = Object.keys(map);
      for (var i = 0; i < keys.length - 500; i++) delete map[keys[i]];
      return Storage.setAutoSearch({ postContacts: map });
    }).then(function () {
      if (Log && Log.isEnabled()) Log.debug('AutoSearch', 'stashed post contact for @' + username);
      return { ok: true };
    });
  }

  function autoSearchHold(payload, sender) {
    return autoSearchGuard(sender).then(function (g) {
      if (!g.ok) return { ok: false, reason: g.reason };
      var profile = payload && payload.profile;
      if (!profile || !profile.instagram_username) return { ok: false, reason: 'no_profile' };
      return Storage.setAutoSearch({ hold: profile, phase: 'linktree', message: 'Opening Linktree…' })
        .then(function () { return { ok: true }; });
    });
  }

  function absolutePostUrl(path) {
    if (!path) return '';
    return 'https://www.instagram.com' + (path.charAt(0) === '/' ? path : '/' + path);
  }

  function autoSearchResolve(payload, sender) {
    return autoSearchGuard(sender).then(function (g) {
      if (!g.ok) return { ok: false, reason: g.reason };
      var state = g.state;
      var profile = state.hold;
      if (!profile || !profile.instagram_username) return { ok: false, reason: 'no_hold' };
      var website = payload && typeof payload.website === 'string' ? N.normalizeExternalUrl(payload.website) : '';
      if (website && N.isNonWebsiteUrl(website)) website = '';
      profile = Object.assign({}, profile, { website: website, website_found: !!website });
      if (Log && Log.isEnabled()) {
        Log.debug('AutoSearch', 'linktree resolved @' + profile.instagram_username + ' website=' + (website || 'none'));
      }
      return Storage.setAutoSearch({ hold: null }).then(function () {
        return processCandidate({
          profile: profile,
          confidence: typeof profile.confidence === 'number' ? profile.confidence : 0,
          hasWebsite: !!website,
          saveAll: true
        });
      }).then(function () {
        return bumpCollected(state, profile.instagram_username);
      }).then(function (bump) {
        if (!bump) return { ok: false, reason: 'progress_error' };
        if (bump.finished) return { ok: true, finished: true, collected: bump.collected, target: state.target };
        return autoSearchAdvance(sender).then(function (adv) {
          if (!adv.ok) return { ok: false, reason: adv.reason };
          var url = adv.next ? absolutePostUrl(adv.next) : (adv.searchUrl || '');
          if (!url) return { ok: false, reason: 'no_next' };
          return tabsUpdate(state.tabId, url).then(function (nav) {
            return { ok: nav.ok !== false, finished: false, next: url };
          });
        });
      });
    });
  }

  function autoSearchProgress(payload, sender) {
    var type = payload && payload.type;
    return autoSearchGuard(sender).then(function (g) {
      if (!g.ok) return { ok: false, reason: g.reason };
      var state = g.state;

      if (type === 'phase') {
        var phase = String(payload.phase || '');
        if (!phase || phase === state.phase) return { ok: true, collected: state.collected, finished: false };
        return Storage.setAutoSearch({ phase: phase, message: '' }).then(function (next) {
          return { ok: true, collected: next.collected, finished: false };
        });
      }

      if (type === 'profileSubmitted') {
        var username = normalizeKey(payload.username);
        if (!username) return { ok: false, reason: 'no_username' };
        return bumpCollected(state, username).then(function (bump) {
          if (!bump) return { ok: false, reason: 'no_username' };
          return { ok: true, collected: bump.collected, target: state.target, finished: bump.finished };
        });
      }

      if (type === 'blocked') {
        return Storage.setAutoSearch({
          active: false,
          phase: 'blocked',
          message: String(payload.message || 'Login required — open Instagram and log in')
        }).then(function () { return { ok: true, finished: false }; });
      }

      if (type === 'exhausted') {
        return Storage.setAutoSearch({
          active: false,
          phase: 'exhausted',
          message: String(payload.message || 'No more results')
        }).then(function () { return { ok: true, finished: false }; });
      }

      return Promise.resolve({ ok: false, reason: 'unknown_type' });
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') return false;

    var handled;

    switch (message.type) {
      case 'PROCESS_CANDIDATE':
        handled = processCandidate(message.payload);
        break;
      case 'DELETE_LEADS':
        handled = deleteLeads(message.payload && message.payload.ids);
        break;
      case 'CLEAR_LEADS':
        handled = clearLeads();
        break;
      case 'UPDATE_LEAD':
        handled = updateLead(message.payload);
        break;
      case 'GET_SNAPSHOT':
        handled = flushStats().then(function () { return Storage.getSnapshot(); });
        break;
      case 'FLUSH_STATS':
        handled = flushStats().then(function () { return { flushed: true }; });
        break;
      case 'AUTOSEARCH_START':
        handled = autoSearchStart(message.payload);
        break;
      case 'AUTOSEARCH_STOP':
        handled = autoSearchStop();
        break;
      case 'AUTOSEARCH_CLAIM':
        handled = autoSearchClaim(sender);
        break;
      case 'AUTOSEARCH_NAVIGATE':
        handled = autoSearchNavigate(message.payload, sender);
        break;
      case 'AUTOSEARCH_HARVEST':
        handled = autoSearchHarvest(message.payload, sender);
        break;
      case 'AUTOSEARCH_ADVANCE':
        handled = autoSearchAdvance(sender);
        break;
      case 'AUTOSEARCH_HOLD':
        handled = autoSearchHold(message.payload, sender);
        break;
      case 'AUTOSEARCH_RESOLVE':
        handled = autoSearchResolve(message.payload, sender);
        break;
      case 'AUTOSEARCH_PROGRESS':
        handled = autoSearchProgress(message.payload, sender);
        break;
      case 'POST_CONTACT_STASH':
        handled = stashPostContact(message.payload);
        break;
      case 'FLAG_INFLUENCERS':
        handled = flagInfluencers();
        break;
      case 'EXCLUDE_PERMITS':
        handled = excludePermits();
        break;
      case 'CLEAN_PHONES':
        handled = cleanPhones();
        break;
      case 'SET_PHONE':
        handled = setPhone(message.payload);
        break;
      case 'OUTREACH_START':
        handled = Outreach ? Outreach.start(message.payload) : Promise.resolve({ started: false, reason: 'unavailable' });
        break;
      case 'OUTREACH_STOP':
        handled = Outreach ? Outreach.stop() : Promise.resolve({ stopped: false, reason: 'unavailable' });
        break;
      default:
        return false;
    }

    handled.then(function (result) {
      try { sendResponse(result); } catch (e) { /* ignore */ }
    }).catch(function (err) {
      if (Log) Log.error('Background', 'handler failed:', err && err.message);
      try { sendResponse({ error: true }); } catch (e) { /* ignore */ }
    });

    return true;
  });

  chrome.runtime.onInstalled.addListener(function (details) {
  initSettings();

  Storage.onChanged(function (changes) {
    if (changes.settings && changes.settings.newValue && Log) {
      Log.setEnabled(!!changes.settings.newValue.debug);
    }
  });
    if (Log) Log.debug('Background', 'extension', details.reason);
  });

  initSettings();

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(function () {
      flushStats();
    });
  }

  if (Log) Log.debug('Background', 'service worker loaded');
})(typeof globalThis !== 'undefined' ? globalThis : self);
