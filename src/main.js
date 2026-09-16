import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as piperTTS from '@mintplex-labs/piper-tts-web';

// ---- Supabase config ----
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SYNC_CONFIGURED = SUPABASE_URL.startsWith('http') && !!SUPABASE_ANON_KEY;

// ---- User identity ----
// Not real auth -- just a per-device label so two people using the same
// browser (or the same Supabase project) don't see or overwrite each other's
// data. Nothing here is a password or a security boundary; see README.
// The picker overlay defaults to visible in the HTML itself (avoids a flash
// of the real app before JS can hide it). If a name is already stored, hide
// it immediately; otherwise wire it up and leave it blocking the page.
let currentUserId = localStorage.getItem('plumb:userId') || '';
if (currentUserId) {
  document.getElementById('userModalOverlay').classList.remove('open');
} else {
  showUserPicker();
}

// ---- DOM references (all at top) ----
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const placeholder = document.getElementById('placeholder');
const alignBadge = document.getElementById('alignBadge');
const calibrateFlash = document.getElementById('calibrateFlash');
const trackingSummary = document.getElementById('trackingSummary');
const tsHeroNum = document.getElementById('tsHeroNum');
const tsTimelineChart = document.getElementById('tsTimelineChart');
const tsStats = document.getElementById('tsStats');

const cameraToggleBtn = document.getElementById('cameraToggleBtn');
const cameraSelect = document.getElementById('cameraSelect');
const calibrateBtn = document.getElementById('calibrateBtn');
const breakToggleBtn = document.getElementById('breakToggleBtn');
const testVoiceBtn = document.getElementById('testVoiceBtn');
const muteBtn = document.getElementById('muteBtn');
const bgAudioBtn = document.getElementById('bgAudioBtn');
const reportBtn = document.getElementById('reportBtn');
const voiceSelect = document.getElementById('voiceSelect');
const voiceReady = document.getElementById('voiceReady');

const statusCard = document.getElementById('statusCard');
const pipBtn = document.getElementById('pipBtn');
const statusValue = document.getElementById('statusValue');
const statusCaption = document.getElementById('statusCaption');

const dzDot = document.getElementById('dzDot');
const dzRing = document.getElementById('dzRing');
const dzTolerance = document.getElementById('dzTolerance');
const lmLateral = document.getElementById('lmLateral');
const lmSlump = document.getElementById('lmSlump');
const lmLean = document.getElementById('lmLean');

const gearBtn = document.getElementById('gearBtn');
const settingsModalOverlay = document.getElementById('settingsModalOverlay');
const settingsModalClose = document.getElementById('settingsModalClose');

const toleranceSlider = document.getElementById('toleranceSlider');
const compressionToleranceSlider = document.getElementById('compressionToleranceSlider');
const leanToleranceSlider = document.getElementById('leanToleranceSlider');
const sustainSlider = document.getElementById('sustainSlider');
const breakSlider = document.getElementById('breakSlider');
const stillnessSlider = document.getElementById('stillnessSlider');
const toleranceVal = document.getElementById('toleranceVal');
const compressionToleranceVal = document.getElementById('compressionToleranceVal');
const leanToleranceVal = document.getElementById('leanToleranceVal');
const sustainVal = document.getElementById('sustainVal');
const breakVal = document.getElementById('breakVal');
const stillnessVal = document.getElementById('stillnessVal');

const syncDot = document.getElementById('syncDot');
const syncText = document.getElementById('syncText');
const alertFeed = document.getElementById('alertFeed');

const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const modalTabs = document.getElementById('modalTabs');
const reportSummary = document.getElementById('reportSummary');
const slouchChartCtx = document.getElementById('slouchChart').getContext('2d');
const hydrationChartCtx = document.getElementById('hydrationChart').getContext('2d');
const todayTimelineCanvas = document.getElementById('todayTimelineChart');
const weekDayRows = document.getElementById('weekDayRows');
const weekDayRowsList = document.getElementById('weekDayRowsList');
const weekDayRowsLegend = document.getElementById('weekDayRowsLegend');
const dayDrilldown = document.getElementById('dayDrilldown');
const dayDrilldownTitle = document.getElementById('dayDrilldownTitle');
const dayDrilldownCanvas = document.getElementById('dayDrilldownChart');
const dayDrilldownClose = document.getElementById('dayDrilldownClose');
const panelNumeric = document.getElementById('panelNumeric');
const panelAi = document.getElementById('panelAi');
const aiSummaryText = document.getElementById('aiSummaryText');
const aiMeta = document.getElementById('aiMeta');
const aiStatGrid = document.getElementById('aiStatGrid');

const hydrationFill = document.getElementById('hydrationFill');
const hydrationConsumedEl = document.getElementById('hydrationConsumed');
const hydrationTargetEl = document.getElementById('hydrationTarget');
const hydrationUndoBtn = document.getElementById('hydrationUndoBtn');
const hydrationTargetInput = document.getElementById('hydrationTargetInput');
const hydrationSizeInputs = {
  glass: document.getElementById('hydrationGlassInput'),
  mug: document.getElementById('hydrationMugInput'),
  can: document.getElementById('hydrationCanInput'),
  bottle: document.getElementById('hydrationBottleInput')
};
const hydrationButtons = {
  glass: document.getElementById('hydrationGlassBtn'),
  mug: document.getElementById('hydrationMugBtn'),
  can: document.getElementById('hydrationCanBtn'),
  bottle: document.getElementById('hydrationBottleBtn')
};

const breakRingFill = document.getElementById('breakRingFill');
const BREAK_RING_CIRCUMFERENCE = 2 * Math.PI * 54;
const breakTakenEl = document.getElementById('breakTaken');
const breakTargetEl = document.getElementById('breakTarget');
const breakMinutesEl = document.getElementById('breakMinutes');

let currentChart = null;
let hydrationChart = null;
let aiChart = null;

// ---- State ----
let landmarker = null;
let running = false;
let cameraStarting = false; // true only during the pre-PiP alignment countdown
let rafId = null;
let voiceNudgesEnabled = true;
let bgAudioEnabled = false;

let baselineLateral = null;
let baselineNeckRatio = null;
let baselineShoulderWidth = null;
let lastFrameTime = performance.now();

let slouchStartedAt = null;
let slouchType = null;
let slouchAccumulatedMs = 0;
let displayLateral = 0, displayCompression = 0, displayLean = 0;
let lastPostureNudgeAt = 0;

let stillnessRef = null;
let lastMovementAt = null;
let lastStillnessNudgeAt = 0;
let lastBreakNudgeAt = 0;
const STILLNESS_MOVE_THRESHOLD = 0.03;

let presenceStartedAt = null;
let absenceStartedAt = null;
let breakStartedAt = null;
let breakActive = false;
let manualBreak = false;
let isPersonPresent = false;
let breakPreSittingSeconds = 0;
let lastFinalizedSittingSeconds = 0;

const BREAK_MIN_SECONDS = 60;
const BREAK_MAX_SECONDS = 60 * 60;

// Per-user prefix -- so two names on the same device/browser never see each
// other's cached numbers. Voice and camera choice deliberately stay
// unprefixed below: those are device properties, not person properties.
const BREAK_TARGET_KEY_PREFIX = `plumb:${currentUserId}:breakTarget:`;
const BREAK_TAKEN_KEY_PREFIX = `plumb:${currentUserId}:breakTaken:`;
const BREAK_MINUTES_KEY_PREFIX = `plumb:${currentUserId}:breakMinutes:`;
const PRESENCE_START_KEY = `plumb:${currentUserId}:presenceStart`;
const LAST_SESSION_END_KEY = `plumb:${currentUserId}:lastSessionEnd`;

const HYDRATION_TARGET_KEY = `plumb:${currentUserId}:hydrationTargetMl`;
const HYDRATION_SIZES_KEY = `plumb:${currentUserId}:hydrationSizesMl`;
const HYDRATION_LOG_PREFIX = `plumb:${currentUserId}:hydrationMl:`;

function dateForTimestamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function today() {
  return dateForTimestamp(Date.now());
}
function addDaysToDateStr(ds, n) {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dateForTimestamp(d.getTime());
}

let breakTargetToday = Number(localStorage.getItem(BREAK_TARGET_KEY_PREFIX + today())) || 0;
let breaksTakenToday = Number(localStorage.getItem(BREAK_TAKEN_KEY_PREFIX + today())) || 0;
let breakMinutesToday = Number(localStorage.getItem(BREAK_MINUTES_KEY_PREFIX + today())) || 0;

let hydrationTargetMl = Number(localStorage.getItem(HYDRATION_TARGET_KEY)) || 2000;
let hydrationSizes = JSON.parse(localStorage.getItem(HYDRATION_SIZES_KEY) || 'null') || { glass: 300, mug: 250, can: 355, bottle: 500 };
let hydrationConsumedMl = Number(localStorage.getItem(HYDRATION_LOG_PREFIX + today())) || 0;
let hydrationLastClickMl = 0;

let eventBuffer = [];
let audioCtx = null;
let silentAudioEl = null;

let currentVoiceId = localStorage.getItem('plumb:voice') || '';
let piperSession = null;
let piperSessionVoice = null;
let currentPiperSource = null;

const PIPER_WASM_PATHS = {
  onnxWasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm'
};

function setSyncStatus(mode, text) {
  syncDot.classList.remove('ok', 'err');
  if (mode) syncDot.classList.add(mode);
  syncText.textContent = text;
}
if (!SYNC_CONFIGURED) setSyncStatus('', 'Cloud sync: not configured');
else setSyncStatus('', 'Cloud sync: ready');

async function mergeRemoteStats() {
  await reconcileTodayFromCloud();
}


async function flushEvents() {
  if (!SYNC_CONFIGURED || eventBuffer.length === 0) return;

  const toSend = eventBuffer.map(ev => ({
    user_id: currentUserId,
    date: ev.date || null,
    start_time: ev.start_time || null,
    end_time: ev.end_time || null,
    type: ev.type || null,
    duration_seconds: ev.duration_seconds || 0,
    ended_by: ev.ended_by || null,
    kind: ev.kind || null,
    pre_break_sitting_seconds: ev.pre_break_sitting_seconds || 0,
    lateness_seconds: ev.lateness_seconds || 0,
    created_at: ev.created_at || new Date().toISOString()
  }));

  eventBuffer = [];

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(toSend),
      keepalive: true
    });

    if (!res.ok) {
      console.error('Event upload:', res.status, await res.text());
      eventBuffer.push(...toSend);
      setSyncStatus('err', `Cloud sync: ${res.status}`);
    } else {
      setSyncStatus('ok', `Cloud sync: last synced ${new Date().toLocaleTimeString()}`);
    }
  } catch (err) {
    console.error('Event upload:', err);
    eventBuffer.push(...toSend);
    setSyncStatus('err', err.message);
  }
}


