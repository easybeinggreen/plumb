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

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const cameraSelect = document.getElementById('cameraSelect');
const calibrateBtn = document.getElementById('calibrateBtn');
const testVoiceBtn = document.getElementById('testVoiceBtn');
const muteBtn = document.getElementById('muteBtn');
const bgAudioBtn = document.getElementById('bgAudioBtn');
const exportBtn = document.getElementById('exportBtn');
const voiceSelect = document.getElementById('voiceSelect');

const statusCard = document.getElementById('statusCard');
const statusValue = document.getElementById('statusValue');

const postureMap = document.getElementById('postureMap');
const pmCtx = postureMap.getContext('2d');
const gaugeCaption = document.getElementById('gaugeCaption');

const statSession = document.getElementById('statSession');
const statSlouch = document.getElementById('statSlouch');
const statPostureNudges = document.getElementById('statPostureNudges');
const statBreakNudges = document.getElementById('statBreakNudges');
const statBreaksTaken = document.getElementById('statBreaksTaken');
const statSinceBreak = document.getElementById('statSinceBreak');

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

// ---- State ----
let landmarker = null;
let running = false;
let rafId = null;
let muted = false;
let bgAudioEnabled = false;

let baselineLateral = null;
let baselineNeckRatio = null;

let lastFrameTime = performance.now();

// Slouch / posture timers
let slouchStartedAt = null;
let slouchType = null;           // 'lateral_left', 'lateral_right', 'compression'
let lastPostureNudgeAt = 0;

// Break / presence logic
let presenceStart = null;
let isPersonPresent = false;
let lastBreakEnd = null;
let breakStart = null;
let breaksTaken = 0;
let lastBreakNudgeAt = 0;

// Event buffer (flushed to Supabase every 30 seconds)
let eventBuffer = [];

// Audio context and background silent loop
let audioCtx = null;
let silentAudioEl = null;

let currentVoiceId = localStorage.getItem('plumb:voice') || voiceSelect.value;
voiceSelect.value = currentVoiceId;
let piperSession = null;
let piperSessionVoice = null;

