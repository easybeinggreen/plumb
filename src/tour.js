// A click-through tour of Plumb's main features. It highlights the real controls on the page (a spotlight
// plus a label card), so nothing here can drift from what the page actually has: a step whose control is
// missing or hidden (for example the pop-out button in a browser without it) is simply left out.

export const TAGLINE = 'Plumb is your desk companion and guardian angel, keeping you aligned in every way.';

// `sel` is the control to point at. Steps without `sel` are centred cards (the welcome and the last one).
// The order follows the screen: the buttons under the camera, left to right, then the header, then the
// right-hand column, top to bottom. (The pop-out button is left out on purpose: the card moves into its small
// window by itself when the camera starts, so the button is not something to learn.)
export const TOUR_STEPS = [
  { id: 'welcome', title: 'Welcome to Plumb', body: `${TAGLINE} Here is a quick tour of what it does, in the order you will meet it on the screen.`, next: 'take the tour' },

  // ---- under the camera ----
  { id: 'camera', sel: '#cameraToggleBtn', title: 'Start the camera', body: 'Plumb watches how you are sitting through your webcam. The video never leaves this device; only small numbers are saved. Press it again to stop.' },
  { id: 'calibrate', sel: '#calibrateBtn', title: 'Calibrate your plumb position', body: 'Sit the way you should be sitting, then press this. That becomes plumb for you, and everything is measured from it. It is kept for the day, and Plumb re-sets your sitting height itself after a break.' },
  { id: 'break', sel: '#breakToggleBtn', title: 'Start a break', body: 'Press it when you step away, or just leave: Plumb notices and counts the break. After too long sitting it changes to "time for a break".' },
  { id: 'nudges', sel: '.switch-item', title: 'Nudges on or muted', body: 'Turns the spoken nudges on or off, for example when you cannot have sound. The message still appears on screen.' },
  { id: 'focus', sel: '#pomodoroBtn', title: 'Focus', body: 'A distraction-free focus block: every alert pauses until it ends, then you get a short break. Tracking carries on quietly.' },
  { id: 'workstation', sel: '#ergoWizardBtn', title: 'Workstation setup', body: 'A one-off walkthrough of your desk: eye height against the screen, distance, lighting and desk basics, ending with calibration. Worth doing once.' },
  { id: 'gym', sel: '#deskGymBtn', title: 'Desk gym', body: 'Five quick seated stretches, each with a short note on why it helps and a link to a demo video. Only when you ask: Plumb never prompts you to do them.' },
  { id: 'look', sel: '#closeupBtn', title: 'How do I look?', body: 'Before a call: a live mirror, framing and lighting checks and a microphone test, all on this device, plus an optional AI look at your hair, clothes and background. It finishes with Ready for the call.' },
  { id: 'manual', sel: '#whyBtn', title: 'The manual', body: 'Why Plumb nudges you the way it does: the reasoning and evidence behind each alert and setting, in plain words.' },
  { id: 'settings', sel: '#gearBtn', title: 'Settings', body: 'Sensitivity, timings, water target and working hours, reminders, the focus timer, the daily wrap, the voice, your camera and your name.' },

  // ---- the header ----
  { id: 'wrap', sel: '#wrapBtn', title: "Today's wrap", body: 'Your day so far in one window: time tracked, how much of it you were plumb against yesterday, breaks, your longest sit, your roughest hour and your water.' },
  { id: 'report', sel: '#reportBtn', title: 'Your charts', body: 'Today, this week and this month: how much of the time you were plumb, a colour strip for every minute of every day, with your breaks and your water. Click a day for its detail.' },

  // ---- the right-hand column ----
  { id: 'dot', sel: '#statusCard', title: 'The dot and the loop', body: 'The dot shows where you are. Inside the dashed loop you are plumb; stay outside it for a while and Plumb gives you a spoken nudge. In Chrome this card moves into a small always-on-top window when you start the camera, so it stays in view.' },
  { id: 'water', sel: '.hydration-col', title: 'Hydration', body: 'Tap glass, mug, can or bottle when you drink. The dashed line shows where you would be if you drank evenly through your working day.' },
  { id: 'light', sel: '.gauge-col-light', title: 'Ambient brightness', body: 'How bright the room is and which side the light comes from, so you can spot glare before it tires your eyes.' },
  { id: 'ring', sel: '.gauge-col-break', title: 'Break countdown', body: 'The ring counts down to your next break, turns to "break due" when it is time, and the line under it totals your break time today.' },
  { id: 'tips', sel: '#weeklyGoalsPanel', title: 'Plumb Tips', body: 'Press run 7 day summary for two points from your last 7 days, each with the numbers behind it and something to do about it. It can take a few seconds, sometimes a minute or two.' },
  { id: 'activity', sel: '#activityToggle', title: 'Recent activity', body: 'A short log of what Plumb has done today: calibrations, breaks and nudges. It stays tucked away until you open it.' },

  { id: 'done', title: "That's the tour", body: 'You can take it again any time from the ? button at the top. Start the camera to begin.', next: 'done' }
];