// ---- cross-device reconciliation for the live "today" gauges ----
// Local increments (creditBreakTargetFromSitting, incrementBreaksTaken, logHydration)
// keep this device responsive instantly and work offline. This periodically pulls the
// authoritative merged totals from Supabase -- across whichever devices synced today --
// and overwrites local state with it, the same way the report modal already computes
// "today" from raw events rather than trusting any single device's running counters.
async function reconcileTodayFromCloud() {
  if (!SYNC_CONFIGURED) return;
  const d = today();
  try {
    const [eventsRes, hydrationRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/posture_events?date=eq.${d}&user_id=eq.${encodeURIComponent(currentUserId)}&select=type,duration_seconds`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
      }),
      fetch(`${SUPABASE_URL}/rest/v1/hydration_events?date=eq.${d}&user_id=eq.${encodeURIComponent(currentUserId)}&select=volume_ml`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
      })
    ]);
    if (eventsRes.ok) {
      const events = await eventsRes.json();
      let taken = 0, breakSeconds = 0, presenceSeconds = 0;
      events.forEach(e => {
        const dur = e.duration_seconds || 0;
        if (e.type === 'break') { taken++; breakSeconds += dur; }
        else if (e.type === 'presence') presenceSeconds += dur;
      });
      const intervalSec = Number(breakSlider.value) * 60;
      const target = intervalSec > 0 ? Math.floor(presenceSeconds / intervalSec) : 0;
      breaksTakenToday = taken;
      breakTargetToday = target;
      breakMinutesToday = Math.round(breakSeconds / 60);
      localStorage.setItem(BREAK_TAKEN_KEY_PREFIX + d, String(breaksTakenToday));
      localStorage.setItem(BREAK_TARGET_KEY_PREFIX + d, String(breakTargetToday));
      localStorage.setItem(BREAK_MINUTES_KEY_PREFIX + d, String(breakMinutesToday));
      renderBreakGauge();
    }
    if (hydrationRes.ok) {
      const rows = await hydrationRes.json();
      const total = rows.reduce((sum, r) => sum + (r.volume_ml || 0), 0);
      hydrationConsumedMl = total;
      localStorage.setItem(HYDRATION_LOG_PREFIX + d, String(hydrationConsumedMl));
      renderHydration();
    }
  } catch (err) { console.warn('reconcileTodayFromCloud:', err); }
}

function addAlertToFeed(type, message) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const item = document.createElement('div');
  item.style.marginBottom = '3px';
  item.innerHTML = `<span style="font-family:var(--mono);">${time}</span> <span style="color:var(--ink);">${message}</span>`;
  if (alertFeed.children.length === 1 && alertFeed.children[0].innerText === 'no alerts yet') alertFeed.innerHTML = '';
  alertFeed.insertBefore(item, alertFeed.firstChild);
  while (alertFeed.children.length > 15) alertFeed.removeChild(alertFeed.lastChild);
}

function logEvent(event) {
  eventBuffer.push(event);
}

function logPresenceEvent(startTime, endTime, endedBy) {
  const dur = Math.round((endTime - startTime) / 1000);
  if (dur <= 0) return;
  logEvent({
    date: dateForTimestamp(startTime),
    start_time: new Date(startTime).toISOString(),
    end_time: new Date(endTime).toISOString(),
    type: 'presence',
    duration_seconds: dur,
    ended_by: endedBy,
    created_at: new Date().toISOString()
  });
}

function logBreakEvent(startTime, endTime, kind, preBreakSittingSeconds = 0) {
  const dur = Math.round((endTime - startTime) / 1000);
  if (dur <= 0) return;
  const intervalSec = Number(breakSlider.value) * 60;
  const lateness = Math.max(0, Math.round(preBreakSittingSeconds - intervalSec));
  logEvent({
    date: dateForTimestamp(startTime),
    start_time: new Date(startTime).toISOString(),
    end_time: new Date(endTime).toISOString(),
    type: 'break',
    duration_seconds: dur,
    kind: kind,
    pre_break_sitting_seconds: Math.round(preBreakSittingSeconds),
    lateness_seconds: lateness,
    created_at: new Date().toISOString()
  });
}

function logAwayEvent(startTime, endTime) {
  const dur = Math.round((endTime - startTime) / 1000);
  if (dur <= 0) return;
  logEvent({
    date: dateForTimestamp(startTime),
    start_time: new Date(startTime).toISOString(),
    end_time: new Date(endTime).toISOString(),
    type: 'away',
    duration_seconds: dur,
    created_at: new Date().toISOString()
  });
}

function logNotTrackingEvent(startTime, endTime) {
  const dur = Math.round((endTime - startTime) / 1000);
  if (dur <= 0) return;
  logEvent({
    date: dateForTimestamp(startTime),
    start_time: new Date(startTime).toISOString(),
    end_time: new Date(endTime).toISOString(),
    type: 'not_tracking',
    duration_seconds: dur,
    created_at: new Date().toISOString()
  });
}

function logCalibrationEvent() {
  logEvent({
    date: today(),
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    type: 'calibration',
    duration_seconds: 0,
    created_at: new Date().toISOString()
  });
}

function logPostureEvent(type, startTime, endTime) {
  const dur = Math.round((endTime - startTime) / 1000);
  if (dur <= 0) return;
  logEvent({
    date: dateForTimestamp(startTime),
    start_time: new Date(startTime).toISOString(),
    end_time: new Date(endTime).toISOString(),
    type: type,
    duration_seconds: dur,
    created_at: new Date().toISOString()
  });
}

function creditBreakTargetFromSitting(sittingSeconds) {
  const intervalSec = Number(breakSlider.value) * 60;
  const qualifying = Math.floor(sittingSeconds / intervalSec);
  if (qualifying <= 0) return;
  breakTargetToday += qualifying;
  localStorage.setItem(BREAK_TARGET_KEY_PREFIX + today(), String(breakTargetToday));
}

function addBreakMinutesToday(gapSeconds) {
  const mins = Math.round(gapSeconds / 60);
  if (mins <= 0) return;
  breakMinutesToday += mins;
  localStorage.setItem(BREAK_MINUTES_KEY_PREFIX + today(), String(breakMinutesToday));
}

function incrementBreaksTaken() {
  breaksTakenToday += 1;
  localStorage.setItem(BREAK_TAKEN_KEY_PREFIX + today(), String(breaksTakenToday));
}

function finalizePresenceBlock(endedBy = 'person_left', endTs = Date.now()) {
  if (!presenceStartedAt) return;
  const end = endTs;
  const sittingSeconds = (end - presenceStartedAt) / 1000;
  if (sittingSeconds > 0) {
    lastFinalizedSittingSeconds = sittingSeconds;
    logPresenceEvent(presenceStartedAt, end, endedBy);
    creditBreakTargetFromSitting(sittingSeconds);
  }
  presenceStartedAt = null;
}

function classifyGap(startTime, endTime) {
  const sec = (endTime - startTime) / 1000;
  if (sec < BREAK_MIN_SECONDS) return 'micro';
  if (sec <= BREAK_MAX_SECONDS) return 'break';
  return 'away';
}

function setPresenceStart(ts) {
  presenceStartedAt = ts;
  if (ts === null) localStorage.removeItem(PRESENCE_START_KEY);
  else localStorage.setItem(PRESENCE_START_KEY, String(ts));
}

function startBreak(manual = false) {
  if (breakActive) return;
  finalizePresenceBlock(manual ? 'manual_break' : 'auto_break');
  breakPreSittingSeconds = lastFinalizedSittingSeconds;
  breakActive = true;
  manualBreak = manual;
  breakStartedAt = Date.now();
  if (slouchStartedAt) { logPostureEvent(slouchType, slouchStartedAt, Date.now()); slouchStartedAt = null; slouchAccumulatedMs = 0; }
  stillnessRef = null; lastMovementAt = null;
  addAlertToFeed('break', manual ? 'Manual break started' : 'Break started (camera lost)');
  breakToggleBtn.textContent = 'end break';
  breakToggleBtn.classList.add('break-active');
  breakToggleBtn.classList.remove('break-due');
}

function endBreak() {
  if (!breakActive || !breakStartedAt) return;
  const end = Date.now();
  const dur = (end - breakStartedAt) / 1000;

  if (dur >= BREAK_MIN_SECONDS) {
    if (dur <= BREAK_MAX_SECONDS) {
      logBreakEvent(breakStartedAt, end, manualBreak ? 'manual' : 'auto', breakPreSittingSeconds);
      addBreakMinutesToday(dur);
      incrementBreaksTaken();
      let msg = '';
      if (dur >= 300) { msg = BREAK_RETURN_LONG_PHRASES[breakReturnLongIdx % BREAK_RETURN_LONG_PHRASES.length]; breakReturnLongIdx++; }
      else if (dur >= 60) { msg = BREAK_RETURN_SHORT_PHRASES[breakReturnShortIdx % BREAK_RETURN_SHORT_PHRASES.length]; breakReturnShortIdx++; }
      if (msg) speak(msg);
      const mins = Math.round(dur / 60);
      addAlertToFeed('break', `Break ended (${mins > 0 ? mins + ' min' : Math.round(dur) + ' sec'})`);
    } else {
      logAwayEvent(breakStartedAt, end);
      addAlertToFeed('away', `Away for ${Math.round(dur/3600)}h ${Math.round((dur%3600)/60)}m`);
    }
  } else {
    addAlertToFeed('break', `Short absence ignored`);
  }

  breakActive = false;
  manualBreak = false;
  breakStartedAt = null;
  breakPreSittingSeconds = 0;
  setPresenceStart(Date.now());
  renderBreakGauge();
  breakToggleBtn.textContent = 'take a break';
  breakToggleBtn.classList.remove('break-active', 'break-due');
}

let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }

  // If PiP is active, ignore main tab visibility.
  if (trackingPipWindow && !trackingPipWindow.closed) return;

  // If PiP disappeared unexpectedly while we thought we were running, clean up now.
  if (running && (!trackingPipWindow || trackingPipWindow.closed)) {
    stopCamera();
    return;
  }

  if (!hiddenAt || !running) { hiddenAt = null; return; }
  const hiddenStart = hiddenAt;
  const hiddenMs = Date.now() - hiddenStart;
  hiddenAt = null;
  if (hiddenMs < 2000) return;

  if (breakActive && breakStartedAt) {
    endBreak();
    return;
  }

  // Both blocks must end at hiddenStart, not now -- the hidden span itself
  // gets logged separately as not_tracking below. Ending at Date.now() here
  // previously attributed the entire hidden/asleep gap as continuous
  // slouching AND continuous presence, on top of also logging the same
  // span as not_tracking -- a real, confirmed bug: a tab left hidden
  // overnight produced single compression events of 14.2h (2026-09-15),
  // 15.7h (2026-08-26, mistakenly believed fixed by a different, unrelated
  // leak-path fix that day), and 87.9h (2026-08-21).
  if (slouchStartedAt) {
    logPostureEvent(slouchType, slouchStartedAt, hiddenStart);
    slouchStartedAt = null;
    slouchAccumulatedMs = 0;
  }
  finalizePresenceBlock('tab_hidden', hiddenStart);
  logNotTrackingEvent(hiddenStart, Date.now());

  isPersonPresent = false;
  setPresenceStart(null);
  absenceStartedAt = null;
  stillnessRef = null;
  lastMovementAt = null;
  lastBreakNudgeAt = Date.now();
  renderBreakGauge();
});

async function ensureAudioUnlocked() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; } }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  return true;
}

function startBgSilentAudio() {
  if (!silentAudioEl) {
    silentAudioEl = new Audio();
    silentAudioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    silentAudioEl.loop = true; silentAudioEl.volume = 0.001;
  }
  silentAudioEl.play().catch(() => { setTimeout(startBgSilentAudio, 5000); });
  bgAudioEnabled = true;
  bgAudioBtn.textContent = 'background nudges: on';
  bgAudioBtn.classList.add('is-on');
}

function stopBgSilentAudio() {
  if (silentAudioEl) silentAudioEl.pause();
  bgAudioEnabled = false;
  bgAudioBtn.textContent = 'background nudges';
  bgAudioBtn.classList.remove('is-on');
}

function updateVoiceReady(ready) { voiceReady.classList.toggle('ready', ready); }

const PIPER_VOICES = [
  { id: 'en_GB-alan-medium', name: 'Alan — UK male, steady' },
  { id: 'en_GB-northern_english_male-medium', name: 'Nathan — UK male, northern' },
  { id: 'en_GB-alba-medium', name: 'Alba — UK female, warm' },
  { id: 'en_GB-southern_english_female-low', name: 'Southern — UK female, light' },
  { id: 'en_GB-cori-medium', name: 'Cori — UK female, crisp' },
  { id: 'en_GB-jenny_dioco-medium', name: 'Jenny — UK female, bright' },
  { id: 'en_GB-aru-medium', name: 'Aru — UK, low & brisk' },
  { id: 'en_GB-semaine-medium', name: 'Semaine — UK, measured' },
];
const DEFAULT_VOICE_ID = 'Google UK English Female';

function populateVoiceList() {
  const currentVal = voiceSelect.value;
  voiceSelect.innerHTML = '';
  const piperGroup = document.createElement('optgroup');
  piperGroup.label = 'offline (piper)';
  PIPER_VOICES.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    piperGroup.appendChild(opt);
  });
  voiceSelect.appendChild(piperGroup);
  if (window.speechSynthesis) {
    const voices = window.speechSynthesis.getVoices();
    const englishVoices = voices.filter(v => v.lang.startsWith('en') &&
      (v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Samantha') || v.name.includes('Daniel')));
    const usedVoices = englishVoices.length > 0 ? englishVoices : voices.filter(v => v.lang.startsWith('en'));
    if (usedVoices.length > 0) {
      const browserGroup = document.createElement('optgroup');
      browserGroup.label = 'browser voices';
      usedVoices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.name;
        browserGroup.appendChild(opt);
      });
      voiceSelect.appendChild(browserGroup);
    }
  }
  const hasStoredChoice = !!localStorage.getItem('plumb:voice');
  const voicesStillLoading = window.speechSynthesis && window.speechSynthesis.getVoices().length === 0;
  const optionExists = (val) => [...voiceSelect.options].some(o => o.value === val);
  // currentVal only counts as "already resolved" if it matches currentVoiceId --
  // i.e. we deliberately picked it in an earlier pass. Otherwise it's just the
  // browser's incidental first-<option> auto-select (always a Piper voice,
  // since that group renders before browser voices are even loaded), which
  // must never be allowed to pre-empt the real default below.
  if (currentVal && currentVal === currentVoiceId && optionExists(currentVal)) {
    voiceSelect.value = currentVal;
  } else if (hasStoredChoice && currentVoiceId && optionExists(currentVoiceId)) {
    voiceSelect.value = currentVoiceId;
  } else if (!hasStoredChoice && optionExists(DEFAULT_VOICE_ID)) {
    currentVoiceId = DEFAULT_VOICE_ID;
    voiceSelect.value = currentVoiceId;
    localStorage.setItem('plumb:voice', currentVoiceId);
  } else if (hasStoredChoice || !voicesStillLoading) {
    // Falls here when the browser's own female voice genuinely isn't
    // available on this system -- PIPER_VOICES[0] is Alan (male), so
    // defaulting to it silently handed out a male voice by accident.
    // Prefer the first female-labeled Piper voice instead.
    const fallbackVoice = PIPER_VOICES.find(v => /female/i.test(v.name)) || PIPER_VOICES[0];
    currentVoiceId = fallbackVoice.id;
    voiceSelect.value = currentVoiceId;
    localStorage.setItem('plumb:voice', currentVoiceId);
  }
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = populateVoiceList;
populateVoiceList();
voiceSelect.addEventListener('change', () => {
  currentVoiceId = voiceSelect.value;
  localStorage.setItem('plumb:voice', currentVoiceId);
  testVoiceBtn.textContent = 'test voice';
  updateVoiceReady(false);
});

function renderHydration() {
  const pct = hydrationTargetMl > 0 ? Math.max(0, Math.min(100, (hydrationConsumedMl / hydrationTargetMl) * 100)) : 0;
  hydrationFill.style.height = pct + '%';
  hydrationConsumedEl.textContent = hydrationConsumedMl;
  hydrationTargetEl.textContent = hydrationTargetMl;
  hydrationUndoBtn.hidden = hydrationLastClickMl === 0;
}

let lastHydrationEventId = null;
async function logHydration(ml, drinkType) {
  hydrationConsumedMl += ml;
  hydrationLastClickMl = ml;
  localStorage.setItem(HYDRATION_LOG_PREFIX + today(), String(hydrationConsumedMl));
  renderHydration();
  lastHydrationEventId = null;
  if (!SYNC_CONFIGURED) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hydration_events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'return=representation' },
      body: JSON.stringify([{ user_id: currentUserId, date: today(), volume_ml: ml, drink_type: drinkType || null }])
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows = await res.json();
    if (rows[0]) lastHydrationEventId = rows[0].id;
  } catch (err) { console.warn('logHydration sync:', err); }
}

async function undoHydration() {
  if (!hydrationLastClickMl) return;
  hydrationConsumedMl = Math.max(0, hydrationConsumedMl - hydrationLastClickMl);
  hydrationLastClickMl = 0;
  localStorage.setItem(HYDRATION_LOG_PREFIX + today(), String(hydrationConsumedMl));
  renderHydration();
  if (SYNC_CONFIGURED && lastHydrationEventId != null) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/hydration_events?id=eq.${lastHydrationEventId}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
      });
    } catch (err) { console.warn('undoHydration sync:', err); }
    lastHydrationEventId = null;
  }
}
Object.entries(hydrationButtons).forEach(([key, btn]) => btn.addEventListener('click', () => logHydration(hydrationSizes[key], key)));
hydrationUndoBtn.addEventListener('click', undoHydration);

hydrationTargetInput.value = hydrationTargetMl;
hydrationTargetInput.addEventListener('change', () => {
  hydrationTargetMl = Math.max(100, Number(hydrationTargetInput.value) || 2000);
  localStorage.setItem(HYDRATION_TARGET_KEY, String(hydrationTargetMl));
  renderHydration();
  scheduleSettingsPush();
});
Object.entries(hydrationSizeInputs).forEach(([key, input]) => {
  input.value = hydrationSizes[key];
  input.addEventListener('change', () => {
    hydrationSizes[key] = Math.max(10, Number(input.value) || hydrationSizes[key]);
    localStorage.setItem(HYDRATION_SIZES_KEY, JSON.stringify(hydrationSizes));
    hydrationButtons[key].title = `${key} — ${hydrationSizes[key]}ml`;
    scheduleSettingsPush();
  });
});
renderHydration();

function renderBreakGauge(liveContinuousMin = 0) {
  const intervalMin = Number(breakSlider.value);
  if (breakActive) {
    breakRingFill.style.strokeDashoffset = BREAK_RING_CIRCUMFERENCE + 'px';
    breakRingFill.classList.remove('due');
    breakTakenEl.textContent = 'on a break';
    breakTargetEl.textContent = '';
  } else {
    const pct = intervalMin > 0 ? Math.max(0, Math.min(100, (liveContinuousMin / intervalMin) * 100)) : 0;
    breakRingFill.style.strokeDashoffset = (BREAK_RING_CIRCUMFERENCE * (1 - pct / 100)) + 'px';
    const remainingMin = Math.max(0, intervalMin - liveContinuousMin);
    if (remainingMin <= 0) {
      breakRingFill.classList.add('due');
      breakTakenEl.textContent = 'break due';
      breakTargetEl.textContent = '';
    } else {
      breakRingFill.classList.remove('due');
      const mm = Math.floor(remainingMin);
      const ss = Math.round((remainingMin - mm) * 60);
      breakTakenEl.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
      breakTargetEl.textContent = 'to next break';
    }
  }
  breakMinutesEl.textContent = breakMinutesToday;
}
renderBreakGauge();

async function ensurePiperVoice(voiceId) {
  if (piperSession && piperSessionVoice === voiceId) return true;
  try {
    testVoiceBtn.textContent = 'loading voice…';
    try { Object.defineProperty(navigator, 'hardwareConcurrency', { value: 1, configurable: true }); } catch (e) {}
    piperSession = await piperTTS.TtsSession.create({
      voiceId,
      wasmPaths: PIPER_WASM_PATHS,
      progress: p => { testVoiceBtn.textContent = `Downloading… ${Math.round(p.loaded * 100 / p.total)}%`; }
    });
    await piperSession.waitReady;
    piperSessionVoice = voiceId;
    testVoiceBtn.textContent = 'test voice';
    updateVoiceReady(true);
    return true;
  } catch (err) {
    console.warn('Piper:', err);
    testVoiceBtn.textContent = 'test voice';
    updateVoiceReady(false);
    return false;
  }
}

async function speak(text, force = false) {
  // force=true (the test-voice button) bypasses mute -- deliberately
  // testing the voice is exactly the case where muted shouldn't apply, and
  // silently doing nothing on click was indistinguishable from "broken".
  if (!voiceNudgesEnabled && !force) return;
  await ensureAudioUnlocked();
  const isBrowserVoice = window.speechSynthesis && [...window.speechSynthesis.getVoices()].some(v => v.name === currentVoiceId);
  if (isBrowserVoice) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = window.speechSynthesis.getVoices().find(v => v.name === currentVoiceId);
      if (voice) u.voice = voice;
      window.speechSynthesis.speak(u);
      return;
    }
  }
  try {
    const ok = await ensurePiperVoice(currentVoiceId);
    if (ok) {
      const wav = await piperSession.predict(text);
      const buffer = await audioCtx.decodeAudioData(await wav.arrayBuffer());
      // Unlike speechSynthesis (cancelled above), nothing was stopping a
      // still-playing Piper buffer before starting the next one -- two
      // nudges close together (e.g. a break-end message landing right as a
      // posture nudge fires) played on top of each other instead of the
      // second one replacing the first.
      if (currentPiperSource) { try { currentPiperSource.stop(); } catch (e) {} }
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(audioCtx.destination);
      currentPiperSource = src;
      src.onended = () => { if (currentPiperSource === src) currentPiperSource = null; };
      src.start(0);
      return;
    }
  } catch (e) { console.warn('Piper fallback:', e); }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
}

const LEFT_PHRASES = ["You're leaning left — straighten up.", "Left drift — bring head centre.", "Tilting left — correct it.", "Drifting left — ease back to centre.", "A little left lean — straighten up.", "Left side's dropped — bring it back."];
const RIGHT_PHRASES = ["Leaning right — centre yourself.", "Right drift — straighten up.", "Tilting right — adjust.", "Drifting right — ease back to centre.", "A little right lean — straighten up.", "Right side's dropped — bring it back."];
const SLUMP_PHRASES = ["Slumping — sit taller.", "Neck sinking — lengthen spine.", "Shoulders dropping — open up.", "Reset your posture.", "Sinking a bit — lift through the chest.", "Spine's rounding — sit a touch taller.", "Shoulders back and down — reset."];
const LEAN_PHRASES = ["You've drifted in close — ease back from the screen.", "Getting close to the monitor — sit back a little.", "Give yourself some space from the screen.", "A bit close to the screen — ease back.", "Crept toward the monitor — give it room.", "Pull back a little from the screen."];
const BREAK_PROMPT_PHRASES = ["Time for a break — stand up, stretch, come back refreshed.", "You've been sitting a while — step away.", "Take a short break — enjoy it.", "Good time for a stretch — up you get.", "Your body could use a change of scenery.", "Stand, shake it out, then carry on."];
const STILLNESS_PHRASES = ["You've held the same shape a while — shift position, even briefly.", "Time to change something — stand, stretch, or just re-settle.", "Give your spine a change of scenery for a moment.", "Same spot a while — a small shift will do.", "Bodies like variety — change something, even slightly.", "Worth a little wiggle — you've been still a while."];
const BREAK_RETURN_LONG_PHRASES = ["Great long break — you're refreshed.", "Nice long break — welcome back.", "That was a proper break — good stuff.", "Well rested — good to have you back."];
const BREAK_RETURN_SHORT_PHRASES = ["Good break — that was a nice stretch.", "Nice one — welcome back.", "Good stretch — back to it.", "That's the way — short and sweet."];
let leftIdx = 0, rightIdx = 0, slumpIdx = 0, leanIdx = 0, breakIdx = 0, stillIdx = 0, breakReturnLongIdx = 0, breakReturnShortIdx = 0;

function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }
function drawPoseDots(points, color) {
  ctx.fillStyle = color || 'rgba(44,110,142,0.9)';
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x * overlay.width, p.y * overlay.height, 4, 0, 2 * Math.PI);
    ctx.fill();
  });
}
function shoulderWidthOf(lSh, rSh) { return Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y) || 0.0001; }
function neckCompressionRatio(earMid, shMid, lSh, rSh) {
  const gap = Math.max(shMid.y - earMid.y, 0.0001);
  const sw = shoulderWidthOf(lSh, rSh);
  return gap / sw;
}
function lateralDeviation(earMid, shMid, lSh, rSh) {
  const sw = shoulderWidthOf(lSh, rSh);
  return (earMid.x - shMid.x) / sw;
}
function leanInRatio(lSh, rSh, baselineSw) {
  if (!baselineSw) return 0;
  const sw = shoulderWidthOf(lSh, rSh);
  return (sw - baselineSw) / baselineSw;
}

// ---- Experimental face-point signals (eye-line tilt, inter-eye distance,
// nose offset) -- not wired into calibration, thresholds, nudges, or
// Supabase yet. Just drawn + printed live so they can be eyeballed against
// real movement before deciding if/how to turn any of them into a real
// signal. Landmark indices per BlazePose topology: 0 = nose, 2/5 = left/
// right eye centers.
function eyeTiltDegrees(leftEye, rightEye) {
  return Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);
}
function interEyeDistanceRatio(leftEye, rightEye, lSh, rSh) {
  const sw = shoulderWidthOf(lSh, rSh);
  return Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y) / sw;
}
function noseOffset(nose, shMid, lSh, rSh) {
  const sw = shoulderWidthOf(lSh, rSh);
  return { x: (nose.x - shMid.x) / sw, y: (nose.y - shMid.y) / sw };
}
function drawExperimentalReadout(eyeTilt, eyeDist, noseOff) {
  ctx.font = '11px Karla, sans-serif';
  const lines = [
    `eye tilt: ${eyeTilt.toFixed(1)}°`,
    `eye dist: ${eyeDist.toFixed(3)}`,
    `nose off: ${noseOff.x.toFixed(3)}, ${noseOff.y.toFixed(3)}`
  ];
  const boxW = 130, lineH = 14, pad = 6;
  ctx.fillStyle = 'rgba(10,38,38,0.65)';
  ctx.fillRect(6, 6, boxW, lines.length * lineH + pad * 2 - 4);
  ctx.fillStyle = '#F0DAC7';
  lines.forEach((line, i) => ctx.fillText(line, 6 + pad, 6 + pad + lineH * (i + 1) - 4));
}

async function initModel() {
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1
  });
}

// ---- PiP helpers ----
let trackingPipWindow = null;
let originalStatusParent = null;
let originalStatusNextSibling = null;
let originalVideoParent = null;
let originalVideoNextSibling = null;

// Split in two because documentPictureInPicture.requestWindow() requires a
// live user gesture -- it must fire right on the "start camera" click, before
// the alignment countdown eats that permission window. Moving the actual
// video/statusCard elements into the (already-open) PiP window is plain DOM
// work and has no such deadline, so that part happens later, once the
// countdown finishes -- giving one automatic pop-out with no second click.
async function requestPipWindow() {
  if (!('documentPictureInPicture' in window)) return false;

  try {
    trackingPipWindow = await documentPictureInPicture.requestWindow({ width: 200, height: 190 });
  } catch (err) {
    console.warn('PiP open failed:', err);
    trackingPipWindow = null;
    return false;
  }

  trackingPipWindow.document.title = 'plumb';
  trackingPipWindow.document.head.appendChild(document.getElementById('appStyles').cloneNode(true));
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Karla:wght@300;400;500;600;700&display=swap';
  trackingPipWindow.document.head.appendChild(fontLink);

  trackingPipWindow.document.body.style.margin = '0';
  trackingPipWindow.document.body.style.background = 'var(--paper)';
  trackingPipWindow.document.body.style.display = 'flex';
  trackingPipWindow.document.body.style.alignItems = 'center';
  trackingPipWindow.document.body.style.justifyContent = 'center';
  trackingPipWindow.document.body.style.height = '100vh';
  trackingPipWindow.document.body.style.padding = '8px';
  trackingPipWindow.document.body.style.color = 'var(--ink-soft)';
  trackingPipWindow.document.body.style.fontFamily = 'Karla, sans-serif';
  trackingPipWindow.document.body.style.fontSize = '13px';
  trackingPipWindow.document.body.style.textAlign = 'center';
  trackingPipWindow.document.body.textContent = 'getting ready…';

  trackingPipWindow.addEventListener('pagehide', () => {
    if (running) {
      stopCamera();
    } else {
      closeTrackingPip();
    }
  }, { once: true });

  return true;
}

function movePipContent() {
  if (!trackingPipWindow || trackingPipWindow.closed) return false;

  trackingPipWindow.document.body.textContent = '';

  originalStatusParent = statusCard.parentElement;
  originalStatusNextSibling = statusCard.nextSibling;
  originalVideoParent = video.parentElement;
  originalVideoNextSibling = video.nextSibling;

  statusCard.classList.add('pip-mode');
  trackingPipWindow.document.body.appendChild(statusCard);

  video.style.position = 'absolute';
  video.style.left = '-9999px';
  video.style.top = '-9999px';
  video.style.width = '160px';
  video.style.height = '120px';
  video.style.opacity = '0';
  overlay.style.position = 'absolute';
  overlay.style.left = '-9999px';
  overlay.style.top = '-9999px';
  overlay.style.width = '160px';
  overlay.style.height = '120px';
  overlay.style.opacity = '0';
  trackingPipWindow.document.body.appendChild(video);
  trackingPipWindow.document.body.appendChild(overlay);

  return true;
}

function closeTrackingPip() {
  if (trackingPipWindow) {
    try { trackingPipWindow.close(); } catch (e) {}
    trackingPipWindow = null;
  }

  if (originalStatusParent) {
    statusCard.classList.remove('pip-mode');
    if (originalStatusNextSibling) {
      originalStatusParent.insertBefore(statusCard, originalStatusNextSibling);
    } else {
      originalStatusParent.appendChild(statusCard);
    }
  }

  if (originalVideoParent) {
    video.style.position = '';
    video.style.left = '';
    video.style.top = '';
    video.style.width = '';
    video.style.height = '';
    video.style.opacity = '';
    overlay.style.position = '';
    overlay.style.left = '';
    overlay.style.top = '';
    overlay.style.width = '';
    overlay.style.height = '';
    overlay.style.opacity = '';
    if (originalVideoNextSibling) {
      originalVideoParent.insertBefore(video, originalVideoNextSibling);
      originalVideoParent.insertBefore(overlay, originalVideoNextSibling);
    } else {
      originalVideoParent.appendChild(video);
      originalVideoParent.appendChild(overlay);
    }
  }

  originalStatusParent = null;
  originalStatusNextSibling = null;
  originalVideoParent = null;
  originalVideoNextSibling = null;
}

function nextFrame() {
  if (trackingPipWindow && trackingPipWindow.closed) {
    stopCamera();
    return;
  }

  rafId = trackingPipWindow
    ? trackingPipWindow.requestAnimationFrame(loop)
    : requestAnimationFrame(loop);
}

// Live pose dots during the alignment countdown, so there's actually
// something to align by -- detection only, no presence/slouch/stats side
// effects (those don't start until `running` is true after the countdown).
let alignPreviewActive = false;
function alignPreviewFrame() {
  if (!alignPreviewActive) return;
  const result = landmarker.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    drawPoseDots([lm[7], lm[8], lm[11], lm[12]]);
    // This alignment countdown is the ONLY point the raw video is ever
    // visible -- movePipContent() (see stopCamera/PiP wiring) sets both
    // `video` and `overlay` to opacity:0 and moves them off-screen once
    // tracking actually starts, on purpose (PiP shows the abstracted status
    // card, not your face). The main loop() also draws the eye/nose
    // overlay, but onto a canvas nobody can ever see by that point -- this
    // is the only place it's worth drawing at all.
    const leftEye = lm[2], rightEye = lm[5], nose = lm[0];
    drawPoseDots([leftEye, rightEye, nose], 'rgba(193,98,46,0.85)');
    drawExperimentalReadout(
      eyeTiltDegrees(leftEye, rightEye),
      interEyeDistanceRatio(leftEye, rightEye, lm[11], lm[12]),
      noseOffset(nose, midpoint(lm[11], lm[12]), lm[11], lm[12])
    );
  }
  requestAnimationFrame(alignPreviewFrame);
}

async function startCamera() {
  cameraStarting = true;
  cameraToggleBtn.textContent = 'loading…';
  cameraToggleBtn.disabled = true;
  try {
    if (!landmarker) await initModel();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, ...(cameraSelect.value ? { deviceId: { exact: cameraSelect.value } } : {}) },
      audio: false
    });
    // Another app taking the camera later ends this track on its own --
    // catch it here immediately rather than waiting for the tracking loop
    // to eventually throw on a dead frame.
    stream.getVideoTracks().forEach(track => {
      track.addEventListener('ended', () => handleCameraLost('track ended'));
    });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = r);
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    await video.play();
    populateCameraList();

    cameraToggleBtn.textContent = 'stop camera';
    cameraToggleBtn.classList.remove('start-camera');
    cameraToggleBtn.classList.add('stop-camera');
    cameraToggleBtn.disabled = false;

    // Calibration only needs the landmarker and a live frame -- both already
    // true here -- so enable it right away. This used to sit *after* the
    // `await requestPipWindow()` below, which meant a real (confirmed, not
    // just a stale-cursor cosmetic thing) window where the video was already
    // visibly playing and the button looked ready, but a click did nothing
    // because it was still genuinely disabled. Moving it earlier removes
    // that dead window instead of just disguising it.
    calibrateBtn.disabled = false;
    if (baselineLateral === null) {
      calibrateBtn.textContent = 'calibrate posture';
      calibrateBtn.classList.add('needs-calibration');
      calibrateBtn.classList.remove('is-confirmed');
      calibrateFlash.hidden = false;
    }

    // Request the PiP window right now, on this click's still-live user
    // gesture -- requestWindow() refuses to open without one, and that
    // permission doesn't survive the countdown below. The window opens (near-)
    // empty; the actual video only moves into it once the countdown ends.
    const pipRequested = await requestPipWindow();

    // Give a look at full-size, un-shrunk, un-dimmed video before it moves
    // into the small PiP window -- otherwise framing/alignment problems are
    // invisible until you're already tracking in a 160x120 popup. Live pose
    // dots run so there's something to actually align by.
    placeholder.style.display = 'none';
    alignBadge.hidden = false;
    alignPreviewActive = true;
    requestAnimationFrame(alignPreviewFrame);

    const ALIGN_SECONDS = 10;
    for (let s = ALIGN_SECONDS; s > 0; s--) {
      alignBadge.textContent = `tracking starts in ${s}s`;
      await new Promise(r => setTimeout(r, 1000));
      if (!video.srcObject) { cameraStarting = false; alignPreviewActive = false; alignBadge.hidden = true; return; } // stopped during the alignment window
    }
    alignPreviewActive = false;
    alignBadge.hidden = true;

    const pipOpened = pipRequested && movePipContent();
    if (pipOpened) {
      placeholder.style.display = 'none';
      trackingSummary.hidden = false;
      renderTrackingSummary();
    } else {
      placeholder.style.display = 'none';
      trackingSummary.hidden = true;
    }

    running = true;
    cameraStarting = false;
    breakToggleBtn.disabled = false;
    lastFrameTime = performance.now();
await mergeRemoteStats();
maybeSwitchDay();
logStartupGap();
    setPresenceStart(null);
    absenceStartedAt = null;
    breakActive = false;
    manualBreak = false;
    breakStartedAt = null;
    breakPreSittingSeconds = 0;
    isPersonPresent = false;
    breakToggleBtn.textContent = 'take a break';
    breakToggleBtn.classList.remove('break-active', 'break-due');
    ensurePiperVoice(currentVoiceId);
    await ensureAudioUnlocked();
    if (bgAudioEnabled) startBgSilentAudio();

    nextFrame();
  } catch (err) {
    cameraStarting = false;
    placeholder.textContent = `camera error: ${err.message}`;
    cameraToggleBtn.textContent = 'start camera';
    cameraToggleBtn.classList.add('start-camera');
    cameraToggleBtn.classList.remove('stop-camera');
    cameraToggleBtn.disabled = false;
    closeTrackingPip();
  }
}

let handlingCameraLoss = false;

// The camera feed can disappear without ever going through the "stop
// camera" button -- most commonly another app (Zoom, Teams, the OS camera
// app) taking the device, which either ends the MediaStreamTrack outright
// or leaves the <video> stalled on a stale/zero-size frame that then throws
// inside the pose model. Neither case was handled before: `running` stayed
// true, the button still said "stop camera", and whatever presence/slouch
// block was open at that moment just sat in memory and was never flushed --
// which is how whole afternoons went missing from the report. This closes
// things down the same clean way a manual stop does, but leaves a visible
// trail (console + alert feed + a distinct placeholder message) instead of
// going dark with no explanation.
function handleCameraLost(reason) {
  if (handlingCameraLoss || (!running && !cameraStarting)) return;
  handlingCameraLoss = true;
  console.warn('Plumb: camera lost —', reason);
  addAlertToFeed('camera_lost', `Camera feed lost (${reason}) — tracking stopped`);
  stopCamera('lost');
  handlingCameraLoss = false;
}

function stopCamera(reason = 'manual') {
  const wasRunning = running;

  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (wasRunning) {
    finalizePresenceBlock(reason === 'lost' ? 'camera_lost' : 'camera_stopped');
  }

  if (slouchStartedAt) {
    logPostureEvent(slouchType, slouchStartedAt, Date.now());
    slouchStartedAt = null;
    slouchAccumulatedMs = 0;
  }

  stillnessRef = null;
  lastMovementAt = null;
  localStorage.setItem(LAST_SESSION_END_KEY, new Date().toISOString());

  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }

  placeholder.style.display = 'flex';
  placeholder.textContent = reason === 'lost'
    ? 'camera feed was interrupted (another app may have taken it) — press start camera to resume'
    : 'camera is off — press start camera to begin';
  trackingSummary.hidden = true;

  cameraToggleBtn.textContent = 'start camera';
  cameraToggleBtn.classList.add('start-camera');
  cameraToggleBtn.classList.remove('stop-camera');
  cameraToggleBtn.disabled = false;

  calibrateBtn.disabled = true;
  breakToggleBtn.disabled = true;
  // A calibrated baseline persists across a stop/restart in this tab (no
  // need to redo it every time you toggle the camera), so reflect that in
  // the button instead of blanking it back to an unstyled "not done" look.
  calibrateBtn.textContent = baselineLateral === null ? 'calibrate posture' : 'recalibrate posture';
  calibrateBtn.classList.toggle('is-confirmed', baselineLateral !== null);
  calibrateBtn.classList.remove('needs-calibration');
  calibrateFlash.hidden = true;
  breakToggleBtn.textContent = 'take a break';
  breakToggleBtn.classList.remove('break-active', 'break-due');

  if (breakActive) endBreak();
  stopBgSilentAudio();
  flushEvents();

  closeTrackingPip();
}

async function populateCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    if (!cams.length) return;
    const saved = localStorage.getItem('plumb:cameraId');
    const prev = cameraSelect.value;
    cameraSelect.innerHTML = '<option value="">Default camera</option>';
    cams.forEach((cam, i) => {
      const o = document.createElement('option');
      o.value = cam.deviceId;
      o.textContent = cam.label || `Camera ${i + 1}`;
      cameraSelect.appendChild(o);
    });
    if (saved && cams.some(c => c.deviceId === saved)) cameraSelect.value = saved;
    else if (prev && cams.some(c => c.deviceId === prev)) cameraSelect.value = prev;
  } catch (e) {}
}
populateCameraList();
if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', populateCameraList);
cameraSelect.addEventListener('change', () => {
  localStorage.setItem('plumb:cameraId', cameraSelect.value);
  if (running) { stopCamera(); startCamera(); }
});

gearBtn.addEventListener('click', () => {
  const label = document.getElementById('currentUserLabel');
  if (label) label.textContent = currentUserId;
  settingsModalOverlay.classList.add('open');
});

document.getElementById('switchUserBtn').addEventListener('click', () => {
  localStorage.removeItem('plumb:userId');
  location.reload();
});

// Not real auth -- see the comment at the top of the file. A name is just
// stashed in localStorage; requestWindow() etc. never see it. Reloads after
// submit so every key/query built from currentUserId picks it up cleanly,
// rather than threading a "no user yet" state through the whole file.
function showUserPicker() {
  const overlay = document.getElementById('userModalOverlay');
  const input = document.getElementById('userNameInput');
  const knownList = document.getElementById('userKnownList');
  const continueBtn = document.getElementById('userContinueBtn');

  const known = JSON.parse(localStorage.getItem('plumb:knownUsers') || '[]');
  knownList.hidden = known.length === 0;
  knownList.innerHTML = '';
  known.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-compact';
    btn.textContent = name;
    btn.addEventListener('click', () => submit(name));
    knownList.appendChild(btn);
  });

  function submit(name) {
    name = name.trim();
    if (!name) { input.focus(); return; }
    const knownSet = new Set(known);
    knownSet.add(name);
    localStorage.setItem('plumb:knownUsers', JSON.stringify([...knownSet]));
    localStorage.setItem('plumb:userId', name);
    location.reload();
  }

  continueBtn.addEventListener('click', () => submit(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(input.value); });
  overlay.classList.add('open');
  input.focus();
}
settingsModalClose.addEventListener('click', () => settingsModalOverlay.classList.remove('open'));

function setStatus(mode, text, caption) {
  statusCard.classList.remove('state-good', 'state-mild', 'state-sustained', 'state-idle');
  statusCard.classList.add(`state-${mode === 'good' ? 'good' : mode === 'idle' ? 'idle' : mode}`);
  statusValue.textContent = text;
  if (caption !== undefined) statusCaption.textContent = caption;
}

const DOT_MAX_PX = 64, DOT_CENTER = 85, ELLIPSE_MAX_PX = 66, TOLERANCE_SCALE = 210;
const DOT_BASE_R = 11, DOT_LEAN_MAX_DELTA = 18, LEAN_CURVE_K = 8;

function updatePostureGlyph(lateral, compression, lean, latTol, compTol) {
  const ellipseRx = Math.min(ELLIPSE_MAX_PX, latTol * TOLERANCE_SCALE);
  const ellipseRy = Math.min(ELLIPSE_MAX_PX, compTol * TOLERANCE_SCALE);
  dzTolerance.style.rx = ellipseRx + 'px';
  dzTolerance.style.ry = ellipseRy + 'px';

  // Dot position is proportional to how much of your tolerance you've used
  // up, scaled against the loop's own rendered radius on each axis -- so
  // "touching the edge" always means "at the real slouch threshold",
  // instead of the dot racing out to the edge on a curve that had nothing
  // to do with the tolerance value.
  const latRatio = latTol > 0 ? lateral / latTol : 0;
  const compRatio = compTol > 0 ? compression / compTol : 0;
  const px = Math.max(-DOT_MAX_PX, Math.min(DOT_MAX_PX, -latRatio * ellipseRx));
  const py = Math.max(-DOT_MAX_PX, Math.min(DOT_MAX_PX, compRatio * ellipseRy));
  dzDot.style.cx = (DOT_CENTER + px) + 'px';
  dzDot.style.cy = (DOT_CENTER + py) + 'px';
  dzRing.style.cx = (DOT_CENTER + px) + 'px';
  dzRing.style.cy = (DOT_CENTER + py) + 'px';

  const leanNorm = Math.tanh(Math.max(lean, 0) * LEAN_CURVE_K);
  const dotR = DOT_BASE_R + leanNorm * DOT_LEAN_MAX_DELTA;
  dzDot.style.r = dotR + 'px';
  dzRing.style.r = (dotR + 5) + 'px';
}

function updateLiveMetrics(lateral, compression, lean, calibrated) {
  if (!calibrated) {
    lmLateral.textContent = '—';
    lmSlump.textContent = '—';
    lmLean.textContent = '—';
    lmLateral.classList.remove('over');
    lmSlump.classList.remove('over');
    lmLean.classList.remove('over');
    return;
  }
  const latTol = Number(toleranceSlider.value);
  const compTol = Number(compressionToleranceSlider.value);
  const leanTol = Number(leanToleranceSlider.value);
  lmLateral.textContent = lateral.toFixed(2);
  lmSlump.textContent = compression.toFixed(2);
  lmLean.textContent = lean.toFixed(2);
  lmLateral.classList.toggle('over', Math.abs(lateral) > latTol);
  lmSlump.classList.toggle('over', compression > compTol);
  lmLean.classList.toggle('over', lean > leanTol);
}

let lastCheckedDate = today();
function maybeSwitchDay() {
  const cur = today();
  if (lastCheckedDate !== cur) {
    lastCheckedDate = cur;
    flushEvents();
    breaksTakenToday = 0;
    breakTargetToday = 0;
    breakMinutesToday = 0;
    setPresenceStart(null);
    absenceStartedAt = null;
    hydrationConsumedMl = Number(localStorage.getItem(HYDRATION_LOG_PREFIX + cur)) || 0;
    hydrationLastClickMl = 0;
    renderHydration();
    renderBreakGauge();
    speak("Good morning! A new day of posture tracking has started.");
  }
}

function logStartupGap() {
  const lastEnd = localStorage.getItem(LAST_SESSION_END_KEY);
  if (!lastEnd) return;

  const gapStart = new Date(lastEnd).getTime();
  const gapEnd = Date.now();
  const gapSec = Math.round((gapEnd - gapStart) / 1000);

  // Invalid or ancient timestamps are ignored.
  if (!Number.isFinite(gapSec) || gapSec <= 0) {
    localStorage.removeItem(LAST_SESSION_END_KEY);
    return;
  }

  // Only handle gaps from the same local calendar day.
  if (dateForTimestamp(gapStart) !== today()) {
    localStorage.removeItem(LAST_SESSION_END_KEY);
    return;
  }

  // Up to 60 seconds: ignore, just reset.
  if (gapSec < 60) {
    localStorage.removeItem(LAST_SESSION_END_KEY);
    return;
  }

  // 1–60 minutes: treat as a real break, even if the laptop slept.
  if (gapSec <= 60 * 60) {
    logBreakEvent(gapStart, gapEnd, 'retrospective');
    addBreakMinutesToday(gapSec);
    incrementBreaksTaken();
    addAlertToFeed('break', `Break logged (${Math.round(gapSec / 60)} min)`);
  } else {
    // Longer than 60 minutes same day: honest not-tracking gap.
    logNotTrackingEvent(gapStart, gapEnd);
    addAlertToFeed('not_tracking', `Not tracking for ${Math.round(gapSec / 3600)}h ${Math.round((gapSec % 3600) / 60)}m`);
  }

  localStorage.removeItem(LAST_SESSION_END_KEY);
}

function markMinutes(event, states, state) {
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  if (isNaN(start) || isNaN(end)) return;
  const dayMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const dayEnd = new Date(dayMidnight.getTime() + 24 * 3600 * 1000);
  const startMs = Math.max(start, dayMidnight);
  const endMs = Math.min(end, dayEnd);
  if (endMs <= startMs) return;
  const startMin = Math.floor((startMs - dayMidnight) / 60000);
  const endMin = Math.ceil((endMs - dayMidnight) / 60000);
  for (let m = startMin; m < endMin && m < 1440; m++) {
    if (m >= 0) states[m] = state;
  }
}

const TIMELINE_COLORS = {
  good: '#0A2626',
  slouch: '#C1622E',
  break: '#C9C2B3',
  away: '#9FB0B5',
  not_tracking: '#F0EDE6',
  future: 'transparent'
};

// Classifies every minute of `referenceDate` into a base state (good/break/
// away/not_tracking/future) from raw events, plus -- for "good" minutes --
// what fraction of that minute was actually spent slouching (0..1), not
// just whether a slouch event touched it at all. A single 8-second posture
// correction shouldn't paint a whole 60-second block solid orange the same
// as ten straight minutes of real slumping: confirmed on real data
// (2026-09-14) that 1,169 slouch events averaging 8s each touched 297
// distinct minutes -- nearly 5 hours' worth of solid-orange minutes -- while
// the true slouch total that day was 2.6 hours, which is exactly why the
// minute strip looked far more slouch-heavy than the totals bar next to it.
// Pulled out of renderTodayTimeline so the same classification feeds both
// the full single-day timeline and the compact per-day strips in the week
// view -- one source of truth for "what happened when" that later AI
// summarization can also consume directly.
function computeMinuteData(events, referenceDate) {
  const now = new Date();
  const refDate = referenceDate || now;
  const midnight = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const dayEnd = new Date(midnight.getTime() + 24 * 3600 * 1000);
  const isToday = midnight.getTime() === new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // A past day is fully elapsed -- no "future" greying, no "now" line. Only
  // today has a real cutoff partway through.
  const nowMinute = isToday ? Math.floor((now - midnight) / 60000) : 1439;

  const states = new Array(1440).fill('not_tracking');
  for (let m = Math.max(0, Math.min(1439, nowMinute + 1)); m < 1440; m++) {
    states[m] = 'future';
  }

  events.forEach(e => { if (e.type === 'presence') markMinutes(e, states, 'good'); });
  events.forEach(e => {
    if (e.type === 'break') markMinutes(e, states, 'break');
    else if (e.type === 'away') markMinutes(e, states, 'away');
    else if (e.type === 'not_tracking') markMinutes(e, states, 'not_tracking');
  });

  // Camera blips under BREAK_MIN_SECONDS aren't logged as their own event (to
  // avoid noise), which leaves a real gap in event coverage for that moment.
  // Bridge short not_tracking runs sandwiched between two tracked segments so
  // a half-second flicker doesn't paint a stray "not tracking" sliver.
  const BRIDGE_MAX_MIN = 2;
  for (let i = 0; i < 1440; i++) {
    if (states[i] !== 'not_tracking') continue;
    let j = i;
    while (j < 1440 && states[j] === 'not_tracking') j++;
    if (j - i <= BRIDGE_MAX_MIN && states[i - 1] === 'good' && states[j] === 'good') {
      for (let k = i; k < j; k++) states[k] = 'good';
    }
    i = j - 1;
  }

  // How many seconds of each minute a slouch-type event actually overlapped,
  // not just whether it touched the minute -- this is what makes the strip
  // reflect real density instead of rounding every touch up to a full 60s.
  const slouchSeconds = new Array(1440).fill(0);
  events.forEach(e => {
    if (!['lateral_left', 'lateral_right', 'compression', 'lean_in'].includes(e.type)) return;
    const start = new Date(e.start_time);
    const end = new Date(e.end_time);
    if (isNaN(start) || isNaN(end)) return;
    let cursor = new Date(Math.max(start, midnight));
    const clippedEnd = new Date(Math.min(end, dayEnd));
    if (clippedEnd <= cursor) return;
    let m = Math.floor((cursor - midnight) / 60000);
    while (cursor < clippedEnd && m < 1440) {
      const minuteEnd = new Date(midnight.getTime() + (m + 1) * 60000);
      const segEnd = new Date(Math.min(clippedEnd, minuteEnd));
      if (m >= 0) slouchSeconds[m] += (segEnd - cursor) / 1000;
      cursor = segEnd;
      m++;
    }
  });
  const slouchFrac = slouchSeconds.map(s => Math.min(1, s / 60));

  return { states, slouchFrac, isToday, nowMinute, midnight };
}

// Draws one minute-resolution track: solid color per base state, with a
// slouch-density overlay (alpha = fraction of that minute spent slouching)
// on top of "good" minutes instead of a flat on/off paint. Shared by the
// full single-day timeline and the compact per-day strips so both render
// the same underlying data the same way.
function drawMinuteTrack(ctx2, x0, y0, width, height, states, slouchFrac) {
  for (let m = 0; m < 1440; m++) {
    const state = states[m];
    if (state === 'future') continue;
    const x = x0 + (m / 1440) * width;
    const w = x0 + ((m + 1) / 1440) * width - x;
    ctx2.fillStyle = TIMELINE_COLORS[state] || '#ccc';
    ctx2.fillRect(x, y0, w, height);
    if (state === 'good' && slouchFrac[m] > 0) {
      ctx2.globalAlpha = slouchFrac[m];
      ctx2.fillStyle = TIMELINE_COLORS.slouch;
      ctx2.fillRect(x, y0, w, height);
      ctx2.globalAlpha = 1;
    }
  }
}

// Compact, unlabeled version of the timeline, sized to fill whatever the
// canvas's CSS layout already gives it. Used for the per-day rows in the
// week view, where 7 of these sit next to a totals bar so the pattern
// within a day is visible without clicking in.
function drawDayStrip(canvas, minuteData) {
  const width = Math.max(canvas.getBoundingClientRect().width || canvas.parentElement.clientWidth || 200, 40);
  const height = 16;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx2 = canvas.getContext('2d');
  ctx2.scale(dpr, dpr);
  ctx2.clearRect(0, 0, width, height);
  drawMinuteTrack(ctx2, 0, 0, width, height, minuteData.states, minuteData.slouchFrac);
}

const TOTALS_BAR_COLORS = { good: '#0A2626', left: '#F0DAC7', right: '#E4C1A0', slump: '#C1622E', lean: '#2E7D6B', break: '#C9C2B3' };

// The same six categories as the month view's stacked bar chart, just drawn
// as one compact horizontal bar per day instead of a Chart.js dataset --
// pairs with drawDayStrip() in the week view's day rows.
function drawTotalsBar(canvas, bucket) {
  const width = Math.max(canvas.getBoundingClientRect().width || canvas.parentElement.clientWidth || 110, 40);
  const height = 16;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx2 = canvas.getContext('2d');
  ctx2.scale(dpr, dpr);
  ctx2.clearRect(0, 0, width, height);

  const good = Math.max(0, bucket.sessionSeconds - bucket.left - bucket.right - bucket.slump - bucket.lean);
  const segs = [
    ['good', good], ['left', bucket.left], ['right', bucket.right],
    ['slump', bucket.slump], ['lean', bucket.lean], ['break', bucket.break]
  ];
  const total = segs.reduce((sum, [, v]) => sum + v, 0);
  if (total <= 0) {
    ctx2.fillStyle = 'rgba(10,38,38,0.06)';
    ctx2.fillRect(0, 0, width, height);
    return;
  }
  let x = 0;
  segs.forEach(([key, val]) => {
    if (val <= 0) return;
    const w = (val / total) * width;
    ctx2.fillStyle = TOTALS_BAR_COLORS[key];
    ctx2.fillRect(x, 0, w, height);
    x += w;
  });
}

// Renders each day in the week view as a row: date label, consolidated
// totals bar, and the minute-by-minute pattern strip side by side. Unlike
// month, week always fetches raw events for the full range (see
// showReport()) -- 7 days is small enough that per-minute detail for every
// day is cheap, so there's no need to lean on the rollup table here. This
// is also the shape future AI summarization wants: totals and the
// underlying pattern together, per day, not just one or the other.
const TOTALS_BAR_LABELS = { good: 'good posture', left: 'leaning left', right: 'leaning right', slump: 'slumping', lean: 'leaning in', break: 'break' };
const TIMELINE_LABELS = { good: 'sitting well', slouch: 'slouching (shade = how much)', break: 'break', away: 'away', not_tracking: 'not tracking' };

// Built from the same color constants the bars/strips themselves draw
// from, so the key can't silently drift out of sync with what's on screen.
function renderWeekLegend() {
  if (weekDayRowsLegend.childElementCount > 0) return;
  const makeGroup = (title, colors, labels) => {
    const group = document.createElement('div');
    group.className = 'legend-group';
    const label = document.createElement('span');
    label.className = 'legend-group-label';
    label.textContent = title;
    group.appendChild(label);
    Object.keys(colors).forEach(key => {
      if (!(key in labels)) return;
      const item = document.createElement('span');
      item.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = colors[key];
      if (key === 'not_tracking') swatch.style.border = '1px solid var(--ink-faint-2)';
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(labels[key]));
      group.appendChild(item);
    });
    return group;
  };
  weekDayRowsLegend.appendChild(makeGroup('totals', TOTALS_BAR_COLORS, TOTALS_BAR_LABELS));
  weekDayRowsLegend.appendChild(makeGroup('pattern', TIMELINE_COLORS, TIMELINE_LABELS));
  weekDayRowsLegend.appendChild(makeGroup('hydration', { water: 'var(--water)' }, { water: 'bar = % of daily target' }));
}

function renderWeekDayRows(dates, dateMap, eventsByDate, hydrationByDate) {
  renderWeekLegend();
  weekDayRowsList.innerHTML = '';
  dates.forEach(ds => {
    const bucket = dateMap[ds];
    const dayEvents = eventsByDate[ds] || [];

    const row = document.createElement('div');
    row.className = 'day-row';

    const label = document.createElement('div');
    label.className = 'day-row-label';
    label.textContent = new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    row.appendChild(label);

    const totalsCanvas = document.createElement('canvas');
    totalsCanvas.className = 'day-row-totals';
    row.appendChild(totalsCanvas);

    const stripCanvas = document.createElement('canvas');
    stripCanvas.className = 'day-row-strip';
    stripCanvas.title = 'click for full timeline';
    stripCanvas.addEventListener('click', () => showDayDrilldown(ds));
    row.appendChild(stripCanvas);

    const meta = document.createElement('div');
    meta.className = 'day-row-meta';
    const trackedMin = Math.round((bucket.sessionSeconds + bucket.break) / 60);
    const daySlouchSec = bucket.left + bucket.right + bucket.slump + bucket.lean;
    const daySlouchPct = bucket.sessionSeconds ? Math.round(daySlouchSec / bucket.sessionSeconds * 100) : 0;
    meta.textContent = trackedMin > 0 ? `${trackedMin}m · ${daySlouchPct}%` : '—';
    row.appendChild(meta);

    const hydrationMl = (hydrationByDate && hydrationByDate[ds]) || 0;
    const hydrationCell = document.createElement('div');
    hydrationCell.className = 'day-row-hydration';
    hydrationCell.title = `${hydrationMl}ml of ${hydrationTargetMl}ml target`;
    const hydrationBarBg = document.createElement('div');
    hydrationBarBg.className = 'day-row-hydration-bar';
    const hydrationBarFill = document.createElement('div');
    hydrationBarFill.className = 'day-row-hydration-fill';
    const hydrationPct = hydrationTargetMl ? Math.min(100, Math.round((hydrationMl / hydrationTargetMl) * 100)) : 0;
    hydrationBarFill.style.width = `${hydrationPct}%`;
    hydrationBarBg.appendChild(hydrationBarFill);
    hydrationCell.appendChild(hydrationBarBg);
    const hydrationLabel = document.createElement('span');
    hydrationLabel.className = 'day-row-hydration-label';
    hydrationLabel.textContent = hydrationMl > 0 ? `${(hydrationMl / 1000).toFixed(1)}L` : '—';
    hydrationCell.appendChild(hydrationLabel);
    row.appendChild(hydrationCell);

    weekDayRowsList.appendChild(row);

    drawTotalsBar(totalsCanvas, bucket);
    const minuteData = computeMinuteData(dayEvents, new Date(ds + 'T00:00:00'));
    drawDayStrip(stripCanvas, minuteData);
  });
}

function renderTodayTimeline(events, canvas, referenceDate) {
  const container = canvas.parentElement;
  const containerWidth = container.getBoundingClientRect().width || container.clientWidth || 600;
  const width = Math.max(containerWidth, 300);
  const height = 175;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.style.display = 'block';

  const ctx2 = canvas.getContext('2d');
  ctx2.scale(dpr, dpr);
  ctx2.clearRect(0, 0, width, height);

  const timelineHeight = 100;
  const legendY = timelineHeight + 22;
  const hourLabelY = timelineHeight + 14;

  const { states, slouchFrac, isToday, nowMinute, midnight } = computeMinuteData(events, referenceDate);
  const colors = TIMELINE_COLORS;

  const labels = {
    good: 'sitting well',
    slouch: 'slouching',
    break: 'break (1–60m)',
    away: 'away (60m+)',
    not_tracking: 'not tracking'
  };

  drawMinuteTrack(ctx2, 0, 0, width, timelineHeight, states, slouchFrac);

  // Contiguous runs of the same base state, for the hover tooltip below --
  // the fill itself no longer needs these (drawMinuteTrack paints
  // per-minute), but "sitting well, 09:14-11:40" reads better on hover than
  // a single minute would.
  const segments = [];
  let segCur = states[0];
  let segStart = 0;
  for (let i = 1; i < 1440; i++) {
    if (states[i] !== segCur) {
      segments.push({ state: segCur, startMin: segStart, endMin: i });
      segStart = i;
      segCur = states[i];
    }
  }
  segments.push({ state: segCur, startMin: segStart, endMin: 1440 });

  ctx2.fillStyle = '#4B615E';
  ctx2.font = '10px Karla, sans-serif';

  for (let h = 0; h <= 24; h += 1) {
    const x = (h / 24) * width;

    if (h % 3 === 0) {
      ctx2.strokeStyle = 'rgba(10,38,38,0.12)';
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(x, 0);
      ctx2.lineTo(x, timelineHeight);
      ctx2.stroke();

      ctx2.fillText(String(h).padStart(2, '0') + ':00', x + 2, hourLabelY);
    } else {
      ctx2.strokeStyle = 'rgba(10,38,38,0.05)';
      ctx2.beginPath();
      ctx2.moveTo(x, 0);
      ctx2.lineTo(x, timelineHeight);
      ctx2.stroke();
    }
  }

  if (isToday && nowMinute >= 0 && nowMinute <= 1440) {
    const x = (nowMinute / 1440) * width;

    ctx2.strokeStyle = '#14403B';
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.moveTo(x, 0);
    ctx2.lineTo(x, timelineHeight);
    ctx2.stroke();

    ctx2.fillStyle = '#14403B';
    ctx2.font = 'bold 9px Karla, sans-serif';
    ctx2.fillText('now', x + 3, 9);
  }

  const legendItems = [
    { key: 'good', color: colors.good },
    { key: 'slouch', color: colors.slouch },
    { key: 'break', color: colors.break },
    { key: 'away', color: colors.away },
    { key: 'not_tracking', color: colors.not_tracking }
  ];

  let legendX = 0;
  ctx2.font = '10px Karla, sans-serif';

  legendItems.forEach(item => {
    const swatchSize = 8;
    const text = labels[item.key];
    const textWidth = ctx2.measureText(text).width;
    const totalWidth = swatchSize + 4 + textWidth + 14;

    ctx2.fillStyle = item.color;
    ctx2.fillRect(legendX, legendY, swatchSize, swatchSize);

    ctx2.fillStyle = '#4B615E';
    ctx2.fillText(text, legendX + swatchSize + 4, legendY + swatchSize - 1);

    legendX += totalWidth;
  });

  canvas._timelineSegments = segments;
  canvas._timelineColors = colors;
  canvas._timelineLabels = labels;
  canvas._timelineWidth = width;
  canvas._timelineHeight = timelineHeight;
  canvas._timelineMidnight = midnight;

  function formatDuration(mins) {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (y > timelineHeight) {
      canvas.title = '';
      return;
    }

    const minute = (x / width) * 1440;
    const seg = segments.find(s => minute >= s.startMin && minute < s.endMin);

    if (seg && seg.state !== 'future') {
      const startTime = new Date(midnight.getTime() + seg.startMin * 60000);
      const endTime = new Date(midnight.getTime() + seg.endMin * 60000);
      const startLabel = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const endLabel = endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let extra = '';
      if (seg.state === 'good') {
        let sum = 0;
        for (let m = seg.startMin; m < seg.endMin; m++) sum += slouchFrac[m];
        const avgPct = Math.round((sum / (seg.endMin - seg.startMin)) * 100);
        if (avgPct > 0) extra = ` · ${avgPct}% slouching`;
      }

      canvas.title = `${labels[seg.state]}${extra}\n${startLabel} – ${endLabel}\n${formatDuration(seg.endMin - seg.startMin)}`;
    } else {
      canvas.title = '';
    }
  };

  canvas.onmouseleave = () => {
    canvas.title = '';
  };
}

async function fetchEventsForRange(start, end) {
  if (!SYNC_CONFIGURED) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_events?date=gte.${start}&date=lte.${end}&user_id=eq.${encodeURIComponent(currentUserId)}&order=date.asc,start_time.asc`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error('fetch');
    return await res.json();
  } catch (e) { console.warn(e); return []; }
}

async function fetchHydrationForRange(start, end) {
  if (!SYNC_CONFIGURED) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hydration_events?date=gte.${start}&date=lte.${end}&user_id=eq.${encodeURIComponent(currentUserId)}&select=date,volume_ml`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error('fetch');
    return await res.json();
  } catch (e) { console.warn(e); return []; }
}

// Reads the pre-aggregated rollup table instead of raw events -- a handful
// of (date, type) rows instead of potentially thousands of individual
// nudges, so week/month reports stay fast and immune to the REST row cap
// regardless of how much history accumulates. Only covers dates the nightly
// rollup has already processed (see rollup-summary.cjs); the last couple of
// days are always fetched from raw events instead, since they haven't been
// rolled up yet -- see showReport().
async function fetchDailySummaryForRange(start, end) {
  if (!SYNC_CONFIGURED) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_daily_summary?date=gte.${start}&date=lte.${end}&user_id=eq.${encodeURIComponent(currentUserId)}&order=date.asc`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error('fetch');
    return await res.json();
  } catch (e) { console.warn(e); return []; }
}