const PIPER_WASM_PATHS = {
  onnxWasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm'
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const LOG_KEY = (d) => `plumb:${d}`;

let stats = loadTodayStats();

// ---- Multi-device merge: fetch today's remote stats on startup ----
async function mergeRemoteStats() {
  if (!SYNC_CONFIGURED) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/posture_logs?date=eq.${stats.date}&select=*`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    if (!res.ok) throw new Error('fetch failed');
    const rows = await res.json();
    if (rows.length > 0) {
      const remote = rows[0];
      // Use the larger of local or remote totals (since local may have been running before sync)
      stats.sessionSeconds = Math.max(stats.sessionSeconds, remote.session_seconds || 0);
      stats.slouchSeconds = Math.max(stats.slouchSeconds, remote.slouch_seconds || 0);
      stats.postureNudges = Math.max(stats.postureNudges, remote.posture_nudges || 0);
      stats.breakNudges = Math.max(stats.breakNudges, remote.break_nudges || 0);
      stats.breaksTaken = Math.max(stats.breaksTaken, remote.breaks_taken || 0);
      // Also update local in-memory break counter
      breaksTaken = stats.breaksTaken;
      console.log('Merged remote stats:', stats);
    }
  } catch (err) {
    console.warn('Could not merge remote stats:', err);
  }
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
  return {
    date: today(),
    sessionSeconds: 0,
    slouchSeconds: 0,
    postureNudges: 0,
    breakNudges: 0,
    breaksTaken: 0
  };
}

function saveStatsLocal() {
  stats.breaksTaken = breaksTaken;
  localStorage.setItem(LOG_KEY(stats.date), JSON.stringify(stats));
}

function getAllStoredDays() {
  const days = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('plumb:')) {
      try { days.push(JSON.parse(localStorage.getItem(key))); } catch (e) {}
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Cloud sync ----
function setSyncStatus(mode, text) {
  syncDot.classList.remove('ok', 'err');
  if (mode) syncDot.classList.add(mode);
  syncText.textContent = text;
}

if (!SYNC_CONFIGURED) {
  setSyncStatus('', 'Cloud sync: not configured yet (see README)');
} else {
  setSyncStatus('', 'Cloud sync: ready');
}

async function syncToSupabase() {
  if (!SYNC_CONFIGURED) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/posture_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify([
        {
          date: stats.date,
          session_seconds: Math.round(stats.sessionSeconds),
          slouch_seconds: Math.round(stats.slouchSeconds),
          posture_nudges: stats.postureNudges,
          break_nudges: stats.breakNudges,
          breaks_taken: stats.breaksTaken,
          updated_at: new Date().toISOString()
        }
      ]),
      keepalive: true
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${res.status} ${errText}`);
    }
    setSyncStatus('ok', `Cloud sync: last synced ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.warn('Supabase sync failed:', err);
    setSyncStatus('err', `Cloud sync: ${err.message}`);
  }
}

async function flushEvents() {
  if (!SYNC_CONFIGURED || eventBuffer.length === 0) return;
  const toSend = [...eventBuffer];
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
      const errText = await res.text();
      console.warn('Event upload failed:', res.status, errText);
      // Put events back so we can retry later
      eventBuffer.push(...toSend);
    }
  } catch (err) {
    console.warn('Event upload error:', err);
    eventBuffer.push(...toSend);
  }
}

function saveStats() {
  saveStatsLocal();
  syncToSupabase();
  flushEvents();
}

// ---- Alert feed (on-screen log) ----
function addAlertToFeed(type, message) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const item = document.createElement('div');
  item.style.marginBottom = '4px';
  item.innerHTML = `<span style="font-family:var(--mono);">${time}</span> <span style="color:var(--ink);">${message}</span>`;
  if (alertFeed.children.length === 1 && alertFeed.children[0].innerText === 'No alerts yet') {
    alertFeed.innerHTML = '';
  }
  alertFeed.insertBefore(item, alertFeed.firstChild);
  // Keep only last 20 entries
  while (alertFeed.children.length > 20) {
    alertFeed.removeChild(alertFeed.lastChild);
  }
}

// ---- Audio unlock & keep-alive ----
async function ensureAudioUnlocked() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('Cannot create AudioContext', e);
      return false;
    }
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  return true;
}

function startBgSilentAudio() {
  if (!silentAudioEl) {
    silentAudioEl = new Audio();
    silentAudioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    silentAudioEl.loop = true;
    silentAudioEl.volume = 0.001;
  }
  silentAudioEl.play().catch(e => console.warn('silent audio play blocked:', e));
  bgAudioEnabled = true;
  bgAudioBtn.textContent = 'Background nudges: on';
}

function stopBgSilentAudio() {
  if (silentAudioEl) {
    silentAudioEl.pause();
  }
  bgAudioEnabled = false;
  bgAudioBtn.textContent = 'Background nudges: off';
}

// ---- Voice ----
async function ensurePiperVoice(voiceId) {
  if (piperSession && piperSessionVoice === voiceId) return true;
  try {
    testVoiceBtn.textContent = 'Loading voice…';
    try {
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: 1, configurable: true });
    } catch (e) {}
    piperSession = await piperTTS.TtsSession.create({
      voiceId,
      wasmPaths: PIPER_WASM_PATHS,
      progress: (p) => {
        const pct = Math.round((p.loaded * 100) / p.total);
        testVoiceBtn.textContent = `Downloading voice… ${pct}%`;
      }
    });
    await piperSession.waitReady;
    piperSessionVoice = voiceId;
    testVoiceBtn.textContent = 'Test voice';
    return true;
  } catch (err) {
    console.warn('Piper unavailable, will fall back to browser voice:', err);
    testVoiceBtn.textContent = 'Test voice';
    return false;
  }
}

async function speak(text) {
  if (muted) return;
  const unlocked = await ensureAudioUnlocked();
  if (!unlocked) return;
  try {
    const ok = await ensurePiperVoice(currentVoiceId);
    if (ok) {
      const wav = await piperSession.predict(text);
      const audioBuffer = await audioCtx.decodeAudioData(await wav.arrayBuffer());
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      source.start(0);
      return;
    }
  } catch (err) {
    console.warn('Piper synthesis failed, falling back to browser TTS:', err);
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const savedVoice = localStorage.getItem('plumb:speechVoice');
    if (savedVoice) {
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(v => v.name === savedVoice);
      if (match) u.voice = match;
    }
    window.speechSynthesis.speak(u);
  }
}

// ---- Phrases ----
const LEFT_PHRASES = [
  "You're leaning to the left — straighten up.",
  "Left side drift — bring your head back to centre.",
  "Your head is tilting left — correct that lean."
];
const RIGHT_PHRASES = [
  "Leaning right — bring your head back to centre.",
  "Right side drift — straighten up please.",
  "Your head is tilting right — correct that lean."
];
const SLUMP_PHRASES = [
  "You're slumping down — sit taller, lift your chest.",
  "Neck sinking — lengthen your spine.",
  "Shoulders dropping — open up and sit tall.",
  "You've sunk into a slump — reset your posture."
];
const BREAK_PROMPT_PHRASES = [
  "Time to take a break! Stand up, stretch, and enjoy — come back refreshed.",
  "You've been sitting a while. Step away for a moment and come back soon.",
  "Your body deserves a break — get up, walk around, then return.",
  "Take a short break — enjoy it and come back when you're ready."
];
const WELCOME_BACK_SHORT = [
  "Welcome back — that was a short break.",
  "Quick break — good to have you back."
];
const WELCOME_BACK_LONG = [
  "Welcome back — you had a nice long break.",
  "Great break — you're back feeling refreshed."
];

let leftIdx = 0, rightIdx = 0, slumpIdx = 0, breakIdx = 0, welcomeIdx = 0;

// ---- Math helpers ----
function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function neckCompressionRatio(earMid, shoulderMid, leftSh, rightSh) {
  const gap = Math.max(shoulderMid.y - earMid.y, 0.0001);
  const shoulderWidth = Math.hypot(leftSh.x - rightSh.x, leftSh.y - rightSh.y) || 0.0001;
  return gap / shoulderWidth;
}

function lateralDeviation(earMid, shMid, leftSh, rightSh) {
  const shoulderWidth = Math.hypot(leftSh.x - rightSh.x, leftSh.y - rightSh.y) || 0.0001;
  return (earMid.x - shMid.x) / shoulderWidth; // negative = left
}

// ---- Pose detection ----
async function initModel() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1
  });
}

async function startCamera() {
  startBtn.disabled = true;
  startBtn.textContent = 'Loading model…';
  try {
    if (!landmarker) await initModel();
    const constraints = {
      video: {
        width: 640,
        height: 480,
        ...(cameraSelect.value ? { deviceId: { exact: cameraSelect.value } } : {})
      },
      audio: false
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await new Promise((resolve) => (video.onloadedmetadata = resolve));
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    await video.play();
    populateCameraList();
    placeholder.style.display = 'none';
    running = true;
    stopBtn.disabled = false;
    calibrateBtn.disabled = false;
    startBtn.textContent = 'Start camera';
    lastFrameTime = performance.now();

    // Merge remote stats before tracking begins
    await mergeRemoteStats();

    presenceStart = null;
    lastBreakEnd = Date.now();
    breakStart = null;
    isPersonPresent = false;
    breaksTaken = stats.breaksTaken;

    ensurePiperVoice(currentVoiceId);
    await ensureAudioUnlocked();
    if (bgAudioEnabled) startBgSilentAudio();
    loop();
  } catch (err) {
    placeholder.textContent = `Couldn't access the camera: ${err.message}. Check browser permissions and that you're on HTTPS or localhost.`;
    startBtn.disabled = false;
    startBtn.textContent = 'Start camera';
  }
}

function stopCamera() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  placeholder.style.display = 'flex';
  placeholder.textContent =
    'Camera is off. Click "Start camera" to begin — this app only looks at angles between a few body points, it never records or sends the video anywhere.';
  stopBtn.disabled = true;
  calibrateBtn.disabled = true;
  stopBgSilentAudio();
  saveStats();
}

// ---- Camera picker ----
async function populateCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    if (cams.length === 0) return;

    const saved = localStorage.getItem('plumb:cameraId');
    const previous = cameraSelect.value;

    cameraSelect.innerHTML = '<option value="">Default camera</option>';
    cams.forEach((cam, i) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Camera ${i + 1}`;
      cameraSelect.appendChild(opt);
    });

    if (saved && cams.some((c) => c.deviceId === saved)) {
      cameraSelect.value = saved;
    } else if (previous && cams.some((c) => c.deviceId === previous)) {
      cameraSelect.value = previous;
    }
  } catch (err) {
    console.warn('Could not list cameras:', err);
  }
}

