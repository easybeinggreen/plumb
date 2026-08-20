import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as piperTTS from '@mintplex-labs/piper-tts-web';

// ---- Supabase config ----
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SYNC_CONFIGURED = SUPABASE_URL.startsWith('http') && !!SUPABASE_ANON_KEY;

// ---- DOM references (all at top) ----
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const placeholder = document.getElementById('placeholder');

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
const todayTimelineCanvas = document.getElementById('todayTimelineChart');
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

const breakFill = document.getElementById('breakFill');
const breakTakenEl = document.getElementById('breakTaken');
const breakTargetEl = document.getElementById('breakTarget');
const breakMinutesEl = document.getElementById('breakMinutes');

let currentChart = null;
let aiChart = null;

// ---- State ----
let landmarker = null;
let running = false;
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

const BREAK_TARGET_KEY_PREFIX = 'plumb:breakTarget:';
const BREAK_TAKEN_KEY_PREFIX = 'plumb:breakTaken:';
const BREAK_MINUTES_KEY_PREFIX = 'plumb:breakMinutes:';
const PRESENCE_START_KEY = 'plumb:presenceStart';
const LAST_SESSION_END_KEY = 'plumb:lastSessionEnd';

const HYDRATION_TARGET_KEY = 'plumb:hydrationTargetMl';
const HYDRATION_SIZES_KEY = 'plumb:hydrationSizesMl';
const HYDRATION_LOG_PREFIX = 'plumb:hydrationMl:';
const LOG_KEY = (d) => `plumb:${d}`;

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

const PIPER_WASM_PATHS = {
  onnxWasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm'
};

function loadTodayStats() {
  const raw = localStorage.getItem(LOG_KEY(today()));
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s.date !== today()) throw new Error('stale');
      return s;
    } catch (e) {}
  }
  return { date: today(), sessionSeconds: 0, slouchSeconds: 0, postureNudges: 0, breakNudges: 0, breaksTaken: 0 };
}

let stats = loadTodayStats();

function saveStatsLocal() {
  stats.breaksTaken = breaksTakenToday;
  localStorage.setItem(LOG_KEY(stats.date), JSON.stringify(stats));
}

function setSyncStatus(mode, text) {
  syncDot.classList.remove('ok', 'err');
  if (mode) syncDot.classList.add(mode);
  syncText.textContent = text;
}
if (!SYNC_CONFIGURED) setSyncStatus('', 'Cloud sync: not configured');
else setSyncStatus('', 'Cloud sync: ready');

async function mergeRemoteStats() {
  // Placeholder – daily aggregates will be computed from events later.
  return;
}

async function syncToSupabase() {
  if (!SYNC_CONFIGURED) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ date: stats.date, session_seconds: Math.round(stats.sessionSeconds), slouch_seconds: Math.round(stats.slouchSeconds), posture_nudges: stats.postureNudges, break_nudges: stats.breakNudges, breaks_taken: breaksTakenToday, updated_at: new Date().toISOString() }]),
      keepalive: true
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    setSyncStatus('ok', `Cloud sync: last synced ${new Date().toLocaleTimeString()}`);
  } catch (err) { console.warn('syncToSupabase:', err); setSyncStatus('err', err.message); }
}

async function flushEvents() {
  if (!SYNC_CONFIGURED || eventBuffer.length === 0) return;

  const toSend = eventBuffer.map(ev => ({
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
      body: JSON.stringify(toSend)
    });

    if (!res.ok) {
      console.error('Event upload:', res.status, await res.text());
      eventBuffer.push(...toSend);
    }
  } catch (err) {
    console.error('Event upload:', err);
    eventBuffer.push(...toSend);
  }
}

function saveStats() { saveStatsLocal(); syncToSupabase(); flushEvents(); }

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