const TS_SLOUCH_TYPES = ['lateral_left', 'lateral_right', 'compression', 'lean_in'];

// The ambient "how's today going" panel that replaces the dead video space
// once PiP has taken the live feed. Reuses the real report timeline (hour
// markers, "now" line, actual minute-by-minute segments) rather than a
// flattened summary -- when something happened matters, not just how much.
// Deliberately still not the full report: no click-through, no week/month,
// just today at a glance. Session-only sitting-well%, matching showReport's
// fixed formula.
async function renderTrackingSummary() {
  if (!SYNC_CONFIGURED) return;
  const d = today();
  const events = await fetchEventsForRange(d, d);

  // `events` only has *finalized* chunks -- a presence block (and any
  // slouch sub-segment inside it) only becomes a row once it ends. Without
  // this, the panel reads as frozen for as long as you've been continuously
  // tracked, which is exactly backwards for an ambient "how's it going" view.
  const now = Date.now();
  if (presenceStartedAt) {
    events.push({ date: d, type: 'presence', start_time: new Date(presenceStartedAt).toISOString(), end_time: new Date(now).toISOString(), duration_seconds: Math.round((now - presenceStartedAt) / 1000) });
  }
  if (slouchStartedAt) {
    events.push({ date: d, type: slouchType, start_time: new Date(slouchStartedAt).toISOString(), end_time: new Date(now).toISOString(), duration_seconds: Math.round((now - slouchStartedAt) / 1000) });
  }

  let session = 0, slouch = 0, breakSec = 0, breaks = 0;
  events.forEach(e => {
    const dur = e.duration_seconds || 0;
    if (e.type === 'presence') session += dur;
    else if (TS_SLOUCH_TYPES.includes(e.type)) slouch += dur;
    else if (e.type === 'break') { breakSec += dur; breaks++; }
  });

  const pct = session > 0 ? Math.max(0, Math.min(100, Math.round((session - slouch) / session * 100))) : null;
  tsHeroNum.textContent = pct === null ? '—' : pct + '%';

  const monitoredMin = Math.round((session + breakSec) / 60);
  const monitoredLabel = monitoredMin >= 60 ? `${Math.floor(monitoredMin / 60)}h ${monitoredMin % 60}m` : `${monitoredMin}m`;
  tsStats.textContent = `${monitoredLabel} monitored · ${breaks} break${breaks === 1 ? '' : 's'} taken`;

  renderTodayTimeline(events, tsTimelineChart);
}

