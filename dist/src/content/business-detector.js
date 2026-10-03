(function (root) {
  'use strict';

  var Log = root.FicinoLog;
  var N = root.FicinoNormalizer;
  var S = root.FicinoSelectors;

  function containsKeyword(text, keywords) {
    if (!text) return null;
    var lower = ' ' + String(text).toLowerCase() + ' ';
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i].toLowerCase();
      if (lower.indexOf(kw) !== -1) return kw;
    }
    return null;
  }

  function normalizeForMatch(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
  }

  function escapeRe(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function keywordHit(text, keywords) {
    var norm = normalizeForMatch(text);
    if (!norm) return null;
    for (var i = 0; i < keywords.length; i++) {
      var kw = normalizeForMatch(keywords[i]);
      if (!kw) continue;
      var re;
      try {
        re = new RegExp('(?:^|\\s)' + escapeRe(kw) + '(?:s|es|ing|ed)?(?=\\s|$)');
      } catch (e) {
        continue;
      }
      if (re.test(norm)) return keywords[i];
    }
    return null;
  }

  function isBusinessUi(text) {
    var norm = normalizeForMatch(text);
    for (var i = 0; i < S.BUSINESS_UI_TEXT.length; i++) {
      if (norm.indexOf(S.BUSINESS_UI_TEXT[i]) !== -1) return true;
    }
    return false;
  }

  function detectBusiness(profile) {
    var reasons = [];
    var score = 0;
    var keywordSource = null;

    if (!profile) {
      return { confidence: 0, unlikely: true, reasons: [], keyword: null };
    }

    var name = profile.instagram_name || '';
    var username = profile.instagram_username || '';
    var bio = profile.bio || '';
    var category = profile.category || '';

    if (category) {
      score += 35;
      reasons.push('category: ' + category);
    }

    if (profile.phone_normalized || profile.phone_raw) {
      score += 20;
      reasons.push('phone present');
    }

    if (profile.email) {
      score += 15;
      reasons.push('email present');
    }

    if (profile.location) {
      score += 8;
      reasons.push('location present');
    }

    if (profile.contactUi && profile.contactUi.length) {
      score += 10;
      reasons.push('business UI: ' + profile.contactUi.slice(0, 3).join(', '));
    }

    var kwName = keywordHit(name, S.BUSINESS_KEYWORDS);
    var kwBio = keywordHit(bio, S.BUSINESS_KEYWORDS);
    var kwUser = keywordHit(String(username).replace(/[._]/g, ' '), S.BUSINESS_KEYWORDS);
    var kwCat = keywordHit(category, S.BUSINESS_KEYWORDS);

    if (kwCat) {
      score += 20;
      keywordSource = keywordSource || 'category';
      reasons.push('keyword in category: ' + kwCat);
    }
    if (kwName) {
      score += 15;
      keywordSource = keywordSource || 'name';
      reasons.push('keyword in name: ' + kwName);
    }
    if (kwBio) {
      score += 12;
      keywordSource = keywordSource || 'bio';
      reasons.push('keyword in bio: ' + kwBio);
    }
    if (kwUser) {
      score += 8;
      keywordSource = keywordSource || 'username';
      reasons.push('keyword in username: ' + kwUser);
    }

    if (name && N.normalizeUsername(username) && name.trim().toLowerCase() !== String(username).trim().toLowerCase()) {
      score += 5;
      reasons.push('distinct display name');
    }

    var followerText = String(profile.followers || '');
    if (/followers/i.test(followerText)) score += 2;

    if (score > 100) score = 100;
    if (score < 0) score = 0;

    var keyword = kwCat || kwName || kwBio || kwUser;

    if (Log && Log.isEnabled()) {
      Log.debug('Business Detection', 'Score: ' + score, 'keyword:', keyword || 'none', '|', reasons.join('; '));
    }

    return {
      confidence: score,
      reasons: reasons,
      keyword: keyword,
      keywordSource: keywordSource
    };
  }

  function bandFor(score) {
    if (score <= 30) return 'unlikely';
    if (score <= 60) return 'possible';
    if (score <= 80) return 'likely';
    return 'strong';
  }

  root.FicinoBusinessDetector = {
    detectBusiness: detectBusiness,
    keywordHit: keywordHit,
    containsKeyword: containsKeyword,
    isBusinessUi: isBusinessUi,
    bandFor: bandFor
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.FicinoBusinessDetector;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