function finalizePresenceBlock(endedBy = 'person_left') {
  if (!presenceStartedAt) return;
  const end = Date.now();
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
      if (dur >= 300) msg = 'Great long break — you’re refreshed.';
      else if (dur >= 60) msg = 'Good break — that was a nice stretch.';
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

  finalizePresenceBlock('tab_hidden');
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
  if (currentVal && [...voiceSelect.options].some(o => o.value === currentVal)) {
    voiceSelect.value = currentVal;
  } else if (hasStoredChoice && currentVoiceId && [...voiceSelect.options].some(o => o.value === currentVoiceId)) {
    voiceSelect.value = currentVoiceId;
  } else if (!hasStoredChoice && [...voiceSelect.options].some(o => o.value === DEFAULT_VOICE_ID)) {
    currentVoiceId = DEFAULT_VOICE_ID;
    voiceSelect.value = currentVoiceId;
    localStorage.setItem('plumb:voice', currentVoiceId);
  } else if (hasStoredChoice || !voicesStillLoading) {
    currentVoiceId = PIPER_VOICES[0].id;
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

function logHydration(ml) {
  hydrationConsumedMl += ml;
  hydrationLastClickMl = ml;
  localStorage.setItem(HYDRATION_LOG_PREFIX + today(), String(hydrationConsumedMl));
  renderHydration();
}

function undoHydration() {
  if (!hydrationLastClickMl) return;
  hydrationConsumedMl = Math.max(0, hydrationConsumedMl - hydrationLastClickMl);
  hydrationLastClickMl = 0;
  localStorage.setItem(HYDRATION_LOG_PREFIX + today(), String(hydrationConsumedMl));
  renderHydration();
}
Object.entries(hydrationButtons).forEach(([key, btn]) => btn.addEventListener('click', () => logHydration(hydrationSizes[key])));
hydrationUndoBtn.addEventListener('click', undoHydration);

hydrationTargetInput.value = hydrationTargetMl;
hydrationTargetInput.addEventListener('change', () => {
  hydrationTargetMl = Math.max(100, Number(hydrationTargetInput.value) || 2000);
  localStorage.setItem(HYDRATION_TARGET_KEY, String(hydrationTargetMl));
  renderHydration();
});
Object.entries(hydrationSizeInputs).forEach(([key, input]) => {
  input.value = hydrationSizes[key];
  input.addEventListener('change', () => {
    hydrationSizes[key] = Math.max(10, Number(input.value) || hydrationSizes[key]);
    localStorage.setItem(HYDRATION_SIZES_KEY, JSON.stringify(hydrationSizes));
    hydrationButtons[key].title = `${key} — ${hydrationSizes[key]}ml`;
  });
});
renderHydration();

function renderBreakGauge(liveContinuousMin = 0) {
  const intervalMin = Number(breakSlider.value);
  const liveExtra = Math.floor(liveContinuousMin / intervalMin);
  const target = breakTargetToday + liveExtra;
  const pct = target > 0 ? Math.max(0, Math.min(100, (breaksTakenToday / target) * 100)) : 0;
  breakFill.style.height = pct + '%';
  breakTakenEl.textContent = breaksTakenToday;
  breakTargetEl.textContent = target;
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

async function speak(text) {
  if (!voiceNudgesEnabled) return;
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
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(audioCtx.destination);
      src.start(0);
      return;
    }
  } catch (e) { console.warn('Piper fallback:', e); }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
}

const LEFT_PHRASES = ["You're leaning left — straighten up.", "Left drift — bring head centre.", "Tilting left — correct it."];
const RIGHT_PHRASES = ["Leaning right — centre yourself.", "Right drift — straighten up.", "Tilting right — adjust."];
const SLUMP_PHRASES = ["Slumping — sit taller.", "Neck sinking — lengthen spine.", "Shoulders dropping — open up.", "Reset your posture."];
const LEAN_PHRASES = ["You've drifted in close — ease back from the screen.", "Getting close to the monitor — sit back a little.", "Give yourself some space from the screen."];
const BREAK_PROMPT_PHRASES = ["Time for a break — stand up, stretch, come back refreshed.", "You've been sitting a while — step away.", "Take a short break — enjoy it."];
const STILLNESS_PHRASES = ["You've held the same shape a while — shift position, even briefly.", "Time to change something — stand, stretch, or just re-settle.", "Give your spine a change of scenery for a moment."];
let leftIdx = 0, rightIdx = 0, slumpIdx = 0, leanIdx = 0, breakIdx = 0, stillIdx = 0;

function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }
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