async function showReport(range) {
  let start, end;
  const curDate = today();
  if (range === 'today') { start = curDate; end = curDate; }
  else if (range === 'week') { start = addDaysToDateStr(curDate, -6); end = curDate; }
  else if (range === 'month') { start = addDaysToDateStr(curDate, -29); end = curDate; }
  else if (range === 'ai') { renderAiSummary(); return; }

  panelNumeric.classList.add('active');
  panelAi.classList.remove('active');

  const emptyBucket = () => ({ break: 0, left: 0, right: 0, slump: 0, lean: 0, away: 0, breaks: 0, sessionSeconds: 0 });
  function addToBucket(bucket, type, dur, count) {
    if (type === 'break') { bucket.break += dur; bucket.breaks += count; }
    else if (type === 'away') bucket.away += dur;
    else if (type === 'lateral_left') bucket.left += dur;
    else if (type === 'lateral_right') bucket.right += dur;
    else if (type === 'compression') bucket.slump += dur;
    else if (type === 'lean_in') bucket.lean += dur;
    // 'presence' events cover every continuous tracked block (across however many
    // devices were used that day) and sum correctly since each is its own inserted
    // row. This replaces the old posture_logs.session_seconds read, which was a
    // single per-day value that got silently overwritten by whichever device
    // synced last, undercounting any day where more than one device was used.
    else if (type === 'presence') bucket.sessionSeconds += dur;
  }

  // Week/month read the pre-summed rollup table for anything the nightly job
  // has already processed, and raw events only for the last 2 days it
  // hasn't reached yet (see rollup-summary.cjs's cutoff) -- keeps the report
  // fast and immune to the REST row cap no matter how much history piles
  // up, while still being current within a day or two. "today" is untouched:
  // always raw, since it needs full per-minute granularity for the timeline.
  // Week is also always raw for every day in range, not just the recent
  // ones -- only 7 days, so the volume that made month need the rollup in
  // the first place (thousands of rows) never comes close to mattering
  // here, and the day rows below need real per-minute detail for the whole
  // week, not just aggregate totals.
  let events = [];
  let summaryRows = [];
  let hydrationRows = [];
  if (range === 'month') {
    const summaryEnd = addDaysToDateStr(curDate, -2);
    const recentStart = addDaysToDateStr(curDate, -1);
    [summaryRows, events, hydrationRows] = await Promise.all([
      summaryEnd >= start ? fetchDailySummaryForRange(start, summaryEnd) : Promise.resolve([]),
      fetchEventsForRange(recentStart, end),
      fetchHydrationForRange(start, end)
    ]);
  } else if (range === 'week') {
    [events, hydrationRows] = await Promise.all([
      fetchEventsForRange(start, end),
      fetchHydrationForRange(start, end)
    ]);
  } else {
    events = await fetchEventsForRange(start, end);
  }

  const hydrationByDate = {};
  hydrationRows.forEach(r => {
    hydrationByDate[r.date] = (hydrationByDate[r.date] || 0) + (r.volume_ml || 0);
  });

  const dateMap = {};
  let ds0 = start;
  while (ds0 <= end) {
    dateMap[ds0] = emptyBucket();
    ds0 = addDaysToDateStr(ds0, 1);
  }
  summaryRows.forEach(r => {
    const ds = r.date;
    if (!dateMap[ds]) dateMap[ds] = emptyBucket();
    addToBucket(dateMap[ds], r.type, r.total_seconds || 0, r.event_count || 0);
  });
  events.forEach(e => {
    const ds = e.date;
    if (!dateMap[ds]) dateMap[ds] = emptyBucket();
    const dur = e.duration_seconds || 0;
    addToBucket(dateMap[ds], e.type, dur, 1);
  });

  const dates = Object.keys(dateMap).sort();
  const labels = dates.map(ds => new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
  const breakMin = dates.map(ds => Math.round(dateMap[ds].break / 60));
  const leftMin = dates.map(ds => Math.round(dateMap[ds].left / 60));
  const rightMin = dates.map(ds => Math.round(dateMap[ds].right / 60));
  const slumpMin = dates.map(ds => Math.round(dateMap[ds].slump / 60));
  const leanMin = dates.map(ds => Math.round(dateMap[ds].lean / 60));
  const goodMin = dates.map(ds => Math.max(0, Math.round((dateMap[ds].sessionSeconds - dateMap[ds].left - dateMap[ds].right - dateMap[ds].slump - dateMap[ds].lean) / 60)));

  let totalBreak = 0, totalSession = 0, totalSlouch = 0, totalBreaks = 0, totalAway = 0;
  Object.values(dateMap).forEach(day => {
    totalBreak += day.break;
    totalSession += day.sessionSeconds;
    totalSlouch += day.left + day.right + day.slump + day.lean;
    totalBreaks += day.breaks;
    totalAway += day.away;
  });
  const overall = totalBreak + totalSession;
  // Denominator is session time only, not session+break -- taking a break
  // is neutral, not a quiet way to inflate this number. "monitored" above
  // still counts break time; it's a different question (how much of your
  // day is accounted for at all) from this one (how much of your sitting
  // time was good). Matches generate-summary.cjs's slouchRatePct, which
  // already used session-only.
  const slouchPct = totalSession ? Math.min(100, Math.round(totalSlouch / totalSession * 100)) : 0;
  const avgBreak = totalBreaks ? Math.round(totalBreak / totalBreaks / 60) : 0;

  // Days with zero logged water are real "didn't drink anything" days, not
  // missing data (unlike posture, there's no passive capture -- every ml is
  // a manual button press) -- so they count fully toward the average rather
  // than being excluded as unmeasured.
  let hydrationMetric = '';
  if (range === 'week' || range === 'month') {
    const dayCount = dates.length;
    const totalMl = dates.reduce((sum, ds) => sum + (hydrationByDate[ds] || 0), 0);
    const avgMl = dayCount ? Math.round(totalMl / dayCount) : 0;
    const avgPctOfTarget = hydrationTargetMl ? Math.round((avgMl / hydrationTargetMl) * 100) : 0;
    hydrationMetric = `<div class="metric"><div class="value">${(avgMl / 1000).toFixed(1)}L</div><div class="label">avg hydration${avgPctOfTarget ? ` (${avgPctOfTarget}%)` : ''}</div></div>`;
  }

  reportSummary.innerHTML = `
    <div class="metric"><div class="value">${Math.round(overall / 60)}m</div><div class="label">monitored</div></div>
    <div class="metric"><div class="value">${slouchPct}%</div><div class="label">time slouching</div></div>
    <div class="metric"><div class="value">${totalBreaks}</div><div class="label">breaks</div></div>
    <div class="metric"><div class="value">${avgBreak}m</div><div class="label">avg break</div></div>
    ${totalAway > 0 ? `<div class="metric"><div class="value">${Math.round(totalAway / 3600)}h</div><div class="label">time away</div></div>` : ''}
    ${hydrationMetric}
  `;

  slouchChartCtx.canvas.style.display = 'none';
  hydrationChartCtx.canvas.style.display = 'none';
  todayTimelineCanvas.style.display = 'none';
  weekDayRows.style.display = 'none';
  hideDayDrilldown();

  if (range === 'today') {
    todayTimelineCanvas.style.display = 'block';
    renderTodayTimeline(events, todayTimelineCanvas);
  } else if (range === 'week') {
    weekDayRows.style.display = 'block';
    const eventsByDate = {};
    events.forEach(e => {
      if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
      eventsByDate[e.date].push(e);
    });
    renderWeekDayRows(dates, dateMap, eventsByDate, hydrationByDate);
  } else {
    slouchChartCtx.canvas.style.display = 'block';
    if (currentChart) currentChart.destroy();
    currentChart = new Chart(slouchChartCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'good posture', data: goodMin, backgroundColor: '#0A2626', stack: 's' },
          { label: 'leaning left', data: leftMin, backgroundColor: '#F0DAC7', stack: 's' },
          { label: 'leaning right', data: rightMin, backgroundColor: '#E4C1A0', stack: 's' },
          { label: 'slumping', data: slumpMin, backgroundColor: '#C1622E', stack: 's' },
          { label: 'leaning in', data: leanMin, backgroundColor: '#2E7D6B', stack: 's' },
          { label: 'break', data: breakMin, backgroundColor: '#C9C2B3', stack: 's' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, title: { display: true, text: 'minutes' }, grid: { color: 'rgba(10,38,38,0.06)' } }
        },
        plugins: {
          legend: { labels: { font: { family: 'Karla', weight: '600', size: 11 }, boxWidth: 12, padding: 12 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} min` } }
        },
        // Click a day's bar to drill into that day's actual timeline (same
        // rendering as "today", just for whichever date was clicked) --
        // aggregates tell you how much, the timeline tells you when.
        onClick: (evt, elements) => {
          if (!elements.length) return;
          showDayDrilldown(dates[elements[0].index]);
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        }
      }
    });

    // Month is the only view long enough that a day-by-day water trend is
    // worth its own chart rather than just an average -- week's day rows
    // already show it inline per day.
    if (range === 'month') {
      hydrationChartCtx.canvas.style.display = 'block';
      if (hydrationChart) hydrationChart.destroy();
      const hydrationL = dates.map(ds => Math.round((hydrationByDate[ds] || 0) / 100) / 10);
      const targetL = hydrationTargetMl / 1000;
      hydrationChart = new Chart(hydrationChartCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'water', data: hydrationL, backgroundColor: '#3E7CA6', borderRadius: 3 },
            {
              label: 'target', data: dates.map(() => targetL), type: 'line',
              borderColor: 'rgba(10,38,38,0.35)', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          scales: {
            x: { grid: { display: false } },
            y: { title: { display: true, text: 'litres' }, grid: { color: 'rgba(10,38,38,0.06)' } }
          },
          plugins: {
            legend: { labels: { font: { family: 'Karla', weight: '600', size: 11 }, boxWidth: 12, padding: 12 } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}L` } }
          }
        }
      });
    }
  }
}

