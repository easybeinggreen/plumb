import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as piperTTS from '@mintplex-labs/piper-tts-web';

// ---- Supabase config ----
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SYNC_CONFIGURED = SUPABASE_URL.startsWith('http') && !!SUPABASE_ANON_KEY;

// ---- DOM references ----
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
const statusValue = document.getElementById('statusValue');
const statusCaption = document.getElementById('statusCaption');

const dzDot = document.getElementById('dzDot');
const lmLateral = document.getElementById('lmLateral');
const lmSlump = document.getElementById('lmSlump');
const lmLateralTol = document.getElementById('lmLateralTol');
const lmSlumpTol = document.getElementById('lmSlumpTol');

const gearBtn = document.getElementById('gearBtn');
const devicePopover = document.getElementById('devicePopover');

const settingsToggle = document.getElementById('settingsToggle');
const settingsContent = document.getElementById('settingsContent');

const toleranceSlider = document.getElementById('toleranceSlider');
const compressionToleranceSlider = document.getElementById('compressionToleranceSlider');
const sustainSlider = document.getElementById('sustainSlider');
const breakSlider = document.getElementById('breakSlider');
const toleranceVal = document.getElementById('toleranceVal');
const compressionToleranceVal = document.getElementById('compressionToleranceVal');
const sustainVal = document.getElementById('sustainVal');
const breakVal = document.getElementById('breakVal');

const syncDot = document.getElementById('syncDot');
const syncText = document.getElementById('syncText');
const alertFeed = document.getElementById('alertFeed');

// Report modal
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const modalTabs = document.getElementById('modalTabs');
const reportSummary = document.getElementById('reportSummary');
const slouchChartCtx = document.getElementById('slouchChart').getContext('2d');
const panelNumeric = document.getElementById('panelNumeric');
const panelAi = document.getElementById('panelAi');
const aiSummaryText = document.getElementById('aiSummaryText');
const aiMeta = document.getElementById('aiMeta');
const aiStatGrid = document.getElementById('aiStatGrid');
let currentChart = null;
let aiChart = null;

// ---- State ----
let landmarker = null;
let running = false;
let rafId = null;
let muted = false;
let bgAudioEnabled = false;

let baselineLateral = null;
let baselineNeckRatio = null;
let lastFrameTime = performance.now();

let slouchStartedAt = null;
let slouchType = null;
let slouchAccumulatedMs = 0; // capped, frame-based — kept in sync with stats.slouchSeconds so
                              // event durations can never exceed the session time they came from
let displayLateral = 0, displayCompression = 0; // smoothed, for the glyph only — raw values still drive tolerance/nudge logic
let lastPostureNudgeAt = 0;

let presenceStart = null;
let isPersonPresent = false;
let lastBreakEnd = null;
let breakStart = null;
let breaksTaken = 0;
let lastBreakNudgeAt = 0;
let manualBreak = false;
let breakActive = false;
const BREAK_MIN_SECONDS = 15;
const BREAK_MAX_SECONDS = 2 * 60 * 60; // 2 hours — beyond this it's logged as "away", not a break

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

// A day is always this device's local calendar day. Timestamps stay UTC
// (correct for exact instants); only date *labels* need to stay local,
// computed straight from date parts rather than round-tripped through
// toISOString() (which silently shifts the date for any non-UTC+0 offset).
const dateForTimestamp = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const today = () => dateForTimestamp(Date.now());
const addDaysToDateStr = (ds, n) => {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dateForTimestamp(d.getTime());
};

const LOG_KEY = (d) => `plumb:${d}`;
const LAST_SESSION_END_KEY = 'plumb:lastSessionEnd';

let stats = loadTodayStats();

