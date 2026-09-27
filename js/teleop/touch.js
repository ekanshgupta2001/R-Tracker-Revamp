// ── R-Tracker TeleOp — Touch Thumbsticks ─────────────────────────────────
// Two on-screen sticks for phones and tablets: the left one drives and strafes
// (a gamepad's left stick, lx/ly), the right one turns (the right stick's x, rx).
// They only write touchInp; drive.js reads it in updateBot() between the gamepad
// and the keyboard, through the same deadzone and input-latency buffer, so the
// physics, par times and ratings are exactly those of a gamepad.
//
// The sticks show when the device's primary pointer is coarse or the first touch
// lands (html.rt-touch), and hide while a gamepad is connected (html.rt-gamepad).
// Pointer events with capture, so a thumb that slides off the stick keeps
// steering until it lifts; touch-action: none on the stick keeps the page still.

const touchInp = { lx: 0, ly: 0, rx: 0, left: false, right: false };

(function () {
  const root = document.documentElement;
  function showSticks() {
    if (root.classList.contains('rt-touch')) return;
    root.classList.add('rt-touch');
    resize();                                 // the sticks take room from the field (field.js)
  }
  if (window.matchMedia('(pointer: coarse)').matches) root.classList.add('rt-touch');
  window.addEventListener('touchstart', showSticks, { passive: true, once: true });
  window.addEventListener('gamepadconnected', () => { root.classList.add('rt-gamepad'); resize(); });
  window.addEventListener('gamepaddisconnected', () => {
    if (!navigator.getGamepads || ![].some.call(navigator.getGamepads(), Boolean)) { root.classList.remove('rt-gamepad'); resize(); }
  });

  function bind(id, axisX, axisY, flag) {
    const base = document.getElementById(id);
    if (!base) return;
    const knob = base.querySelector('.stick-knob');
    let pid = null;

    function set(e) {
      const r = base.getBoundingClientRect();
      const reach = (axisY ? Math.min(r.width, r.height) : r.width) / 2 - knob.offsetWidth / 4;
      let x = (e.clientX - (r.left + r.width / 2)) / reach;
      let y = axisY ? (e.clientY - (r.top + r.height / 2)) / reach : 0;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      touchInp[axisX] = x;
      if (axisY) touchInp[axisY] = y;
      knob.style.transform = `translate(${x * reach}px, ${y * reach}px)`;
    }
    function release(e) {
      if (e.pointerId !== pid) return;
      pid = null;
      touchInp[flag] = false;
      touchInp[axisX] = 0;
      if (axisY) touchInp[axisY] = 0;
      knob.style.transform = '';
      base.classList.remove('held');
    }
    base.addEventListener('pointerdown', e => {
      if (pid !== null) return;
      pid = e.pointerId;
      base.setPointerCapture(pid);
      touchInp[flag] = true;
      base.classList.add('held');
      set(e);
      e.preventDefault();
    });
    base.addEventListener('pointermove', e => { if (e.pointerId === pid) set(e); });
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);
    base.addEventListener('lostpointercapture', release);
  }
  bind('stick-l', 'lx', 'ly', 'left');
  bind('stick-r', 'rx', null, 'right');
})();