// Always fetches raw events for the single clicked day -- even a "rolled
// up" day still has its full-resolution row untouched in posture_events
// (see rollup-summary.cjs), so this works identically whether the day came
// from the summary table or from recent raw events in the chart above.
async function showDayDrilldown(dateStr) {
  dayDrilldownTitle.textContent = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  dayDrilldown.style.display = 'block';
  dayDrilldown.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const dayEvents = await fetchEventsForRange(dateStr, dateStr);
  renderTodayTimeline(dayEvents, dayDrilldownCanvas, new Date(dateStr + 'T00:00:00'));
}

function hideDayDrilldown() {
  dayDrilldown.style.display = 'none';
}

async function renderAiSummary() {
  panelNumeric.classList.remove('active');
  panelAi.classList.add('active');
  try {
    const res = await fetch('./data/summary.json', { cache: 'no-store' });
    const data = await res.json();
    if (!data.summary) {
      aiSummaryText.textContent = "no summary yet — this fills in after the weekly GitHub Action runs.";
      aiMeta.textContent = '';
      aiStatGrid.innerHTML = '';
      if (aiChart) { aiChart.destroy(); aiChart = null; }
      return;
    }
    aiSummaryText.textContent = data.summary;
    aiMeta.textContent = data.generatedAt ? `generated ${new Date(data.generatedAt).toLocaleString()} · based on ${data.stats.daysLogged} logged days` : '';
    const s = data.stats;
    aiStatGrid.innerHTML = `
      <div class="metric"><div class="value">${Math.round((s.totalSessionMinutes || 0) / 60)}h</div><div class="label">tracked time</div></div>
      <div class="metric"><div class="value">${s.slouchRatePct || 0}%</div><div class="label">time slouching</div></div>
      <div class="metric"><div class="value">${s.totalBreaksTaken || 0}</div><div class="label">breaks taken</div></div>
    `;
    const days = s.days || [];
    if (aiChart) aiChart.destroy();
    aiChart = new Chart(document.getElementById('aiDailyChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: days.map(d => d.date),
        datasets: [{ label: 'slouch minutes', data: days.map(d => d.slouchMinutes || 0), backgroundColor: '#C1622E', borderRadius: 4 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { title: { display: true, text: 'minutes' }, grid: { color: 'rgba(10,38,38,0.06)' } },
          x: { grid: { display: false } }
        }
      }
    });
  } catch (err) {
    aiSummaryText.textContent = "couldn't load this week's summary.";
    aiMeta.textContent = '';
    aiStatGrid.innerHTML = '';
  }
}

