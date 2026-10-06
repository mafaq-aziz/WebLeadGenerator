(function (root) {
  'use strict';

  var Log = root.FicinoLog;
  var N = root.FicinoNormalizer;

  var COLUMNS = [
    { key: 'instagram_username', header: 'Instagram Username' },
    { key: 'instagram_name', header: 'Business Name' },
    { key: 'instagram_url', header: 'Instagram URL' },
    { key: 'bio', header: 'Bio' },
    { key: 'category', header: 'Category' },
    { key: 'phone', header: 'Phone' },
    { key: 'email', header: 'Email' },
    { key: 'website', header: 'Website' },
    { key: 'location', header: 'Location' },
    { key: 'followers', header: 'Followers' },
    { key: 'source_page', header: 'Source Page' },
    { key: 'search_term', header: 'Search Term' },
    { key: 'date_found', header: 'Date Found' },
    { key: 'confidence', header: 'Business Confidence' },
    { key: 'status', header: 'Status' },
    { key: 'notes', header: 'Notes' },
    { key: 'wa_message', header: 'WhatsApp Message' },
    { key: 'ig_message', header: 'Instagram Message' }
  ];

  function templatesFor(templates) {
    var T = root.FicinoTemplates;
    var defaults = (T && T.defaults) || { wa: '', ig: '' };
    return {
      wa: (templates && templates.wa) || defaults.wa,
      ig: (templates && templates.ig) || defaults.ig
    };
  }

  function leadValue(lead, key, templates) {
    switch (key) {
      case 'phone':
        return lead.phone_raw || lead.phone_normalized || '';
      case 'wa_message':
        return root.FicinoTemplates ? root.FicinoTemplates.render(templatesFor(templates).wa, lead) : '';
      case 'ig_message':
        return root.FicinoTemplates ? root.FicinoTemplates.render(templatesFor(templates).ig, lead) : '';
      default:
        return lead[key] === undefined || lead[key] === null ? '' : lead[key];
    }
  }

  function toRows(leads, templates) {
    return (leads || []).map(function (lead) {
      var row = {};
      COLUMNS.forEach(function (col) {
        row[col.header] = leadValue(lead, col.key, templates);
      });
      return row;
    });
  }

  function buildWorkbook(leads, templates) {
    if (typeof XLSX === 'undefined') {
      throw new Error('XLSX library is not loaded');
    }
    var rows = toRows(leads, templates);
    var worksheet = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map(function (c) { return c.header; }) });
    worksheet['!cols'] = COLUMNS.map(function (col) {
      var width = 18;
      if (col.key === 'bio') width = 50;
      if (col.key === 'instagram_url' || col.key === 'source_page') width = 38;
      if (col.key === 'notes') width = 30;
      if (col.key === 'wa_message' || col.key === 'ig_message') width = 60;
      return { wch: width };
    });
    var workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
    return workbook;
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () {
      try { document.body.removeChild(anchor); } catch (e) { /* ignore */ }
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    }, 1500);
  }

  function exportExcel(leads, timestamp, templates) {
    try {
      var workbook = buildWorkbook(leads, templates);
      var data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      var blob = new Blob([data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      var stamp = timestamp || N.exportTimestamp(new Date());
      var filename = 'instagram_business_leads_' + stamp + '.xlsx';
      triggerDownload(blob, filename);
      if (Log && Log.isEnabled()) Log.debug('Export', 'Excel export complete:', filename, '(' + (leads || []).length + ' rows)');
      return { ok: true, filename: filename, rows: (leads || []).length };
    } catch (err) {
      if (Log) Log.error('Export', 'Excel export failed:', err && err.message);
      return { ok: false, error: err && err.message ? err.message : 'unknown error' };
    }
  }

  root.FicinoExcelExport = {
    COLUMNS: COLUMNS,
    leadValue: leadValue,
    toRows: toRows,
    buildWorkbook: buildWorkbook,
    exportExcel: exportExcel
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
