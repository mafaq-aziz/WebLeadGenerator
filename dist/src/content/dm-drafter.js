(function (root) {
  'use strict';

  function findComposer(doc) {
    var candidates = [];
    try {
      candidates = doc.querySelectorAll('div[contenteditable="true"]');
    } catch (e) {
      return null;
    }
    var dialogScoped = [];
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (node.closest && node.closest('[role="dialog"]')) dialogScoped.push(node);
    }
    var pool = dialogScoped.length ? dialogScoped : Array.prototype.slice.call(candidates);
    for (var j = 0; j < pool.length; j++) {
      var parent = pool[j].parentNode;
      var label = String(pool[j].getAttribute('aria-label') || '') + ' ' +
        String(parent && parent.getAttribute ? (parent.getAttribute('aria-label') || '') : '');
      if (/message/i.test(label)) return pool[j];
    }
    if (dialogScoped.length) return dialogScoped[dialogScoped.length - 1];
    if (pool.length) return pool[pool.length - 1];
    return null;
  }

  function insertText(node, text) {
    node.focus();
    var ok = false;
    try {
      ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      node.textContent = text;
      var event;
      try {
        event = new InputEvent('input', { bubbles: true, cancelable: false });
      } catch (e) {
        event = document.createEvent('Event');
        event.initEvent('input', true, true);
      }
      node.dispatchEvent(event);
    }
    return !!node.textContent;
  }

  function pressEnter(node) {
    var types = ['keydown', 'keypress', 'keyup'];
    for (var i = 0; i < types.length; i++) {
      var event;
      try {
        event = new root.KeyboardEvent(types[i], {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        });
      } catch (e) {
        event = node.ownerDocument.createEvent('Event');
        event.initEvent(types[i], true, true);
      }
      node.dispatchEvent(event);
    }
  }

  function findSendButton(doc) {
    var selectors = ['[aria-label="Send"]', '[aria-label="Send message"]', '[aria-label="Send Message"]'];
    for (var i = 0; i < selectors.length; i++) {
      var nodes = [];
      try {
        nodes = doc.querySelectorAll(selectors[i]);
      } catch (e) {
        nodes = [];
      }
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (el.hidden) continue;
        var btn = el.closest ? (el.closest('[role="button"]') || el.closest('button')) : null;
        if (btn) return btn;
        if (el.getAttribute && el.getAttribute('role') === 'button') return el;
        if (el.parentElement) return el.parentElement;
      }
    }
    return null;
  }

  function composerCleared(node) {
    return !String(node.textContent || '').trim();
  }

  function pollCleared(node, deadline, done) {
    (function tick() {
      if (composerCleared(node)) {
        done(true);
        return;
      }
      if (Date.now() > deadline) {
        done(false);
        return;
      }
      setTimeout(tick, 200);
    })();
  }

  function sendVerified(node, respond) {
    pressEnter(node);
    pollCleared(node, Date.now() + 2000, function (sentByEnter) {
      if (sentByEnter) {
        respond({ ok: true, sent: true });
        return;
      }
      var btn = findSendButton(node.ownerDocument || root.document);
      if (btn && typeof btn.click === 'function') {
        try {
          btn.click();
        } catch (e) {
          /* ignore */
        }
      }
      pollCleared(node, Date.now() + 2000, function (sentByClick) {
        if (sentByClick) {
          respond({ ok: true, sent: true });
          return;
        }
        pressEnter(node);
        pollCleared(node, Date.now() + 1500, function (sentByRetry) {
          if (sentByRetry) {
            respond({ ok: true, sent: true });
            return;
          }
          respond({ ok: false, reason: 'send_failed' });
        });
      });
    });
  }

  function findMessageButton(doc) {
    var labels = ['message', 'send message', 'envoyer un message', 'envoyer message', 'enviar mensaje', 'nachricht senden'];
    var scopes = [];
    try {
      var header = doc.querySelector('header');
      if (header) scopes.push(header);
    } catch (e) {
      /* ignore */
    }
    scopes.push(doc);
    for (var s = 0; s < scopes.length; s++) {
      var nodes = [];
      try {
        nodes = scopes[s].querySelectorAll('[role="button"], button, a');
      } catch (e) {
        nodes = [];
      }
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var text = String(el.textContent || '').trim().toLowerCase();
        var aria = String(el.getAttribute && el.getAttribute('aria-label') || '').trim().toLowerCase();
        var href = String(el.getAttribute && el.getAttribute('href') || '');
        if (labels.indexOf(text) !== -1 || aria === 'message' || /^\/direct\//.test(href)) return el;
      }
    }
    return null;
  }

  function typeAndSend(text, deadline, respond) {
    (function poll() {
      var node = findComposer(root.document);
      if (node) {
        if (String(node.textContent || '').trim()) {
          respond({ ok: false, reason: 'composer_not_empty' });
          return;
        }
        var done = insertText(node, text);
        if (!done) {
          respond({ ok: false, reason: 'insert_failed' });
          return;
        }
        setTimeout(function () {
          if (!String(node.textContent || '').trim()) insertText(node, text);
          if (!String(node.textContent || '').trim()) {
            respond({ ok: false, reason: 'insert_failed' });
            return;
          }
          sendVerified(node, respond);
        }, 300);
        return;
      }
      if (Date.now() > deadline) {
        respond({ ok: false, reason: 'no_composer' });
        return;
      }
      setTimeout(poll, 300);
    })();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, respond) {
      if (!message || message.type !== 'OUTREACH_DRAFT') return false;
      var text = String(message.text || '');
      var recipient = String(message.recipient || '').replace(/^@/, '').toLowerCase();
      var ms = typeof message.deadlineMs === 'number' && message.deadlineMs > 0 ? message.deadlineMs : 20000;
      var deadline = Date.now() + ms;
      var clicked = false;
      (function poll() {
        var path = '';
        try {
          path = String((root.location && root.location.pathname) || '');
        } catch (e) {
          path = '';
        }
        if (/^\/accounts\/login/.test(path)) {
          respond({ ok: false, reason: 'login_required' });
          return;
        }
        if (/^\/direct\//.test(path)) {
          typeAndSend(text, deadline, respond);
          return;
        }
        if (!recipient) {
          respond({ ok: false, reason: 'no_recipient' });
          return;
        }
        if (clicked) {
          if (Date.now() > deadline) {
            respond({ ok: false, reason: 'thread_open_failed' });
            return;
          }
          setTimeout(poll, 300);
          return;
        }
        if (path.replace(/^\/|\/$/g, '').toLowerCase() !== recipient) {
          respond({ ok: false, reason: 'wrong_profile' });
          return;
        }
        var btn = findMessageButton(root.document);
        if (btn && typeof btn.click === 'function') {
          clicked = true;
          try {
            btn.click();
          } catch (e) {
            respond({ ok: false, reason: 'message_click_failed' });
            return;
          }
          setTimeout(poll, 300);
          return;
        }
        if (Date.now() > deadline) {
          respond({ ok: false, reason: 'no_message_button' });
          return;
        }
        setTimeout(poll, 300);
      })();
      return true;
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