reportBtn.addEventListener('click', () => {
  modalOverlay.classList.add('open');
  const active = document.querySelector('.tab.active');
  showReport(active ? active.dataset.range : 'today');
});
modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
dayDrilldownClose.addEventListener('click', hideDayDrilldown);
modalTabs.addEventListener('click', e => {
  if (e.target.classList.contains('tab')) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    showReport(e.target.dataset.range);
  }
});

// ---- Critical listeners ----
cameraToggleBtn.addEventListener('click', () => {
  if (running || cameraStarting) stopCamera();
  else startCamera();
});

breakToggleBtn.addEventListener('click', () => {
  if (!running) return;
  if (breakActive) endBreak();
  else startBreak(true);
});

calibrateBtn.addEventListener('click', () => {
  // Belt-and-braces on top of the startCamera reordering above -- if this
  // somehow still fires before the model/video are actually ready, say so
  // instead of doing nothing. A click that appears to do nothing, with no
  // feedback either way, is what made this feel broken rather than slow.
  // Deliberately NOT gated on `running` -- calibration is meant to work
  // during the pre-running alignment countdown too (see startCamera), only
  // on the model/video actually being live.
  if (!landmarker || !video.srcObject) {
    addAlertToFeed('calibration', 'Camera not ready yet — try again in a moment');
    return;
  }
  const result = landmarker.detectForVideo(video, performance.now());
  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    const earMid = midpoint(lm[7], lm[8]);
    const shMid = midpoint(lm[11], lm[12]);
    baselineNeckRatio = neckCompressionRatio(earMid, shMid, lm[11], lm[12]);
    baselineLateral = lateralDeviation(earMid, shMid, lm[11], lm[12]);
    baselineShoulderWidth = shoulderWidthOf(lm[11], lm[12]);
    stillnessRef = null;
    lastMovementAt = null;
    statusCaption.textContent = 'calibrated to your desk';
    speak("Calibrated. That's your good posture.");
    addAlertToFeed('calibration', 'Posture calibrated');
    logCalibrationEvent();
    calibrateBtn.textContent = 'recalibrate posture';
    calibrateBtn.classList.remove('needs-calibration');
    calibrateBtn.classList.add('is-confirmed');
    calibrateFlash.hidden = true;
  } else {
    addAlertToFeed('calibration', "No person detected — make sure you're in frame, then try again");
  }
});