// Where to put the label card so it is fully on screen and does not cover the highlighted control.
// Rects are { top, left, width, height } in viewport pixels. Prefers below, then above, then beside,
// and centres in the window when nothing fits (a very tall control).
export function placeTooltip(target, card, vp, gap = 14, margin = 12) {
  const clampX = (x) => Math.max(margin, Math.min(x, vp.width - card.width - margin));
  const clampY = (y) => Math.max(margin, Math.min(y, vp.height - card.height - margin));
  const centreX = clampX(target.left + target.width / 2 - card.width / 2);
  const bottom = target.top + target.height;
  if (bottom + gap + card.height <= vp.height - margin) return { placement: 'below', top: bottom + gap, left: centreX };
  if (target.top - gap - card.height >= margin) return { placement: 'above', top: target.top - gap - card.height, left: centreX };
  const right = target.left + target.width;
  if (right + gap + card.width <= vp.width - margin) return { placement: 'right', top: clampY(target.top + target.height / 2 - card.height / 2), left: right + gap };
  if (target.left - gap - card.width >= margin) return { placement: 'left', top: clampY(target.top + target.height / 2 - card.height / 2), left: target.left - gap - card.width };
  return { placement: 'center', top: clampY((vp.height - card.height) / 2), left: clampX((vp.width - card.width) / 2) };
}

const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

// Runs the tour. `onClose(how)` is called with 'done' or 'skip' once it ends.
export function startTour({ onClose } = {}) {
  const steps = TOUR_STEPS.filter((s) => !s.sel || visible(document.querySelector(s.sel)));
  let i = 0;

  const root = document.createElement('div');
  root.className = 'tour-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Plumb tour');
  root.innerHTML = `<div class="tour-hole"></div>
    <div class="tour-card" tabindex="-1">
      <div class="tour-count"></div>
      <h3 class="tour-title"></h3>
      <p class="tour-body"></p>
      <div class="tour-actions">
        <button type="button" class="link-btn tour-skip">skip tour</button>
        <span class="tour-nav"><button type="button" class="btn-compact tour-back">back</button> <button type="button" class="btn tour-next">next</button></span>
      </div>
    </div>`;
  document.body.appendChild(root);
  const hole = root.querySelector('.tour-hole'), card = root.querySelector('.tour-card');
  const count = root.querySelector('.tour-count'), title = root.querySelector('.tour-title'), body = root.querySelector('.tour-body');
  const backBtn = root.querySelector('.tour-back'), nextBtn = root.querySelector('.tour-next'), skipBtn = root.querySelector('.tour-skip');

  function layout() {
    const s = steps[i];
    const el = s.sel ? document.querySelector(s.sel) : null;
    root.classList.toggle('tour-centred', !el);
    if (el) {
      const r = el.getBoundingClientRect(), pad = 6;
      hole.style.cssText = `top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
      const c = card.getBoundingClientRect();
      const p = placeTooltip({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 }, { width: c.width, height: c.height }, { width: window.innerWidth, height: window.innerHeight });
      card.style.top = p.top + 'px'; card.style.left = p.left + 'px'; card.style.transform = 'none';
    } else {
      hole.style.cssText = 'display:none;';
      card.style.top = '50%'; card.style.left = '50%'; card.style.transform = 'translate(-50%, -50%)';
    }
  }

  function show() {
    const s = steps[i];
    const el = s.sel ? document.querySelector(s.sel) : null;
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const middle = s.sel ? `${i} of ${steps.length - 2}` : '';
    count.textContent = middle; count.hidden = !middle;
    title.textContent = s.title; body.textContent = s.body;
    backBtn.hidden = i === 0;
    nextBtn.textContent = s.next || 'next';
    skipBtn.hidden = i === steps.length - 1;
    layout();                                   // now, so it never depends on animation-frame timing
    requestAnimationFrame(layout);              // and again once the browser has settled
    nextBtn.focus({ preventScroll: true });
  }

  function close(how) {
    window.removeEventListener('resize', layout);
    window.removeEventListener('scroll', layout, true);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    if (onClose) onClose(how);
  }
  function next() { if (i >= steps.length - 1) close('done'); else { i++; show(); } }
  function back() { if (i > 0) { i--; show(); } }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close('skip'); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (e.target === skipBtn || e.target === backBtn) return; e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  }
  nextBtn.addEventListener('click', next);
  backBtn.addEventListener('click', back);
  skipBtn.addEventListener('click', () => close('skip'));
  window.addEventListener('resize', layout);
  window.addEventListener('scroll', layout, true);
  document.addEventListener('keydown', onKey, true);
  show();
  return { close };
}
