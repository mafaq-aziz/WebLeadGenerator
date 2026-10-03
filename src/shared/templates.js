(function (root) {
  'use strict';

  var DEFAULT_TEMPLATES = {
    wa: 'Hi {name}! We help businesses like yours get more clients through Instagram content. Worth a quick chat?',
    ig: 'Hi {name}! Love your page — we help businesses like yours grow on Instagram. Open to a quick chat?'
  };

  function placeholderValues(lead) {
    var l = lead || {};
    var username = String(l.instagram_username || '').replace(/^@/, '');
    return {
      username: username,
      name: String(l.instagram_name || '').trim() || username,
      category: String(l.category || '').trim(),
      location: String(l.location || '').trim(),
      followers: String(l.followers || '').trim(),
      phone: String(l.phone_normalized || l.phone_raw || '').trim()
    };
  }

  function render(template, lead) {
    var text = String(template === undefined || template === null ? '' : template);
    var values = placeholderValues(lead);
    return text.replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
    });
  }

  function waPhoneDigits(lead) {
    var l = lead || {};
    var raw = String(l.phone_normalized || l.phone_raw || '');
    var digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    digits = digits.replace(/^00/, '');
    if (digits.charAt(0) === '0') digits = digits.slice(1);
    return digits.length >= 7 ? digits : '';
  }

  function waSendUrl(lead, text) {
    var phone = waPhoneDigits(lead);
    if (!phone) return '';
    var message = text === undefined || text === null ? '' : String(text);
    var url = 'https://web.whatsapp.com/send?phone=' + phone;
    if (message) url += '&text=' + encodeURIComponent(message);
    return url;
  }

  function igSendUrl(lead) {
    var l = lead || {};
    var username = String(l.instagram_username || '').trim().replace(/^@/, '');
    if (!username) return '';
    return 'https://www.instagram.com/direct/new/?to=' + encodeURIComponent(username);
  }

  function isIgnored(lead) {
    return !!(lead && lead.status === 'Ignore');
  }

  function exportable(leads) {
    return (leads || []).filter(function (lead) { return !isIgnored(lead); });
  }

  root.FicinoTemplates = {
    DEFAULT_TEMPLATES: DEFAULT_TEMPLATES,
    defaults: DEFAULT_TEMPLATES,
    placeholderValues: placeholderValues,
    render: render,
    waPhoneDigits: waPhoneDigits,
    waSendUrl: waSendUrl,
    igSendUrl: igSendUrl,
    isIgnored: isIgnored,
    exportable: exportable
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.FicinoTemplates;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
