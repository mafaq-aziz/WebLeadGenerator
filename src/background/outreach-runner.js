(function (root) {
  'use strict';

  var Log = root.FicinoLog;
  var Storage = root.FicinoStorage;
  var T = root.FicinoTemplates;
  var N = root.FicinoNormalizer;

  var paceMs = null;
  var active = null;
  var bound = false;

  function delay() {
    if (typeof paceMs === 'number') return paceMs;
    return 1500 + Math.floor(Math.random() * 2000);
  }

  function tabsApi() {
    return typeof chrome !== 'undefined' && chrome.tabs ? chrome.tabs : null;
  }

  function bind() {
    if (bound) return;
    var tabs = tabsApi();
    if (!tabs) return;
    bound = true;
    if (tabs.onUpdated) tabs.onUpdated.addListener(onUpdated);
    if (tabs.onRemoved) tabs.onRemoved.addListener(onRemoved);
  }

  function onUpdated(tabId, info) {
    if (!active || !active.pending || !info || info.status !== 'complete') return;
    if (active.pending.tabId !== tabId) return;
    if (active.pending.sent) return;
    active.pending.sent = true;
    sendDraft(tabId);
  }

  function onRemoved(tabId) {
    if (!active || !active.pending || active.pending.tabId !== tabId) return;
    var pending = active.pending;
    clearTimeout(pending.timer);
    finishItem(pending.item, 'tab_closed', tabId);
  }

  function sendDraft(tabId) {
    var pending = active && active.pending;
    if (!pending) return;
    var tabs = tabsApi();
    if (!tabs || !tabs.sendMessage) {
      finishItem(pending.item, 'no_content_script', tabId);
      return;
    }
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(function () {
      if (active && active.pending === pending) finishItem(pending.item, 'timeout', tabId);
    }, 30000);

    function attempt(tries) {
      if (!active || active.pending !== pending) return;
      tabs.sendMessage(tabId, { type: 'OUTREACH_DRAFT', text: pending.item.text }, function (resp) {
        if (!active || active.pending !== pending) return;
        var err = chrome.runtime && chrome.runtime.lastError;
        if (err && tries < 10) {
          setTimeout(function () { attempt(tries + 1); }, 300);
          return;
        }
        clearTimeout(pending.timer);
        if (err || !resp) {
          finishItem(pending.item, 'no_content_script', tabId);
        } else if (resp.ok) {
          finishItem(pending.item, null, tabId);
        } else {
          finishItem(pending.item, resp.reason || 'draft_failed', tabId);
        }
      });
    }
    attempt(0);
  }

  function updateStored(extra, done) {
    var a = active;
    var base = {
      prepared: a.prepared.slice(),
      failed: a.failed.concat(a.skipped || []),
      tabIds: a.tabIds.slice(),
      message: 'Preparing ' + (a.prepared.length + a.failed.length) + '/' + a.items.length
    };
    Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
    Storage.setOutreach(base).then(function () {
      if (done) done();
    }).catch(function () {
      if (done) done();
    });
  }

  function finishItem(item, reason, tabId) {
    if (!active) return;
    if (reason) {
      active.failed.push({ id: item.id, username: item.username, reason: reason });
    } else {
      active.prepared.push({ id: item.id, username: item.username, tabId: tabId || null, url: item.url });
    }
    active.pending = null;
    updateStored(null, function () { schedule(false); });
  }

  function schedule(immediate) {
    if (!active) return;
    var wait = immediate ? 0 : delay();
    active.timer = setTimeout(function () {
      if (!active) return;
      active.timer = null;
      openNext();
    }, wait);
  }

  function openNext() {
    var a = active;
    if (!a) return;
    if (a.index >= a.items.length) {
      finish();
      return;
    }
    var item = a.items[a.index++];
    var tabs = tabsApi();
    if (!tabs || !tabs.create) {
      finishItem(item, 'no_tabs', null);
      return;
    }
    tabs.create({ url: item.url, active: false }, function (tab) {
      if (!active) return;
      var tabId = tab && typeof tab.id === 'number' ? tab.id : null;
      if (tabId == null) {
        finishItem(item, 'tab_failed', null);
        return;
      }
      active.tabIds.push(tabId);
      if (active.channel === 'whatsapp') {
        active.prepared.push({ id: item.id, username: item.username, tabId: tabId, url: item.url });
        updateStored(null, function () { schedule(false); });
      } else {
        var captured = { tabId: tabId, item: item, timer: null };
        captured.timer = setTimeout(function () {
          if (active && active.pending === captured) finishItem(item, 'timeout', tabId);
        }, 30000);
        active.pending = captured;
      }
    });
  }

  function finish() {
    var a = active;
    active = null;
    if (!a) return;
    var summary = a.prepared.length + ' draft(s) ready' +
      (a.failed.length ? ', ' + a.failed.length + ' failed' : '');
    var tabs = tabsApi();
    if (a.tabIds.length && tabs && tabs.update) {
      tabs.update(a.tabIds[0], { active: true });
    }
    Storage.setOutreach({
      state: 'done',
      prepared: a.prepared.slice(),
      failed: a.failed.concat(a.skipped || []),
      tabIds: a.tabIds.slice(),
      message: summary,
      doneAt: Date.now(),
      dismissed: false
    }).then(function () {
      if (Log && Log.isEnabled()) Log.debug('Outreach', 'done: ' + summary);
    }).catch(function () { /* storage failure already logged by storage.js */ });
  }

  function start(payload) {
    if (active) return Promise.resolve({ started: false, reason: 'busy' });
    var channel = payload && payload.channel;
    if (channel !== 'whatsapp' && channel !== 'instagram') {
      return Promise.resolve({ started: false, reason: 'bad_channel' });
    }
    var ids = payload && Array.isArray(payload.ids)
      ? payload.ids.filter(function (id) { return typeof id === 'string' && id; })
      : [];
    if (!ids.length) return Promise.resolve({ started: false, reason: 'no_ids' });

    active = {
      channel: channel, items: [], index: 0,
      prepared: [], failed: [], skipped: [], tabIds: [],
      pending: null, timer: null
    };

    return Promise.all([Storage.getLeads(), Storage.getOutreach(), Storage.getSettings()]).then(function (parts) {
      var leads = parts[0];
      var outreach = parts[1];
      var settings = parts[2];
      var byId = Object.create(null);
      leads.forEach(function (lead) { if (lead && lead.id) byId[lead.id] = lead; });

      var template = channel === 'whatsapp'
        ? (outreach.waTemplate || (T && T.defaults.wa) || '')
        : (outreach.igTemplate || (T && T.defaults.ig) || '');

      var BATCH_LIMIT = 20;
      var items = [];
      var skipped = [];
      ids.forEach(function (id) {
        if (items.length >= BATCH_LIMIT) {
          skipped.push({ id: id, username: '', reason: 'batch_limit' });
          return;
        }
        var lead = byId[id];
        if (!lead) {
          skipped.push({ id: id, username: '', reason: 'not_found' });
          return;
        }
        var username = String(lead.instagram_username || '').replace(/^@/, '');
        if (lead.status === 'Ignore') {
          skipped.push({ id: id, username: username, reason: 'ignored' });
          return;
        }
        var text = T ? T.render(template, lead) : String(template);
        var url = '';
        if (channel === 'whatsapp') {
          var source = lead.phone_raw || lead.phone_normalized || '';
          if (lead.phone_issue) {
            skipped.push({ id: id, username: username, reason: lead.phone_issue });
            return;
          }
          var attributed = N ? N.attributePhone(source, {
            keyword: lead.keyword,
            bio: lead.bio,
            location: lead.location,
            username: lead.instagram_username,
            name: lead.instagram_name,
            website: lead.website,
            source_page: lead.source_page
          }, settings.defaultCountryCode) : null;
          if (!attributed || !attributed.valid || attributed.needsCc) {
            var reason = !attributed || attributed.issue === 'no_number'
              ? 'no_phone'
              : (attributed.needsCc ? 'needs_cc' : (attributed.issue || 'invalid_phone'));
            skipped.push({ id: id, username: username, reason: reason });
            return;
          }
          url = T ? T.waSendUrl({ phone_normalized: attributed.normalized }, text) : '';
          if (!url) {
            skipped.push({ id: id, username: username, reason: 'no_phone' });
            return;
          }
        } else {
          url = T ? T.igSendUrl(lead) : '';
          if (!url) {
            skipped.push({ id: id, username: username, reason: 'no_username' });
            return;
          }
        }
        items.push({ id: lead.id, username: username, text: text, url: url });
      });

      if (!items.length) {
        active = null;
        return Storage.setOutreach({
          state: 'idle',
          message: 'No eligible leads',
          prepared: [],
          failed: skipped,
          tabIds: [],
          startedAt: 0,
          doneAt: 0
        }).then(function () {
          return { started: false, reason: 'no_eligible', skipped: skipped.length };
        });
      }

      active.items = items;
      active.skipped = skipped.slice();
      bind();
      updateStored({
        state: 'running',
        channel: channel,
        failed: skipped,
        prepared: [],
        tabIds: [],
        dismissed: false,
        startedAt: Date.now(),
        doneAt: 0
      }, function () {});
      if (Log && Log.isEnabled()) {
        Log.debug('Outreach', 'starting ' + channel + ' with ' + items.length + ' draft(s)');
      }
      schedule(true);
      return { started: true, total: items.length, skipped: skipped.length };
    }).catch(function (err) {
      active = null;
      if (Log) Log.error('Outreach', 'start failed:', err && err.message);
      return { started: false, reason: 'error' };
    });
  }

  function stop() {
    if (!active) return Promise.resolve({ stopped: false, reason: 'idle' });
    var a = active;
    if (a.timer) clearTimeout(a.timer);
    if (a.pending && a.pending.timer) clearTimeout(a.pending.timer);
    active = null;
    return Storage.setOutreach({
      state: 'stopped',
      message: 'Stopped by user',
      prepared: a.prepared.slice(),
      failed: a.failed.concat(a.skipped || []),
      tabIds: a.tabIds.slice(),
      doneAt: Date.now()
    }).then(function () {
      return { stopped: true, prepared: a.prepared.length };
    });
  }

  function recoverIfNeeded() {
    Storage.getOutreach().then(function (outreach) {
      if (outreach.state === 'running' && !active) {
        return Storage.setOutreach({
          state: 'interrupted',
          message: 'Interrupted (browser restarted) — start again'
        });
      }
      return null;
    }).catch(function () { /* ignore */ });
  }

  recoverIfNeeded();

  root.FicinoOutreach = {
    start: start,
    stop: stop,
    setPace: function (ms) { paceMs = ms; },
    isActive: function () { return !!active; }
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.FicinoOutreach;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
