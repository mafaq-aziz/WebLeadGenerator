(function () {
  'use strict';

  var Log = window.FicinoLog;
  var Storage = window.FicinoStorage;
  var ExcelExport = window.FicinoExcelExport;
  var CsvExport = window.FicinoCsvExport;
  var Templates = window.FicinoTemplates;
  var STATUS_VALUES = (window.FicinoSelectors && window.FicinoSelectors.STATUS_VALUES) ||
    ['New', 'Reviewed', 'Contacted', 'Ignore'];

  var state = {
    leads: [],
    filter: 'all',
    query: '',
    sort: 'date_desc',
    selected: Object.create(null),
    toastTimer: null,
    templates: { wa: '', ig: '' },
    outreachChannel: 'whatsapp',
    outreach: null,
    prevOutreachState: null,
    audioCtx: null
  };

  var els = {};

  function $(id) { return document.getElementById(id); }

  function showToast(message, isError) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('error', !!isError);
    els.toast.hidden = false;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { els.toast.hidden = true; }, 2600);
  }

  function confidenceClass(score) {
    if (score >= 81) return 'high';
    if (score >= 61) return 'medium';
    return 'low';
  }

  function matchesQuery(lead, query) {
    if (!query) return true;
    var haystack = [
      lead.instagram_name, lead.instagram_username, lead.bio, lead.category,
      lead.phone_raw, lead.phone_normalized, lead.email, lead.location, lead.notes
    ].join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function matchesFilter(lead) {
    var score = Number(lead.confidence) || 0;
    switch (state.filter) {
      case 'high': return score >= 70;
      case 'medium': return score >= 40 && score < 70;
      case 'phone': return !!(lead.phone_normalized || lead.phone_raw);
      case 'phone_issue': return !!lead.phone_issue;
      case 'email': return !!lead.email;
      case 'ignored': return lead.status === 'Ignore';
      default: return true;
    }
  }

  function sortLeads(list) {
    var copy = list.slice();
    var byDate = function (a, b) {
      return String(a.date_found || '').localeCompare(String(b.date_found || ''));
    };
    switch (state.sort) {
      case 'date_asc': return copy.sort(byDate);
      case 'date_desc': return copy.sort(function (a, b) { return byDate(b, a); });
      case 'confidence_desc':
        return copy.sort(function (a, b) { return (Number(b.confidence) || 0) - (Number(a.confidence) || 0); });
      case 'confidence_asc':
        return copy.sort(function (a, b) { return (Number(a.confidence) || 0) - (Number(b.confidence) || 0); });
      case 'name_asc':
        return copy.sort(function (a, b) {
          return String(a.instagram_name || '').toLowerCase().localeCompare(String(b.instagram_name || '').toLowerCase());
        });
      case 'username_asc':
        return copy.sort(function (a, b) {
          return String(a.instagram_username || '').toLowerCase().localeCompare(String(b.instagram_username || '').toLowerCase());
        });
      default: return copy;
    }
  }

  function visibleLeads() {
    var query = state.query.trim().toLowerCase();
    return sortLeads(state.leads.filter(function (lead) {
      return matchesFilter(lead) && matchesQuery(lead, query);
    }));
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    var list = visibleLeads();

    els.leadCount.textContent = state.leads.length + (state.leads.length === 1 ? ' lead' : ' leads');
    var selCount = selectedIds().length;
    els.selectedCount.textContent = selCount + (selCount === 1 ? ' lead selected' : ' leads selected');
    els.emptyState.hidden = state.leads.length !== 0;
    els.noMatchState.hidden = !(state.leads.length > 0 && list.length === 0);

    if (!list.length) {
      els.leadRows.innerHTML = '';
      els.checkAll.checked = false;
      return;
    }

    var html = list.map(function (lead) {
      var score = Number(lead.confidence) || 0;
      var selected = state.selected[lead.id] ? 'checked' : '';
      var statusOptions = STATUS_VALUES.map(function (status) {
        var sel = (lead.status || 'New') === status ? ' selected' : '';
        return '<option value="' + escapeHtml(status) + '"' + sel + '>' + escapeHtml(status) + '</option>';
      }).join('');
      var phone = lead.phone_raw || lead.phone_normalized || '—';
      var phoneCell = escapeHtml(phone);
      if (lead.phone_issue) {
        phoneCell = '<span class="phone-flag" title="Unverified phone (' + escapeHtml(lead.phone_issue) + ') — click the pencil to fix">⚠</span> ' +
          phoneCell + ' <button class="icon-btn fix-phone-btn" data-id="' + escapeHtml(lead.id) + '" title="Set the correct number">✎</button>';
      } else if (lead.phone_replaced_raw && lead.phone_normalized) {
        phoneCell += ' <span class="phone-corrected" title="Auto-corrected from ' +
          escapeHtml(lead.phone_replaced_raw) + ' to match the profile bio">↻</span>';
      }
      var name = lead.instagram_name || lead.instagram_username;
      var url = lead.instagram_url || ('https://www.instagram.com/' + lead.instagram_username + '/');

      return '' +
        '<tr data-id="' + escapeHtml(lead.id) + '">' +
          '<td class="col-check"><input type="checkbox" class="row-check" data-id="' + escapeHtml(lead.id) + '"' + selected + ' /></td>' +
          '<td>' +
            '<div class="cell-name">' + escapeHtml(name) + '</div>' +
            (lead.category ? '<div class="cell-sub">' + escapeHtml(lead.category) + '</div>' : '') +
            (lead.bio ? '<div class="cell-bio">' + escapeHtml(lead.bio) + '</div>' : '') +
          '</td>' +
          '<td><a class="cell-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">@' + escapeHtml(lead.instagram_username) + '</a></td>' +
          '<td' + (lead.phone_issue ? ' class="phone-bad"' : '') + '>' + phoneCell + '</td>' +
          '<td>' + escapeHtml(lead.email || '—') + '</td>' +
          '<td>' + escapeHtml(lead.location || '—') + '</td>' +
          '<td class="num"><span class="badge ' + confidenceClass(score) + '">' + score + '</span></td>' +
          '<td>' + escapeHtml(lead.date_found || '') + '</td>' +
          '<td><select class="status-select" data-id="' + escapeHtml(lead.id) + '">' + statusOptions + '</select></td>' +
          '<td><input class="notes-input" data-id="' + escapeHtml(lead.id) + '" value="' + escapeHtml(lead.notes || '') + '" placeholder="Notes" /></td>' +
          '<td><button class="icon-btn delete-btn" data-id="' + escapeHtml(lead.id) + '" title="Delete lead">✕</button></td>' +
        '</tr>';
    }).join('');

    els.leadRows.innerHTML = html;

    var allChecked = list.every(function (lead) { return state.selected[lead.id]; });
    els.checkAll.checked = allChecked && list.length > 0;
  }

  function loadLeads() {
    return Storage.getLeads().then(function (leads) {
      state.leads = leads || [];
      render();
    }).catch(function (err) {
      if (Log) Log.error('Dashboard', 'load failed:', err && err.message);
      showToast('Could not load leads', true);
    });
  }

  function sendMessage(payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(payload, function (response) {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function selectedIds() {
    return Object.keys(state.selected).filter(function (id) { return state.selected[id]; });
  }

  function exportLeads(leads, kind, skipNote) {
    if (!leads.length) {
      showToast('No leads to export');
      return false;
    }
    var result = kind === 'csv'
      ? CsvExport.exportCsv(leads, undefined, state.templates)
      : ExcelExport.exportExcel(leads, undefined, state.templates);
    if (result.ok) {
      showToast('Exported ' + result.rows + ' leads' + (skipNote || ''));
      return true;
    }
    showToast('Export failed: ' + result.error, true);
    return false;
  }

  function ensureAudio() {
    if (!state.audioCtx && typeof AudioContext !== 'undefined') {
      try {
        state.audioCtx = new AudioContext();
      } catch (e) {
        state.audioCtx = null;
      }
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      try { state.audioCtx.resume(); } catch (e) { /* ignore */ }
    }
    return state.audioCtx;
  }

  function beep() {
    try {
      var ctx = ensureAudio();
      if (!ctx) return;
      var start = ctx.currentTime;
      [0, 0.3, 0.6].forEach(function (offset) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start + offset);
        osc.stop(start + offset + 0.25);
      });
    } catch (e) { /* ignore */ }
  }

  function outreachStatusText(outreach) {
    if (!outreach || outreach.state === 'idle') return '';
    if (outreach.state === 'running') return outreach.message || 'Preparing drafts…';
    if (outreach.state === 'done') {
      return 'Drafts ready: ' + (outreach.prepared || []).length + ' prepared' +
        ((outreach.failed || []).length ? ', ' + outreach.failed.length + ' failed' : '');
    }
    if (outreach.state === 'interrupted') return 'Interrupted — press Prepare to restart';
    return outreach.state || '';
  }

  function updateOutreachUI(outreach) {
    state.outreach = outreach;
    var status = $('outreachStatus');
    if (status) status.textContent = outreachStatusText(outreach);
    var stopBtn = $('btnStopOutreach');
    if (stopBtn) stopBtn.hidden = !(outreach && outreach.state === 'running');
    var prepBtn = $('btnPrepare');
    if (prepBtn) prepBtn.disabled = !!(outreach && outreach.state === 'running');
    var banner = $('outreachBanner');
    if (banner) {
      var show = !!(outreach && outreach.state === 'done' && !outreach.dismissed);
      banner.hidden = !show;
      if (show) {
        $('outreachBannerText').textContent = outreach.channel === 'instagram'
          ? 'Instagram: ' + (outreach.prepared || []).length +
            ' message(s) typed and sent automatically. Check your DMs.'
          : 'All drafts are ready — WhatsApp: ' + (outreach.prepared || []).length +
            ' tabs prefilled. Send them one by one with Enter.';
      }
    }
  }

  function loadOutreach() {
    if (!Storage.getOutreach) return Promise.resolve();
    return Storage.getOutreach().then(function (outreach) {
      var previous = state.prevOutreachState;
      updateOutreachUI(outreach);
      state.prevOutreachState = outreach ? outreach.state : null;
      if (outreach && outreach.state === 'done' && previous !== 'done') beep();
      return outreach;
    }).catch(function () { /* ignore */ });
  }

  function wire() {
    els.leadRows = $('leadRows');
    els.leadCount = $('leadCount');
    els.selectedCount = $('selectedCount');
    els.emptyState = $('emptyState');
    els.noMatchState = $('noMatchState');
    els.searchInput = $('searchInput');
    els.sortSelect = $('sortSelect');
    els.checkAll = $('checkAll');
    els.toast = $('toast');

    var searchTimer = null;
    els.searchInput.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = els.searchInput.value;
        render();
      }, 160);
    });

    els.sortSelect.addEventListener('change', function () {
      state.sort = els.sortSelect.value;
      render();
    });

    $('filters').addEventListener('click', function (event) {
      var target = event.target.closest('.chip');
      if (!target) return;
      state.filter = target.getAttribute('data-filter');
      Array.prototype.forEach.call(document.querySelectorAll('#filters .chip'), function (chip) {
        chip.classList.toggle('active', chip === target);
      });
      render();
    });

    els.checkAll.addEventListener('change', function () {
      var list = visibleLeads();
      list.forEach(function (lead) {
        if (els.checkAll.checked) state.selected[lead.id] = true;
        else delete state.selected[lead.id];
      });
      render();
    });

    $('btnSelectAll').addEventListener('click', function () {
      visibleLeads().forEach(function (lead) { state.selected[lead.id] = true; });
      render();
    });

    els.leadRows.addEventListener('change', function (event) {
      var target = event.target;
      var id = target.getAttribute && target.getAttribute('data-id');
      if (!id) return;

      if (target.classList.contains('row-check')) {
        if (target.checked) state.selected[id] = true;
        else delete state.selected[id];
        render();
        return;
      }

      if (target.classList.contains('status-select')) {
        sendMessage({ type: 'UPDATE_LEAD', payload: { id: id, status: target.value } }).then(function (response) {
          if (!response || !response.updated) {
            showToast('Status not saved', true);
            return;
          }
          state.leads = state.leads.map(function (lead) {
            if (lead.id === id) lead.status = target.value;
            return lead;
          });
          showToast('Status updated');
        });
        return;
      }

      if (target.classList.contains('notes-input')) {
        sendMessage({ type: 'UPDATE_LEAD', payload: { id: id, notes: target.value } }).then(function (response) {
          if (!response || !response.updated) {
            showToast('Notes not saved', true);
            return;
          }
          state.leads = state.leads.map(function (lead) {
            if (lead.id === id) lead.notes = target.value;
            return lead;
          });
          showToast('Notes saved');
        });
      }
    });

    els.leadRows.addEventListener('click', function (event) {
      var fixButton = event.target.closest('.fix-phone-btn');
      if (fixButton) {
        var fixId = fixButton.getAttribute('data-id');
        var fixLead = state.leads.filter(function (lead) { return lead.id === fixId; })[0];
        var current = fixLead ? (fixLead.phone_raw || fixLead.phone_normalized || '') : '';
        var entered = window.prompt('Enter the full number with country code (e.g. +971501234567):', current);
        if (entered === null) return;
        entered = entered.trim();
        if (!entered) return;
        sendMessage({ type: 'SET_PHONE', payload: { id: fixId, phone_raw: entered } }).then(function (response) {
          if (!response || !response.ok) {
            showToast('Number not saved' + (response && response.reason ? ': ' + response.reason : ''), true);
            return;
          }
          loadLeads().then(function () { showToast('Number updated'); });
        });
        return;
      }
      var button = event.target.closest('.delete-btn');
      if (!button) return;
      var id = button.getAttribute('data-id');
      sendMessage({ type: 'UPDATE_LEAD', payload: { id: id, delete: true } }).then(function (response) {
        if (!response || !response.updated) {
          showToast('Could not delete lead', true);
          return;
        }
        delete state.selected[id];
        state.leads = state.leads.filter(function (lead) { return lead.id !== id; });
        render();
        showToast('Lead deleted');
      });
    });

    $('btnExportSelected').addEventListener('click', function () {
      var ids = selectedIds();
      if (!ids.length) {
        showToast('Select at least one lead');
        return;
      }
      var leads = state.leads.filter(function (lead) { return state.selected[lead.id]; });
      exportLeads(leads, 'xlsx');
    });

    $('btnExportAll').addEventListener('click', function () {
      var exportable = state.leads;
      var skipNote = '';
      if (Templates && Templates.exportable) {
        var before = state.leads.length;
        exportable = Templates.exportable(state.leads);
        var skipped = before - exportable.length;
        if (skipped > 0) skipNote = ' (' + skipped + ' ignored excluded)';
      }
      exportLeads(exportable, 'xlsx', skipNote);
    });

    $('btnClearAll').addEventListener('click', function () {
      if (!state.leads.length) {
        showToast('No leads to clear');
        return;
      }
      if (!window.confirm('Delete all ' + state.leads.length + ' leads and reset statistics?')) return;
      sendMessage({ type: 'CLEAR_LEADS' }).then(function (response) {
        if (!response || !response.cleared) {
          showToast('Could not clear leads', true);
          return;
        }
        state.selected = Object.create(null);
        loadLeads().then(function () { showToast('All leads cleared'); });
      });
    });

    $('btnFlagInfluencers').addEventListener('click', function () {
      sendMessage({ type: 'FLAG_INFLUENCERS' }).then(function (response) {
        if (!response || !response.ok) {
          showToast('Could not flag influencers', true);
          return;
        }
        loadLeads().then(function () {
          if (response.flagged || response.restored) {
            showToast('Flagged ' + response.flagged + ' influencers' +
              (response.restored ? ', restored ' + response.restored : ''));
          } else {
            showToast('No influencers found among ' + response.total + ' leads');
          }
        });
      });
    });

    $('btnFixPhones').addEventListener('click', function () {
      sendMessage({ type: 'CLEAN_PHONES' }).then(function (response) {
        if (!response || !response.ok) {
          showToast('Could not check numbers', true);
          return;
        }
        loadLeads().then(function () {
          showToast('Phone check: ' + (response.corrected || 0) + ' corrected from the profile, ' +
            response.flagged + ' flagged, ' + response.valid + ' verified');
        });
      });
    });

    var channelWrap = $('outreachChannels');
    channelWrap.addEventListener('click', function (event) {
      var target = event.target.closest('.chip');
      if (!target) return;
      state.outreachChannel = target.getAttribute('data-channel');
      Array.prototype.forEach.call(channelWrap.querySelectorAll('.chip'), function (chip) {
        chip.classList.toggle('active', chip === target);
      });
    });

    $('btnPrepare').addEventListener('click', function () {
      var ids = selectedIds();
      if (!ids.length) {
        showToast('Select at least one lead');
        return;
      }
      ensureAudio();
      sendMessage({
        type: 'OUTREACH_START',
        payload: { channel: state.outreachChannel, ids: ids }
      }).then(function (response) {
        if (!response || !response.started) {
          var reason = (response && response.reason) || 'service worker unavailable';
          showToast('Could not start: ' + reason, true);
          return;
        }
        showToast('Preparing drafts…');
        loadOutreach();
      });
    });

    $('btnStopOutreach').addEventListener('click', function () {
      sendMessage({ type: 'OUTREACH_STOP' }).then(function (response) {
        if (!response || !response.stopped) {
          showToast('Nothing to stop', true);
          return;
        }
        showToast('Outreach stopped — ' + response.prepared + ' draft(s) already open');
        loadOutreach();
      });
    });

    $('btnMarkContacted').addEventListener('click', function () {
      if (!Storage.getOutreach) {
        showToast('Outreach unavailable', true);
        return;
      }
      Storage.getOutreach().then(function (outreach) {
        var prepared = (outreach && outreach.prepared) || [];
        if (!prepared.length) {
          showToast('No prepared drafts');
          return;
        }
        return prepared.reduce(function (chain, item) {
          return chain.then(function () {
            return sendMessage({ type: 'UPDATE_LEAD', payload: { id: item.id, status: 'Contacted' } });
          });
        }, Promise.resolve()).then(function () {
          return loadLeads();
        }).then(function () {
          showToast(prepared.length + ' leads marked Contacted');
        });
      });
    });

    $('btnSaveTpl').addEventListener('click', function () {
      if (!Storage.setOutreach) {
        showToast('Outreach unavailable', true);
        return;
      }
      state.templates = { wa: $('tplWa').value, ig: $('tplIg').value };
      Storage.setOutreach({ waTemplate: state.templates.wa, igTemplate: state.templates.ig })
        .then(function () { showToast('Messages saved'); })
        .catch(function () { showToast('Could not save messages', true); });
    });

    $('btnDismissOutreach').addEventListener('click', function () {
      if (!Storage.setOutreach) return;
      Storage.setOutreach({ dismissed: true }).then(function () {
        updateOutreachUI(Object.assign({}, state.outreach, { dismissed: true }));
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire();
    loadLeads();
    Storage.getSettings().then(function (settings) {
      var runClean = !settings || settings.phoneCleanupVersion !== 1;
      var runPermits = !settings || settings.permitExcludeVersion !== 2;
      if (!runClean && !runPermits) return null;
      var messages = [];
      var clean = runClean
        ? sendMessage({ type: 'CLEAN_PHONES' }).then(function (response) {
            if (response && response.ok) {
              messages.push('Phone check: ' + (response.corrected || 0) + ' corrected from the profile, ' +
                response.flagged + ' flagged — review ⚠ cells');
            }
          })
        : Promise.resolve();
      return clean.then(function () {
        if (!runPermits) return null;
        return sendMessage({ type: 'EXCLUDE_PERMITS' }).then(function (response) {
          if (response && response.ok && response.matched) {
            messages.push(response.matched + ' permit lead(s) excluded as influencer-style');
          }
        });
      }).then(function () {
        if (!messages.length) return null;
        return loadLeads().then(function () {
          showToast(messages.join(' · '));
        });
      });
    }).catch(function () { /* ignore */ });
    Storage.onChanged(function (changes) {
      if (changes.leads) loadLeads();
      if (changes.outreach) {
        var outreach = (changes.outreach && changes.outreach.newValue) || null;
        var previous = state.prevOutreachState;
        updateOutreachUI(outreach);
        state.prevOutreachState = outreach ? outreach.state : null;
        if (outreach && outreach.state === 'done' && previous !== 'done') beep();
      }
    });
    if (Storage.getOutreach) {
      Storage.getOutreach().then(function (outreach) {
        var defaults = (Templates && Templates.defaults) || { wa: '', ig: '' };
        state.templates = {
          wa: (outreach && outreach.waTemplate) || defaults.wa,
          ig: (outreach && outreach.igTemplate) || defaults.ig
        };
        $('tplWa').value = state.templates.wa;
        $('tplIg').value = state.templates.ig;
        updateOutreachUI(outreach);
        state.prevOutreachState = outreach ? outreach.state : null;
      }).catch(function () { /* ignore */ });
    }
  });
})();
