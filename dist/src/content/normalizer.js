(function (root) {
  'use strict';

  var TRACKING_PARAMS = ['igsh', 'igshid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'mibextid', 'img_index', 'img_number'];

  function collapseWhitespace(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  function collapseMultiline(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) { return line.replace(/[ \t]+/g, ' ').trim(); })
      .filter(function (line, index, arr) {
        return line.length > 0 || (index > 0 && arr[index - 1].length > 0);
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function stripQueryAndHash(url) {
    if (typeof url !== 'string') return '';
    var hashIndex = url.indexOf('#');
    if (hashIndex >= 0) url = url.slice(0, hashIndex);
    var queryIndex = url.indexOf('?');
    if (queryIndex >= 0) url = url.slice(0, queryIndex);
    return url;
  }

  function normalizeUsername(input) {
    if (typeof input !== 'string') return '';
    var value = input.trim();
    value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
    value = value.replace(/^@/, '');
    value = value.split('/')[0];
    value = value.split('?')[0];
    value = value.split('#')[0];
    value = value.replace(/[^A-Za-z0-9._]/g, '');
    if (value.length > 30) value = value.slice(0, 30);
    return value;
  }

  function isValidUsername(username) {
    if (typeof username !== 'string') return false;
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return false;
    if (/^\.{1,2}$/.test(username)) return false;
    if (/^[._]/.test(username) && username.indexOf('.') === 0 && username.indexOf('_') !== 0) return false;
    return true;
  }

  function normalizeProfileUrl(username, baseUrl) {
    var clean = normalizeUsername(username);
    if (!clean) return '';
    var origin = 'https://www.instagram.com';
    if (typeof baseUrl === 'string' && /^https?:\/\/(www\.)?instagram\.com/i.test(baseUrl)) {
      try {
        origin = new URL(baseUrl).origin;
      } catch (e) { /* keep default origin */ }
    }
    return origin + '/' + clean + '/';
  }

  function usernameFromUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    var value = url.trim();
    if (value.indexOf('http') !== 0 && value.charAt(0) !== '/') {
      if (/^[A-Za-z0-9._]{1,30}$/.test(value)) return value;
      return '';
    }
    var parsed = value;
    if (value.charAt(0) === '/') {
      parsed = 'https://www.instagram.com' + (value.charAt(0) === '/' ? value : '/' + value);
    }
    var pathname = parsed;
    try {
      var u = new URL(parsed, 'https://www.instagram.com');
      if (!/instagram\.com$/i.test(u.hostname.replace(/^www\./, ''))) return '';
      pathname = u.pathname;
    } catch (e) {
      return '';
    }
    pathname = stripQueryAndHash(pathname);
    var segments = pathname.split('/').filter(function (s) { return s.length > 0; });
    if (segments.length === 0) return '';
    var candidate = segments[0];
    if (!isValidUsername(candidate)) return '';
    return candidate;
  }

  function normalizeExternalUrl(input) {
    if (typeof input !== 'string') return '';
    var value = input.trim();
    if (!value) return '';
    value = value.replace(/^[("'*]+/, '').replace(/[).,;'"]+$/, '');
    if (!/^https?:\/\//i.test(value)) {
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(value)) {
        value = 'https://' + value;
      } else {
        return '';
      }
    }
    var url;
    try {
      url = new URL(value);
    } catch (e) {
      return '';
    }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return '';
    if (url.protocol === 'http:') url.protocol = 'https:';
    url.hostname = url.hostname.replace(/^www\./i, '');
    url.hash = '';
    var params = Array.from(url.searchParams.keys());
    params.forEach(function (key) {
      if (TRACKING_PARAMS.indexOf(key.toLowerCase()) !== -1) {
        url.searchParams.delete(key);
      }
    });
    var out = url.toString();
    out = out.replace(/\?$/, '');
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  }

  function domainOf(url) {
    var normalized = normalizeExternalUrl(url);
    if (!normalized) return '';
    try {
      return new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function urlsEqual(a, b) {
    var da = domainOf(a);
    var db = domainOf(b);
    if (!da || !db) return false;
    return da === db;
  }

  function looksLikeUrlInText(text) {
    if (typeof text !== 'string') return '';
    var match = text.match(/(?:https?:\/\/|www\.)[^\s<>"')\]]+[^\s<>"')\].,;:!?]/i);
    if (match) return match[0];
    var bare = text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ae|pk|uk|de|fr|au|ca|in|us|me|info|biz|store|shop|online|site|xyz|pro|app|dev|design|agency|studio)(?:\/[^\s]*)?/i);
    if (bare) return bare[0];
    return '';
  }

  var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

  function extractEmails(text) {
    if (typeof text !== 'string') return [];
    var matches = text.match(EMAIL_RE) || [];
    var seen = {};
    var out = [];
    matches.forEach(function (m) {
      var lower = m.toLowerCase();
      if (seen[lower]) return;
      if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(m)) return;
      seen[lower] = true;
      out.push(m);
    });
    return out;
  }

  var PHONE_RE = /(?:\+?\d{1,3}[\s.\-()]*)?(?:\(\d{2,4}\)[\s.\-()]*)?\d{2,4}[\s.\-()]*\d{2,4}[\s.\-()]*\d{0,4}/g;

  function normalizePhone(raw) {
    if (typeof raw !== 'string') return { raw: '', normalized: '' };
    var value = raw.trim();
    if (!value) return { raw: '', normalized: '' };
    var hasPlus = value.charAt(0) === '+';
    var digits = value.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return { raw: '', normalized: '' };
    var normalized = (hasPlus ? '+' : '') + digits;
    return { raw: value, normalized: normalized };
  }

  var PERMIT_RE = /\b(?:permits?|licence|license|trn|vat|registration|reg\.?\s+no|cr\.?\s+no)\b/i;
  var PERMIT_MENTION_RE = /\b(?:permit(?:s|ted|ing)?|licen[cs]\w*|trn|reg(?:istration)?\.?\s+no|cr\.?\s+no)\b/i;
  var PERMIT_MENTION_AR = ['رخص', 'تصريح', 'تصاريح', 'ترخيص', 'سجل تجار'];
  var PHONE_CONNECTOR_RE = /\b(?:phone|call|tel(?:ephone)?|whatsapp|mobile|contact|wa)\b/i;

  function mentionsPermit(text) {
    if (typeof text !== 'string' || !text) return false;
    if (PERMIT_MENTION_RE.test(text)) return true;
    for (var i = 0; i < PERMIT_MENTION_AR.length; i++) {
      if (text.indexOf(PERMIT_MENTION_AR[i]) !== -1) return true;
    }
    return false;
  }

  function permitAdjacent(text, start, end, candidates) {
    var after = text.slice(end, end + 16);
    if (PERMIT_RE.test(after)) return true;
    var before = text.slice(Math.max(0, start - 34), start);
    if (!PERMIT_RE.test(before)) return false;
    if (PHONE_CONNECTOR_RE.test(text.slice(Math.max(0, start - 16), start))) return false;
    var re = new RegExp(PERMIT_RE.source, 'gi');
    var nearestEnd = -1;
    var w;
    while ((w = re.exec(before)) !== null) nearestEnd = w.index + w[0].length;
    if (nearestEnd >= 0) {
      var wordEnd = (start - before.length) + nearestEnd;
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i] > wordEnd && candidates[i] < start) return false;
      }
    }
    return true;
  }

  function scanPhoneCandidates(text) {
    var out = { phones: [], permits: [] };
    if (typeof text !== 'string' || !text) return out;
    var matches = text.match(PHONE_RE) || [];
    var positions = [];
    var cursor = 0;
    matches.forEach(function (m) {
      var at = text.indexOf(m, cursor);
      if (at < 0) at = cursor;
      positions.push(at);
      cursor = at + m.length;
    });
    var seen = {};
    matches.forEach(function (m, idx) {
      var candidate = m.trim();
      if (candidate.length < 7) return;
      var digits = candidate.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return;
      if (/^(19|20)\d{2}$/.test(digits)) return;
      var phone = normalizePhone(candidate);
      if (!phone.normalized) return;
      var start = positions[idx];
      var end = start + m.length;
      var explicit = /^\+|^00/.test(candidate);
      if (!explicit && permitAdjacent(text, start, end, positions)) {
        if (!seen['permit:' + digits]) {
          seen['permit:' + digits] = true;
          out.permits.push(digits);
        }
        return;
      }
      if (seen[phone.normalized]) return;
      seen[phone.normalized] = true;
      out.phones.push(phone);
    });
    return out;
  }

  function extractPhones(text) {
    return scanPhoneCandidates(text).phones;
  }

  function findPermitNumbers(text) {
    return scanPhoneCandidates(text).permits;
  }

  function extractPhonesFromHref(href) {
    if (typeof href !== 'string') return null;
    if (!/^tel:/i.test(href)) return null;
    return normalizePhone(href.replace(/^tel:/i, ''));
  }

  var COUNTRY_HINTS = [
    { cc: '971', re: /\b(uae|united\s+arab\s+emirates|dubai|abu\s+dhabi|sharjah|ajman|al\s+ain|fujairah|umm\s+al\s+quwain|ras\s+al\s+khaimah)\b|\.ae\b/i },
    { cc: '966', re: /\b(ksa|saudi\s+arabia|saudi|riyadh|jeddah|makkah|madinah|dammam|al\s+khobar)\b|\.sa\b/i },
    { cc: '974', re: /\b(qatar|doha|al\s+khor)\b|\.qa\b/i },
    { cc: '965', re: /\b(kuwait)\b|\.kw\b/i },
    { cc: '973', re: /\b(bahrain|manama)\b|\.bh\b/i },
    { cc: '968', re: /\b(oman|muscat|salalah)\b|\.om\b/i },
    { cc: '20', re: /\b(egypt|cairo|alexandria|giza)\b|\.eg\b/i },
    { cc: '962', re: /\b(jordan|amman|zarqa)\b|\.jo\b/i },
    { cc: '964', re: /\b(iraq|baghdad|basra|erbil)\b|\.iq\b/i },
    { cc: '961', re: /\b(lebanon|beirut)\b|\.lb\b/i },
    { cc: '970', re: /\b(palestine|gaza|ramallah)\b|\.ps\b/i },
    { cc: '90', re: /\b(turkey|turkiye|istanbul|ankara|izmir)\b|\.tr\b/i },
    { cc: '91', re: /\b(india|indian|mumbai|bangalore|bengaluru|delhi|chennai|kolkata|hyderabad|pune|ahmedabad|jaipur|kochi|indore|surat|lucknow|nagpur)\b|\.in\b/i },
    { cc: '92', re: /\b(pakistan|pakistani|karachi|lahore|islamabad|peshawar|multan|faisalabad|quetta)\b|\.pk\b/i },
    { cc: '880', re: /\b(bangladesh|dhaka|chittagong)\b|\.bd\b/i },
    { cc: '94', re: /\b(sri\s+lanka|colombo)\b|\.lk\b/i },
    { cc: '977', re: /\b(nepal|kathmandu)\b|\.np\b/i },
    { cc: '44', re: /\b(united\s+kingdom|london|manchester|birmingham|liverpool|bristol|leeds|glasgow|edinburgh|brighton|oxford|cambridge)\b|\buk\b|\.co\.uk\b/i },
    { cc: '1', re: /\b(united\s+states|\busa\b|american|new\s+york|los\s+angeles|chicago|houston|miami|atlanta|dallas|seattle|boston|san\s+francisco|las\s+vegas|canada|toronto|vancouver|montreal)\b/i },
    { cc: '61', re: /\b(australia|sydney|melbourne|brisbane|perth|adelaide)\b|\.au\b/i },
    { cc: '49', re: /\b(germany|german|berlin|munich|hamburg|frankfurt)\b|\.de\b/i },
    { cc: '33', re: /\b(france|french|paris|lyon|marseille)\b|\.fr\b/i },
    { cc: '39', re: /\b(italy|italian|rome|milan|naples|venice)\b|\.it\b/i },
    { cc: '34', re: /\b(spain|spanish|madrid|barcelona|valencia)\b|\.es\b/i },
    { cc: '31', re: /\b(netherlands|dutch|amsterdam|rotterdam)\b|\.nl\b/i },
    { cc: '380', re: /\b(ukraine|kyiv|kharkiv)\b|\.ua\b/i },
    { cc: '7', re: /\b(russia|russian|moscow|petersburg)\b|\.ru\b/i },
    { cc: '63', re: /\b(philippines|filipino|manila|cebu)\b|\.ph\b/i },
    { cc: '60', re: /\b(malaysia|malaysian|kuala\s+lumpur|penang|johor)\b|\.my\b/i },
    { cc: '65', re: /\b(singapore)\b|\.sg\b/i },
    { cc: '62', re: /\b(indonesia|jakarta|surabaya|bali)\b|\.id\b/i },
    { cc: '66', re: /\b(thailand|thai|bangkok|phuket|pattaya)\b|\.th\b/i },
    { cc: '84', re: /\b(vietnam|vietnamese|hanoi|ho\s+chi\s+minh|danang)\b|\.vn\b/i },
    { cc: '86', re: /\b(china|chinese|beijing|shanghai|shenzhen|guangzhou)\b|\.cn\b/i },
    { cc: '852', re: /\b(hong\s+kong)\b|\.hk\b/i },
    { cc: '81', re: /\b(japan|japanese|tokyo|osaka|yokohama)\b|\.jp\b/i },
    { cc: '82', re: /\b(south\s+korea|korea|seoul|busan)\b|\.kr\b/i },
    { cc: '234', re: /\b(nigeria|nigerian|lagos|abuja|kano|ibadan)\b|\.ng\b/i },
    { cc: '254', re: /\b(kenya|nairobi|kisumu)\b|\.ke\b/i },
    { cc: '233', re: /\b(ghana|accra)\b|\.gh\b/i },
    { cc: '27', re: /\b(south\s+africa|johannesburg|cape\s+town|durban)\b|\.za\b/i },
    { cc: '212', re: /\b(morocco|casablanca|marrakesh)\b|\.ma\b/i },
    { cc: '55', re: /\b(brazil|brazilian|sao\s+paulo|rio\s+de\s+janeiro)\b|\.br\b/i },
    { cc: '52', re: /\b(mexico|mexican|mexico\s+city|guadalajara)\b|\.mx\b/i },
    { cc: '54', re: /\b(argentina|buenos\s+aires)\b|\.ar\b/i },
    { cc: '57', re: /\b(colombia|bogota)\b|\.co\b/i },
    { cc: '51', re: /\b(peru|lima)\b|\.pe\b/i },
    { cc: '56', re: /\b(chile|santiago)\b|\.cl\b/i }
  ];

  function inferCountryCode(ctx) {
    if (!ctx) return '';
    var fields = [
      ctx.keyword, ctx.location, ctx.bio, ctx.username,
      ctx.name, ctx.category, ctx.website, ctx.source_page
    ];
    for (var i = 0; i < fields.length; i++) {
      var text = typeof fields[i] === 'string' ? fields[i] : '';
      if (!text) continue;
      var probe = text.replace(/[-_/]+/g, ' ');
      for (var h = 0; h < COUNTRY_HINTS.length; h++) {
        if (COUNTRY_HINTS[h].re.test(probe)) return COUNTRY_HINTS[h].cc;
      }
    }
    return '';
  }

  function attributePhone(raw, ctx, fallbackCC) {
    var result = { raw: '', normalized: '', digits: '', local: '', valid: false, needsCc: false, issue: 'no_number' };
    var value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return result;
    result.raw = value;
    var hasPlus = value.charAt(0) === '+';
    var all = value.replace(/\D/g, '');
    if (!all) {
      result.issue = 'too_short';
      return result;
    }
    var digits = '';
    var cc = '';
    if (hasPlus) {
      digits = all;
      result.local = digits;
    } else if (all.indexOf('00') === 0) {
      digits = all.slice(2);
      result.local = digits;
    } else {
      cc = inferCountryCode(ctx);
      if (!cc && /^05\d{8}$/.test(all)) cc = '971';
      if (!cc && fallbackCC) cc = String(fallbackCC).replace(/\D/g, '');
      var local = all;
      if (cc && local.indexOf(cc) === 0 && local.length > cc.length + 5) {
        digits = local;
        result.local = local.slice(cc.length);
      } else if (local.charAt(0) === '0') {
        digits = cc ? cc + local.slice(1) : local;
        result.local = cc ? local.slice(1) : local;
        if (!cc) result.needsCc = true;
      } else if (local.length >= 11) {
        digits = local;
        result.local = local;
      } else {
        digits = cc ? cc + local : local;
        result.local = local;
        if (!cc) result.needsCc = true;
      }
    }
    if (digits.length < 7) {
      result.digits = digits;
      result.issue = 'too_short';
      return result;
    }
    if (digits.length > 15) {
      result.digits = digits;
      result.issue = 'too_long';
      return result;
    }
    var seen = {};
    var distinct = 0;
    for (var i = 0; i < digits.length; i++) {
      var d = digits.charAt(i);
      if (!seen[d]) {
        seen[d] = true;
        distinct += 1;
      }
    }
    if (distinct < 4) {
      result.digits = digits;
      result.issue = 'suspicious';
      return result;
    }
    result.digits = digits;
    result.valid = true;
    result.issue = '';
    if (!result.needsCc) result.normalized = '+' + digits;
    return result;
  }

  function normalizeDate(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) date = new Date();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function exportTimestamp(date) {
    var d = date instanceof Date ? date : new Date(date || Date.now());
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' +
      pad(d.getHours()) + '-' + pad(d.getMinutes());
  }

  function parseFollowers(text) {
    if (typeof text !== 'string') return '';
    var match = text.match(/([\d.,]+[KkMmBb]?)\s*Followers/i);
    if (!match) return '';
    return collapseWhitespace(match[1]);
  }

  var NON_WEBSITE_RE = /instagram|facebook|twitter|youtube|linkedin|tiktok|whatsapp|wa\.me|wa\.link|threads|pinterest|linktr\.ee|beacons\.ai|carrd\.co|ca\.link|bento\.me|m\.me|fb\.me|t\.me|telegram|snapchat|discord/i;

  function isNonWebsiteUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    return NON_WEBSITE_RE.test(value);
  }

  var Normalizer = {
    collapseWhitespace: collapseWhitespace,
    collapseMultiline: collapseMultiline,
    stripQueryAndHash: stripQueryAndHash,
    normalizeUsername: normalizeUsername,
    isValidUsername: isValidUsername,
    normalizeProfileUrl: normalizeProfileUrl,
    usernameFromUrl: usernameFromUrl,
    normalizeExternalUrl: normalizeExternalUrl,
    isNonWebsiteUrl: isNonWebsiteUrl,
    domainOf: domainOf,
    urlsEqual: urlsEqual,
    looksLikeUrlInText: looksLikeUrlInText,
    extractEmails: extractEmails,
    extractPhones: extractPhones,
    findPermitNumbers: findPermitNumbers,
    mentionsPermit: mentionsPermit,
    normalizePhone: normalizePhone,
    extractPhonesFromHref: extractPhonesFromHref,
    inferCountryCode: inferCountryCode,
    attributePhone: attributePhone,
    normalizeDate: normalizeDate,
    exportTimestamp: exportTimestamp,
    parseFollowers: parseFollowers
  };

  root.FicinoNormalizer = Normalizer;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Normalizer;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
