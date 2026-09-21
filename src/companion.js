// Pure logic for hydration pacing and reminders, kept free of the DOM so it
// can be tested with real timestamps. "Minutes" below always means minutes
// since local midnight.

export const PACE_BEHIND_NUDGE_ML = 300;   // how far behind pace before a nudge is worth it
export const PACE_ON_TRACK_ML = 150;       // within this either side reads as "on pace"
export const PACE_NUDGE_COOLDOWN_MS = 60 * 60 * 1000;
export const PACE_NO_NUDGE_FIRST_MIN = 60; // no water nudge in the first hour after the day starts
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
  return { expectedMl, behindMl, state, minutesLeft: endMin - nowMin, minutesIn: nowMin - startMin };
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
  if (status.minutesIn < PACE_NO_NUDGE_FIRST_MIN) return false;
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

export function reminderDue(r, now, lastFiredMs, windowStartMin, windowEndMin, graceMin = REMINDER_GRACE_MIN) {
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
  if (nowMin < at || nowMin - at > graceMin) return false;
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

// ---- Focus timer (Pomodoro) --------------------------------------------------
export const POMODORO_DEFAULTS = { focus: 25, short: 5, long: 15, rounds: 4 };

export function newPomodoroState(dateStr) {
  return { date: dateStr, phase: 'idle', endsAt: null, round: 0, completedToday: 0 };
}
export function rolloverPomodoro(state, dateStr) {
  return state && state.date === dateStr ? state : newPomodoroState(dateStr);
}
export function startFocus(state, nowMs, cfg) {
  return { ...state, phase: 'focus', endsAt: nowMs + cfg.focus * 60000 };
}
export function stopPomodoro(state) {
  return { ...state, phase: 'idle', endsAt: null };
}
// Advances the timer if the current phase has ended. Returns the new state and,
// when something just finished, an event the caller can announce. Focus ends
// straight into the break; a break ends into idle (waits for you to start the
// next block -- nothing auto-starts).
export function tickPomodoro(state, nowMs, cfg) {
  if (state.phase === 'idle' || state.endsAt === null || nowMs < state.endsAt) return { state, event: null };
  if (state.phase === 'focus') {
    const round = state.round + 1;
    const long = round % cfg.rounds === 0;
    const breakMin = long ? cfg.long : cfg.short;
    return {
      state: { ...state, round, completedToday: state.completedToday + 1, phase: long ? 'long' : 'short', endsAt: nowMs + breakMin * 60000 },
      event: { type: 'focus-done', breakMin, long, round }
    };
  }
  return { state: { ...state, phase: 'idle', endsAt: null }, event: { type: 'break-done' } };
}
export function pomodoroRemainingMs(state, nowMs) {
  return state.endsAt ? Math.max(0, state.endsAt - nowMs) : 0;
}
export function formatMmSs(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// kind: 'nudge' (posture/light), 'break', 'stillness', 'hydration', 'reminder',
// 'wrap', 'pomodoro'. A focus block freezes everything except the timer's own
// messages; during a timer break Plumb's own "take a break / move" prompts are
// redundant (the timer IS the break rhythm) but everything else may speak.
export function pomodoroBlocksAlert(state, kind) {
  if (state.phase === 'focus') return kind !== 'pomodoro';
  if (state.phase === 'short' || state.phase === 'long') return kind === 'break' || kind === 'stillness';
  return false;
}

// ---- End-of-day wrap ---------------------------------------------------------
const SLOUCH_LABELS = { lateral_left: 'leaning left', lateral_right: 'leaning right', compression: 'neck dropping', lean_in: 'leaning in', sitting_low: 'sitting low' };

export function formatDuration(totalSec) {
  const mins = Math.round(totalSec / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}
export function hourLabel(h) {
  return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
}

// Spreads a block across the local hours it covers, in whole-minute chunks.
function addByHour(bucket, startIso, durationSec) {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return;
  for (let t = 0; t < durationSec; t += 60) {
    const h = new Date(start + t * 1000).getHours();
    bucket[h] = (bucket[h] || 0) + Math.min(60, durationSec - t);
  }
}

export function buildDayWrap({ events, hydrationMl, targetMl, tomatoes = 0, alertsCount = null, prevPctWell = null, goal = null }) {
  let tracked = 0, slouch = 0, breaks = 0, breakSec = 0, longestSit = 0;
  const byType = {}, hourTracked = {}, hourSlouch = {};
  events.forEach((e) => {
    const dur = e.duration_seconds || 0;
    if (e.type === 'presence') {
      tracked += dur;
      longestSit = Math.max(longestSit, dur);
      if (e.start_time) addByHour(hourTracked, e.start_time, dur);
    } else if (SLOUCH_LABELS[e.type]) {
      slouch += dur;
      byType[e.type] = (byType[e.type] || 0) + dur;
      if (e.start_time) addByHour(hourSlouch, e.start_time, dur);
    } else if (e.type === 'break') {
      breaks++;
      breakSec += dur;
    }
  });
  if (tracked < 600) return { hasData: false };

  const pctWell = Math.max(0, Math.min(100, Math.round((1 - Math.min(slouch, tracked) / tracked) * 100)));
  const rows = [];
  rows.push({ label: 'tracked', value: formatDuration(tracked) });
  rows.push({ label: 'sitting well', value: `${pctWell}%`, note: prevPctWell != null ? `yesterday ${prevPctWell}%` : null });
  rows.push({ label: 'breaks', value: breaks > 0 ? `${breaks} (${formatDuration(breakSec)} in total)` : 'none taken' });
  rows.push({ label: 'longest sit', value: formatDuration(longestSit), note: longestSit >= 90 * 60 ? 'worth breaking up' : null });

  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  if (topType && slouch >= 120) {
    rows.push({ label: 'most common', value: SLOUCH_LABELS[topType[0]], note: `${Math.round((topType[1] / slouch) * 100)}% of slouch time` });
  }

  const hours = Object.keys(hourTracked).map(Number).filter((h) => hourTracked[h] >= 15 * 60)
    .map((h) => ({ h, ratio: (hourSlouch[h] || 0) / hourTracked[h], slouchSec: hourSlouch[h] || 0 }));
  if (hours.length >= 2) {
    const steadiest = [...hours].sort((a, b) => a.ratio - b.ratio)[0];
    const roughest = [...hours].sort((a, b) => b.ratio - a.ratio)[0];
    if (roughest.h !== steadiest.h && roughest.slouchSec >= 180 && roughest.ratio >= 0.2) {
      rows.push({ label: 'steadiest hour', value: `${hourLabel(steadiest.h)} (${Math.round((1 - steadiest.ratio) * 100)}%)` });
      rows.push({ label: 'roughest hour', value: `${hourLabel(roughest.h)} (${Math.round((1 - roughest.ratio) * 100)}%)` });
    }
  }

  if (targetMl > 0) rows.push({ label: 'water', value: `${hydrationMl}ml of ${targetMl}ml`, note: `${Math.round((hydrationMl / targetMl) * 100)}%` });
  if (tomatoes > 0) rows.push({ label: 'focus blocks', value: String(tomatoes) });
  if (alertsCount !== null) rows.push({ label: 'alerts from Plumb', value: String(alertsCount), note: alertsCount === 0 ? 'quiet day' : null });

  let headline = `Sitting well ${pctWell}% of ${formatDuration(tracked)} tracked.`;
  if (prevPctWell != null && Math.abs(pctWell - prevPctWell) >= 3) {
    headline += ` ${Math.abs(pctWell - prevPctWell)} points ${pctWell > prevPctWell ? 'better' : 'lower'} than yesterday.`;
  }
  return { hasData: true, headline, rows, goal };
}

// Sitting-well % for a set of events, or null if too little was tracked.
export function sittingWellPct(events) {
  let tracked = 0, slouch = 0;
  events.forEach((e) => {
    const d = e.duration_seconds || 0;
    if (e.type === 'presence') tracked += d;
    else if (SLOUCH_LABELS[e.type]) slouch += d;
  });
  if (tracked < 600) return null;
  return Math.max(0, Math.min(100, Math.round((1 - Math.min(slouch, tracked) / tracked) * 100)));
}

// Names are only labels (see the "User identity" note in main.js), but "Paul",
// "paul" and "Paul " would each become a separate person with separate data.
// Collapse whitespace, cap the length, and if the typed name matches a name
// already used on this device ignoring capitals, reuse that spelling.
export function normaliseUserName(raw, knownNames = []) {
  const cleaned = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  if (!cleaned) return '';
  const match = knownNames.find((k) => String(k).toLowerCase() === cleaned.toLowerCase());
  return match || cleaned;
}
