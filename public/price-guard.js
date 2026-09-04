/**
 * Price freshness guard.
 *
 * The site is static, so a page built on Monday would keep asserting Monday's
 * price for as long as it sits in the CDN. The Amazon Associates terms require
 * a displayed price to be current or removed, so the page re-checks its own
 * timestamps against the visitor's clock and takes stale prices down itself.
 *
 * Build-time filtering still happens in Price.astro; this is the second gate,
 * and the only one that keeps working after the build.
 */
(function () {
  'use strict';

  var MAX_AGE_HOURS = 24;

  function guard() {
    var nodes = document.querySelectorAll('[data-price]');
    var now = Date.now();

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var checkedAt = el.getAttribute('data-checked-at');
      var t = checkedAt ? Date.parse(checkedAt) : NaN;

      // No timestamp, an unparseable one, or a future one: treat as untrustworthy.
      var stale = !isFinite(t) || t > now || now - t >= MAX_AGE_HOURS * 3600 * 1000;
      if (!stale) continue;

      var label = el.getAttribute('data-stale-label') || 'Check current price on Amazon';
      var span = document.createElement('span');
      span.className = 'stale';
      span.textContent = label;

      el.textContent = '';
      el.appendChild(span);

      // Drop the "checked on <date>" note with the price it belonged to.
      // Matched by id, not by DOM position: the note is not always a sibling,
      // and a note left behind claims a price that is no longer displayed.
      var id = el.getAttribute('data-price');
      if (id) {
        var note = document.querySelector('[data-price-note="' + id + '"]');
        if (note && note.parentNode) note.parentNode.removeChild(note);
      }

      el.removeAttribute('data-checked-at');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guard);
  } else {
    guard();
  }

  // A tab left open overnight must not keep showing yesterday's price.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) guard();
  });
  setInterval(guard, 10 * 60 * 1000);
})();