async function openTrackingPip() {
  if (!('documentPictureInPicture' in window)) return false;

  try {
    trackingPipWindow = await documentPictureInPicture.requestWindow({ width: 200, height: 190 });
  } catch (err) {
    console.warn('PiP open failed:', err);
    trackingPipWindow = null;
    return false;
  }

  originalStatusParent = statusCard.parentElement;
  originalStatusNextSibling = statusCard.nextSibling;
  originalVideoParent = video.parentElement;
  originalVideoNextSibling = video.nextSibling;

  trackingPipWindow.document.title = 'plumb';
  trackingPipWindow.document.head.appendChild(document.getElementById('appStyles').cloneNode(true));
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
  trackingPipWindow.document.head.appendChild(fontLink);

  trackingPipWindow.document.body.style.margin = '0';
  trackingPipWindow.document.body.style.background = 'var(--paper)';
  trackingPipWindow.document.body.style.display = 'flex';
  trackingPipWindow.document.body.style.alignItems = 'center';
  trackingPipWindow.document.body.style.justifyContent = 'center';
  trackingPipWindow.document.body.style.height = '100vh';
  trackingPipWindow.document.body.style.padding = '8px';

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

  trackingPipWindow.addEventListener('pagehide', () => {
    if (running) {
      stopCamera();
    } else {
      closeTrackingPip();
    }
  }, { once: true });

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

async function startCamera() {
  cameraToggleBtn.textContent = 'loading…';
  cameraToggleBtn.disabled = true;
  try {
    if (!landmarker) await initModel();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, ...(cameraSelect.value ? { deviceId: { exact: cameraSelect.value } } : {}) },
      audio: false
    });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = r);
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    await video.play();
    populateCameraList();

    const pipOpened = await openTrackingPip();

    if (pipOpened) {
      placeholder.style.display = 'flex';
      placeholder.textContent = 'tracking in popup — leave it open';
    } else {
      placeholder.style.display = 'none';
    }

    running = true;
    cameraToggleBtn.textContent = 'stop camera';
    cameraToggleBtn.classList.remove('start-camera');
    cameraToggleBtn.classList.add('stop-camera');
    cameraToggleBtn.disabled = false;
    calibrateBtn.disabled = false;
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
    placeholder.textContent = `camera error: ${err.message}`;
    cameraToggleBtn.textContent = 'start camera';
    cameraToggleBtn.classList.add('start-camera');
    cameraToggleBtn.classList.remove('stop-camera');
    cameraToggleBtn.disabled = false;
    closeTrackingPip();
  }
}

