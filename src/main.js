import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as piperTTS from '@mintplex-labs/piper-tts-web';

// ---- Supabase config (safe to expose — protected by RLS) ----
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
const exportBtn = document.getElementById('exportBtn');
const voiceSelect = document.getElementById('voiceSelect');

const statusCard = document.getElementById('statusCard');
const statusValue = document.getElementById('statusValue');

// Old gauge elements – we’ll keep them but they will no longer be updated
const gaugeReading = document.getElementById('gaugeReading');
const gaugeCaption = document.getElementById('gaugeCaption');
const needleGroup = document.getElementById('needleGroup');
const gaugeArc = document.getElementById('gaugeArc');

// New 2D posture map canvas (add this to your HTML)
const postureMap = document.getElementById('postureMap');
const pmCtx = postureMap.getContext('2d');

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

let baselineAngle = null;        // forward head angle (old gauge)
let baselineNeckRatio = null;
let baselineLateral = null;      // lateral deviation (new map)
let baselineForward = null;      // forward lean z-diff (new map)

let lastMoveSampleAt = 0;
let lastMoveSamplePos = null;
let lastMovedAt = Date.now();
let slouchStartedAt = null;
let lastPostureNudgeAt = 0;
let lastMoveNudgeAt = 0;         // for move nudge cooldown
let lastFrameTime = performance.now();

let currentVoiceId = localStorage.getItem('plumb:voice') || voiceSelect.value;
voiceSelect.value = currentVoiceId;
let piperSession = null;
let piperSessionVoice = null;

// Audio context for reliable playback
let audioCtx = null;

// Piper WASM paths (keep your current config)
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
          move_nudges: stats.moveNudges,
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

function saveStats() {
  saveStatsLocal();
  syncToSupabase();
}

// ---- Audio unlock and voice ----
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

// Unlock audio on first user interaction (Start camera click or Test voice)
document.addEventListener('click', ensureAudioUnlocked, { once: true });