populateCameraList();
if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', populateCameraList);
}

cameraSelect.addEventListener('change', () => {
  localStorage.setItem('plumb:cameraId', cameraSelect.value);
  if (running) {
    stopCamera();
    startCamera();
  }
});

// ---- UI helpers ----
function setStatus(mode, text) {
  statusCard.classList.remove('good', 'alert', 'idle');
  statusCard.classList.add(mode);
  statusValue.textContent = text;
}

function fmtMinSec(totalSeconds) { return `${Math.floor(totalSeconds / 60)}m`; }

function refreshStatDisplay() {
  statSession.textContent = fmtMinSec(stats.sessionSeconds);
  const pct = stats.sessionSeconds ? Math.round((stats.slouchSeconds / stats.sessionSeconds) * 100) : 0;
  statSlouch.textContent = `${fmtMinSec(stats.slouchSeconds)} (${pct}%)`;
  statPostureNudges.textContent = stats.postureNudges;
  statBreakNudges.textContent = stats.breakNudges;
  statBreaksTaken.textContent = breaksTaken;
  const sinceBreak = lastBreakEnd ? Math.floor((Date.now() - lastBreakEnd) / 1000) : 0;
  if (sinceBreak > 0) {
    const mm = String(Math.floor(sinceBreak / 60)).padStart(2, '0');
    const ss = String(sinceBreak % 60).padStart(2, '0');
    statSinceBreak.textContent = `${mm}:${ss}`;
  } else {
    statSinceBreak.textContent = '--';
  }
}

