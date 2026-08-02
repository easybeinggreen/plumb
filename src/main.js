import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as piperTTS from '@mintplex-labs/piper-tts-web';

// ---- Supabase config (safe to expose — protected by RLS, see README) ----
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
const calibrateBtn = document.getElementById('calibrateBtn');
const testVoiceBtn = document.getElementById('testVoiceBtn');
const muteBtn = document.getElementById('muteBtn');
const exportBtn = document.getElementById('exportBtn');
const voiceSelect = document.getElementById('voiceSelect');

const statusCard = document.getElementById('statusCard');
const statusValue = document.getElementById('statusValue');
const gaugeReading = document.getElementById('gaugeReading');
const gaugeCaption = document.getElementById('gaugeCaption');
const needleGroup = document.getElementById('needleGroup');
const gaugeArc = document.getElementById('gaugeArc');

const statSession = document.getElementById('statSession');
const statSlouch = document.getElementById('statSlouch');
const statPostureNudges = document.getElementById('statPostureNudges');
const statMoveNudges = document.getElementById('statMoveNudges');
const statSinceMove = document.getElementById('statSinceMove');

const toleranceSlider = document.getElementById('toleranceSlider');
const sustainSlider = document.getElementById('sustainSlider');
const moveSlider = document.getElementById('moveSlider');
const moveThresholdSlider = document.getElementById('moveThresholdSlider');
const toleranceVal = document.getElementById('toleranceVal');
const sustainVal = document.getElementById('sustainVal');
const moveVal = document.getElementById('moveVal');
const moveThresholdVal = document.getElementById('moveThresholdVal');

const syncDot = document.getElementById('syncDot');
const syncText = document.getElementById('syncText');

// ---- State ----
let landmarker = null;
let running = false;
let rafId = null;
let muted = false;

let baselineAngle = null;
let baselineNeckRatio = null;
let lastMoveSampleAt = 0;
let lastMoveSamplePos = null;
let lastMovedAt = Date.now();
let slouchStartedAt = null;
let lastPostureNudgeAt = 0;
let lastFrameTime = performance.now();

let currentVoiceId = localStorage.getItem('plumb:voice') || voiceSelect.value;
voiceSelect.value = currentVoiceId;
let piperSession = null;
let piperSessionVoice = null;

// The library's built-in default points at a stale file on cdnjs that no
// longer resolves correctly. This pins it to a CDN mirror on the exact
// onnxruntime-web version actually bundled with the app, avoiding both the
// broken default and any version mismatch.
const PIPER_WASM_PATHS = {
  onnxWasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm'
};

const today = () => new Date().toISOString().slice(0, 10);
const LOG_KEY = (d) => `plumb:${d}`;

let stats = loadTodayStats();

function loadTodayStats() {
  const raw = localStorage.getItem(LOG_KEY(today()));
  if (raw) return JSON.parse(raw);
  return { date: today(), sessionSeconds: 0, slouchSeconds: 0, moveNudges: 0, postureNudges: 0 };
}

function saveStatsLocal() {
  localStorage.setItem(LOG_KEY(stats.date), JSON.stringify(stats));
}

