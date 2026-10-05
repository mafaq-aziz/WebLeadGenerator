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

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, respond) {
      if (!message || message.type !== 'OUTREACH_DRAFT') return false;
      var text = String(message.text || '');
      var deadline = Date.now() + 20000;
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
            pressEnter(node);
            respond({ ok: true, sent: true });
          }, 300);
          return;
        }
        if (Date.now() > deadline) {
          respond({ ok: false, reason: 'no_composer' });
          return;
        }
        setTimeout(poll, 300);
      })();
      return true;
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
