// Pure logic for hydration pacing and reminders, kept free of the DOM so it
// can be tested with real timestamps. "Minutes" below always means minutes
// since local midnight.

export const PACE_BEHIND_NUDGE_ML = 300;   // how far behind pace before a nudge is worth it
export const PACE_ON_TRACK_ML = 150;       // within this either side reads as "on pace"
export const PACE_NUDGE_COOLDOWN_MS = 60 * 60 * 1000;
export const PACE_NO_NUDGE_LAST_MIN = 60;  // no chug-your-water nudges in the last hour of the day window
export const REMINDER_GRACE_MIN = 10;      // a time reminder still fires up to this late (e.g. after a call ends)

export function hhmmToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h >= 0 && h < 24 && mm >= 0 && mm < 60 ? h * 60 + mm : null;
}

export function minutesToHhmm(min) {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function minutesNow(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

// How much you "should" have drunk by now if intake were spread evenly across
// the active window. Nothing expected before the window, everything after it.
export function expectedIntakeMl(targetMl, startMin, endMin, nowMin) {
  if (!(targetMl > 0) || !(endMin > startMin)) return 0;
  const frac = (nowMin - startMin) / (endMin - startMin);
  return targetMl * Math.max(0, Math.min(1, frac));
}

export function paceStatus({ consumedMl, targetMl, startMin, endMin, nowMin }) {
  const expectedMl = expectedIntakeMl(targetMl, startMin, endMin, nowMin);
  const behindMl = expectedMl - consumedMl; // positive = behind pace
  let state;
  if (nowMin < startMin) state = 'before';
  else if (behindMl >= PACE_BEHIND_NUDGE_ML) state = 'behind';
  else if (behindMl > PACE_ON_TRACK_ML) state = 'slightly-behind';
  else if (behindMl < -PACE_ON_TRACK_ML) state = 'ahead';
  else state = 'on';
  return { expectedMl, behindMl, state, minutesLeft: endMin - nowMin };
}

const round50 = (n) => Math.max(50, Math.round(n / 50) * 50);

const BEHIND_PHRASES = [
  (ml) => `You're about ${ml}ml behind for this time of day. Have a drink.`,
  (ml) => `Water check: roughly ${ml}ml behind pace. Time for a glass.`,
  (ml) => `You've fallen about ${ml}ml behind today. Have some water.`
];

export function hydrationNudgeText(behindMl, variant = 0) {
  return BEHIND_PHRASES[variant % BEHIND_PHRASES.length](round50(behindMl));
}

export function shouldNudgeHydration({ status, nowMs, lastNudgeMs }) {
  if (status.state !== 'behind') return false;
  if (status.minutesLeft < PACE_NO_NUDGE_LAST_MIN) return false;
  return !lastNudgeMs || nowMs - lastNudgeMs >= PACE_NUDGE_COOLDOWN_MS;
}

// Text on the hydration card, e.g. "on pace" / "400ml behind pace".
export function paceLabel(status) {
  if (status.state === 'before') return '';
  if (status.state === 'ahead') return 'ahead of pace';
  if (status.state === 'on') return 'on pace';
  return `${round50(status.behindMl)}ml behind pace`;
}

// ---- Reminders --------------------------------------------------------------
// { id, text, kind: 'time' | 'every', time: 'HH:MM', everyMin, weekdaysOnly, enabled }
// lastFiredMs: when this reminder last fired (epoch ms) or undefined.
// windowStartMin/windowEndMin: active hours, used by 'every' reminders.

export function reminderDue(r, now, lastFiredMs, windowStartMin, windowEndMin) {
  if (!r || r.enabled === false || !r.text) return false;
  const day = now.getDay();
  if (r.weekdaysOnly && (day === 0 || day === 6)) return false;
  const nowMin = minutesNow(now);

  if (r.kind === 'every') {
    const every = Number(r.everyMin);
    if (!(every >= 5)) return false;
    if (nowMin < windowStartMin || nowMin > windowEndMin) return false;
    if (!lastFiredMs) return false; // first sighting only starts the clock (see seedEvery)
    return now.getTime() - lastFiredMs >= every * 60000;
  }

  const at = hhmmToMinutes(r.time);
  if (at === null) return false;
  if (nowMin < at || nowMin - at > REMINDER_GRACE_MIN) return false;
  // Already fired today for this slot?
  if (lastFiredMs) {
    const last = new Date(lastFiredMs);
    if (last.toDateString() === now.toDateString() && minutesNow(last) >= at) return false;
  }
  return true;
}

// Pulls a clock time out of goal text like "At 1:30pm, take a walk" / "at 9am".
export function parseGoalTime(text) {
  const m = /\b(?:at|by|around|before)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(String(text || ''));
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  if (h < 1 || h > 12 || mm > 59) return null;
  const pm = m[3].toLowerCase() === 'pm';
  if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12;
  return minutesToHhmm(h * 60 + mm);
}

export function describeReminder(r) {
  const days = r.weekdaysOnly ? 'weekdays' : 'every day';
  return r.kind === 'every' ? `every ${r.everyMin} min` : `${r.time} ${days}`;
}