// ---- Multi‑device merge ----
async function mergeRemoteStats() {
  if (!SYNC_CONFIGURED) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_logs?date=eq.${stats.date}&select=*`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error('fetch failed');
    const rows = await res.json();
    if (rows.length > 0) {
      const remote = rows[0];
      stats.sessionSeconds = Math.max(stats.sessionSeconds, remote.session_seconds || 0);
      stats.slouchSeconds = Math.max(stats.slouchSeconds, remote.slouch_seconds || 0);
      stats.postureNudges = Math.max(stats.postureNudges, remote.posture_nudges || 0);
      stats.breakNudges = Math.max(stats.breakNudges, remote.break_nudges || 0);
      stats.breaksTaken = Math.max(stats.breaksTaken, remote.breaks_taken || 0);
      breaksTaken = stats.breaksTaken;
    }
  } catch (err) { console.warn('mergeRemoteStats:', err); }
}

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

function saveStatsLocal() {
  stats.breaksTaken = breaksTaken;
  localStorage.setItem(LOG_KEY(stats.date), JSON.stringify(stats));
}

// ---- Cloud sync ----
function setSyncStatus(mode, text) {
  syncDot.classList.remove('ok', 'err');
  if (mode) syncDot.classList.add(mode);
  syncText.textContent = text;
}
if (!SYNC_CONFIGURED) setSyncStatus('', 'Cloud sync: not configured');
else setSyncStatus('', 'Cloud sync: ready');

async function syncToSupabase() {
  if (!SYNC_CONFIGURED) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ date: stats.date, session_seconds: Math.round(stats.sessionSeconds), slouch_seconds: Math.round(stats.slouchSeconds), posture_nudges: stats.postureNudges, break_nudges: stats.breakNudges, breaks_taken: stats.breaksTaken, updated_at: new Date().toISOString() }]),
      keepalive: true
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    setSyncStatus('ok', `Cloud sync: last synced ${new Date().toLocaleTimeString()}`);
  } catch (err) { console.warn('syncToSupabase:', err); setSyncStatus('err', err.message); }
}

async function flushEvents() {
  if (!SYNC_CONFIGURED || eventBuffer.length === 0) return;
  const toSend = [...eventBuffer]; eventBuffer = [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify(toSend)
    });
    if (!res.ok) { console.error('Event upload:', res.status, await res.text()); eventBuffer.push(...toSend); }
  } catch (err) { console.error('Event upload:', err); eventBuffer.push(...toSend); }
}

function saveStats() { saveStatsLocal(); syncToSupabase(); flushEvents(); }

// ---- Alert feed ----
function addAlertToFeed(type, message) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const item = document.createElement('div');
  item.style.marginBottom = '3px';
  item.innerHTML = `<span style="font-family:var(--mono);">${time}</span> <span style="color:var(--ink);">${message}</span>`;
  if (alertFeed.children.length === 1 && alertFeed.children[0].innerText === 'no alerts yet') alertFeed.innerHTML = '';
  alertFeed.insertBefore(item, alertFeed.firstChild);
  while (alertFeed.children.length > 15) alertFeed.removeChild(alertFeed.lastChild);
}

// ---- Event logging ----
function logSlouchEvent(type, startTime, endTime) {
  const dur = Math.round((endTime - startTime)/1000);
  if (dur <= 0) return;
  eventBuffer.push({ date: dateForTimestamp(startTime), start_time: new Date(startTime).toISOString(), end_time: new Date(endTime).toISOString(), type, duration_seconds: dur });
}
function logBreakEvent(startTime, endTime) {
  const dur = Math.round((endTime - startTime)/1000);
  if (dur <= 0) return;
  eventBuffer.push({ date: dateForTimestamp(startTime), start_time: new Date(startTime).toISOString(), end_time: new Date(endTime).toISOString(), type: 'break', duration_seconds: dur });
}
function logAwayEvent(startTime, endTime) {
  const dur = Math.round((endTime - startTime)/1000);
  if (dur <= 0) return;
  eventBuffer.push({ date: dateForTimestamp(startTime), start_time: new Date(startTime).toISOString(), end_time: new Date(endTime).toISOString(), type: 'away', duration_seconds: dur });
}
function logCalibrationEvent() {
  eventBuffer.push({ date: today(), start_time: new Date().toISOString(), end_time: new Date().toISOString(), type: 'calibration', duration_seconds: 0 });
}

function logRetrospectiveBreak() {
  const lastEnd = localStorage.getItem(LAST_SESSION_END_KEY);
  if (!lastEnd) return;
  const gapStart = new Date(lastEnd).getTime();
  const gapEnd = Date.now();
  const gap = (gapEnd - gapStart) / 1000;
  if (gap < BREAK_MIN_SECONDS) return;
  if (gap > BREAK_MAX_SECONDS) {
    // camera was off for longer than a real break — log it as time away
    // instead of inflating "avg break" with one giant outlier
    logAwayEvent(gapStart, gapEnd);
  } else {
    logBreakEvent(gapStart, gapEnd);
    breaksTaken++;
    stats.breaksTaken = breaksTaken;
  }
}

// ---- Break control ----
function startBreak(manual = false) {
  if (breakActive) return;
  breakActive = true;
  manualBreak = manual;
  breakStart = Date.now();
  if (slouchStartedAt) { logSlouchEvent(slouchType, slouchStartedAt, Date.now()); slouchStartedAt = null; }
  addAlertToFeed('break', manual ? 'Manual break started' : 'Break started (camera lost)');
  breakToggleBtn.textContent = 'end break';
  breakToggleBtn.classList.add('break-active');
  breakToggleBtn.classList.remove('break-due');
}
function endBreak() {
  if (!breakActive || !breakStart) return;
  const end = Date.now();
  const dur = (end - breakStart) / 1000;
  if (dur >= BREAK_MIN_SECONDS) {
    logBreakEvent(breakStart, end);
    breaksTaken++;
    let msg = '';
    if (dur >= 300) msg = 'Great long break — you’re refreshed.';
    else if (dur >= 60) msg = 'Good break — that was a nice stretch.';
    // under 60s no spoken welcome
    if (msg) speak(msg);
    const mins = Math.round(dur / 60);
    addAlertToFeed('break', `Break ended (${mins > 0 ? mins + ' min' : Math.round(dur) + ' sec'})`);
  } else {
    addAlertToFeed('break', `Short absence ignored`);
  }
  breakActive = false;
  manualBreak = false;
  breakStart = null;
  breakToggleBtn.textContent = 'take a break';
  breakToggleBtn.classList.remove('break-active', 'break-due');
}

// ---- Audio helpers ----
async function ensureAudioUnlocked() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){ return false; } }
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
function stopBgSilentAudio() { if (silentAudioEl) silentAudioEl.pause(); bgAudioEnabled = false; bgAudioBtn.textContent = 'background nudges'; bgAudioBtn.classList.remove('is-on'); }

// ---- Voice ----
function updateVoiceReady(ready) { voiceReady.classList.toggle('ready', ready); }
async function ensurePiperVoice(voiceId) {
  if (piperSession && piperSessionVoice === voiceId) return true;
  try {
    testVoiceBtn.textContent = 'loading voice…';
    try { Object.defineProperty(navigator, 'hardwareConcurrency', { value:1, configurable:true }); } catch(e){}
    piperSession = await piperTTS.TtsSession.create({
      voiceId, wasmPaths: PIPER_WASM_PATHS,
      progress: p => { testVoiceBtn.textContent = `Downloading… ${Math.round(p.loaded*100/p.total)}%`; }
    });
    await piperSession.waitReady;
    piperSessionVoice = voiceId;
    testVoiceBtn.textContent = 'test voice';
    updateVoiceReady(true);
    return true;
  } catch(err) { console.warn('Piper:', err); testVoiceBtn.textContent = 'test voice'; updateVoiceReady(false); return false; }
}
async function speak(text) {
  if (muted) return;
  await ensureAudioUnlocked();
  const isBrowserVoice = window.speechSynthesis && [...window.speechSynthesis.getVoices()].some(v=>v.name===currentVoiceId);
  if (isBrowserVoice) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = window.speechSynthesis.getVoices().find(v=>v.name===currentVoiceId);
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
      const src = audioCtx.createBufferSource(); src.buffer = buffer; src.connect(audioCtx.destination); src.start(0);
      return;
    }
  } catch(e) { console.warn('Piper fallback:', e); }
  if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
}

// ---- Phrases ----
const LEFT_PHRASES = ["You're leaning left — straighten up.", "Left drift — bring head centre.", "Tilting left — correct it."];
const RIGHT_PHRASES = ["Leaning right — centre yourself.", "Right drift — straighten up.", "Tilting right — adjust."];
const SLUMP_PHRASES = ["Slumping — sit taller.", "Neck sinking — lengthen spine.", "Shoulders dropping — open up.", "Reset your posture."];
const BREAK_PROMPT_PHRASES = ["Time for a break — stand up, stretch, come back refreshed.", "You've been sitting a while — step away.", "Take a short break — enjoy it."];
let leftIdx = 0, rightIdx = 0, slumpIdx = 0, breakIdx = 0;

// ---- Math ----
function midpoint(a,b) { return { x:(a.x+b.x)/2, y:(a.y+b.y)/2, z:(a.z+b.z)/2 }; }
function neckCompressionRatio(earMid, shMid, lSh, rSh) {
  const gap = Math.max(shMid.y - earMid.y, 0.0001);
  const sw = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y) || 0.0001;
  return gap / sw;
}
function lateralDeviation(earMid, shMid, lSh, rSh) {
  const sw = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y) || 0.0001;
  return (earMid.x - shMid.x) / sw;  // negative = right
}

// ---- Pose detection ----
async function initModel() {
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'GPU' },
    runningMode: 'VIDEO', numPoses: 1
  });
}

async function startCamera() {
  cameraToggleBtn.textContent = 'loading…';
  cameraToggleBtn.disabled = true;
  try {
    if (!landmarker) await initModel();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480, ...(cameraSelect.value ? { deviceId:{exact:cameraSelect.value} }:{}) }, audio: false });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = r);
    overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    await video.play();
    populateCameraList();
    placeholder.style.display = 'none';
    running = true;
    cameraToggleBtn.textContent = 'stop camera';
    cameraToggleBtn.classList.remove('start-camera');
    cameraToggleBtn.classList.add('stop-camera');
    cameraToggleBtn.disabled = false;
    calibrateBtn.disabled = false;
    breakToggleBtn.disabled = false;
    lastFrameTime = performance.now();
    await mergeRemoteStats();
    logRetrospectiveBreak();
    presenceStart = null; lastBreakEnd = Date.now(); breakStart = null; isPersonPresent = false; breakActive = false; manualBreak = false;
    breakToggleBtn.textContent = 'take a break';
    breakToggleBtn.classList.remove('break-active', 'break-due');
    ensurePiperVoice(currentVoiceId); await ensureAudioUnlocked();
    if (bgAudioEnabled) startBgSilentAudio();
    loop();
  } catch(err) {
    placeholder.textContent = `camera error: ${err.message}`;
    cameraToggleBtn.textContent = 'start camera';
    cameraToggleBtn.classList.add('start-camera');
    cameraToggleBtn.classList.remove('stop-camera');
    cameraToggleBtn.disabled = false;
  }
}

function stopCamera() {
  running = false; if (rafId) cancelAnimationFrame(rafId);
  if (slouchStartedAt) { logSlouchEvent(slouchType, slouchStartedAt, Date.now()); slouchStartedAt = null; }
  localStorage.setItem(LAST_SESSION_END_KEY, new Date().toISOString());
  if (video.srcObject) { video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject = null; }
  placeholder.style.display = 'flex'; placeholder.textContent = 'camera is off — press start camera to begin';
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
  stopBgSilentAudio(); saveStats();
}

// ---- Camera picker ----
async function populateCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d=>d.kind==='videoinput');
    if (!cams.length) return;
    const saved = localStorage.getItem('plumb:cameraId'), prev = cameraSelect.value;
    cameraSelect.innerHTML = '<option value="">Default camera</option>';
    cams.forEach((cam,i) => { const o = document.createElement('option'); o.value = cam.deviceId; o.textContent = cam.label || `Camera ${i+1}`; cameraSelect.appendChild(o); });
    if (saved && cams.some(c=>c.deviceId===saved)) cameraSelect.value = saved;
    else if (prev && cams.some(c=>c.deviceId===prev)) cameraSelect.value = prev;
  } catch(e) {}
}
populateCameraList();
if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', populateCameraList);
cameraSelect.addEventListener('change', () => { localStorage.setItem('plumb:cameraId', cameraSelect.value); if(running){ stopCamera(); startCamera(); } });

// ---- Settings toggle ----
settingsToggle.addEventListener('click', () => {
  settingsContent.classList.toggle('hidden');
  settingsToggle.querySelector('.arrow').textContent = settingsContent.classList.contains('hidden') ? '▼' : '▲';
});

// ---- UI helpers ----
// mode: 'good' | 'mild' | 'sustained' | 'idle'
function setStatus(mode, text, caption) {
  statusCard.classList.remove('state-good','state-mild','state-sustained','state-idle');
  statusCard.classList.add(`state-${mode === 'good' ? 'good' : mode === 'idle' ? 'idle' : mode}`);
  statusValue.textContent = text;
  if (caption !== undefined) statusCaption.textContent = caption;
}

// Positions the dot at (lateral/latTol, compression/compTol) in normalized
// units, so the dashed ring (drawn at a fixed radius) always represents
// "at tolerance" regardless of the two sliders having different scales.
// Leaning left (positive lateral) moves the dot left; slumping moves it down.
const DOT_RING_PX = 46, DOT_CENTER = 85, DOT_MAX_PX = 62;
function updatePostureGlyph(lateral, compression, latTol, compTol) {
  const nx = latTol ? lateral / latTol : 0;
  const ny = compTol ? compression / compTol : 0;
  const px = Math.max(-DOT_MAX_PX, Math.min(DOT_MAX_PX, -nx * DOT_RING_PX));
  const py = Math.max(-DOT_MAX_PX, Math.min(DOT_MAX_PX, ny * DOT_RING_PX));
  dzDot.style.cx = (DOT_CENTER + px) + 'px';
  dzDot.style.cy = (DOT_CENTER + py) + 'px';
}

function updateLiveMetrics(lateral, compression, calibrated) {
  if (!calibrated) {
    lmLateral.textContent = '—'; lmSlump.textContent = '—';
    lmLateral.classList.remove('over'); lmSlump.classList.remove('over');
    return;
  }
  const latTol = Number(toleranceSlider.value), compTol = Number(compressionToleranceSlider.value);
  lmLateral.textContent = lateral.toFixed(2);
  lmSlump.textContent = compression.toFixed(2);
  lmLateral.classList.toggle('over', Math.abs(lateral) > latTol);
  lmSlump.classList.toggle('over', compression > compTol);
}

function maybeSwitchDay() {
  const cur = today();
  if (stats.date !== cur) {
    saveStats();
    stats = { date:cur, sessionSeconds:0, slouchSeconds:0, postureNudges:0, breakNudges:0, breaksTaken:0 };
    breaksTaken = 0; presenceStart = null; lastBreakEnd = Date.now();
    speak("Good morning! A new day of posture tracking has started.");
  }
}

// ---- Main loop ----
function loop() {
  if (!running) return;
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime)/1000, 0.5);
  lastFrameTime = now;
  maybeSwitchDay();

  const result = landmarker.detectForVideo(video, now);
  ctx.clearRect(0,0,overlay.width,overlay.height);

  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    const leftEar=lm[7], rightEar=lm[8], leftSh=lm[11], rightSh=lm[12];
    ctx.fillStyle='rgba(44,110,142,0.9)';
    [leftEar,rightEar,leftSh,rightSh].forEach(p => { ctx.beginPath(); ctx.arc(p.x*overlay.width, p.y*overlay.height,4,0,2*Math.PI); ctx.fill(); });

    const earMid = midpoint(leftEar,rightEar), shMid = midpoint(leftSh,rightSh);

    if (!isPersonPresent) {
      if (breakActive && !manualBreak && breakStart) {
        const gap = (Date.now() - breakStart)/1000;
        if (gap >= BREAK_MIN_SECONDS) {
          endBreak();
        }
      }
      isPersonPresent = true;
      presenceStart = Date.now();
      lastBreakEnd = Date.now();
      // reset break start timer for auto-break
      breakStart = null;
    }

    // update break button colour if break reminder time reached
    const breakIntervalMin = Number(breakSlider.value);
    const continuousMin = presenceStart ? (Date.now() - presenceStart) / 60000 : 0;
    if (!breakActive && continuousMin >= breakIntervalMin) {
      breakToggleBtn.classList.add('break-due');
      breakToggleBtn.textContent = 'time for a break';
    } else if (!breakActive) {
      breakToggleBtn.classList.remove('break-due');
      breakToggleBtn.textContent = 'take a break';
    }

    if (breakActive) {
      setStatus('idle', 'on a break', 'back in a few');
      updatePostureGlyph(0, 0, 0.2, 0.1);
      updateLiveMetrics(0, 0, false);
      rafId = requestAnimationFrame(loop);
      return;
    }

    stats.sessionSeconds += dt;

    const lateral = baselineLateral!==null ? lateralDeviation(earMid,shMid,leftSh,rightSh) - baselineLateral : 0;
    const neckRatio = neckCompressionRatio(earMid,shMid,leftSh,rightSh);
    const compression = baselineNeckRatio!==null ? baselineNeckRatio - neckRatio : 0;
    const calibrated = baselineLateral!==null && baselineNeckRatio!==null;
    updateLiveMetrics(lateral, compression, calibrated);

    // Smooth the glyph's displayed position only — the raw lateral/compression
    // above still drive tolerance checks and nudges, so alerts stay responsive
    // even though the dot itself doesn't jitter frame to frame.
    displayLateral += (lateral - displayLateral) * 0.2;
    displayCompression += (compression - displayCompression) * 0.2;

    if (!calibrated) {
      setStatus('idle', 'calibrate to begin', 'sit naturally, then calibrate');
      updatePostureGlyph(0, 0, 0.2, 0.1);
    } else {
      const latTol = Number(toleranceSlider.value), compTol = Number(compressionToleranceSlider.value), sus = Number(sustainSlider.value)*1000;
      const leftLean = lateral > latTol, rightLean = lateral < -latTol, comp = compression > compTol;
      const isSlouching = leftLean || rightLean || comp;
      const currentType = leftLean ? 'lateral_left' : rightLean ? 'lateral_right' : comp ? 'compression' : null;

      updatePostureGlyph(displayLateral, displayCompression, latTol, compTol);

      if (isSlouching) {
        stats.slouchSeconds += dt;
        if (!slouchStartedAt) { slouchStartedAt = Date.now(); slouchType = currentType; slouchAccumulatedMs = 0; }
        slouchAccumulatedMs += dt * 1000;
        const dur = Date.now() - slouchStartedAt;
        const label = currentType === 'compression' ? 'slumping' : currentType === 'lateral_left' ? 'leaning left' : 'leaning right';
        setStatus(dur > sus ? 'sustained' : 'mild', label, `${Math.round(dur/1000)}s and counting`);
        if (dur > sus && Date.now() - lastPostureNudgeAt > 5000) {
          let phrase;
          if (currentType==='compression') { phrase = SLUMP_PHRASES[slumpIdx%SLUMP_PHRASES.length]; slumpIdx++; }
          else if (currentType==='lateral_left') { phrase = LEFT_PHRASES[leftIdx%LEFT_PHRASES.length]; leftIdx++; }
          else { phrase = RIGHT_PHRASES[rightIdx%RIGHT_PHRASES.length]; rightIdx++; }
          speak(phrase); addAlertToFeed(currentType, phrase); stats.postureNudges++; lastPostureNudgeAt = Date.now();
        }
      } else {
        if (slouchStartedAt) {
          // Use the accumulated, dt-capped duration rather than a raw
          // Date.now() diff — if the tab was throttled/backgrounded mid-slouch,
          // this stays consistent with stats.slouchSeconds instead of logging
          // the full uncapped wall-clock gap (which is what caused >100% totals).
          logSlouchEvent(slouchType, slouchStartedAt, slouchStartedAt + slouchAccumulatedMs);
          slouchStartedAt = null; slouchAccumulatedMs = 0;
        }
        setStatus('good', 'sitting tall', 'calibrated to your desk');
      }

      if (presenceStart && !breakActive && continuousMin >= breakIntervalMin && Date.now() - lastBreakNudgeAt > 60000) {
        const p = BREAK_PROMPT_PHRASES[breakIdx% BREAK_PROMPT_PHRASES.length]; breakIdx++;
        speak(p); addAlertToFeed('break_prompt', p); stats.breakNudges++; lastBreakNudgeAt = Date.now();
      }
    }
  } else {
    if (isPersonPresent && !breakActive) {
      if (slouchStartedAt) { logSlouchEvent(slouchType, slouchStartedAt, slouchStartedAt + slouchAccumulatedMs); slouchStartedAt = null; slouchAccumulatedMs = 0; }
      breakStart = Date.now();
      isPersonPresent = false;
      setStatus('idle', 'no one detected', 'step into frame to resume');
      updatePostureGlyph(0, 0, 0.2, 0.1);
      updateLiveMetrics(0, 0, false);
    }
    if (!isPersonPresent && breakStart && !breakActive) {
      const absence = (Date.now() - breakStart)/1000;
      if (absence >= BREAK_MIN_SECONDS) {
        startBreak(false);
      }
    }
  }

  rafId = requestAnimationFrame(loop);
}

// ---- Calibration (always possible) ----
calibrateBtn.addEventListener('click', () => {
  const result = landmarker.detectForVideo(video, performance.now());
  if (result.landmarks && result.landmarks.length>0) {
    const lm = result.landmarks[0];
    const earMid = midpoint(lm[7],lm[8]), shMid = midpoint(lm[11],lm[12]);
    baselineNeckRatio = neckCompressionRatio(earMid, shMid, lm[11], lm[12]);
    baselineLateral = lateralDeviation(earMid, shMid, lm[11], lm[12]);
    statusCaption.textContent = 'calibrated to your desk';
    speak("Calibrated. That's your good posture.");
    addAlertToFeed('calibration', 'Posture calibrated'); logCalibrationEvent();
    calibrateBtn.textContent = 'recalibrate posture';
    calibrateBtn.classList.add('is-confirmed');
  }
});

// ---- Break button ----
breakToggleBtn.addEventListener('click', () => {
  if (!running) return;
  if (breakActive) {
    endBreak();
  } else {
    startBreak(true);
  }
});

// ---- Camera toggle button ----
cameraToggleBtn.addEventListener('click', () => {
  if (running) {
    stopCamera();
  } else {
    startCamera();
  }
});

// ---- Report modal (unchanged) ----
async function fetchEventsForRange(start, end) {
  if (!SYNC_CONFIGURED) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_events?date=gte.${start}&date=lte.${end}&order=date.asc,start_time.asc`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error('fetch');
    return await res.json();
  } catch(e) { console.warn(e); return []; }
}
async function fetchDailyLogs(start, end) {
  if (!SYNC_CONFIGURED) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_logs?date=gte.${start}&date=lte.${end}&order=date.asc`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error('fetch');
    return await res.json();
  } catch(e) { console.warn(e); return []; }
}

async function showReport(range) {
  let start, end;
  const curDate = today();
  if (range==='today') { start=curDate; end=curDate; }
  else if (range==='week') { start = addDaysToDateStr(curDate, -6); end=curDate; }
  else if (range==='month') { start = addDaysToDateStr(curDate, -29); end=curDate; }
  else if (range==='ai') { renderAiSummary(); return; }

  panelNumeric.classList.add('active'); panelAi.classList.remove('active');

  const events = await fetchEventsForRange(start, end);
  const logs = await fetchDailyLogs(start, end);

  const dateMap = {};
  let ds0 = start;
  while (ds0 <= end) {
    dateMap[ds0] = { break:0, left:0, right:0, slump:0, away:0, breaks:0, sessionSeconds:0 };
    ds0 = addDaysToDateStr(ds0, 1);
  }
  events.forEach(e => {
    const ds = e.date;
    if (!dateMap[ds]) dateMap[ds] = { break:0, left:0, right:0, slump:0, away:0, breaks:0, sessionSeconds:0 };
    const dur = e.duration_seconds||0;
    if (e.type==='break') { dateMap[ds].break += dur; dateMap[ds].breaks++; }
    else if (e.type==='away') dateMap[ds].away += dur;
    else if (e.type==='lateral_left') dateMap[ds].left += dur;
    else if (e.type==='lateral_right') dateMap[ds].right += dur;
    else if (e.type==='compression') dateMap[ds].slump += dur;
  });
  logs.forEach(log => { if (dateMap[log.date]) dateMap[log.date].sessionSeconds = log.session_seconds||0; });

  const dates = Object.keys(dateMap).sort();
  const labels = dates.map(ds => new Date(ds+'T00:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }));
  const breakMin = dates.map(ds => Math.round(dateMap[ds].break/60));
  const leftMin = dates.map(ds => Math.round(dateMap[ds].left/60));
  const rightMin = dates.map(ds => Math.round(dateMap[ds].right/60));
  const slumpMin = dates.map(ds => Math.round(dateMap[ds].slump/60));
  const goodMin = dates.map(ds => Math.max(0, Math.round((dateMap[ds].sessionSeconds - dateMap[ds].left - dateMap[ds].right - dateMap[ds].slump)/60)));

  let totalBreak=0, totalSession=0, totalSlouch=0, totalBreaks=0, totalAway=0;
  Object.values(dateMap).forEach(day => { totalBreak+=day.break; totalSession+=day.sessionSeconds; totalSlouch+=day.left+day.right+day.slump; totalBreaks+=day.breaks; totalAway+=day.away; });
  const overall = totalBreak + totalSession;
  const slouchPct = overall ? Math.min(100, Math.round(totalSlouch/overall*100)) : 0;
  const avgBreak = totalBreaks ? Math.round(totalBreak/totalBreaks/60) : 0;
  reportSummary.innerHTML = `
    <div class="metric"><div class="value">${Math.round(overall/60)}m</div><div class="label">monitored</div></div>
    <div class="metric"><div class="value">${slouchPct}%</div><div class="label">time slouching</div></div>
    <div class="metric"><div class="value">${totalBreaks}</div><div class="label">breaks</div></div>
    <div class="metric"><div class="value">${avgBreak}m</div><div class="label">avg break</div></div>
    ${totalAway > 0 ? `<div class="metric"><div class="value">${Math.round(totalAway/3600)}h</div><div class="label">time away</div></div>` : ''}
  `;

  if (currentChart) currentChart.destroy();
  currentChart = new Chart(slouchChartCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'good posture', data:goodMin, backgroundColor:'#0A2626', stack:'s' },
        { label:'leaning left', data:leftMin, backgroundColor:'#F0DAC7', stack:'s' },
        { label:'leaning right', data:rightMin, backgroundColor:'#E4C1A0', stack:'s' },
        { label:'slumping', data:slumpMin, backgroundColor:'#C1622E', stack:'s' },
        { label:'break', data:breakMin, backgroundColor:'#C9C2B3', stack:'s' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      scales: { x:{ stacked:true, grid:{ display:false } }, y:{ stacked:true, title:{ display:true, text:'minutes' }, grid:{ color:'rgba(10,38,38,0.06)' } } },
      plugins: {
        legend: { labels: { font: { family: 'Nunito', weight: '700', size: 11 }, boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} min` } }
      }
    }
  });
}

