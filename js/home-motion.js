// ── R-Tracker Home — motion (GSAP, vendored in vendor/gsap/) ─────────────────
// The entrance choreography, the depth parallax of the sky, and the CTA's
// magnetic pull. Everything here is decoration: every tween ends on the page's
// natural layout, and with prefers-reduced-motion (or without GSAP) the page is
// exactly what the markup and CSS draw.
//
// The <head> boot script adds html.rt-intro (content at opacity 0) only when
// motion is allowed; this file removes it as soon as the timeline owns the
// elements, and the boot script removes it after 2.5 s regardless, so the page
// can never stay hidden. When the entrance has finished, <html> carries
// data-intro="done" (tests wait on it).

(function () {
  'use strict';
  var html = document.documentElement;
  function done() { html.classList.remove('rt-intro'); html.setAttribute('data-intro', 'done'); }
  if (!window.gsap) { done(); return; }
  var gsap = window.gsap;
  if (window.SplitText) gsap.registerPlugin(window.SplitText);

  var mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', function () {
    var q = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
    var ease = 'power3.out';
    var tl = gsap.timeline({ defaults: { ease: ease }, onComplete: done });

    // 1. top bar
    tl.from('.home-brand', { y: -14, opacity: 0, duration: 0.6 }, 0)
      .from('.home-actions > *', { y: -14, opacity: 0, duration: 0.6, stagger: 0.06 }, 0.05);

    // 2. the greeting rises word by word out of a mask, then the subtitle
    var h1 = document.getElementById('home-greeting-title'), split = null;
    if (h1 && window.SplitText) {
      split = SplitText.create(h1, { type: 'words', mask: 'words' });
      tl.from(split.words, { yPercent: 110, duration: 0.8, stagger: 0.07, ease: 'power4.out',
        onComplete: function () { split.revert(); } }, 0.12);
    } else if (h1) {
      tl.from(h1, { y: 18, opacity: 0, duration: 0.7 }, 0.12);
    }
    tl.from('.home-greeting p', { y: 12, opacity: 0, duration: 0.7 }, 0.35);

    // 3. the welcome card and the hero rise in
    var fr = document.getElementById('rt-first-run');
    if (fr && !fr.hidden) tl.from(fr, { y: 22, opacity: 0, duration: 0.8 }, 0.3);
    tl.from('#home-hero-teleop', { y: 26, opacity: 0, duration: 0.9 }, 0.4)
      .from('#home-hero-teleop .hero-main > *', { y: 12, opacity: 0, duration: 0.6, stagger: 0.06 }, 0.55)
      .from('#hero-field', { scale: 0.94, opacity: 0, duration: 0.8 }, 0.6);

    // 4. the progress bar fills and the count runs up to its value
    var fill = document.getElementById('hero-bar-fill'), prog = document.getElementById('hero-progress');
    if (fill) tl.from(fill, { width: 0, duration: 1.0, ease: 'power2.out' }, 0.8);
    if (prog) {
      var m = /^(\d+) \/ (\d+)$/.exec(prog.textContent);
      if (m && +m[1] > 0) {
        var c = { v: 0 }, total = m[2];
        tl.to(c, { v: +m[1], duration: 1.0, ease: 'power2.out', snap: { v: 1 },
          onUpdate: function () { prog.textContent = c.v + ' / ' + total; } }, 0.8);
      }
    }
    tl.from('.hero-stat', { x: 14, opacity: 0, duration: 0.6, stagger: 0.08 }, 0.7);

    // 5. the curriculum: the sheet, then the finished steps light up left to right,
    //    then the current ring pulses once
    tl.from('#home-curriculum', { y: 24, opacity: 0, duration: 0.8 }, 0.55);
    var doneDots = q('#home-stepper .step-done .step-dot');
    if (doneDots.length) tl.from(doneDots, { scale: 0, duration: 0.45, stagger: 0.09, ease: 'back.out(2)' }, 0.85);
    var cur = document.querySelector('#home-stepper .step-current .step-dot');
    if (cur) tl.fromTo(cur, { scale: 1 }, { scale: 1.3, duration: 0.25, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 0.95 + doneDots.length * 0.09);

    // 6. the tools
    tl.from('.home-tools-title', { y: 10, opacity: 0, duration: 0.6 }, 0.7)
      .from('.tool-card', { y: 22, opacity: 0, duration: 0.7, stagger: 0.08 }, 0.75);

    // everything is in its from-state now: reveal the page
    html.classList.remove('rt-intro');

    // ── depth parallax: the pointer drifts the sky layers by their depth ──
    var atm = document.getElementById('rt-atmosphere');
    var onMove = null;
    if (atm && window.matchMedia('(pointer: fine)').matches) {
      atm.classList.add('rt-parallax');
      var px = gsap.quickTo(atm, '--px', { duration: 1.4, ease: 'power3.out' });
      var py = gsap.quickTo(atm, '--py', { duration: 1.4, ease: 'power3.out' });
      onMove = function (e) {
        px((e.clientX / window.innerWidth - 0.5) * 2);
        py((e.clientY / window.innerHeight - 0.5) * 2);
      };
      window.addEventListener('pointermove', onMove, { passive: true });
    }

    // ── the gold CTA leans toward the cursor (at most 6 px) ──
    var cta = document.getElementById('hero-cta'), ctaMove = null, ctaLeave = null;
    if (cta) {
      var cx = gsap.quickTo(cta, 'x', { duration: 0.5, ease: 'power3.out' });
      var cy = gsap.quickTo(cta, 'y', { duration: 0.5, ease: 'power3.out' });
      ctaMove = function (e) {
        var r = cta.getBoundingClientRect();
        cx(((e.clientX - r.left) / r.width - 0.5) * 12);
        cy(((e.clientY - r.top) / r.height - 0.5) * 8);
      };
      ctaLeave = function () { cx(0); cy(0); };
      cta.addEventListener('pointermove', ctaMove);
      cta.addEventListener('pointerleave', ctaLeave);
    }

    // undone if the user turns reduced motion on while the page is open
    return function () {
      if (onMove) window.removeEventListener('pointermove', onMove);
      if (atm) { atm.classList.remove('rt-parallax'); atm.style.removeProperty('--px'); atm.style.removeProperty('--py'); }
      if (cta) { cta.removeEventListener('pointermove', ctaMove); cta.removeEventListener('pointerleave', ctaLeave); }
      if (split) split.revert();
      done();
    };
  });
  // reduced motion: nothing animates
  mm.add('(prefers-reduced-motion: reduce)', function () { done(); });
})();
