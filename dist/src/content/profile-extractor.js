(function (root) {
  'use strict';

  var Log = root.FicinoLog;
  var N = root.FicinoNormalizer;
  var S = root.FicinoSelectors;

  var EMAIL_RE_LIKE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (Log) Log.warn('Profile', err && err.message ? err.message : err);
      return fallback;
    }
  }

  function isVisible(el) {
    if (!el || el.isConnected === false) return false;
    if (root.getComputedStyle) {
      var style = safe(function () { return root.getComputedStyle(el); }, null);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
        return false;
      }
    }
    return true;
  }

  function textOf(el) {
    if (!el) return '';
    return N.collapseWhitespace(el.textContent || '');
  }

  function pageUrl(doc) {
    var d = doc || root.document;
    try {
      return d && d.location ? d.location.href : '';
    } catch (e) {
      return '';
    }
  }

  function hrefOf(a) {
    if (!a || !a.getAttribute) return '';
    return a.getAttribute('href') || '';
  }

  function currentUsername(doc) {
    var username = N.usernameFromUrl(pageUrl(doc));
    if (!username || S.isReservedSegment(username)) return '';
    if (!N.isValidUsername(username)) return '';
    return username;
  }

  function findHeader(doc) {
    var d = doc || root.document;
    return safe(function () {
      return d.querySelector('header') ||
        d.querySelector('main header') ||
        d.querySelector('[role="main"] header');
    }, null);
  }

  function headerTextBlocks(header) {
    if (!header) return [];
    var blocks = [];
    var candidates = safe(function () {
      return header.querySelectorAll('span, div, h1, h2, h3, a, li, p');
    }, null);
    if (!candidates) return blocks;
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isVisible(el)) continue;
      var hasTextChild = false;
      for (var j = 0; j < el.children.length; j++) {
        var child = el.children[j];
        if (child.textContent && N.collapseWhitespace(child.textContent)) {
          hasTextChild = true;
          break;
        }
      }
      if (hasTextChild) continue;
      var text = textOf(el);
      if (!text) continue;
      blocks.push({ el: el, text: text });
    }
    return blocks;
  }

  function extractProfileLinks(scope) {
    var doc = scope || root.document;
    var results = [];
    var seen = {};
    var anchors = safe(function () { return doc.querySelectorAll('a[href]'); }, null);
    if (!anchors) return results;
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = hrefOf(a);
      if (!href) continue;
      var username = safe(function () { return N.usernameFromUrl(href); }, '');
      if (!username || !N.isValidUsername(username)) continue;
      if (S.isReservedSegment(username)) continue;
      if (seen[username]) continue;
      seen[username] = true;
      var label = textOf(a) || (a.getAttribute && a.getAttribute('aria-label')) || '';
      results.push({
        username: username,
        url: N.normalizeProfileUrl(username, pageUrl(doc)),
        label: N.collapseWhitespace(label).slice(0, 140),
        anchor: a
      });
    }
    return results;
  }

  function extractUsername(doc) {
    var fromUrl = currentUsername(doc);
    if (fromUrl) return fromUrl;
    var header = findHeader(doc);
    if (header) {
      var link = safe(function () { return header.querySelector('a[href^="/"]'); }, null);
      if (link) {
        var u = N.usernameFromUrl(hrefOf(link));
        if (u && !S.isReservedSegment(u)) return u;
      }
    }
    return '';
  }

  var META_AUTHOR_BLOCKLIST = {
    post: 1, posts: 1, reel: 1, reels: 1, story: 1, stories: 1, photo: 1, photos: 1,
    video: 1, videos: 1, image: 1, images: 1, liked: 1, likes: 1, comments: 1,
    share: 1, explore: 1, followers: 1, following: 1, instagram: 1, account: 1,
    user: 1, profile: 1, content: 1, page: 1, tag: 1, tags: 1, recent: 1, all: 1
  };

  function authorsFromMeta(d) {
    var parts = [];
    var m1 = safe(function () { return d.querySelector('meta[name="description"]'); }, null);
    var m2 = safe(function () { return d.querySelector('meta[property="og:description"]'); }, null);
    if (m1 && m1.getAttribute) parts.push(m1.getAttribute('content') || '');
    if (m2 && m2.getAttribute) parts.push(m2.getAttribute('content') || '');
    var desc = parts.join(' ');
    if (!desc) return [];

    function validate(list) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var u = String(list[i] || '').trim().replace(/^@/, '');
        if (!u || !N.isValidUsername(u)) continue;
        if (S.isReservedSegment(u)) continue;
        if (META_AUTHOR_BLOCKLIST[u.toLowerCase()]) continue;
        out.push(u);
      }
      return out;
    }

    var m = /([A-Za-z0-9._]+(?:\s+and\s+[A-Za-z0-9._]+)*)\s+on\s+Instagram/i.exec(desc);
    var out = m ? validate(m[1].split(/\s+and\s+/i)) : [];
    if (!out.length) {
      var by = /Video\s+by\s+@?([A-Za-z0-9._]{1,30})/i.exec(desc);
      if (by) out = validate([by[1]]);
    }
    if (!out.length) {
      var of = /Photos?\s+and\s+videos?\s+of\s+@?([A-Za-z0-9._]{1,30})/i.exec(desc);
      if (of) out = validate([of[1]]);
    }
    return out;
  }

  function extractPostAuthors(doc) {
    var d = doc || root.document;
    var out = [];
    var seen = {};
    function add(u) {
      u = String(u || '').replace(/^@/, '');
      if (!u || !N.isValidUsername(u)) return;
      if (S.isReservedSegment(u)) return;
      var key = u.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(u);
    }
    function addAnchorAnchors(scope) {
      var anchors = safe(function () { return scope.querySelectorAll('a[href]'); }, null);
      if (!anchors) return;
      for (var i = 0; i < anchors.length; i++) {
        var href = hrefOf(anchors[i]);
        if (!href) continue;
        var path = href.split('#')[0].split('?')[0];
        if (!/^\/[A-Za-z0-9._]{1,30}\/?$/.test(path)) continue;
        add(safe(function () { return N.usernameFromUrl(path); }, ''));
      }
    }

    var scopes = [];
    var dialog = findDialog(d);
    if (dialog) scopes.push(dialog);
    var article = safe(function () { return d.querySelector('article'); }, null);
    if (article) scopes.push(article);
    var main = safe(function () { return d.querySelector('main'); }, null);
    if (main) scopes.push(main);

    for (var s = 0; s < scopes.length; s++) {
      var headers = safe(function () { return scopes[s].querySelectorAll('header'); }, null);
      if (headers) {
        for (var h = 0; h < headers.length; h++) {
          var links = safe(function () { return headers[h].querySelectorAll('a[href]'); }, null);
          if (!links) continue;
          for (var i = 0; i < links.length; i++) {
            add(safe(function () { return N.usernameFromUrl(hrefOf(links[i])); }, ''));
          }
        }
      }
      addAnchorAnchors(scopes[s]);
    }
    if (!scopes.length) {
      var headerOnly = safe(function () { return d.querySelectorAll('header'); }, null);
      if (headerOnly) {
        for (var g = 0; g < headerOnly.length; g++) {
          var hlinks = safe(function () { return headerOnly[g].querySelectorAll('a[href]'); }, null);
          if (!hlinks) continue;
          for (var k = 0; k < hlinks.length; k++) {
            add(safe(function () { return N.usernameFromUrl(hrefOf(hlinks[k])); }, ''));
          }
        }
      }
    }
    var meta = authorsFromMeta(d);
    for (var t = 0; t < meta.length; t++) add(meta[t]);
    return out;
  }

  function extractPostAuthor(doc) {
    var authors = extractPostAuthors(doc);
    return authors.length ? authors[0] : '';
  }

  var INFLUENCER_MARKERS = [
    'blog', 'blogs', 'vlog', 'vlogs', 'daily', 'diary', 'diaries', 'reels', 'wanderlust'
  ];

  var COMMON_FIRST_NAMES = [
    'alice', 'alex', 'amanda', 'amy', 'andrea', 'anthony', 'antonio', 'ben', 'benedetta',
    'carla', 'charlotte', 'chiara', 'chris', 'clara', 'daniel', 'david', 'elena', 'emily',
    'emma', 'eric', 'francesca', 'george', 'gianni', 'giulia', 'giuseppe', 'hannah',
    'isabella', 'james', 'jessica', 'julia', 'kevin', 'laura', 'leo', 'luna', 'luca',
    'lucia', 'marco', 'maria', 'mark', 'martin', 'mattia', 'melissa', 'michelle', 'mia',
    'natalie', 'nicole', 'noah', 'oliver', 'paolo', 'patricia', 'peter', 'pierluigi',
    'rachel', 'robert', 'roberto', 'sara', 'sarah', 'sophie', 'stefano', 'thomas', 'tom',
    'valentina', 'victoria', 'william', 'zoe'
  ];

  function businessWordHit(text) {
    var norm = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!norm) return null;
    var kws = S.BUSINESS_KEYWORDS;
    for (var i = 0; i < kws.length; i++) {
      var kw = String(kws[i]).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!kw) continue;
      var re;
      try {
        re = new RegExp('(?:^|\\s)' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:s|es|ing|ed)?(?=\\s|$)');
      } catch (e) {
        continue;
      }
      if (re.test(norm)) return kws[i];
    }
    return null;
  }

  function rankPostAuthors(authors, opts) {
    opts = opts || {};
    var list = [];
    var seen = {};
    var raw = Array.isArray(authors) ? authors : [];
    for (var i = 0; i < raw.length; i++) {
      var u = String(raw[i] || '').replace(/^@/, '');
      if (!u) continue;
      var key = u.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      list.push(u);
    }
    var qTokens = String(opts.query || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (t) {
      return t.length >= 3;
    });
    var scored = list.map(function (u, idx) {
      var norm = String(u).toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
      var flat = String(u).toLowerCase();
      var score = 0;
      if (businessWordHit(norm)) score += 3;
      var q = 0;
      for (var t = 0; t < qTokens.length; t++) {
        if (norm.indexOf(qTokens[t]) !== -1) q += 2;
      }
      score += Math.min(q, 4);
      for (var m = 0; m < INFLUENCER_MARKERS.length; m++) {
        if (flat.indexOf(INFLUENCER_MARKERS[m]) !== -1) {
          score -= 2;
          break;
        }
      }
      var tokens = norm.split(/\s+/);
      for (var f = 0; f < COMMON_FIRST_NAMES.length; f++) {
        if (tokens.indexOf(COMMON_FIRST_NAMES[f]) !== -1) {
          score -= 1;
          break;
        }
      }
      return { username: u, score: score, index: idx };
    });
    scored.sort(function (a, b) { return (b.score - a.score) || (a.index - b.index); });
    return scored.map(function (s) { return s.username; });
  }

  function extractBusinessName(doc, username) {
    return safe(function () {
      var header = findHeader(doc);
      if (!header) return '';
      var lowerUser = String(username || '').toLowerCase();
      var headingFallback = '';
      var heading = header.querySelector('h2') || header.querySelector('h1');
      if (heading) {
        var headingText = textOf(heading);
        if (headingText && !/^\d[\d.,]*\s*(followers|following|posts)/i.test(headingText)) {
          if (!lowerUser || headingText.toLowerCase() !== lowerUser) {
            if (headingText.length <= 90) return headingText;
          } else {
            headingFallback = '';
          }
        }
      }
      var section = header.querySelector('section') || header;
      var dirAuto = section.querySelectorAll('[dir="auto"]');
      var bio = extractBio(doc);
      for (var i = 0; i < dirAuto.length; i++) {
        var text = textOf(dirAuto[i]);
        if (!text) continue;
        if (/followers|following|posts/i.test(text)) continue;
        if (/^\d/.test(text) && text.length < 20) continue;
        if (lowerUser && text.toLowerCase() === lowerUser) continue;
        if (text.length > 90) continue;
        if (text.indexOf('|') !== -1) continue;
        if ((dirAuto[i].textContent || '').indexOf('\n') !== -1) continue;
        if (bio && text === bio) continue;
        return text;
      }
      return headingFallback;
    }, '');
  }

  function extractBio(doc) {
    return safe(function () {
      var header = findHeader(doc);
      if (!header) return '';
      var blocks = headerTextBlocks(header);
      var best = '';
      var skip = /^(follow|following|message|contact|edit profile|call|email|book now|contact info|send email)$/i;
      for (var i = 0; i < blocks.length; i++) {
        var text = blocks[i].text;
        if (text.length < 4) continue;
        if (/^\d[\d.,]*\s*(followers|following|posts)/i.test(text)) continue;
        if (skip.test(text)) continue;
        if (text.length > best.length) best = text;
      }
      var multiline = safe(function () {
        var dirs = header.querySelectorAll('[dir="auto"]');
        for (var k = 0; k < dirs.length; k++) {
          var raw = dirs[k].textContent || '';
          if (raw.indexOf('\n') !== -1) {
            var cleaned = N.collapseMultiline(raw);
            if (cleaned.length > 8) return cleaned;
          }
        }
        return '';
      }, '');
      if (multiline && multiline.length >= best.length) return multiline.slice(0, 600);
      return best ? best.slice(0, 600) : '';
    }, '');
  }

  function extractCategory(doc) {
    return safe(function () {
      var header = findHeader(doc);
      var username = extractUsername(doc);
      if (header) {
        var blocks = headerTextBlocks(header);
        var categoryRe = /\b(category|business|store|shop|restaurant|cafe|salon|spa|clinic|studio|agency|gym|hotel|academy|school|lawyer|dental|beauty|cosmetic|fashion|jewelry|real estate|property|photography|interior|marketing|consulting|medical|barber|nails|skincare|fitness|travel|automotive|electronics|furniture|pub|bar)\b/i;
        var name = extractBusinessName(doc, username);
        var bio = extractBio(doc);
        for (var i = 0; i < blocks.length; i++) {
          var text = blocks[i].text;
          if (text.length < 3 || text.length > 60) continue;
          if (/followers|following|\bposts?\b/i.test(text)) continue;
          if (username && text.toLowerCase() === username.toLowerCase()) continue;
          if (name && text === name) continue;
          if (bio && text === bio) continue;
          if (text.indexOf('|') !== -1) continue;
          if ((blocks[i].el.textContent || '').indexOf('\n') !== -1) continue;
          var tag = (blocks[i].el.tagName || '').toLowerCase();
          if (tag === 'h1' || tag === 'h2' || tag === 'a') continue;
          if (categoryRe.test(text)) return text;
        }
      }
      var metaDesc = safe(function () {
        var m = doc.querySelector('meta[name="description"]');
        return m ? (m.getAttribute('content') || '') : '';
      }, '');
      var catMatch = metaDesc.match(/(?:^|[•·|,-]\s*)([^•·|]{3,60}?)\s*[•·|]\s*\d/);
      if (catMatch && categoryLike(catMatch[1])) {
        return N.collapseWhitespace(catMatch[1]);
      }
      return '';
    }, '');
  }

  function categoryLike(text) {
    return /\b(salon|clinic|store|shop|restaurant|cafe|studio|agency|gym|hotel|beauty|fashion|dental|medical|lawyer|real estate|photography|barber|fitness|academy|school|spa|restaurant)\b/i.test(text);
  }

  function collectExternalLinks(doc) {
    var d = doc || root.document;
    var out = [];
    var scopes = [];
    var header = findHeader(d);
    if (header) scopes.push(header);
    var main = safe(function () { return d.querySelector('main'); }, null);
    if (main && scopes.indexOf(main) === -1) scopes.push(main);
    if (!scopes.length) scopes.push(d);

    scopes.forEach(function (scope) {
      var anchors = safe(function () { return scope.querySelectorAll('a[href]'); }, null);
      if (!anchors) return;
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = hrefOf(a);
        if (!href) continue;
        if (/^(tel:|mailto:|sms:|#|javascript:)/i.test(href)) continue;
        if (href.charAt(0) === '/') continue;
        if (!/^https?:\/\//i.test(href) && !/^www\./i.test(href)) continue;
        var hostname = safe(function () {
          return new URL(/^https?:\/\//i.test(href) ? href : 'https://' + href).hostname;
        }, '');
        if (!hostname || !S.isExternalHost(hostname)) continue;
        var normalized = N.normalizeExternalUrl(href);
        if (!normalized) continue;
        out.push({
          href: normalized,
          anchor: a,
          text: textOf(a),
          aria: (a.getAttribute && a.getAttribute('aria-label')) || ''
        });
      }
    });
    return out;
  }

  function websiteFromText(doc) {
    var sources = [];
    var bio = extractBio(doc);
    if (bio) sources.push(bio);
    var header = findHeader(doc);
    if (header) sources.push(header.textContent || '');
    var metaDesc = safe(function () {
      var m = doc.querySelector('meta[name="description"]');
      return m ? (m.getAttribute('content') || '') : '';
    }, '');
    if (metaDesc) sources.push(metaDesc);

    for (var i = 0; i < sources.length; i++) {
      var text = sources[i].replace(EMAIL_RE_LIKE, ' ');
      var candidate = N.looksLikeUrlInText(text);
      if (!candidate) continue;
      var normalized = N.normalizeExternalUrl(candidate);
      if (!normalized) continue;
      if (N.isNonWebsiteUrl(normalized)) continue;
      var host = safe(function () { return new URL(normalized).hostname; }, '');
      if (!host || !S.isExternalHost(host)) continue;
      return normalized;
    }
    return '';
  }

  function extractWebsite(doc) {
    return safe(function () {
      var links = collectExternalLinks(doc);
      var header = findHeader(doc);
      var headerHits = [];
      var otherHits = [];
      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        if (N.isNonWebsiteUrl(link.href)) continue;
        if (N.isNonWebsiteUrl(link.text + ' ' + link.aria)) continue;
        if (header && header.contains && header.contains(link.anchor)) headerHits.push(link.href);
        else otherHits.push(link.href);
      }
      if (headerHits.length) return headerHits[0];
      if (otherHits.length) return otherHits[0];
      return websiteFromText(doc);
    }, '');
  }

  function extractLinktree(doc) {
    return safe(function () {
      var links = collectExternalLinks(doc);
      for (var i = 0; i < links.length; i++) {
        if (/linktr\.ee/i.test(links[i].href)) return links[i].href;
      }
      return '';
    }, '');
  }

  function textChunks(scope, selector) {
    var d = scope || root.document;
    if (!d) return [];
    var chunks = [];
    var els = safe(function () { return d.querySelectorAll(selector || 'span, a, div, li, p, h1, h2, h3'); }, null);
    if (els) {
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!isVisible(el)) continue;
        if (el.children && el.children.length) continue;
        var text = textOf(el);
        if (text) chunks.push(text);
      }
    }
    var own = textOf(d);
    if (own) chunks.push(own);
    return chunks;
  }

  function findDialog(doc) {
    var d = doc || root.document;
    return safe(function () {
      return d.querySelector('[role="dialog"]') || d.querySelector('[aria-modal="true"]');
    }, null);
  }

  function extractPhone(doc) {
    return safe(function () {
      var scopes = [];
      var header = findHeader(doc);
      if (header) scopes.push(header);
      var dialog = findDialog(doc);
      if (dialog) scopes.push(dialog);
      if (!scopes.length) scopes.push(doc);

      for (var s = 0; s < scopes.length; s++) {
        var scope = scopes[s];
        var tels = safe(function () { return scope.querySelectorAll('a[href^="tel:"]'); }, null);
        if (tels) {
          for (var i = 0; i < tels.length; i++) {
            var phone = N.extractPhonesFromHref(hrefOf(tels[i]));
            if (phone && phone.normalized) return phone;
          }
        }
      }
      for (var k = 0; k < scopes.length; k++) {
        var chunks = textChunks(scopes[k]);
        for (var c = 0; c < chunks.length; c++) {
          var found = N.extractPhones(chunks[c]);
          if (found.length) return found[0];
        }
      }
      return { raw: '', normalized: '' };
    }, { raw: '', normalized: '' });
  }

  function extractEmail(doc) {
    return safe(function () {
      var scopes = [];
      var header = findHeader(doc);
      if (header) scopes.push(header);
      var dialog = findDialog(doc);
      if (dialog) scopes.push(dialog);
      if (!scopes.length) scopes.push(doc);

      for (var s = 0; s < scopes.length; s++) {
        var anchors = safe(function () { return scopes[s].querySelectorAll('a[href^="mailto:"]'); }, null);
        if (anchors) {
          for (var i = 0; i < anchors.length; i++) {
            var raw = hrefOf(anchors[i]).replace(/^mailto:/i, '');
            var emails = N.extractEmails(raw);
            if (emails.length) return emails[0];
          }
        }
      }
      for (var k = 0; k < scopes.length; k++) {
        var chunks = textChunks(scopes[k]);
        for (var c = 0; c < chunks.length; c++) {
          var found = N.extractEmails(chunks[c]);
          if (found.length) return found[0];
        }
      }
      return '';
    }, '');
  }

  function extractPostContact(doc) {
    return safe(function () {
      var d = doc || root.document;
      var scopes = [];
      var dialog = findDialog(d);
      if (dialog) scopes.push(dialog);
      var article = safe(function () { return d.querySelector('article'); }, null);
      if (article) scopes.push(article);
      var main = safe(function () { return d.querySelector('main'); }, null);
      if (main) scopes.push(main);
      if (!scopes.length) scopes.push(d);

      var phone = null;
      var email = '';
      for (var s = 0; s < scopes.length && (!phone || !email); s++) {
        var scope = scopes[s];
        if (!phone) {
          var tels = safe(function () { return scope.querySelectorAll('a[href^="tel:"]'); }, null);
          if (tels) {
            for (var i = 0; i < tels.length && !phone; i++) {
              var tel = N.extractPhonesFromHref(hrefOf(tels[i]));
              if (tel && tel.normalized) phone = tel;
            }
          }
        }
        if (!email) {
          var mailtos = safe(function () { return scope.querySelectorAll('a[href^="mailto:"]'); }, null);
          if (mailtos) {
            for (var m = 0; m < mailtos.length && !email; m++) {
              var fromHref = N.extractEmails(hrefOf(mailtos[m]).replace(/^mailto:/i, ''));
              if (fromHref.length) email = fromHref[0];
            }
          }
        }
        var chunks = textChunks(scope);
        for (var c = 0; c < chunks.length; c++) {
          if (!phone) {
            var phones = N.extractPhones(chunks[c]);
            if (phones.length) phone = phones[0];
          }
          if (!email) {
            var emails = N.extractEmails(chunks[c]);
            if (emails.length) email = emails[0];
          }
        }
      }
      return { phone: phone || null, email: email || '' };
    }, { phone: null, email: '' });
  }

  function extractFollowers(doc) {
    return safe(function () {
      var header = findHeader(doc);
      if (header) {
        var fromHeader = N.parseFollowers(header.textContent || '');
        if (fromHeader) return fromHeader;
      }
      var metaDesc = safe(function () {
        var m = doc.querySelector('meta[name="description"]');
        return m ? (m.getAttribute('content') || '') : '';
      }, '');
      return N.parseFollowers(metaDesc);
    }, '');
  }

  function extractLocation(doc) {
    return safe(function () {
      var scopes = [];
      var header = findHeader(doc);
      if (header) scopes.push(header);
      var dialog = findDialog(doc);
      if (dialog) scopes.push(dialog);

      for (var s = 0; s < scopes.length; s++) {
        var blocks = headerTextBlocks(scopes[s]);
        for (var i = 0; i < blocks.length; i++) {
          var text = blocks[i].text;
          if (text.length < 3 || text.length > 80) continue;
          if (/followers|following|\bposts?\b|http/i.test(text)) continue;
          var labelled = text.match(/^(?:location|address)\s*[:\-–]\s*(.+)$/i);
          if (labelled) return N.collapseWhitespace(labelled[1]);
          if (/^(location|address)$/i.test(text)) {
            for (var j = i + 1; j < blocks.length; j++) {
              var next = blocks[j].text;
              if (next.length >= 3 && next.length <= 80 && !/^(phone|email|contact|call|website)$/i.test(next)) {
                return next;
              }
            }
            continue;
          }
          if (/\b(based in|located in|city|country)\b/i.test(text)) {
            return text.replace(/^(?:based in|located in)\s*[:\-–]?\s*/i, '');
          }
        }
        var geoLink = safe(function () {
          return scopes[s].querySelector('a[href*="/maps"], a[href*="maps.google"], a[href*="goo.gl/maps"], a[href*="maps.app.goo.gl"]');
        }, null);
        if (geoLink) {
          var label = textOf(geoLink);
          if (label) return label;
        }
      }
      return '';
    }, '');
  }

  function extractContactUiSignals(doc) {
    var signals = [];
    var header = findHeader(doc);
    if (!header) return signals;
    var labels = safe(function () {
      return header.querySelectorAll('button, a, [role="button"], span');
    }, null);
    if (!labels) return signals;
    var uiRe = /^(contact|call|email|book|booking|reserve|order|shop|whatsapp|get directions|view menu|appointments|send email|contact info|message)$/i;
    for (var i = 0; i < labels.length; i++) {
      var text = textOf(labels[i]);
      if (text && text.length <= 30 && uiRe.test(text)) {
        if (signals.indexOf(text.toLowerCase()) === -1) signals.push(text.toLowerCase());
      }
    }
    return signals;
  }

  root.FicinoProfileExtractor = {
    safe: safe,
    isVisible: isVisible,
    textOf: textOf,
    pageUrl: pageUrl,
    currentUsername: currentUsername,
    findHeader: findHeader,
    headerTextBlocks: headerTextBlocks,
    extractProfileLinks: extractProfileLinks,
    extractUsername: extractUsername,
    extractPostAuthor: extractPostAuthor,
    extractPostAuthors: extractPostAuthors,
    rankPostAuthors: rankPostAuthors,
    extractBusinessName: extractBusinessName,
    extractBio: extractBio,
    extractCategory: extractCategory,
    collectExternalLinks: collectExternalLinks,
    extractWebsite: extractWebsite,
    extractLinktree: extractLinktree,
    extractPhone: extractPhone,
    extractEmail: extractEmail,
    extractPostContact: extractPostContact,
    extractFollowers: extractFollowers,
    extractLocation: extractLocation,
    extractContactUiSignals: extractContactUiSignals,
    categoryLike: categoryLike
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