async function renderAiSummary() {
  panelNumeric.classList.remove('active'); panelAi.classList.add('active');
  try {
    const res = await fetch('./data/summary.json', { cache: 'no-store' });
    const data = await res.json();
    if (!data.summary) {
      aiSummaryText.textContent = "no summary yet — this fills in after the weekly GitHub Action runs.";
      aiMeta.textContent = ''; aiStatGrid.innerHTML = '';
      if (aiChart) { aiChart.destroy(); aiChart = null; }
      return;
    }
    aiSummaryText.textContent = data.summary;
    aiMeta.textContent = data.generatedAt ? `generated ${new Date(data.generatedAt).toLocaleString()} · based on ${data.stats.daysLogged} logged days` : '';
    const s = data.stats;
    aiStatGrid.innerHTML = `
      <div class="metric"><div class="value">${Math.round((s.totalSessionMinutes||0)/60)}h</div><div class="label">tracked time</div></div>
      <div class="metric"><div class="value">${s.slouchRatePct||0}%</div><div class="label">time slouching</div></div>
      <div class="metric"><div class="value">${s.totalMoveNudges||0}</div><div class="label">move nudges</div></div>
    `;
    const days = s.days || [];
    if (aiChart) aiChart.destroy();
    aiChart = new Chart(document.getElementById('aiDailyChart').getContext('2d'), {
      type: 'bar',
      data: { labels: days.map(d => d.date), datasets: [{ label: 'slouch minutes', data: days.map(d => d.slouchMinutes||0), backgroundColor: '#C1622E', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display:false } },
        scales: { y: { title: { display:true, text:'minutes' }, grid:{ color:'rgba(10,38,38,0.06)' } }, x: { grid:{ display:false } } } }
    });
  } catch (err) {
    aiSummaryText.textContent = "couldn't load this week's summary.";
    aiMeta.textContent = ''; aiStatGrid.innerHTML = '';
  }
}

