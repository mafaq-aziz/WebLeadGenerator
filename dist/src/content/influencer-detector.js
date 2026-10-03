(function (root) {
  'use strict';

  var STRONG_CATEGORIES = [
    'digital creator', 'blogger', 'vlogger', 'youtuber', 'you tube',
    'content creator', 'influencer', 'public figure', 'personal blog',
    'lifestyle blog', 'creator', 'instagrammer'
  ];

  var BIO_MARKERS = [
    'collab', 'collaboration', 'sponsorship', 'sponsored',
    'business inquiries', 'business enquiries',
    'press inquiries', 'press enquiries',
    'talent agency', 'booking agent'
  ];

  var USERNAME_MARKERS = [
    'blog', 'vlog', 'daily', 'diary', 'diaries', 'wanderlust', 'lifestyle'
  ];

  var MEGA_FOLLOWERS = 500000;
  var HIGH_FOLLOWERS = 100000;

  function normalizeForMatch(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
  }

  function escapeRe(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function wordHit(text, markers) {
    var norm = normalizeForMatch(text);
    if (!norm) return null;
    for (var i = 0; i < markers.length; i++) {
      var kw = normalizeForMatch(markers[i]);
      if (!kw) continue;
      var re;
      try {
        re = new RegExp('(?:^|\\s)(' + escapeRe(kw) + '(?:s|es|ing|ed)?)(?=\\s|$)');
      } catch (e) {
        continue;
      }
      var m = norm.match(re);
      if (m) return m[1];
    }
    return null;
  }

  function countHits(text, markers) {
    var hits = [];
    for (var i = 0; i < markers.length; i++) {
      var matched = wordHit(text, [markers[i]]);
      if (matched && hits.indexOf(matched) === -1) hits.push(matched);
    }
    return hits;
  }

  function parseFollowers(text) {
    var str = String(text || '').replace(/,/g, '');
    var m = str.match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
    if (!m) return 0;
    var value = parseFloat(m[1]);
    if (!isFinite(value)) return 0;
    var unit = (m[2] || '').toLowerCase();
    if (unit === 'k') value *= 1000;
    else if (unit === 'm') value *= 1000000;
    else if (unit === 'b') value *= 1000000000;
    return Math.round(value);
  }

  function detect(profile) {
    var reasons = [];
    var p = profile || {};

    var category = String(p.category || '');
    var bio = String(p.bio || '');
    var username = String(p.instagram_username || '').replace(/^@/, '').replace(/[._]/g, ' ');
    var followers = parseFollowers(p.followers);

    var strongCategory = wordHit(category, STRONG_CATEGORIES);
    if (strongCategory) reasons.push('category: ' + strongCategory);

    var bioHits = countHits(bio, BIO_MARKERS);
    if (bioHits.length) reasons.push('bio: ' + bioHits.join(', '));

    var usernameMarker = wordHit(username, USERNAME_MARKERS);
    if (usernameMarker) reasons.push('username: ' + usernameMarker);

    if (followers >= MEGA_FOLLOWERS) reasons.push('followers: ' + followers);

    var flag = false;
    if (strongCategory) flag = true;
    else if (bioHits.length >= 2) flag = true;
    else if (bioHits.length >= 1 && usernameMarker) flag = true;
    else if (bioHits.length >= 1 && followers >= HIGH_FOLLOWERS) flag = true;
    else if (followers >= MEGA_FOLLOWERS) flag = true;

    return { flag: flag, reasons: reasons, followers: followers };
  }

  root.FicinoInfluencerDetector = {
    detect: detect,
    wordHit: wordHit,
    countHits: countHits,
    parseFollowers: parseFollowers,
    STRONG_CATEGORIES: STRONG_CATEGORIES,
    BIO_MARKERS: BIO_MARKERS,
    USERNAME_MARKERS: USERNAME_MARKERS
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.FicinoInfluencerDetector;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