function drawPostureMap(lateral, compression) {
  const w = postureMap.width, h = postureMap.height;
  pmCtx.clearRect(0, 0, w, h);

  pmCtx.strokeStyle = '#ccc';
  pmCtx.lineWidth = 1;
  pmCtx.beginPath();
  pmCtx.moveTo(w/2, 0); pmCtx.lineTo(w/2, h);
  pmCtx.moveTo(0, h/2); pmCtx.lineTo(w, h/2);
  pmCtx.stroke();

  const scaleX = w * 0.45;
  const scaleY = h * 0.45;
  const dotX = w/2 - lateral * scaleX * 2;
  const dotY = h/2 + compression * scaleY * 5;

  const clampedX = Math.max(8, Math.min(w-8, dotX));
  const clampedY = Math.max(8, Math.min(h-8, dotY));

  const distFromCenter = Math.hypot((clampedX - w/2)/scaleX, (clampedY - h/2)/scaleY);
  if (distFromCenter > 0.5) {
    pmCtx.fillStyle = '#C0492F';
  } else if (distFromCenter > 0.25) {
    pmCtx.fillStyle = '#C98A2C';
  } else {
    pmCtx.fillStyle = '#27AE60';
  }
  pmCtx.beginPath();
  pmCtx.arc(clampedX, clampedY, 7, 0, 2*Math.PI);
  pmCtx.fill();

  pmCtx.fillStyle = '#57676C';
  pmCtx.font = '10px sans-serif';
  pmCtx.textAlign = 'center';
  pmCtx.fillText('Left', 12, h/2 + 3);
  pmCtx.fillText('Right', w-12, h/2 + 3);
  pmCtx.fillText('Tall', w/2, 14);
  pmCtx.fillText('Slump', w/2, h-4);
}

