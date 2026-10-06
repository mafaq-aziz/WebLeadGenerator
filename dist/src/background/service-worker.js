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
    if (incoming.search_term) {
      merged.search_term = unionTerms(existing.search_term, incoming.search_term);
    }
    merged.last_seen = N.normalizeDate(new Date());
    return merged;
  }

  function splitTerms(value) {
    return String(value || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function unionTerms(a, b) {
    var out = [];
    var seen = Object.create(null);
    splitTerms(a).concat(splitTerms(b)).forEach(function (term) {
      var key = term.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(term);
    });
    return out.join(', ');
  }

  function currentSearchTerm(autoState) {
    if (!autoState || !autoState.active) return '';
    var queries = autoState.queries && autoState.queries.length
      ? autoState.queries
      : (autoState.query ? [autoState.query] : []);
    if (!queries.length) return '';
    var index = Number(autoState.queryIndex) || 0;
    return queries[index] || queries[0] || '';
  }

  function searchTermFor(autoState, sender) {
    var term = currentSearchTerm(autoState);
    if (!term) return '';
    var tab = senderTabId(sender);
    if (tab != null && autoState.tabId != null && tab !== autoState.tabId) return '';
    return term;
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

  function processCandidate(payload, sender) {
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
      var term = searchTermFor(autoState, sender);
      if (term) profile = Object.assign({}, profile, { search_term: term });
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

  function firstNonEmpty(list, field) {
    for (var i = 0; i < list.length; i++) {
      var value = list[i] && list[i][field];
      if (value !== undefined && value !== null && String(value) !== '') return String(value);
    }
    return '';
  }

  function longestOf(list, field) {
    var best = '';
    list.forEach(function (lead) {
      var value = lead && lead[field] !== undefined && lead[field] !== null ? String(lead[field]) : '';
      if (value.length > best.length) best = value;
    });
    return best;
  }

  function mergeSelectedLeads(ids) {
    var unique = [];
    (ids || []).forEach(function (id) {
      if (typeof id === 'string' && unique.indexOf(id) === -1) unique.push(id);
    });
    if (unique.length < 2) return Promise.resolve({ ok: false, reason: 'need_two' });

    return mutateLeads(function (leads) {
      var byId = Object.create(null);
      leads.forEach(function (lead) { byId[lead.id] = lead; });
      var group = [];
      for (var i = 0; i < unique.length; i++) {
        if (!byId[unique[i]]) return { ok: false, reason: 'not_found' };
        group.push(byId[unique[i]]);
      }

      var base = Object.assign({}, group[0]);
      var rest = group.slice(1);

      base.instagram_name = longestOf(group, 'instagram_name');
      base.bio = longestOf(group, 'bio');
      base.category = longestOf(group, 'category');
      base.location = longestOf(group, 'location');
      base.source_page = longestOf(group, 'source_page');
      base.email = firstNonEmpty(group, 'email');
      base.website = firstNonEmpty(group, 'website');
      base.keyword = firstNonEmpty(group, 'keyword');
      base.reasons = group.reduce(function (acc, lead) {
        return acc.length ? acc : (lead.reasons || []);
      }, []);

      var phoneSource = group.filter(function (lead) {
        return lead.phone_normalized && !lead.phone_issue;
      })[0] || group.filter(function (lead) {
        return lead.phone_raw;
      })[0] || group[0];
      base.phone_raw = phoneSource.phone_raw || '';
      base.phone_normalized = phoneSource.phone_normalized || '';
      if (phoneSource.phone_issue) base.phone_issue = phoneSource.phone_issue;
      else delete base.phone_issue;
      if (phoneSource.phone_replaced_raw) base.phone_replaced_raw = phoneSource.phone_replaced_raw;
      else delete base.phone_replaced_raw;
      if (phoneSource.phone_corrected) base.phone_corrected = true;
      else delete base.phone_corrected;

      var bestFollowers = '';
      var bestConfidence = -1;
      group.forEach(function (lead) {
        var count = N.parseFollowers(lead.followers);
        if (typeof count !== 'number' || !isFinite(count)) count = -1;
        if (count > bestConfidence) {
          bestConfidence = count;
          bestFollowers = lead.followers || '';
        }
      });
      base.followers = bestFollowers;
      base.confidence = Math.max.apply(null, group.map(function (lead) { return Number(lead.confidence) || 0; }));
      base.website_found = !!base.website;
      base.website_not_found_on_instagram = !base.website;

      var statusRank = { Contacted: 3, Reviewed: 2, Ignore: 1, New: 0 };
      if (!base.status || base.status === 'New') {
        group.forEach(function (lead) {
          var rank = statusRank[lead.status] || 0;
          var best = statusRank[base.status] || 0;
          if (rank > best && rank > 0) base.status = lead.status;
        });
      }
      if (!base.status) base.status = 'New';

      base.influencer = group.some(function (lead) { return !!lead.influencer; });
      var reasons = [];
      group.forEach(function (lead) {
        (lead.influencer_reasons || []).forEach(function (reason) {
          if (reasons.indexOf(reason) === -1) reasons.push(reason);
        });
      });
      base.influencer_reasons = reasons;

      var notes = [];
      group.forEach(function (lead) {
        var note = String(lead.notes || '').trim();
        if (note && notes.indexOf(note) === -1) notes.push(note);
      });
      var others = rest.map(function (lead) { return '@' + lead.instagram_username; }).join(', ');
      if (others) notes.push('Merged from ' + others);
      base.notes = notes.join(' · ');

      base.search_term = unionTerms(
        group.map(function (lead) { return lead.search_term || ''; }).join(', '), ''
      );

      var dates = group.map(function (lead) { return String(lead.date_found || ''); }).filter(Boolean).sort();
      if (dates.length) base.date_found = dates[0];
      var seen = group.map(function (lead) { return String(lead.last_seen || ''); }).filter(Boolean).sort();
      if (seen.length) base.last_seen = seen[seen.length - 1];

      var removeSet = Object.create(null);
      rest.forEach(function (lead) { removeSet[lead.id] = true; });
      var next = [];
      leads.forEach(function (lead) {
        if (removeSet[lead.id]) return;
        next.push(lead.id === base.id ? base : lead);
      });

      return Storage.setLeads(next).then(function () {
        if (Log && Log.isEnabled()) {
          Log.debug('Storage', 'merged ' + group.length + ' leads into @' + base.instagram_username);
        }
        return { ok: true, id: base.id, username: base.instagram_username, merged: group.length };
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

  var TAG_STOPWORDS = {
    in: 1, on: 1, at: 1, near: 1, for: 1, the: 1, of: 1, to: 1, and: 1, or: 1,
    my: 1, me: 1, by: 1, with: 1, into: 1, around: 1, vs: 1, top: 1, best: 1,
    how: 1, what: 1, where: 1, who: 1, when: 1, your: 1, our: 1, this: 1, that: 1
  };

  function tagCandidates(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q || q.charAt(0) === '#') return [];
    var words = q.split(/[^a-z0-9_À-ɏ؀-ۿ]+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (word.length < 3 || TAG_STOPWORDS[word]) continue;
      if (out.indexOf(word) === -1) out.push(word);
      if (word.length > 4 && word.charAt(word.length - 1) === 's') {
        var singular = word.slice(0, -1);
        if (out.indexOf(singular) === -1) out.push(singular);
      }
      if (out.length >= 2) break;
    }
    return out;
  }

  function surfacesFor(query) {
    var surfaces = [];
    var keyword = searchUrlFor(query);
    if (keyword) surfaces.push(keyword);
    tagCandidates(query).forEach(function (tag) {
      var url = 'https://www.instagram.com/explore/tags/' + encodeURIComponent(tag) + '/';
      if (surfaces.indexOf(url) === -1) surfaces.push(url);
    });
    return surfaces;
  }

  function surfaceLabel(url) {
    var match = /\/explore\/tags\/([^/]+)\/?$/.exec(String(url || ''));
    if (match) {
      try { return '#' + decodeURIComponent(match[1]); } catch (err) { return '#tag'; }
    }
    return 'the next results page';
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

  function parseTerms(input) {
    var items = Array.isArray(input) ? input : [input];
    var out = [];
    var seen = Object.create(null);
    items.forEach(function (item) {
      String(item === undefined || item === null ? '' : item).split(/[\n,;]+/).forEach(function (term) {
        var t = term.trim().replace(/\s+/g, ' ');
        if (!t) return;
        var key = t.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        out.push(t);
      });
    });
    return out;
  }

  function autoSearchStart(payload) {
    var terms = parseTerms(payload && (payload.queries || payload.query))
      .filter(function (term) { return !!searchUrlFor(term); });
    if (!terms.length) return Promise.resolve({ started: false, error: 'query_required' });
    var target = parseInt(payload && payload.target, 10);
    if (!isFinite(target)) target = 30;
    if (target < 1) target = 1;
    if (target > 500) target = 500;
    var surfaces = surfacesFor(terms[0]);
    var url = surfaces.length ? surfaces[0] : '';
    if (!url) return Promise.resolve({ started: false, error: 'query_required' });

    return findOrCreateInstagramTab(url).then(function (tabId) {
      return Storage.saveSettings({ autoSearchQuery: terms.join(', '), autoSearchTarget: target }).then(function () {
        return Storage.setAutoSearch({
          active: true,
          phase: 'harvest',
          query: terms[0],
          queries: terms,
          queryIndex: 0,
          totalCollected: 0,
          surfaces: surfaces,
          surfaceIndex: 0,
          searchHarvested: 0,
          target: target,
          collected: 0,
          message: terms.length > 1 ? ('Term 1/' + terms.length + ': ' + terms[0]) : 'Starting…',
          tabId: tabId,
          searchUrl: url,
          visitedPosts: [],
          visitedProfiles: [],
          pending: [],
          hold: null
        });
      }).then(function (state) {
        if (Log && Log.isEnabled()) {
          Log.debug('AutoSearch', 'started ' + terms.length + ' term(s) "' + terms[0] +
            '" target ' + target + ', ' + surfaces.length + ' surface(s)');
        }
        return { started: true, tabId: state.tabId, searchUrl: url, terms: terms.length };
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
      var added = pending.length - g.state.pending.length;
      return Storage.setAutoSearch({
        pending: pending,
        searchHarvested: (Number(g.state.searchHarvested) || 0) + added
      }).then(function (next) {
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

  function termQueries(state) {
    if (state.queries && state.queries.length) return state.queries;
    return state.query ? [state.query] : [];
  }

  function nextTermPatch(state) {
    var queries = termQueries(state);
    var index = Number(state.queryIndex) || 0;
    if (index + 1 >= queries.length) return null;
    var nextTerm = queries[index + 1];
    return {
      queryIndex: index + 1,
      query: nextTerm,
      searchUrl: searchUrlFor(nextTerm),
      surfaces: surfacesFor(nextTerm),
      surfaceIndex: 0,
      searchHarvested: 0,
      collected: 0,
      pending: [],
      active: true,
      phase: 'harvest',
      message: 'Term ' + (index + 2) + '/' + queries.length + ': ' + nextTerm
    };
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
      var added = qualifies && isNewVisit ? 1 : 0;
      collected += added;
      var total = (Number(state.totalCollected) || 0) + added;
      var reached = collected >= state.target;
      var advance = reached ? nextTermPatch(state) : null;
      var patch = {
        collected: collected,
        visitedProfiles: visited,
        totalCollected: total
      };
      if (advance) {
        patch = Object.assign(patch, advance);
        patch.message = advance.message;
      } else {
        patch.active = !reached;
        patch.phase = reached ? 'done' : state.phase;
        patch.message = reached
          ? (termQueries(state).length > 1
            ? ('Done — ' + termQueries(state).length + ' terms, ' + total + ' leads')
            : ('Collected ' + state.target + ' leads'))
          : state.message;
      }
      return Storage.setAutoSearch(patch).then(function (next) {
        if (Log && Log.isEnabled()) {
          Log.debug('AutoSearch', username + (qualifies ? ' lead' : ' skip') + ' ' + next.collected + '/' + state.target);
        }
        return { collected: next.collected, finished: reached && !advance, advanced: !!advance, totalCollected: total };
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
          return {
            ok: true,
            collected: bump.collected,
            target: state.target,
            finished: bump.finished,
            advanced: bump.advanced,
            totalCollected: bump.totalCollected
          };
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
        var surfaces = state.surfaces || [];
        var surfaceIndex = Number(state.surfaceIndex) || 0;
        var harvested = Number(state.searchHarvested) || 0;
        if (!harvested && surfaceIndex + 1 < surfaces.length) {
          var nextSurface = surfaces[surfaceIndex + 1];
          var surfacePatch = {
            surfaceIndex: surfaceIndex + 1,
            searchUrl: nextSurface,
            searchHarvested: 0,
            active: true,
            phase: 'harvest',
            message: 'No posts there — trying ' + surfaceLabel(nextSurface)
          };
          return Storage.setAutoSearch(surfacePatch).then(function (next) {
            if (Log && Log.isEnabled()) {
              Log.debug('AutoSearch', 'empty surface, falling back to ' + next.searchUrl);
            }
            return tabsUpdate(state.tabId, next.searchUrl).then(function (nav) {
              return {
                ok: true, finished: false, advanced: true, fallback: true,
                collected: 0, navigated: nav.ok !== false
              };
            });
          });
        }
        var advance = nextTermPatch(state);
        if (!advance) {
          return Storage.setAutoSearch({
            active: false,
            phase: 'exhausted',
            message: String(payload.message || 'No more results')
          }).then(function () { return { ok: true, finished: false, advanced: false }; });
        }
        return Storage.setAutoSearch(advance).then(function (next) {
          if (Log && Log.isEnabled()) {
            Log.debug('AutoSearch', 'term exhausted, moving to "' + next.query + '"');
          }
          return tabsUpdate(state.tabId, next.searchUrl).then(function (nav) {
            return { ok: true, finished: false, advanced: true, collected: 0, navigated: nav.ok !== false };
          });
        });
      }

      return Promise.resolve({ ok: false, reason: 'unknown_type' });
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') return false;

    var handled;

    switch (message.type) {
      case 'PROCESS_CANDIDATE':
        handled = processCandidate(message.payload, sender);
        break;
      case 'MERGE_LEADS':
        handled = mergeSelectedLeads(message.payload && message.payload.ids);
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
