// Reveal-on-scroll, staggered. Respects prefers-reduced-motion.
(function () {
  // Safety net: nothing on the public site is ever editable. If a stale
  // contenteditable attribute survives a save, strip it before a visitor can
  // type into the page. Edit mode re-applies these after this runs.
  document.querySelectorAll('[contenteditable]').forEach(function (el) {
    el.removeAttribute('contenteditable');
  });

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
  } else {
    var seen = new WeakMap();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var parent = el.parentElement;
        var idx = seen.get(parent) || 0;
        seen.set(parent, idx + 1);
        el.style.transitionDelay = Math.min(idx * 70, 280) + 'ms';
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  }

  // Looping demo videos: play only while on screen, and not at all if the
  // visitor prefers reduced motion. Covers autoplay policies that ignore the
  // attribute, and stops several loops from decoding off screen at once.
  var vids = document.querySelectorAll('video[muted][loop]');
  if (vids.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      vids.forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); v.setAttribute('controls', ''); });
    } else {
      var vio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.play().catch(function () {}); }
          else { e.target.pause(); }
        });
      }, { rootMargin: '120px' });
      vids.forEach(function (v) { vio.observe(v); });
    }
  }
})();
