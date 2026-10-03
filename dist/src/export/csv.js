(function (root) {
  'use strict';

  var Log = root.FicinoLog;
  var N = root.FicinoNormalizer;

  function csvEscape(value) {
    var str = value === undefined || value === null ? '' : String(value);
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function toCsv(leads, templates) {
    var columns = root.FicinoExcelExport ? root.FicinoExcelExport.COLUMNS : [];
    var header = columns.map(function (c) { return csvEscape(c.header); }).join(',');
    var lines = [header];
    (leads || []).forEach(function (lead) {
      var row = columns.map(function (col) {
        var value;
        if (root.FicinoExcelExport && root.FicinoExcelExport.leadValue) {
          value = root.FicinoExcelExport.leadValue(lead, col.key, templates);
        } else if (col.key === 'phone') {
          value = lead.phone_raw || lead.phone_normalized || '';
        } else {
          value = lead[col.key] === undefined || lead[col.key] === null ? '' : lead[col.key];
        }
        return csvEscape(value);
      });
      lines.push(row.join(','));
    });
    return lines.join('\r\n');
  }

  function exportCsv(leads, timestamp, templates) {
    try {
      var csv = toCsv(leads, templates);
      var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      var stamp = timestamp || N.exportTimestamp(new Date());
      var filename = 'instagram_business_leads_' + stamp + '.csv';

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

      if (Log && Log.isEnabled()) Log.debug('Export', 'CSV export complete:', filename, '(' + (leads || []).length + ' rows)');
      return { ok: true, filename: filename, rows: (leads || []).length };
    } catch (err) {
      if (Log) Log.error('Export', 'CSV export failed:', err && err.message);
      return { ok: false, error: err && err.message ? err.message : 'unknown error' };
    }
  }

  root.FicinoCsvExport = {
    csvEscape: csvEscape,
    toCsv: toCsv,
    exportCsv: exportCsv
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
