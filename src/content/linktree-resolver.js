(function (root) {
  'use strict';

  var N = root.FicinoNormalizer;
  var Log = root.FicinoLog;

  var attempts = 0;
  var done = false;

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

  function collectCandidateLinks() {
    var out = [];
    var seen = Object.create(null);
    var anchors = [];
    try {
      anchors = document.querySelectorAll('a[href]');
    } catch (err) {
      return out;
    }
    for (var i = 0; i < anchors.length; i++) {
      var raw = anchors[i].getAttribute('href') || '';
      if (!/^https?:\/\//i.test(raw) && !/^www\./i.test(raw)) continue;
      var url = N.normalizeExternalUrl(raw);
      if (!url) continue;
      if (N.isNonWebsiteUrl(url)) continue;
      if (seen[url]) continue;
      seen[url] = true;
      out.push(url);
    }
    return out;
  }

  function run() {
    if (done) return;
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['autoSearch'], function (items) {
        if (done) return;
        var state = items && items.autoSearch;
        if (!state || !state.active || !state.hold) return;
        var links = collectCandidateLinks();
        if (!links.length && attempts < 20) {
          attempts += 1;
          setTimeout(run, 500);
          return;
        }
        done = true;
        if (Log && Log.isEnabled()) Log.debug('Linktree', 'found ' + links.length + ' candidate links');
        sendMessage({
          type: 'AUTOSEARCH_RESOLVE',
          payload: { website: links.length ? links[0] : '', links: links.slice(0, 8) }
        });
      });
    } catch (err) { /* ignore */ }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  }

  root.FicinoLinktreeResolver = {
    run: run,
    collectCandidateLinks: collectCandidateLinks
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