// ---- Main loop ----
function loop() {
  if (trackingPipWindow && trackingPipWindow.closed) {
    stopCamera();
    return;
  }

  if (!running) return;

  // Everything below can throw if the video feed goes bad mid-frame (most
  // commonly: another app took the camera and the track ended or the
  // element is left on a stale/zero-size frame the pose model can't
  // process). Before this, an uncaught throw here just killed the
  // requestAnimationFrame chain outright -- `running` stayed true, the
  // button still said "stop camera", and whatever presence/slouch block
  // was open at that moment never got finalized or flushed, silently
  // losing that stretch of the day. handleCameraLost() closes it down
  // cleanly instead, the same way a manual stop does.
  try {
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.5);
  lastFrameTime = now;
  maybeSwitchDay();

  const result = landmarker.detectForVideo(video, now);
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    const leftEar = lm[7], rightEar = lm[8], leftSh = lm[11], rightSh = lm[12];
    drawPoseDots([leftEar, rightEar, leftSh, rightSh]);

    const earMid = midpoint(leftEar, rightEar);
    const shMid = midpoint(leftSh, rightSh);

    // Experimental only (see comment above the helpers) -- drawn/printed for
    // now, not fed into calibration, slouch detection, or storage.
    const leftEye = lm[2], rightEye = lm[5], nose = lm[0];
    drawPoseDots([leftEye, rightEye, nose], 'rgba(193,98,46,0.85)');
    drawExperimentalReadout(
      eyeTiltDegrees(leftEye, rightEye),
      interEyeDistanceRatio(leftEye, rightEye, leftSh, rightSh),
      noseOffset(nose, shMid, leftSh, rightSh)
    );

    if (!isPersonPresent) {
      if (breakActive && !manualBreak && breakStartedAt) {
        const gap = (Date.now() - breakStartedAt) / 1000;
        if (gap >= BREAK_MIN_SECONDS) {
          endBreak();
        } else {
          breakActive = false;
          breakStartedAt = null;
          manualBreak = false;
          breakPreSittingSeconds = 0;
          breakToggleBtn.textContent = 'take a break';
          breakToggleBtn.classList.remove('break-active', 'break-due');
        }
      } else if (absenceStartedAt) {
        const gapStart = absenceStartedAt;
        const gapEnd = Date.now();
        const classification = classifyGap(gapStart, gapEnd);
        if (classification === 'break') {
          logBreakEvent(gapStart, gapEnd, 'auto', lastFinalizedSittingSeconds);
          addBreakMinutesToday((gapEnd - gapStart) / 1000);
          incrementBreaksTaken();
          addAlertToFeed('break', `Break ended (${Math.round((gapEnd - gapStart) / 60000)} min)`);
        } else if (classification === 'away') {
          logAwayEvent(gapStart, gapEnd);
          addAlertToFeed('away', `Away for ${Math.round((gapEnd - gapStart) / 3600)}h`);
        }
        absenceStartedAt = null;
      }

      isPersonPresent = true;
      setPresenceStart(Date.now());
      stillnessRef = null;
      lastMovementAt = null;
      lastBreakNudgeAt = Date.now();
      renderBreakGauge();
    }

    const breakIntervalMin = Number(breakSlider.value);
    const continuousMin = presenceStartedAt ? (Date.now() - presenceStartedAt) / 60000 : 0;
    if (!breakActive && continuousMin >= breakIntervalMin) {
      breakToggleBtn.classList.add('break-due');
      breakToggleBtn.textContent = 'time for a break';
    } else if (!breakActive) {
      breakToggleBtn.classList.remove('break-due');
      breakToggleBtn.textContent = 'take a break';
    }
    renderBreakGauge(continuousMin);

    if (breakActive) {
      setStatus('idle', 'on a break', 'back in a few');
      updatePostureGlyph(0, 0, 0, Number(toleranceSlider.value), Number(compressionToleranceSlider.value));
      updateLiveMetrics(0, 0, 0, false);
      stillnessRef = null;
      lastMovementAt = null;
      nextFrame();
      return;
    }

    const lateral = baselineLateral !== null ? lateralDeviation(earMid, shMid, leftSh, rightSh) - baselineLateral : 0;
    const neckRatio = neckCompressionRatio(earMid, shMid, leftSh, rightSh);
    const compression = baselineNeckRatio !== null ? baselineNeckRatio - neckRatio : 0;
    const lean = leanInRatio(leftSh, rightSh, baselineShoulderWidth);
    const calibrated = baselineLateral !== null && baselineNeckRatio !== null && baselineShoulderWidth !== null;
    updateLiveMetrics(lateral, compression, lean, calibrated);

    displayLateral += (lateral - displayLateral) * 0.08;
    displayCompression += (compression - displayCompression) * 0.08;
    displayLean += (lean - displayLean) * 0.08;

    if (!calibrated) {
      setStatus('idle', 'calibrate to begin', 'sit naturally, then calibrate');
      updatePostureGlyph(0, 0, 0, Number(toleranceSlider.value), Number(compressionToleranceSlider.value));
    } else {
      const latTol = Number(toleranceSlider.value);
      const compTol = Number(compressionToleranceSlider.value);
      const leanTol = Number(leanToleranceSlider.value);
      const sus = Number(sustainSlider.value) * 1000;
      const leftLean = lateral > latTol;
      const rightLean = lateral < -latTol;
      const comp = compression > compTol;
      const leaningIn = lean > leanTol;
      const isSlouching = leftLean || rightLean || comp || leaningIn;
      const currentType = leftLean ? 'lateral_left' : rightLean ? 'lateral_right' : comp ? 'compression' : leaningIn ? 'lean_in' : null;

      updatePostureGlyph(displayLateral, displayCompression, displayLean, latTol, compTol);

      if (!stillnessRef) {
        stillnessRef = { lateral, compression, lean };
        lastMovementAt = Date.now();
      } else {
        const moved = Math.abs(lateral - stillnessRef.lateral) > STILLNESS_MOVE_THRESHOLD
          || Math.abs(compression - stillnessRef.compression) > STILLNESS_MOVE_THRESHOLD
          || Math.abs(lean - stillnessRef.lean) > STILLNESS_MOVE_THRESHOLD;
        if (moved) {
          stillnessRef = { lateral, compression, lean };
          lastMovementAt = Date.now();
        }
      }
      const stillMin = Number(stillnessSlider.value);
      const stillMs = Date.now() - (lastMovementAt || Date.now());
      if (stillMs / 60000 >= stillMin && Date.now() - lastStillnessNudgeAt > 60000) {
        const p = STILLNESS_PHRASES[stillIdx % STILLNESS_PHRASES.length];
        stillIdx++;
        speak(p);
        addAlertToFeed('stillness_prompt', p);
        lastStillnessNudgeAt = Date.now();
        stillnessRef = { lateral, compression, lean };
        lastMovementAt = Date.now();
      }

      if (isSlouching) {
        if (!slouchStartedAt) {
          slouchStartedAt = Date.now();
          slouchType = currentType;
          slouchAccumulatedMs = 0;
        }
        slouchAccumulatedMs += dt * 1000;
        const dur = Date.now() - slouchStartedAt;
        const label = currentType === 'compression' ? 'slumping'
          : currentType === 'lateral_left' ? 'leaning left'
          : currentType === 'lateral_right' ? 'leaning right'
          : 'leaning in';
        setStatus(dur > sus ? 'sustained' : 'mild', label, `${Math.round(dur / 1000)}s and counting`);
        if (dur > sus && Date.now() - lastPostureNudgeAt > 5000) {
          let phrase;
          if (currentType === 'compression') { phrase = SLUMP_PHRASES[slumpIdx % SLUMP_PHRASES.length]; slumpIdx++; }
          else if (currentType === 'lateral_left') { phrase = LEFT_PHRASES[leftIdx % LEFT_PHRASES.length]; leftIdx++; }
          else if (currentType === 'lateral_right') { phrase = RIGHT_PHRASES[rightIdx % RIGHT_PHRASES.length]; rightIdx++; }
          else { phrase = LEAN_PHRASES[leanIdx % LEAN_PHRASES.length]; leanIdx++; }
          speak(phrase);
          addAlertToFeed(currentType, phrase);
          lastPostureNudgeAt = Date.now();
        }
      } else {
        if (slouchStartedAt) {
          logPostureEvent(slouchType, slouchStartedAt, slouchStartedAt + slouchAccumulatedMs);
          slouchStartedAt = null;
          slouchAccumulatedMs = 0;
        }
        setStatus('good', 'sitting tall', 'calibrated to your desk');
      }

      if (presenceStartedAt && !breakActive && continuousMin >= breakIntervalMin && Date.now() - lastBreakNudgeAt > 60000) {
        const p = BREAK_PROMPT_PHRASES[breakIdx % BREAK_PROMPT_PHRASES.length];
        breakIdx++;
        speak(p);
        addAlertToFeed('break_prompt', p);
        lastBreakNudgeAt = Date.now();
      }
    }
  } else {
    if (isPersonPresent && !breakActive) {
      finalizePresenceBlock('person_left');
      // A slouch block that's still open when the person leaves frame was
      // never being closed here -- it could sit stuck in memory and keep
      // absorbing active-frame time from a LATER, unrelated presence block
      // once they returned, instead of ending when the presence it happened
      // during actually ended. Confirmed on real data: a single compression
      // event logged as 15.7 hours long, on a day with 5.5 hours of total
      // tracked presence -- only possible if it bridged across gaps like
      // this one instead of closing when the person first stepped away.
      if (slouchStartedAt) {
        logPostureEvent(slouchType, slouchStartedAt, Date.now());
        slouchStartedAt = null;
        slouchAccumulatedMs = 0;
      }
      isPersonPresent = false;
      absenceStartedAt = Date.now();
      breakStartedAt = null;
      setStatus('idle', 'no one detected', 'step into frame to resume');
      updatePostureGlyph(0, 0, 0, Number(toleranceSlider.value), Number(compressionToleranceSlider.value));
      updateLiveMetrics(0, 0, 0, false);
      stillnessRef = null;
      lastMovementAt = null;
    }
    if (!isPersonPresent && !breakActive && absenceStartedAt) {
      const absence = (Date.now() - absenceStartedAt) / 1000;
      if (absence >= BREAK_MIN_SECONDS) {
        breakActive = true;
        manualBreak = false;
        breakStartedAt = absenceStartedAt;
        breakPreSittingSeconds = lastFinalizedSittingSeconds;
        breakToggleBtn.textContent = 'end break';
        breakToggleBtn.classList.add('break-active');
        breakToggleBtn.classList.remove('break-due');
        addAlertToFeed('break', 'Auto break started');
      }
    }
  }

  nextFrame();
  } catch (err) {
    handleCameraLost(err && err.message ? err.message : 'tracking error');
  }
}