// ---- Event logging (slouch start/end) ----
function logSlouchEvent(type, startTime, endTime) {
  const duration = Math.round((endTime - startTime) / 1000);
  if (duration <= 0) return;
  eventBuffer.push({
    date: today(),
    start_time: new Date(startTime).toISOString(),
    end_time: new Date(endTime).toISOString(),
    type,
    duration_seconds: duration
  });
}

// ---- Day change detection ----
function maybeSwitchDay() {
  const current = today();
  if (stats.date !== current) {
    saveStats();
    stats = {
      date: current,
      sessionSeconds: 0,
      slouchSeconds: 0,
      postureNudges: 0,
      breakNudges: 0,
      breaksTaken: 0
    };
    breaksTaken = 0;
    presenceStart = null;
    lastBreakEnd = Date.now();
    speak("Good morning! A new day of posture tracking has started.");
  }
}

// ---- Main loop ----
function loop() {
  if (!running) return;
  const now = performance.now();
  const elapsedSec = Math.min((now - lastFrameTime) / 1000, 0.5);
  lastFrameTime = now;

  maybeSwitchDay();

  const result = landmarker.detectForVideo(video, now);
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    const leftEar = lm[7], rightEar = lm[8], leftSh = lm[11], rightSh = lm[12];

    ctx.fillStyle = 'rgba(44,110,142,0.9)';
    [leftEar, rightEar, leftSh, rightSh].forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * overlay.width, p.y * overlay.height, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    const earMid = midpoint(leftEar, rightEar);
    const shMid = midpoint(leftSh, rightSh);

    stats.sessionSeconds += elapsedSec;

    // Break / presence tracking
    const wasPresent = isPersonPresent;
    isPersonPresent = true;

    if (!wasPresent) {
      const nowTime = Date.now();
      if (breakStart) {
        const breakDuration = nowTime - breakStart;
        if (breakDuration > 30000) {
          breaksTaken++;
        }
        const mins = Math.round(breakDuration / 60000);
        const welcomeMsg = mins >= 5
          ? WELCOME_BACK_LONG[welcomeIdx % WELCOME_BACK_LONG.length]
          : WELCOME_BACK_SHORT[welcomeIdx % WELCOME_BACK_SHORT.length];
        speak(welcomeMsg);
        addAlertToFeed('break', `Returned from break (${mins} min)`);
        welcomeIdx++;
      }
      breakStart = null;
      lastBreakEnd = nowTime;
      presenceStart = nowTime;
    }

    const lateral = baselineLateral !== null
      ? lateralDeviation(earMid, shMid, leftSh, rightSh) - baselineLateral
      : 0;
    const neckRatio = neckCompressionRatio(earMid, shMid, leftSh, rightSh);
    const compression = baselineNeckRatio !== null
      ? baselineNeckRatio - neckRatio
      : 0;

    drawPostureMap(lateral, compression);

    if (baselineLateral === null || baselineNeckRatio === null) {
      setStatus('idle', 'Calibrate to begin tracking');
    } else {
      const lateralTolerance = Number(toleranceSlider.value);
      const compressionTolerance = Number(compressionToleranceSlider.value);
      const sustainMs = Number(sustainSlider.value) * 1000;

      const isLateralLeft = lateral < -lateralTolerance;
      const isLateralRight = lateral > lateralTolerance;
      const isCompressed = compression > compressionTolerance;

      const isSlouching = isLateralLeft || isLateralRight || isCompressed;
      const currentType = isLateralLeft ? 'lateral_left' : isLateralRight ? 'lateral_right' : isCompressed ? 'compression' : null;

      if (isSlouching) {
        stats.slouchSeconds += elapsedSec;
        if (slouchStartedAt === null) {
          slouchStartedAt = Date.now();
          slouchType = currentType;
        }
        const slouchedFor = Date.now() - slouchStartedAt;
        setStatus('alert', `Slouching — ${Math.round(slouchedFor / 1000)}s`);
        if (slouchedFor > sustainMs && Date.now() - lastPostureNudgeAt > 30000) {
          let phrase;
          if (currentType === 'compression') {
            phrase = SLUMP_PHRASES[slumpIdx % SLUMP_PHRASES.length];
            slumpIdx++;
          } else if (currentType === 'lateral_left') {
            phrase = LEFT_PHRASES[leftIdx % LEFT_PHRASES.length];
            leftIdx++;
          } else {
            phrase = RIGHT_PHRASES[rightIdx % RIGHT_PHRASES.length];
            rightIdx++;
          }
          speak(phrase);
          addAlertToFeed(currentType, phrase);
          stats.postureNudges++;
          lastPostureNudgeAt = Date.now();
        }
      } else {
        // Slouch ended
        if (slouchStartedAt !== null) {
          logSlouchEvent(slouchType, slouchStartedAt, Date.now());
        }
        slouchStartedAt = null;
        slouchType = null;
        setStatus('good', 'Sitting well');
      }

      // Break prompt
      if (presenceStart) {
        const continuousMinutes = (Date.now() - presenceStart) / 60000;
        const breakInterval = Number(breakSlider.value);
        if (continuousMinutes >= breakInterval && Date.now() - lastBreakNudgeAt > 60000) {
          const phrase = BREAK_PROMPT_PHRASES[breakIdx % BREAK_PROMPT_PHRASES.length];
          speak(phrase);
          addAlertToFeed('break_prompt', phrase);
          breakIdx++;
          stats.breakNudges++;
          lastBreakNudgeAt = Date.now();
        }
      }
    }
  } else {
    // No person detected
    if (isPersonPresent) {
      // Person left – end any ongoing slouch event
      if (slouchStartedAt !== null) {
        logSlouchEvent(slouchType, slouchStartedAt, Date.now());
        slouchStartedAt = null;
        slouchType = null;
      }
      breakStart = Date.now();
      isPersonPresent = false;
      setStatus('idle', 'No person detected');
    }
  }

  refreshStatDisplay();
  rafId = requestAnimationFrame(loop);
}

