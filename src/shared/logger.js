(function (root) {
  'use strict';

  var PREFIX = '[Ficino]';
  var enabled = false;

  function fmt(tag, args) {
    return [PREFIX, '[' + tag + ']'].concat(Array.prototype.slice.call(args));
  }

  var Log = {
    setEnabled: function (value) {
      enabled = !!value;
    },
    isEnabled: function () {
      return enabled;
    },
    debug: function (tag) {
      if (!enabled) return;
      try {
        console.log.apply(console, fmt(tag, Array.prototype.slice.call(arguments, 1)));
      } catch (e) { /* logging must never break the caller */ }
    },
    warn: function (tag) {
      try {
        console.warn.apply(console, fmt(tag, Array.prototype.slice.call(arguments, 1)));
      } catch (e) { /* ignore */ }
    },
    error: function (tag) {
      try {
        console.error.apply(console, fmt(tag, Array.prototype.slice.call(arguments, 1)));
      } catch (e) { /* ignore */ }
    }
  };

  root.FicinoLog = Log;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Log;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
