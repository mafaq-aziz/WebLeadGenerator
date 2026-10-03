(function (root) {
  'use strict';

  var Log = root.FicinoLog;

  function createObserver(options) {
    var opts = options || {};
    var onBatch = typeof opts.onBatch === 'function' ? opts.onBatch : function () {};
    var onUrlChange = typeof opts.onUrlChange === 'function' ? opts.onUrlChange : function () {};
    var debounceMs = opts.debounceMs || 400;

    var observer = null;
    var timer = null;
    var lastUrl = '';
    var urlTimer = null;
    var started = false;
    var pendingNodes = [];

    function flush() {
      timer = null;
      var nodes = pendingNodes;
      pendingNodes = [];
      if (!nodes.length) return;
      try {
        onBatch(nodes);
      } catch (err) {
        if (Log) Log.warn('Scanner', 'batch handler failed:', err && err.message);
      }
    }

    function schedule(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i]) pendingNodes.push(nodes[i]);
      }
      if (pendingNodes.length > 500) {
        pendingNodes = pendingNodes.slice(0, 500);
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    }

    function handleMutations(mutations) {
      var nodes = [];
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node && node.nodeType === 1) nodes.push(node);
        }
      }
      if (nodes.length) schedule(nodes);
    }

    function checkUrl() {
      var current = '';
      try {
        current = root.location.href;
      } catch (e) {
        return;
      }
      if (current === lastUrl) return;
      var previous = lastUrl;
      lastUrl = current;
      try {
        onUrlChange(current, previous);
      } catch (err) {
        if (Log) Log.warn('Scanner', 'url handler failed:', err && err.message);
      }
    }

    function hookHistory() {
      try {
        ['pushState', 'replaceState'].forEach(function (method) {
          var original = root.history[method];
          if (typeof original !== 'function') return;
          if (original.__ficinoWrapped) return;
          var wrapped = function () {
            var result = original.apply(this, arguments);
            setTimeout(checkUrl, 0);
            return result;
          };
          wrapped.__ficinoWrapped = true;
          root.history[method] = wrapped;
        });
      } catch (err) {
        if (Log) Log.warn('Scanner', 'history hook failed:', err && err.message);
      }
    }

    function start() {
      if (started) return;
      started = true;
      try {
        lastUrl = root.location.href;
      } catch (e) { /* ignore */ }

      if (typeof MutationObserver === 'function' && root.document && root.document.documentElement) {
        observer = new MutationObserver(handleMutations);
        observer.observe(root.document.documentElement, {
          childList: true,
          subtree: true
        });
      }

      try {
        root.addEventListener('popstate', checkUrl);
      } catch (e) { /* ignore */ }
      hookHistory();
      urlTimer = setInterval(checkUrl, 900);
      if (Log && Log.isEnabled()) Log.debug('Scanner', 'observer started');
    }

    function stop() {
      if (!started) return;
      started = false;
      if (observer) {
        try { observer.disconnect(); } catch (e) { /* ignore */ }
        observer = null;
      }
      if (timer) { clearTimeout(timer); timer = null; }
      pendingNodes = [];
      if (urlTimer) { clearInterval(urlTimer); urlTimer = null; }
      try { root.removeEventListener('popstate', checkUrl); } catch (e) { /* ignore */ }
      if (Log && Log.isEnabled()) Log.debug('Scanner', 'observer stopped');
    }

    function forceCheck() {
      checkUrl();
      if (pendingNodes.length) flush();
    }

    return {
      start: start,
      stop: stop,
      forceCheck: forceCheck,
      isStarted: function () { return started; }
    };
  }

  root.FicinoMutationObserver = { createObserver: createObserver };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.FicinoMutationObserver;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
