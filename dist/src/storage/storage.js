(function (root) {
  'use strict';

  var KEY_LEADS = 'leads';
  var KEY_SETTINGS = 'settings';
  var KEY_STATS = 'statistics';

  var DEFAULT_SETTINGS = {
    businessConfidenceThreshold: 70,
    autoScan: true,
    saveEmail: true,
    savePhone: true,
    debug: false,
    autoSearchQuery: '',
    autoSearchTarget: 30,
    autoSearchSource: 'instagram',
    defaultCountryCode: '',
    phoneCleanupVersion: 0,
    permitExcludeVersion: 0
  };

  var DEFAULT_STATS = {
    scanned: 0,
    businesses: 0,
    withWebsite: 0,
    withoutWebsite: 0,
    saved: 0,
    duplicates: 0
  };

  var KEY_AUTOSEARCH = 'autoSearch';
  var KEY_MAPSSEARCH = 'mapsSearch';

  var DEFAULT_AUTOSEARCH = {
    active: false,
    query: '',
    queries: [],
    queryIndex: 0,
    totalCollected: 0,
    surfaces: [],
    surfaceIndex: 0,
    searchHarvested: 0,
    target: 30,
    collected: 0,
    phase: 'idle',
    message: '',
    tabId: null,
    searchUrl: '',
    visitedPosts: [],
    visitedProfiles: [],
    pending: [],
    hold: null,
    postContacts: {},
    updatedAt: 0
  };

  var DEFAULT_MAPSSEARCH = {
    active: false,
    query: '',
    queries: [],
    queryIndex: 0,
    totalCollected: 0,
    target: 30,
    collected: 0,
    phase: 'idle',
    message: '',
    tabId: null,
    searchUrl: '',
    visitedPlaces: [],
    visitedKeys: [],
    pending: [],
    updatedAt: 0
  };

  var KEY_OUTREACH = 'outreach';

  var DEFAULT_OUTREACH = {
    waTemplate: '',
    igTemplate: '',
    state: 'idle',
    channel: '',
    message: '',
    prepared: [],
    failed: [],
    tabIds: [],
    dismissed: false,
    startedAt: 0,
    doneAt: 0
  };

  function chromeApi() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  var memoryFallback = {
    leads: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    statistics: Object.assign({}, DEFAULT_STATS),
    autoSearch: Object.assign({}, DEFAULT_AUTOSEARCH),
    mapsSearch: Object.assign({}, DEFAULT_MAPSSEARCH),
    outreach: Object.assign({}, DEFAULT_OUTREACH)
  };

  function useMemory() {
    return !chromeApi();
  }

  function get(keys) {
    var api = chromeApi();
    if (!api) {
      var out = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
        out[k] = memoryFallback[k];
      });
      return Promise.resolve(out);
    }
    return new Promise(function (resolve, reject) {
      try {
        api.get(keys, function (items) {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(items || {});
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function set(obj) {
    var api = chromeApi();
    if (!api) {
      Object.assign(memoryFallback, obj);
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      try {
        api.set(obj, function () {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  var Storage = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULT_STATS: DEFAULT_STATS,
    DEFAULT_AUTOSEARCH: DEFAULT_AUTOSEARCH,
    DEFAULT_MAPSSEARCH: DEFAULT_MAPSSEARCH,
    DEFAULT_OUTREACH: DEFAULT_OUTREACH,

    getLeads: function () {
      return get(KEY_LEADS).then(function (items) {
        return Array.isArray(items[KEY_LEADS]) ? items[KEY_LEADS] : [];
      });
    },

    setLeads: function (leads) {
      var list = Array.isArray(leads) ? leads : [];
      return set({ leads: list }).then(function () {
        if (useMemory()) memoryFallback.leads = list;
        return list;
      });
    },

    getSettings: function () {
      return get(KEY_SETTINGS).then(function (items) {
        return Object.assign({}, DEFAULT_SETTINGS, items[KEY_SETTINGS] || {});
      });
    },

    saveSettings: function (patch) {
      return Storage.getSettings().then(function (current) {
        var next = Object.assign({}, current, patch || {});
        return set({ settings: next }).then(function () {
          if (useMemory()) memoryFallback.settings = next;
          return next;
        });
      });
    },

    getStats: function () {
      return get(KEY_STATS).then(function (items) {
        return Object.assign({}, DEFAULT_STATS, items[KEY_STATS] || {});
      });
    },

    setStats: function (stats) {
      var next = Object.assign({}, DEFAULT_STATS, stats || {});
      return set({ statistics: next }).then(function () {
        if (useMemory()) memoryFallback.statistics = next;
        return next;
      });
    },

    bumpStats: function (patch) {
      return Storage.getStats().then(function (current) {
        var next = Object.assign({}, current);
        Object.keys(patch || {}).forEach(function (key) {
          var delta = patch[key] || 0;
          next[key] = (typeof next[key] === 'number' ? next[key] : 0) + delta;
        });
        return Storage.setStats(next);
      });
    },

    resetStats: function () {
      return Storage.setStats(Object.assign({}, DEFAULT_STATS));
    },

    getAutoSearch: function () {
      return get(KEY_AUTOSEARCH).then(function (items) {
        return Object.assign({}, DEFAULT_AUTOSEARCH, items[KEY_AUTOSEARCH] || {});
      });
    },

    setAutoSearch: function (patch) {
      return Storage.getAutoSearch().then(function (current) {
        var next = Object.assign({}, current, patch || {}, { updatedAt: Date.now() });
        return set({ autoSearch: next }).then(function () {
          if (useMemory()) memoryFallback.autoSearch = next;
          return next;
        });
      });
    },

    getMapsSearch: function () {
      return get(KEY_MAPSSEARCH).then(function (items) {
        return Object.assign({}, DEFAULT_MAPSSEARCH, items[KEY_MAPSSEARCH] || {});
      });
    },

    setMapsSearch: function (patch) {
      return Storage.getMapsSearch().then(function (current) {
        var next = Object.assign({}, current, patch || {}, { updatedAt: Date.now() });
        return set({ mapsSearch: next }).then(function () {
          if (useMemory()) memoryFallback.mapsSearch = next;
          return next;
        });
      });
    },

    getOutreach: function () {
      return get(KEY_OUTREACH).then(function (items) {
        return Object.assign({}, DEFAULT_OUTREACH, items[KEY_OUTREACH] || {});
      });
    },

    setOutreach: function (patch) {
      return Storage.getOutreach().then(function (current) {
        var next = Object.assign({}, current, patch || {});
        return set({ outreach: next }).then(function () {
          if (useMemory()) memoryFallback.outreach = next;
          return next;
        });
      });
    },

    clearLeads: function () {
      return set({ leads: [] }).then(function () {
        if (useMemory()) memoryFallback.leads = [];
        return Storage.resetStats();
      });
    },

    getSnapshot: function () {
      return Promise.all([Storage.getLeads(), Storage.getSettings(), Storage.getStats()])
        .then(function (parts) {
          return { leads: parts[0], settings: parts[1], statistics: parts[2] };
        });
    },

    onChanged: function (callback) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local') return;
          callback(changes);
        });
      }
    }
  };

  root.FicinoStorage = Storage;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Storage;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