// ---- Init ----
maybeSwitchDay();
fetchAndApplyAppSettings();
reconcileTodayFromCloud();
setInterval(() => {
  if (running) {
    localStorage.setItem(LAST_SESSION_END_KEY, new Date().toISOString());
  }
  maybeSwitchDay();
  flushEvents();
  reconcileTodayFromCloud();
  if (!trackingSummary.hidden) renderTrackingSummary();
}, 10000);
window.addEventListener('beforeunload', () => {
  finalizePresenceBlock('page_unload');
  if (slouchStartedAt) {
    logPostureEvent(slouchType, slouchStartedAt, Date.now());
    slouchStartedAt = null;
  }
  localStorage.setItem(LAST_SESSION_END_KEY, new Date().toISOString());
  flushEvents();
});

testVoiceBtn.addEventListener('click', () => speak('This is what a nudge sounds like.', true));

function renderMuteBtn() {
  muteBtn.textContent = voiceNudgesEnabled ? 'mute' : 'unmute';
  muteBtn.classList.toggle('is-on', voiceNudgesEnabled);
}
renderMuteBtn();
muteBtn.addEventListener('click', () => {
  voiceNudgesEnabled = !voiceNudgesEnabled;
  renderMuteBtn();
});
bgAudioBtn.addEventListener('click', () => {
  if (bgAudioEnabled) stopBgSilentAudio();
  else startBgSilentAudio();
});

function paintSliderTrack(slider) {
  const pct = (slider.value - slider.min) / (slider.max - slider.min) * 100;
  slider.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--ink-faint-2) ${pct}%)`;
}

const TUNING_KEY = `plumb:${currentUserId}:tuning`;
function loadTuning() {
  try {
    const saved = JSON.parse(localStorage.getItem(TUNING_KEY) || 'null');
    if (!saved) return;
    if (saved.tolerance !== undefined) toleranceSlider.value = saved.tolerance;
    if (saved.compression !== undefined) compressionToleranceSlider.value = saved.compression;
    if (saved.lean !== undefined) leanToleranceSlider.value = saved.lean;
    if (saved.sustain !== undefined) sustainSlider.value = saved.sustain;
    if (saved.breakInterval !== undefined) breakSlider.value = saved.breakInterval;
    if (saved.stillness !== undefined) stillnessSlider.value = saved.stillness;
  } catch (e) { console.warn(e); }
}
let pushSettingsTimer = null;
function saveTuning() {
  localStorage.setItem(TUNING_KEY, JSON.stringify({
    tolerance: toleranceSlider.value,
    compression: compressionToleranceSlider.value,
    lean: leanToleranceSlider.value,
    sustain: sustainSlider.value,
    breakInterval: breakSlider.value,
    stillness: stillnessSlider.value
  }));
  scheduleSettingsPush();
}

// ---- app_settings sync: one shared row (id=1), latest change wins everywhere.
// Unlike posture data, settings are a single "current state" -- overwrite-on-sync
// is the *correct* pattern here, not a bug. Debounced so dragging a slider doesn't
// fire a request per frame.
function scheduleSettingsPush() {
  if (!SYNC_CONFIGURED) return;
  clearTimeout(pushSettingsTimer);
  pushSettingsTimer = setTimeout(pushAppSettings, 600);
}
async function pushAppSettings() {
  if (!SYNC_CONFIGURED) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        user_id: currentUserId,
        tolerance: Number(toleranceSlider.value),
        compression: Number(compressionToleranceSlider.value),
        lean: Number(leanToleranceSlider.value),
        sustain: Number(sustainSlider.value),
        break_interval: Number(breakSlider.value),
        stillness: Number(stillnessSlider.value),
        hydration_target_ml: hydrationTargetMl,
        glass_ml: hydrationSizes.glass,
        mug_ml: hydrationSizes.mug,
        can_ml: hydrationSizes.can,
        bottle_ml: hydrationSizes.bottle,
        updated_at: new Date().toISOString()
      }])
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  } catch (err) { console.warn('pushAppSettings:', err); }
}
async function fetchAndApplyAppSettings() {
  if (!SYNC_CONFIGURED) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?user_id=eq.${encodeURIComponent(currentUserId)}&select=*`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows = await res.json();
    const s = rows[0];
    if (!s) return; // no remote row yet -- keep local defaults, first push will create it
    if (s.tolerance != null) toleranceSlider.value = s.tolerance;
    if (s.compression != null) compressionToleranceSlider.value = s.compression;
    if (s.lean != null) leanToleranceSlider.value = s.lean;
    if (s.sustain != null) sustainSlider.value = s.sustain;
    if (s.break_interval != null) breakSlider.value = s.break_interval;
    if (s.stillness != null) stillnessSlider.value = s.stillness;
    if (s.hydration_target_ml != null) { hydrationTargetMl = s.hydration_target_ml; localStorage.setItem(HYDRATION_TARGET_KEY, String(hydrationTargetMl)); }
    if (s.glass_ml != null) hydrationSizes.glass = s.glass_ml;
    if (s.mug_ml != null) hydrationSizes.mug = s.mug_ml;
    if (s.can_ml != null) hydrationSizes.can = s.can_ml;
    if (s.bottle_ml != null) hydrationSizes.bottle = s.bottle_ml;
    localStorage.setItem(HYDRATION_SIZES_KEY, JSON.stringify(hydrationSizes));
    localStorage.setItem(TUNING_KEY, JSON.stringify({
      tolerance: toleranceSlider.value, compression: compressionToleranceSlider.value, lean: leanToleranceSlider.value,
      sustain: sustainSlider.value, breakInterval: breakSlider.value, stillness: stillnessSlider.value
    }));
    // Repaint everything that reads these values so a remote-newer setting shows immediately.
    toleranceVal.textContent = toleranceSlider.value;
    compressionToleranceVal.textContent = compressionToleranceSlider.value;
    leanToleranceVal.textContent = leanToleranceSlider.value;
    sustainVal.textContent = `${sustainSlider.value}s`;
    breakVal.textContent = `${breakSlider.value} min`;
    stillnessVal.textContent = `${stillnessSlider.value} min`;
    hydrationTargetInput.value = hydrationTargetMl;
    Object.entries(hydrationSizeInputs).forEach(([key, input]) => { input.value = hydrationSizes[key]; hydrationButtons[key].title = `${key} — ${hydrationSizes[key]}ml`; });
    [toleranceSlider, compressionToleranceSlider, leanToleranceSlider, sustainSlider, breakSlider, stillnessSlider].forEach(paintSliderTrack);
    renderHydration();
  } catch (err) { console.warn('fetchAndApplyAppSettings:', err); }
}

loadTuning();
toleranceVal.textContent = toleranceSlider.value;
compressionToleranceVal.textContent = compressionToleranceSlider.value;
leanToleranceVal.textContent = leanToleranceSlider.value;
sustainVal.textContent = `${sustainSlider.value}s`;
breakVal.textContent = `${breakSlider.value} min`;
stillnessVal.textContent = `${stillnessSlider.value} min`;

[toleranceSlider, compressionToleranceSlider, leanToleranceSlider, sustainSlider, breakSlider, stillnessSlider].forEach(paintSliderTrack);

toleranceSlider.addEventListener('input', () => {
  toleranceVal.textContent = toleranceSlider.value;
  paintSliderTrack(toleranceSlider);
  saveTuning();
});
compressionToleranceSlider.addEventListener('input', () => {
  compressionToleranceVal.textContent = compressionToleranceSlider.value;
  paintSliderTrack(compressionToleranceSlider);
  saveTuning();
});
leanToleranceSlider.addEventListener('input', () => {
  leanToleranceVal.textContent = leanToleranceSlider.value;
  paintSliderTrack(leanToleranceSlider);
  saveTuning();
});
sustainSlider.addEventListener('input', () => {
  sustainVal.textContent = `${sustainSlider.value}s`;
  paintSliderTrack(sustainSlider);
  saveTuning();
});
breakSlider.addEventListener('input', () => {
  breakVal.textContent = `${breakSlider.value} min`;
  paintSliderTrack(breakSlider);
  renderBreakGauge();
  saveTuning();
});
stillnessSlider.addEventListener('input', () => {
  stillnessVal.textContent = `${stillnessSlider.value} min`;
  paintSliderTrack(stillnessSlider);
  saveTuning();
});

// ---- research-rationale popovers ----
// Sourcing and phrasing kept intentionally honest about how strong the evidence
// actually is (see plumb-research-rationale.md) rather than overclaiming certainty.
const RESEARCH_INFO = {
  tolerance: {
    title: 'side-to-side tolerance',
    short: "There's no single \u201ccorrect\u201d spinal angle \u2014 what matters is how long you hold any one position, not exactly what that position is.",
    long: "This is measured against your own calibrated baseline, not a universal ideal. A recurring finding in sitting-posture research is that rigid, prolonged positions cause strain \u2014 not any particular angle in isolation \u2014 which is why Plumb calibrates to you rather than scoring against a textbook shape.",
    source: 'Source: sitting-posture biomechanics literature (e.g. Roman-Liu et al., 2024 review) \u2014 general synthesis, not one definitive study.'
  },
  compression: {
    title: 'slump tolerance',
    short: "Same principle as side-to-side: no single ideal angle, measured against your own baseline.",
    long: "Neck/shoulder compression (slumping) is tracked relative to how you sat when you calibrated, not a fixed universal target \u2014 consistent with research suggesting movement and variability matter more than any one \u201ccorrect\u201d posture.",
    source: 'Source: sitting-posture biomechanics literature (e.g. Roman-Liu et al., 2024 review) \u2014 general synthesis, not one definitive study.'
  },
  lean: {
    title: 'lean-in tolerance',
    short: "Same principle again \u2014 measured against your own calibrated baseline, not a fixed ideal distance from the screen.",
    long: "Leaning in is tracked as drift away from your own baseline position, in line with research suggesting sustained fixed positions (of any kind) are the more consistent concern, rather than any single distance being inherently wrong.",
    source: 'Source: sitting-posture biomechanics literature (e.g. Roman-Liu et al., 2024 review) \u2014 general synthesis, not one definitive study.'
  },
  sustain: {
    title: 'sustained before nudge',
    short: "Spinal tissue can start to temporarily deform (\u201ccreep\u201d) when held in one flexed position \u2014 studies put that starting somewhere between about 5 and 20+ minutes, depending on severity.",
    long: "This 45s default is a practical trigger for \u201cyou've probably drifted, worth adjusting\u201d \u2014 it isn't a literal claim that tissue creep begins at 45 seconds. The creep research itself operates on a scale of minutes, not tens of seconds; the nudge timing is deliberately conservative so you get a chance to self-correct well before that longer timescale matters.",
    source: 'Source: McGill & Brown 1992; Shin et al. 2009; Korakakis et al. 2017 (proprioception change at 10 min). Ranges vary by study.'
  },
  breakInterval: {
    title: 'break reminder interval',
    short: "The evidence for moving often is more solid than the evidence for any exact number of minutes.",
    long: "A 2025 Cochrane review found only low-quality evidence that extra breaks reduce discomfort, and no clear evidence that more-frequent beats less-frequent. What's more consistently supported is short active movement \u2014 roughly 2\u20133 minutes every 20\u201330 minutes \u2014 not just pausing still. 25 minutes is a reasonable, practical choice within that range, not a scientifically precise number.",
    source: 'Source: Cochrane, \u201cWork-break interventions...\u201d (2019); Chong et al., active microbreaks review (2022); Stanford EHS guidance.'
  },
  stillness: {
    title: 'stillness reminder',
    short: "Same evidence base as the break reminder \u2014 frequent movement, even briefly, is the well-supported part.",
    long: "This nudge exists to catch long stretches of not moving at all, even in a fine posture \u2014 holding any one shape rigidly for a long time is itself the thing the research flags, separate from whether that shape looks slouched.",
    source: 'Source: Cochrane, \u201cWork-break interventions...\u201d (2019); Chong et al., active microbreaks review (2022).'
  },
  hydrationTarget: {
    title: 'daily hydration target',
    short: '2 litres sits at the lower end of what major health bodies cite \u2014 a reasonable default, but not a precise target everyone should hit exactly.',
    long: "EFSA's adequate-intake figures are 2.0 L/day for women and 2.5 L/day for men (total water, including food \u2014 food typically supplies 20\u201330% of that). The IOM's figures are higher: 2.7 L/day women, 3.7 L/day men. The famous \u201c8 glasses a day\u201d rule doesn't trace back to a specific trial \u2014 it's a simplification of older guidance that included food-derived water. Thirst and urine colour are generally more reliable day-to-day signals than any fixed number.",
    source: 'Source: EFSA, \u201cDietary reference values for water\u201d (2010); Institute of Medicine (2004).'
  }
};

const infoPopover = document.getElementById('infoPopover');
const infoPopoverTitle = document.getElementById('infoPopoverTitle');
const infoPopoverShort = document.getElementById('infoPopoverShort');
const infoPopoverLong = document.getElementById('infoPopoverLong');
const infoPopoverSource = document.getElementById('infoPopoverSource');
const infoPopoverClose = document.getElementById('infoPopoverClose');

function openInfoPopover(iconEl) {
  const data = RESEARCH_INFO[iconEl.dataset.info];
  if (!data) return;
  infoPopoverTitle.textContent = data.title;
  infoPopoverShort.textContent = data.short;
  infoPopoverLong.textContent = data.long;
  infoPopoverSource.textContent = data.source;
  infoPopover.classList.add('open');

  // Position near the icon, keeping the popover on-screen.
  const rect = iconEl.getBoundingClientRect();
  const popW = 320;
  let left = rect.left;
  if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
  if (left < 12) left = 12;
  infoPopover.style.left = left + 'px';
  infoPopover.style.top = (rect.bottom + 8) + 'px';
}
function closeInfoPopover() {
  infoPopover.classList.remove('open');
}
document.querySelectorAll('.info-icon').forEach(icon => {
  icon.addEventListener('click', e => {
    e.stopPropagation();
    const alreadyOpenForThis = infoPopover.classList.contains('open') && infoPopoverTitle.textContent === (RESEARCH_INFO[icon.dataset.info] || {}).title;
    closeInfoPopover();
    if (!alreadyOpenForThis) openInfoPopover(icon);
  });
});
infoPopoverClose.addEventListener('click', closeInfoPopover);
document.addEventListener('click', e => {
  if (infoPopover.classList.contains('open') && !infoPopover.contains(e.target) && !e.target.classList.contains('info-icon')) {
    closeInfoPopover();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeInfoPopover();
});