reportBtn.addEventListener('click', () => { modalOverlay.classList.add('open'); const active = document.querySelector('.tab.active'); showReport(active ? active.dataset.range : 'today'); });
modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
modalTabs.addEventListener('click', e => {
  if (e.target.classList.contains('tab')) {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    e.target.classList.add('active');
    showReport(e.target.dataset.range);
  }
});

// ---- Event wiring ----
maybeSwitchDay();
setInterval(() => { maybeSwitchDay(); saveStats(); }, 10000);
window.addEventListener('beforeunload', () => {
  if (slouchStartedAt) { logSlouchEvent(slouchType, slouchStartedAt, Date.now()); slouchStartedAt=null; }
  localStorage.setItem(LAST_SESSION_END_KEY, new Date().toISOString());
  saveStats();
});

testVoiceBtn.addEventListener('click', () => speak('This is what a nudge sounds like.'));
muteBtn.addEventListener('click', () => { muted = !muted; muteBtn.textContent = muted ? 'unmute' : 'mute'; muteBtn.classList.toggle('is-on', !muted); });
bgAudioBtn.addEventListener('click', () => { if(bgAudioEnabled) stopBgSilentAudio(); else startBgSilentAudio(); });

function paintSliderTrack(slider) {
  const pct = (slider.value - slider.min) / (slider.max - slider.min) * 100;
  slider.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--ink-faint-2) ${pct}%)`;
}
[toleranceSlider, compressionToleranceSlider, sustainSlider, breakSlider].forEach(paintSliderTrack);

toleranceSlider.addEventListener('input', () => { toleranceVal.textContent = toleranceSlider.value; paintSliderTrack(toleranceSlider); lmLateralTol.textContent = Number(toleranceSlider.value).toFixed(2); });
compressionToleranceSlider.addEventListener('input', () => { compressionToleranceVal.textContent = compressionToleranceSlider.value; paintSliderTrack(compressionToleranceSlider); lmSlumpTol.textContent = Number(compressionToleranceSlider.value).toFixed(2); });
sustainSlider.addEventListener('input', () => { sustainVal.textContent = `${sustainSlider.value}s`; paintSliderTrack(sustainSlider); });
breakSlider.addEventListener('input', () => { breakVal.textContent = `${breakSlider.value} min`; paintSliderTrack(breakSlider); });

// ---- Device/voice popover ----
gearBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  devicePopover.classList.toggle('is-open');
  gearBtn.classList.toggle('is-open');
});
document.addEventListener('click', (e) => {
  if (!devicePopover.contains(e.target) && e.target !== gearBtn) {
    devicePopover.classList.remove('is-open');
    gearBtn.classList.remove('is-open');
  }
});