// ---- Calibration ----
calibrateBtn.addEventListener('click', () => {
  const now = performance.now();
  const result = landmarker.detectForVideo(video, now);
  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    const earMid = midpoint(lm[7], lm[8]);
    const shMid = midpoint(lm[11], lm[12]);
    baselineNeckRatio = neckCompressionRatio(earMid, shMid, lm[11], lm[12]);
    baselineLateral = lateralDeviation(earMid, shMid, lm[11], lm[12]);
    gaugeCaption.textContent = 'Posture calibrated. Sit like that.';
    speak("Calibrated. That's your good posture.");
  }
});

// ---- Event wiring ----
// Day change check + save every 10s
maybeSwitchDay();
setInterval(() => {
  maybeSwitchDay();
  saveStats();
}, 10000);

window.addEventListener('beforeunload', saveStats);

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

testVoiceBtn.addEventListener('click', () => speak('This is what a nudge sounds like.'));
muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = `Mute voice: ${muted ? 'on' : 'off'}`;
});
bgAudioBtn.addEventListener('click', () => {
  if (bgAudioEnabled) {
    stopBgSilentAudio();
  } else {
    startBgSilentAudio();
  }
});
voiceSelect.addEventListener('change', () => {
  localStorage.setItem('plumb:voice', voiceSelect.value);
  testVoiceBtn.textContent = 'Reloading for new voice…';
  location.reload();
});

exportBtn.addEventListener('click', () => {
  saveStatsLocal();
  const days = getAllStoredDays();
  const blob = new Blob([JSON.stringify(days, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'posture-log-backup.json';
  a.click();
});

toleranceSlider.addEventListener('input', () => (toleranceVal.textContent = toleranceSlider.value));
compressionToleranceSlider.addEventListener('input', () => (compressionToleranceVal.textContent = compressionToleranceSlider.value));
sustainSlider.addEventListener('input', () => (sustainVal.textContent = `${sustainSlider.value}s`));
breakSlider.addEventListener('input', () => (breakVal.textContent = `${breakSlider.value} min`));

setInterval(refreshStatDisplay, 1000);
