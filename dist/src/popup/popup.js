(function () {
  'use strict';

  var Log = window.FicinoLog;
  var Storage = window.FicinoStorage;
  var ExcelExport = window.FicinoExcelExport;
  var CsvExport = window.FicinoCsvExport;

  var els = {};
  var toastTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message, isError) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('error', !!isError);
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 2600);
  }

  function setNumber(el, value) {
    if (el) el.textContent = String(typeof value === 'number' && isFinite(value) ? value : 0);
  }

  function renderStats(stats) {
    setNumber(els.statScanned, stats.scanned);
    setNumber(els.statBusinesses, stats.businesses);
    setNumber(els.statWithWebsite, stats.withWebsite);
    setNumber(els.statWithoutWebsite, stats.withoutWebsite);
    setNumber(els.statSaved, stats.saved);
    setNumber(els.statDuplicates, stats.duplicates);
  }

  function renderStatus(settings) {
    var active = settings.scannerActive !== false && settings.autoScan !== false;
    els.statusDot.classList.toggle('paused', !active);
    els.statusText.textContent = active ? 'Scanner Active' : 'Scanner Paused';
    els.statusHint.textContent = active
      ? 'Scanning current Instagram page…'
      : 'Scanning is paused. Resume to collect leads.';
    els.btnPause.textContent = active ? 'Pause Scanner' : 'Resume Scanner';
  }

  function renderSettings(settings) {
    var threshold = Number(settings.businessConfidenceThreshold);
    if (!isFinite(threshold)) threshold = 70;
    els.thresholdRange.value = String(threshold);
    els.thresholdInput.value = String(threshold);
    els.toggleAutoScan.checked = settings.autoScan !== false;
    els.toggleSaveEmail.checked = settings.saveEmail !== false;
    els.toggleSavePhone.checked = settings.savePhone !== false;
    els.inputCountryCode.value = settings.defaultCountryCode || '';
    els.toggleDebug.checked = !!settings.debug;
    activeSource = settings.autoSearchSource === 'maps' ? 'maps' : 'instagram';
    updateSourceUI();
  }

  var AUTO_PHASE_TEXT = {
    idle: 'Idle',
    harvest: 'Searching results…',
    results: 'Searching results…',
    place: 'Opening place…',
    post: 'Opening post…',
    profile: 'Extracting profile…',
    linktree: 'Opening Linktree…',
    stopped: 'Stopped',
    blocked: 'Login required — open Instagram and log in',
    exhausted: 'No more results',
    done: ''
  };

  var activeSource = 'instagram';
  var searchStates = { auto: null, maps: null };

  function updateSourceUI() {
    if (!els.srcInstagram) return;
    els.srcInstagram.classList.toggle('active', activeSource === 'instagram');
    els.srcMaps.classList.toggle('active', activeSource === 'maps');
    if (document.activeElement !== els.autoQuery) {
      els.autoQuery.placeholder = activeSource === 'maps'
        ? 'e.g. medspa in dubai\nbeauty salon in abu dhabi'
        : 'e.g. salon london\nnail bar\nbrow studio';
    }
  }

  function setSource(source) {
    if (activeSource === source) return;
    activeSource = source;
    updateSourceUI();
    saveSettingsPatch({ autoSearchSource: source }).then(function () {
      showToast(source === 'maps' ? 'Source: Google Maps' : 'Source: Instagram');
    });
  }

  function renderAutoSearch(s, settings) {
    s = s || {};
    var queries = Array.isArray(s.queries) && s.queries.length ? s.queries : (s.query ? [s.query] : []);
    if (document.activeElement !== els.autoQuery) {
      els.autoQuery.value = queries.length > 1
        ? queries.join('\n')
        : (s.query || settings.autoSearchQuery || '');
    }
    if (document.activeElement !== els.autoTarget) {
      var t = Number(s.active ? s.target : settings.autoSearchTarget);
      if (!isFinite(t) || t < 1) t = 30;
      if (t > 500) t = 500;
      els.autoTarget.value = String(t);
    }

    var active = !!s.active;
    els.btnAutoStart.hidden = active;
    els.btnAutoStop.hidden = !active;

    var collected = typeof s.collected === 'number' ? s.collected : 0;
    var total = typeof s.totalCollected === 'number' ? s.totalCollected : collected;
    var target = Number(s.target) || Number(settings.autoSearchTarget) || 30;
    var termCount = queries.length;
    var termPos = (Number(s.queryIndex) || 0) + 1;
    var denominator = termCount > 1 ? target * termCount : target;
    var pct = denominator > 0 ? Math.min(100, Math.round(((termCount > 1 ? total : collected) / denominator) * 100)) : 0;
    els.autoBar.style.width = pct + '%';

    if (s.phase === 'done') {
      els.autoStatus.textContent = termCount > 1
        ? 'Done — ' + termCount + ' terms, ' + total + ' leads collected'
        : 'Done — ' + collected + ' / ' + target + ' leads collected';
      return;
    }
    var base = AUTO_PHASE_TEXT[s.phase] || (s.message || 'Idle');
    if (active && s.phase && AUTO_PHASE_TEXT[s.phase]) {
      els.autoStatus.textContent = base + ' · ' + collected + ' / ' + target +
        (termCount > 1 ? ' · term ' + termPos + '/' + termCount + ' · total ' + total : '');
    } else {
      els.autoStatus.textContent = s.message || base;
    }
  }

  function render(snapshot, autoSearch, mapsSearch) {
    searchStates.auto = autoSearch || null;
    searchStates.maps = mapsSearch || null;
    renderStats(snapshot.statistics || {});
    renderStatus(snapshot.settings || {});
    renderSettings(snapshot.settings || {});
    var settings = snapshot.settings || {};
    var picked = autoSearch && autoSearch.active ? autoSearch
      : (mapsSearch && mapsSearch.active ? mapsSearch
        : (settings.autoSearchSource === 'maps' ? mapsSearch : autoSearch));
    renderAutoSearch(picked, settings);
  }

  function refresh() {
    return Promise.all([Storage.getSnapshot(), Storage.getAutoSearch(), Storage.getMapsSearch()]).then(function (parts) {
      render(parts[0], parts[1], parts[2]);
    }).catch(function (err) {
      if (Log) Log.error('Popup', 'snapshot failed:', err && err.message);
      showToast('Could not read local data', true);
    });
  }

  function saveSettingsPatch(patch) {
    return Storage.saveSettings(patch).then(function (settings) {
      renderStatus(settings);
      renderSettings(settings);
    }).catch(function (err) {
      if (Log) Log.error('Popup', 'settings save failed:', err && err.message);
      showToast('Settings not saved', true);
    });
  }

  function wire() {
    els.statScanned = $('statScanned');
    els.statBusinesses = $('statBusinesses');
    els.statWithWebsite = $('statWithWebsite');
    els.statWithoutWebsite = $('statWithoutWebsite');
    els.statSaved = $('statSaved');
    els.statDuplicates = $('statDuplicates');
    els.statusDot = $('statusDot');
    els.statusText = $('statusText');
    els.statusHint = $('statusHint');
    els.btnPause = $('btnPause');
    els.btnExcel = $('btnExcel');
    els.btnCsv = $('btnCsv');
    els.btnClear = $('btnClear');
    els.btnDashboard = $('btnDashboard');
    els.thresholdRange = $('thresholdRange');
    els.thresholdInput = $('thresholdInput');
    els.toggleAutoScan = $('toggleAutoScan');
    els.toggleSaveEmail = $('toggleSaveEmail');
    els.toggleSavePhone = $('toggleSavePhone');
    els.inputCountryCode = $('inputCountryCode');
    els.toggleDebug = $('toggleDebug');
    els.autoQuery = $('autoQuery');
    els.autoTarget = $('autoTarget');
    els.btnAutoStart = $('btnAutoStart');
    els.btnAutoStop = $('btnAutoStop');
    els.autoStatus = $('autoStatus');
    els.autoBar = $('autoBar');
    els.srcInstagram = $('srcInstagram');
    els.srcMaps = $('srcMaps');
    els.toast = $('toast');

    els.srcInstagram.addEventListener('click', function () { setSource('instagram'); });
    els.srcMaps.addEventListener('click', function () { setSource('maps'); });

    els.btnAutoStart.addEventListener('click', function () {
      var query = els.autoQuery.value.trim();
      var target = parseInt(els.autoTarget.value, 10);
      if (!isFinite(target) || target < 1) target = 30;
      if (target > 500) target = 500;
      if (!query) {
        showToast('Enter a search term first', true);
        return;
      }
      var source = activeSource;
      var startType = source === 'maps' ? 'MAPS_START' : 'AUTOSEARCH_START';
      els.btnAutoStart.disabled = true;
      chrome.runtime.sendMessage({ type: startType, payload: { query: query, target: target } }, function (res) {
        void chrome.runtime.lastError;
        els.btnAutoStart.disabled = false;
        if (!res || !res.started) {
          showToast(source === 'maps' ? 'Could not start Maps search' : 'Could not start auto search', true);
          return;
        }
        if (source === 'maps') {
          showToast(res.terms > 1
            ? 'Maps search started — ' + res.terms + ' terms'
            : 'Google Maps search started');
        } else {
          showToast(res.terms > 1
            ? 'Auto search started — ' + res.terms + ' terms, kept separate per lead'
            : 'Auto search started');
        }
        refresh();
      });
    });

    els.btnAutoStop.addEventListener('click', function () {
      var type;
      if (searchStates.auto && searchStates.auto.active) type = 'AUTOSEARCH_STOP';
      else if (searchStates.maps && searchStates.maps.active) type = 'MAPS_STOP';
      else type = activeSource === 'maps' ? 'MAPS_STOP' : 'AUTOSEARCH_STOP';
      chrome.runtime.sendMessage({ type: type }, function (res) {
        void chrome.runtime.lastError;
        showToast(res && res.stopped ? 'Search stopped' : 'Could not stop', !res);
        refresh();
      });
    });

    els.btnPause.addEventListener('click', function () {
      Storage.getSettings().then(function (settings) {
        var next = settings.scannerActive === false;
        return saveSettingsPatch({ scannerActive: next });
      }).then(function () {
        Storage.getSettings().then(function (s) {
          showToast(s.scannerActive === false ? 'Scanner paused' : 'Scanner resumed');
        });
      });
    });

    els.btnExcel.addEventListener('click', function () {
      els.btnExcel.disabled = true;
      Storage.getLeads().then(function (leads) {
        if (!leads.length) {
          showToast('No leads to export yet');
          return null;
        }
        var result = ExcelExport.exportExcel(leads);
        if (result.ok) showToast('Exported ' + result.rows + ' leads');
        else showToast('Export failed: ' + result.error, true);
      }).catch(function (err) {
        showToast('Export failed: ' + (err && err.message), true);
      }).then(function () {
        els.btnExcel.disabled = false;
      });
    });

    els.btnCsv.addEventListener('click', function () {
      els.btnCsv.disabled = true;
      Storage.getLeads().then(function (leads) {
        if (!leads.length) {
          showToast('No leads to export yet');
          return null;
        }
        var result = CsvExport.exportCsv(leads);
        if (result.ok) showToast('Exported ' + result.rows + ' leads');
        else showToast('Export failed: ' + result.error, true);
      }).catch(function (err) {
        showToast('Export failed: ' + (err && err.message), true);
      }).then(function () {
        els.btnCsv.disabled = false;
      });
    });

    els.btnClear.addEventListener('click', function () {
      var confirmed = window.confirm('Clear all collected leads and reset statistics? This cannot be undone.');
      if (!confirmed) return;
      chrome.runtime.sendMessage({ type: 'CLEAR_LEADS' }, function () {
        if (chrome.runtime.lastError) {
          showToast('Could not clear leads', true);
          return;
        }
        showToast('Leads cleared');
        refresh();
      });
    });

    els.btnDashboard.addEventListener('click', function () {
      var url = chrome.runtime.getURL('src/dashboard/dashboard.html');
      chrome.tabs.create({ url: url });
    });

    function thresholdFromInputs(source) {
      var raw = source.value;
      var value = parseInt(raw, 10);
      if (!isFinite(value)) value = 70;
      if (value < 0) value = 0;
      if (value > 100) value = 100;
      saveSettingsPatch({ businessConfidenceThreshold: value });
    }

    els.thresholdRange.addEventListener('change', function () { thresholdFromInputs(els.thresholdRange); });
    els.thresholdInput.addEventListener('change', function () { thresholdFromInputs(els.thresholdInput); });

    els.toggleAutoScan.addEventListener('change', function () {
      saveSettingsPatch({ autoScan: els.toggleAutoScan.checked });
    });
    els.toggleSaveEmail.addEventListener('change', function () {
      saveSettingsPatch({ saveEmail: els.toggleSaveEmail.checked });
    });
    els.toggleSavePhone.addEventListener('change', function () {
      saveSettingsPatch({ savePhone: els.toggleSavePhone.checked });
    });
    els.inputCountryCode.addEventListener('change', function () {
      var cc = String(els.inputCountryCode.value || '').replace(/\D/g, '').slice(0, 3);
      els.inputCountryCode.value = cc;
      saveSettingsPatch({ defaultCountryCode: cc }).then(function () {
        showToast(cc
          ? 'Country code saved — run "Fix numbers" in the dashboard to re-apply'
          : 'Country code cleared');
      });
    });
    els.toggleDebug.addEventListener('change', function () {
      saveSettingsPatch({ debug: els.toggleDebug.checked }).then(function () {
        if (Log) Log.setEnabled(els.toggleDebug.checked);
        showToast(els.toggleDebug.checked ? 'Debug logging on' : 'Debug logging off');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire();
    refresh();
    Storage.onChanged(function () { refresh(); });
    setInterval(function () {
      chrome.runtime.sendMessage({ type: 'FLUSH_STATS' }, function () {
        void chrome.runtime.lastError;
      });
    }, 4000);
  });
})();