async function ensurePiperVoice(voiceId) {
  if (piperSession && piperSessionVoice === voiceId) return true;
  try {
    testVoiceBtn.textContent = 'Loading voice…';
    // Force single‑threaded WASM to avoid cross‑origin isolation issues
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

// ---- Math helpers ----
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }

function forwardAngle(earMid, shoulderMid) {
  const dx = earMid.x - shoulderMid.x;   // signed!
  const dy = shoulderMid.y - earMid.y;
  return Math.atan2(dx, Math.max(dy, 0.0001)) * (180 / Math.PI);
}

function neckCompressionRatio(earMid, shoulderMid, leftSh, rightSh) {
  const gap = Math.max(shoulderMid.y - earMid.y, 0.0001);
  const shoulderWidth = Math.hypot(leftSh.x - rightSh.x, leftSh.y - rightSh.y) || 0.0001;
  return gap / shoulderWidth;
}

function lateralDeviation(earMid, shMid, leftSh, rightSh) {
  const shoulderWidth = Math.hypot(leftSh.x - rightSh.x, leftSh.y - rightSh.y) || 0.0001;
  return (earMid.x - shMid.x) / shoulderWidth; // negative = left, positive = right
}

function forwardDeviation(nose, shMid) {
  // z: usually -1 (far) to 1 (close)
  return nose.z - shMid.z; // positive = nose closer (leaning forward)
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
    // Wait for metadata so canvas has correct dimensions
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
    lastMovedAt = Date.now();
    lastFrameTime = performance.now();
    // Prefetch voice model
    ensurePiperVoice(currentVoiceId);
    // Ensure audio is unlocked (already done on first click, but safe to call again)
    await ensureAudioUnlocked();
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

// ---- UI update helpers ----
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

function drawPostureMap(lateral, forward) {
  const w = postureMap.width, h = postureMap.height;
  pmCtx.clearRect(0, 0, w, h);
  
  // Crosshair
  pmCtx.strokeStyle = '#ccc';
  pmCtx.lineWidth = 1;
  pmCtx.beginPath();
  pmCtx.moveTo(w/2, 0); pmCtx.lineTo(w/2, h);
  pmCtx.moveTo(0, h/2); pmCtx.lineTo(w, h/2);
  pmCtx.stroke();
  
  // Scale: max displacement 45% of canvas
  const scaleX = w * 0.45;
  const scaleY = h * 0.45;
  const dotX = w/2 + lateral * scaleX * 2;   // sensitivity multiplier
  const dotY = h/2 - forward * scaleY * 2;
  
  const clampedX = Math.max(8, Math.min(w-8, dotX));
  const clampedY = Math.max(8, Math.min(h-8, dotY));
  
  const distFromCenter = Math.hypot((clampedX - w/2)/scaleX, (clampedY - h/2)/scaleY);
  pmCtx.fillStyle = distFromCenter > 0.5 ? '#C0492F' : distFromCenter > 0.25 ? '#C98A2C' : '#2C6E8E';
  pmCtx.beginPath();
  pmCtx.arc(clampedX, clampedY, 7, 0, 2*Math.PI);
  pmCtx.fill();
  
  // Optionally label axes
  pmCtx.fillStyle = '#57676C';
  pmCtx.font = '10px sans-serif';
  pmCtx.textAlign = 'center';
  pmCtx.fillText('Left', 10, h/2 + 3);
  pmCtx.fillText('Right', w-10, h/2 + 3);
  pmCtx.fillText('Forward', w/2, 12);
  pmCtx.fillText('Back', w/2, h-4);
}

// ---- Main tracking loop ----
function loop() {
  if (!running) return;
  const now = performance.now();
  // Cap elapsed time to avoid massive jumps (e.g., after tab is hidden)
  const elapsedSec = Math.min((now - lastFrameTime) / 1000, 0.5);
  lastFrameTime = now;

  const result = landmarker.detectForVideo(video, now);
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    const leftEar = lm[7], rightEar = lm[8], leftSh = lm[11], rightSh = lm[12];
    const nose = lm[0];

    ctx.fillStyle = 'rgba(44,110,142,0.9)';
    [leftEar, rightEar, leftSh, rightSh].forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * overlay.width, p.y * overlay.height, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    const earMid = midpoint(leftEar, rightEar);
    const shMid = midpoint(leftSh, rightSh);
    const angle = forwardAngle(earMid, shMid); // signed lateral angle

    stats.sessionSeconds += elapsedSec;

    if (baselineAngle === null) {
      // Still update the 2D map with raw deviations (not yet calibrated)
      const rawLateral = lateralDeviation(earMid, shMid, leftSh, rightSh);
      const rawForward = forwardDeviation(nose, shMid);
      drawPostureMap(rawLateral, rawForward);
      setStatus('idle', 'Calibrate to begin tracking');
    } else {
      const lateral = lateralDeviation(earMid, shMid, leftSh, rightSh) - baselineLateral;
      const forward = forwardDeviation(nose, shMid) - baselineForward;
      drawPostureMap(lateral, forward);

      const tolerance = Number(toleranceSlider.value);
      const sustainMs = Number(sustainSlider.value) * 1000;

      // Slouch detection: lateral (absolute) > tolerance OR neck compression
      const isLateralSlouch = Math.abs(lateral) > tolerance * 0.02; // scale lateral threshold (0.02 is approximate)
      const neckRatio = neckCompressionRatio(earMid, shMid, leftSh, rightSh);
      const isCompressed = baselineNeckRatio !== null && neckRatio < baselineNeckRatio * 0.85;
      const isSlouching = isLateralSlouch || isCompressed;

      if (isSlouching) {
        stats.slouchSeconds += elapsedSec;
        if (slouchStartedAt === null) slouchStartedAt = Date.now();
        const slouchedFor = Date.now() - slouchStartedAt;
        setStatus('alert', `Slouching — ${Math.round(slouchedFor / 1000)}s`);
        // Posture nudge cooldown set to 30 seconds for testing (adjust as needed)
        if (slouchedFor > sustainMs && Date.now() - lastPostureNudgeAt > 30000) {
          console.log('Posture nudge fired at', new Date().toLocaleTimeString());
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

    // Movement detection (independent of calibration)
    if (now - lastMoveSampleAt > 1000) {
      if (lastMoveSamplePos) {
        const d = Math.hypot(shMid.x - lastMoveSamplePos.x, shMid.y - lastMoveSamplePos.y);
        const moveThreshold = Number(moveThresholdSlider.value) / 100;
        if (d > moveThreshold) {
          lastMovedAt = Date.now();
        }
      }
      lastMoveSamplePos = shMid;
      lastMoveSampleAt = now;
    }

    const moveReminderMs = Number(moveSlider.value) * 60000;
    // Move nudge cooldown (60s) to prevent repetitive alerts
    if (Date.now() - lastMovedAt > moveReminderMs && Date.now() - lastMoveNudgeAt > 60000) {
      console.log('Move nudge fired at', new Date().toLocaleTimeString());
      speak(MOVE_PHRASES[moveIdx % MOVE_PHRASES.length]);
      moveIdx++;
      stats.moveNudges++;
      lastMoveNudgeAt = Date.now();
      lastMovedAt = Date.now(); // reset timer after nudge
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
    const nose = lm[0];

    baselineAngle = forwardAngle(earMid, shMid);
    baselineNeckRatio = neckCompressionRatio(earMid, shMid, lm[11], lm[12]);
    baselineLateral = lateralDeviation(earMid, shMid, lm[11], lm[12]);
    baselineForward = forwardDeviation(nose, shMid);

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