function getAllStoredDays() {
  const days = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('plumb:')) days.push(JSON.parse(localStorage.getItem(key)));
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Cloud sync (write-only, anon key + RLS insert/update policy) ----
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
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify([
        {
          date: stats.date,
          session_seconds: Math.round(stats.sessionSeconds),
          slouch_seconds: Math.round(stats.slouchSeconds),
          posture_nudges: stats.postureNudges,
          move_nudges: stats.moveNudges,
          updated_at: new Date().toISOString()
        }
      ]),
      keepalive: true
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    setSyncStatus('ok', `Cloud sync: last synced ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.warn('Supabase sync failed:', err);
    setSyncStatus('err', 'Cloud sync: last attempt failed (will retry)');
  }
}

function saveStats() {
  saveStatsLocal();
  syncToSupabase();
}

// ---- Voice (Piper local neural TTS, with browser TTS as fallback) ----
async function ensurePiperVoice(voiceId) {
  if (piperSession && piperSessionVoice === voiceId) return true;
  try {
    testVoiceBtn.textContent = 'Loading voice…';
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
  try {
    const ok = await ensurePiperVoice(currentVoiceId);
    if (ok) {
      const wav = await piperSession.predict(text);
      const audio = new Audio(URL.createObjectURL(wav));
      audio.play();
      return;
    }
  } catch (err) {
    console.warn('Piper synthesis failed, falling back to browser voice:', err);
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
  }
}

const POSTURE_PHRASES = [
  "Shoulders back, chin level — you've drifted forward.",
  "Posture check — you're leaning into the screen again.",
  "Sit tall for a second, you've been slouching a while."
];
const MOVE_PHRASES = [
  "Time to stand up and shake it out for a minute.",
  "You've been still a while — a short walk would help.",
  "Get up and move — your body's been in one position too long."
];
let postureIdx = 0, moveIdx = 0;

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
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;
    placeholder.style.display = 'none';
    running = true;
    stopBtn.disabled = false;
    calibrateBtn.disabled = false;
    startBtn.textContent = 'Start camera';
    lastMovedAt = Date.now();
    lastFrameTime = performance.now();
    // prefetch the voice model in the background so the first nudge isn't delayed
    ensurePiperVoice(currentVoiceId);
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
  saveStats();
}

function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function forwardAngle(earMid, shoulderMid) {
  const dx = Math.abs(earMid.x - shoulderMid.x);
  const dy = shoulderMid.y - earMid.y;
  return Math.atan2(dx, Math.max(dy, 0.0001)) * (180 / Math.PI);
}

// Second slouch signal: how compressed the shoulder-to-ear gap is, relative to
// shoulder width (so it stays consistent even if you sit closer/further from
// the camera). Catches "sinking down" slouching that the angle alone misses.
function neckCompressionRatio(earMid, shoulderMid, leftSh, rightSh) {
  const gap = Math.max(shoulderMid.y - earMid.y, 0.0001);
  const shoulderWidth = Math.hypot(leftSh.x - rightSh.x, leftSh.y - rightSh.y) || 0.0001;
  return gap / shoulderWidth;
}

function updateGauge(deviation) {
  const clamped = Math.max(-40, Math.min(40, deviation));
  const angleDeg = (clamped / 40) * 90;
  needleGroup.setAttribute('transform', `rotate(${angleDeg} 110 110)`);
  gaugeReading.textContent =
    (baselineAngle === null ? '--' : (deviation >= 0 ? '+' : '') + deviation.toFixed(0)) + '°';
  const isAlert = baselineAngle !== null && deviation > Number(toleranceSlider.value);
  gaugeArc.setAttribute('stroke', isAlert ? 'var(--alert)' : 'var(--good)');
}

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
  statMoveNudges.textContent = stats.moveNudges;
  const sinceMove = Math.floor((Date.now() - lastMovedAt) / 1000);
  const mm = String(Math.floor(sinceMove / 60)).padStart(2, '0');
  const ss = String(sinceMove % 60).padStart(2, '0');
  statSinceMove.textContent = `${mm}:${ss}`;
}

function loop() {
  if (!running) return;
  const now = performance.now();
  const elapsedSec = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

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
    const angle = forwardAngle(earMid, shMid);

    stats.sessionSeconds += elapsedSec;

    if (baselineAngle === null) {
      updateGauge(0);
      setStatus('idle', 'Calibrate to begin tracking');
    } else {
      const deviation = angle - baselineAngle;
      updateGauge(deviation);
      const tolerance = Number(toleranceSlider.value);
      const sustainMs = Number(sustainSlider.value) * 1000;

      const neckRatio = neckCompressionRatio(earMid, shMid, leftSh, rightSh);
      const isCompressed = baselineNeckRatio !== null && neckRatio < baselineNeckRatio * 0.85;
      const isSlouching = deviation > tolerance || isCompressed;

      if (isSlouching) {
        stats.slouchSeconds += elapsedSec;
        if (slouchStartedAt === null) slouchStartedAt = Date.now();
        const slouchedFor = Date.now() - slouchStartedAt;
        setStatus('alert', `Slouching — ${Math.round(slouchedFor / 1000)}s`);
        if (slouchedFor > sustainMs && Date.now() - lastPostureNudgeAt > 120000) {
          speak(POSTURE_PHRASES[postureIdx % POSTURE_PHRASES.length]);
          postureIdx++;
          stats.postureNudges++;
          lastPostureNudgeAt = Date.now();
        }
      } else {
        slouchStartedAt = null;
        setStatus('good', 'Sitting well');
      }
    }

    if (now - lastMoveSampleAt > 1000) {
      if (lastMoveSamplePos) {
        const d = Math.hypot(shMid.x - lastMoveSamplePos.x, shMid.y - lastMoveSamplePos.y);
        const moveThreshold = Number(moveThresholdSlider.value) / 100; // slider is in "percent of frame"
        if (d > moveThreshold) lastMovedAt = Date.now();
      }
      lastMoveSamplePos = shMid;
      lastMoveSampleAt = now;
    }

    const moveReminderMs = Number(moveSlider.value) * 60000;
    if (Date.now() - lastMovedAt > moveReminderMs) {
      speak(MOVE_PHRASES[moveIdx % MOVE_PHRASES.length]);
      moveIdx++;
      stats.moveNudges++;
      lastMovedAt = Date.now();
    }
  } else {
    setStatus('idle', 'No person detected');
  }

  refreshStatDisplay();
  rafId = requestAnimationFrame(loop);
}

// ---- Wiring ----
setInterval(saveStats, 10000);
window.addEventListener('beforeunload', saveStats);

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

calibrateBtn.addEventListener('click', () => {
  const now = performance.now();
  const result = landmarker.detectForVideo(video, now);
  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    const earMid = midpoint(lm[7], lm[8]);
    const shMid = midpoint(lm[11], lm[12]);
    baselineAngle = forwardAngle(earMid, shMid);
    baselineNeckRatio = neckCompressionRatio(earMid, shMid, lm[11], lm[12]);
    gaugeCaption.textContent = `Calibrated at ${baselineAngle.toFixed(1)}° — sit like this for "good"`;
    speak("Calibrated. That's your good posture.");
  }
});

testVoiceBtn.addEventListener('click', () => speak('This is what a nudge sounds like.'));
muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = `Mute voice: ${muted ? 'on' : 'off'}`;
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

toleranceSlider.addEventListener('input', () => (toleranceVal.textContent = `${toleranceSlider.value}°`));
sustainSlider.addEventListener('input', () => (sustainVal.textContent = `${sustainSlider.value}s`));
moveSlider.addEventListener('input', () => (moveVal.textContent = `${moveSlider.value} min`));
moveThresholdSlider.addEventListener('input', () => (moveThresholdVal.textContent = `${moveThresholdSlider.value}%`));

setInterval(refreshStatDisplay, 1000);