function stopCamera() {
  const wasRunning = running;

  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (wasRunning) {
    finalizePresenceBlock('camera_stopped');
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
  placeholder.textContent = 'camera is off — press start camera to begin';

  cameraToggleBtn.textContent = 'start camera';
  cameraToggleBtn.classList.add('start-camera');
  cameraToggleBtn.classList.remove('stop-camera');
  cameraToggleBtn.disabled = false;

  calibrateBtn.disabled = true;
  breakToggleBtn.disabled = true;
  calibrateBtn.textContent = 'recalibrate posture';
  calibrateBtn.classList.remove('is-confirmed');
  breakToggleBtn.textContent = 'take a break';
  breakToggleBtn.classList.remove('break-active', 'break-due');

  if (breakActive) endBreak();
  stopBgSilentAudio();
  saveStats();

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

gearBtn.addEventListener('click', () => settingsModalOverlay.classList.add('open'));
settingsModalClose.addEventListener('click', () => settingsModalOverlay.classList.remove('open'));

function setStatus(mode, text, caption) {
  statusCard.classList.remove('state-good', 'state-mild', 'state-sustained', 'state-idle');
  statusCard.classList.add(`state-${mode === 'good' ? 'good' : mode === 'idle' ? 'idle' : mode}`);
  statusValue.textContent = text;
  if (caption !== undefined) statusCaption.textContent = caption;
}

const DOT_MAX_PX = 64, DOT_CENTER = 85, ELLIPSE_MAX_PX = 66, TOLERANCE_SCALE = 210;
const RAW_CURVE_K = 12;
const DOT_BASE_R = 11, DOT_LEAN_MAX_DELTA = 18, LEAN_CURVE_K = 8;

function updatePostureGlyph(lateral, compression, lean, latTol, compTol) {
  const ellipseRx = Math.min(ELLIPSE_MAX_PX, latTol * TOLERANCE_SCALE);
  const ellipseRy = Math.min(ELLIPSE_MAX_PX, compTol * TOLERANCE_SCALE);
  dzTolerance.style.rx = ellipseRx + 'px';
  dzTolerance.style.ry = ellipseRy + 'px';

  const px = Math.max(-DOT_MAX_PX, Math.min(DOT_MAX_PX, -Math.tanh(lateral * RAW_CURVE_K) * DOT_MAX_PX));
  const py = Math.max(-DOT_MAX_PX, Math.min(DOT_MAX_PX, Math.tanh(compression * RAW_CURVE_K) * DOT_MAX_PX));
  dzDot.style.cx = (DOT_CENTER + px) + 'px';
  dzDot.style.cy = (DOT_CENTER + py) + 'px';

  const leanNorm = Math.tanh(Math.max(lean, 0) * LEAN_CURVE_K);
  dzDot.style.r = (DOT_BASE_R + leanNorm * DOT_LEAN_MAX_DELTA) + 'px';
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

function maybeSwitchDay() {
  const cur = today();
  if (stats.date !== cur) {
    saveStats();
    stats = { date: cur, sessionSeconds: 0, slouchSeconds: 0, postureNudges: 0, breakNudges: 0, breaksTaken: 0 };
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

function renderTodayTimeline(events) {
  const canvas = todayTimelineCanvas;
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

  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMinute = Math.floor((now - midnight) / 60000);

  const states = new Array(1440).fill('not_tracking');
  for (let m = Math.max(0, Math.min(1439, nowMinute + 1)); m < 1440; m++) {
    states[m] = 'future';
  }

  events.forEach(e => { if (e.type === 'presence') markMinutes(e, states, 'good'); });
  events.forEach(e => {
    if (['lateral_left', 'lateral_right', 'compression', 'lean_in'].includes(e.type)) {
      markMinutes(e, states, 'slouch');
    }
  });
  events.forEach(e => {
    if (e.type === 'break') markMinutes(e, states, 'break');
    else if (e.type === 'away') markMinutes(e, states, 'away');
    else if (e.type === 'not_tracking') markMinutes(e, states, 'not_tracking');
  });

  const segments = [];
  let cur = states[0];
  let start = 0;
  for (let i = 1; i < 1440; i++) {
    if (states[i] !== cur) {
      segments.push({ state: cur, startMin: start, endMin: i });
      start = i;
      cur = states[i];
    }
  }
  segments.push({ state: cur, startMin: start, endMin: 1440 });

  const colors = {
    good: '#0A2626',
    slouch: '#C1622E',
    break: '#C9C2B3',
    away: '#9FB0B5',
    not_tracking: '#F0EDE6',
    future: 'transparent'
  };

  const labels = {
    good: 'sitting well',
    slouch: 'slouching',
    break: 'break (1–60m)',
    away: 'away (60m+)',
    not_tracking: 'not tracking'
  };

  segments.forEach(seg => {
    if (seg.state === 'future') return;

    const x = (seg.startMin / 1440) * width;
    const w = ((seg.endMin - seg.startMin) / 1440) * width;
    ctx2.fillStyle = colors[seg.state] || '#ccc';
    ctx2.fillRect(x, 0, w, timelineHeight);
  });

  ctx2.fillStyle = '#4B615E';
  ctx2.font = '10px Nunito, sans-serif';

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

  if (nowMinute >= 0 && nowMinute <= 1440) {
    const x = (nowMinute / 1440) * width;

    ctx2.strokeStyle = '#14403B';
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.moveTo(x, 0);
    ctx2.lineTo(x, timelineHeight);
    ctx2.stroke();

    ctx2.fillStyle = '#14403B';
    ctx2.font = 'bold 9px Nunito, sans-serif';
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
  ctx2.font = '10px Nunito, sans-serif';

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

      canvas.title = `${labels[seg.state]}\n${startLabel} – ${endLabel}\n${formatDuration(seg.endMin - seg.startMin)}`;
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_events?date=gte.${start}&date=lte.${end}&order=date.asc,start_time.asc`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error('fetch');
    return await res.json();
  } catch (e) { console.warn(e); return []; }
}

async function fetchDailyLogs(start, end) {
  if (!SYNC_CONFIGURED) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_logs?date=gte.${start}&date=lte.${end}&order=date.asc`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error('fetch');
    return await res.json();
  } catch (e) { console.warn(e); return []; }
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

  const events = await fetchEventsForRange(start, end);

  const dateMap = {};
  let ds0 = start;
  while (ds0 <= end) {
    dateMap[ds0] = { break: 0, left: 0, right: 0, slump: 0, lean: 0, away: 0, breaks: 0, sessionSeconds: 0 };
    ds0 = addDaysToDateStr(ds0, 1);
  }
  events.forEach(e => {
    const ds = e.date;
    if (!dateMap[ds]) dateMap[ds] = { break: 0, left: 0, right: 0, slump: 0, lean: 0, away: 0, breaks: 0, sessionSeconds: 0 };
    const dur = e.duration_seconds || 0;
    if (e.type === 'break') { dateMap[ds].break += dur; dateMap[ds].breaks++; }
    else if (e.type === 'away') dateMap[ds].away += dur;
    else if (e.type === 'lateral_left') dateMap[ds].left += dur;
    else if (e.type === 'lateral_right') dateMap[ds].right += dur;
    else if (e.type === 'compression') dateMap[ds].slump += dur;
    else if (e.type === 'lean_in') dateMap[ds].lean += dur;
    // 'presence' events cover every continuous tracked block (across however many
    // devices were used that day) and sum correctly since each is its own inserted
    // row. This replaces the old posture_logs.session_seconds read, which was a
    // single per-day value that got silently overwritten by whichever device
    // synced last, undercounting any day where more than one device was used.
    else if (e.type === 'presence') dateMap[ds].sessionSeconds += dur;
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
  const slouchPct = overall ? Math.min(100, Math.round(totalSlouch / overall * 100)) : 0;
  const avgBreak = totalBreaks ? Math.round(totalBreak / totalBreaks / 60) : 0;
  reportSummary.innerHTML = `
    <div class="metric"><div class="value">${Math.round(overall / 60)}m</div><div class="label">monitored</div></div>
    <div class="metric"><div class="value">${slouchPct}%</div><div class="label">time slouching</div></div>
    <div class="metric"><div class="value">${totalBreaks}</div><div class="label">breaks</div></div>
    <div class="metric"><div class="value">${avgBreak}m</div><div class="label">avg break</div></div>
    ${totalAway > 0 ? `<div class="metric"><div class="value">${Math.round(totalAway / 3600)}h</div><div class="label">time away</div></div>` : ''}
  `;

  slouchChartCtx.canvas.style.display = 'none';
  todayTimelineCanvas.style.display = 'none';

  if (range === 'today') {
    todayTimelineCanvas.style.display = 'block';
    renderTodayTimeline(events);
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
          legend: { labels: { font: { family: 'Nunito', weight: '700', size: 11 }, boxWidth: 12, padding: 12 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} min` } }
        }
      }
    });
  }
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
      <div class="metric"><div class="value">${s.totalMoveNudges || 0}</div><div class="label">move nudges</div></div>
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
modalTabs.addEventListener('click', e => {
  if (e.target.classList.contains('tab')) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    showReport(e.target.dataset.range);
  }
});

// ---- Critical listeners ----
cameraToggleBtn.addEventListener('click', () => {
  if (running) stopCamera();
  else startCamera();
});

breakToggleBtn.addEventListener('click', () => {
  if (!running) return;
  if (breakActive) endBreak();
  else startBreak(true);
});

calibrateBtn.addEventListener('click', () => {
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
    calibrateBtn.classList.add('is-confirmed');
  }
});

// ---- Main loop ----
function loop() {
  if (trackingPipWindow && trackingPipWindow.closed) {
    stopCamera();
    return;
  }

  if (!running) return;
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.5);
  lastFrameTime = now;
  maybeSwitchDay();

  const result = landmarker.detectForVideo(video, now);
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    const leftEar = lm[7], rightEar = lm[8], leftSh = lm[11], rightSh = lm[12];
    ctx.fillStyle = 'rgba(44,110,142,0.9)';
    [leftEar, rightEar, leftSh, rightSh].forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x * overlay.width, p.y * overlay.height, 4, 0, 2 * Math.PI);
      ctx.fill();
    });

    const earMid = midpoint(leftEar, rightEar);
    const shMid = midpoint(leftSh, rightSh);

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

    stats.sessionSeconds += dt;

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
        stats.slouchSeconds += dt;
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
          stats.postureNudges++;
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
        stats.breakNudges++;
        lastBreakNudgeAt = Date.now();
      }
    }
  } else {
    if (isPersonPresent && !breakActive) {
      finalizePresenceBlock('person_left');
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
}

// ---- Init ----
maybeSwitchDay();
setInterval(() => {
  if (running) {
    localStorage.setItem(LAST_SESSION_END_KEY, new Date().toISOString());
  }
  maybeSwitchDay();
  saveStats();
}, 10000);
window.addEventListener('beforeunload', () => {
  finalizePresenceBlock('page_unload');
  if (slouchStartedAt) {
    logPostureEvent(slouchType, slouchStartedAt, Date.now());
    slouchStartedAt = null;
  }
  localStorage.setItem(LAST_SESSION_END_KEY, new Date().toISOString());
  saveStats();
});

testVoiceBtn.addEventListener('click', () => speak('This is what a nudge sounds like.'));

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

const TUNING_KEY = 'plumb:tuning';
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
function saveTuning() {
  localStorage.setItem(TUNING_KEY, JSON.stringify({
    tolerance: toleranceSlider.value,
    compression: compressionToleranceSlider.value,
    lean: leanToleranceSlider.value,
    sustain: sustainSlider.value,
    breakInterval: breakSlider.value,
    stillness: stillnessSlider.value
  }));
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
