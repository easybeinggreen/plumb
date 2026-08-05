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
const breakToggleBtn = document.getElementById('breakToggleBtn');
const testVoiceBtn = document.getElementById('testVoiceBtn');
const muteBtn = document.getElementById('muteBtn');
const bgAudioBtn = document.getElementById('bgAudioBtn');
const reportBtn = document.getElementById('reportBtn');
const voiceSelect = document.getElementById('voiceSelect');
const voiceReady = document.getElementById('voiceReady');

const statusCard = document.getElementById('statusCard');
const statusValue = document.getElementById('statusValue');

const postureMap = document.getElementById('postureMap');
const pmCtx = postureMap.getContext('2d');
const gaugeCaption = document.getElementById('gaugeCaption');

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
let currentChart = null;

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
let slouchType = null;
let lastPostureNudgeAt = 0;

// Break / presence
let presenceStart = null;
let isPersonPresent = false;
let lastBreakEnd = null;
let breakStart = null;
let breaksTaken = 0;
let lastBreakNudgeAt = 0;
let manualBreak = false;        // true when break was manually started
let breakActive = false;        // true when currently on break (manual or automatic)
const BREAK_MIN_SECONDS = 15;   // minimum absence to count as break

// Event buffer
let eventBuffer = [];

// Audio
let audioCtx = null;
let silentAudioEl = null;

// Voice
let currentVoiceId = localStorage.getItem('plumb:voice') || '';
let piperSession = null;
let piperSessionVoice = null;

const PIPER_WASM_PATHS = {
  onnxWasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm'
};

// Local date helper
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const LOG_KEY = (d) => `plumb:${d}`;
const LAST_SESSION_END_KEY = 'plumb:lastSessionEnd';

let stats = loadTodayStats();

// ---- Multi-device merge ----
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
  if (alertFeed.children.length === 1 && alertFeed.children[0].innerText === 'No alerts yet') alertFeed.innerHTML = '';
  alertFeed.insertBefore(item, alertFeed.firstChild);
  while (alertFeed.children.length > 15) alertFeed.removeChild(alertFeed.lastChild);
}

// ---- Event logging ----
function logSlouchEvent(type, startTime, endTime) {
  const dur = Math.round((endTime - startTime)/1000);
  if (dur <= 0) return;
  eventBuffer.push({ date: today(), start_time: new Date(startTime).toISOString(), end_time: new Date(endTime).toISOString(), type, duration_seconds: dur });
}
function logBreakEvent(startTime, endTime) {
  const dur = Math.round((endTime - startTime)/1000);
  if (dur <= 0) return;
  eventBuffer.push({ date: today(), start_time: new Date(startTime).toISOString(), end_time: new Date(endTime).toISOString(), type: 'break', duration_seconds: dur });
}
function logCalibrationEvent() {
  eventBuffer.push({ date: today(), start_time: new Date().toISOString(), end_time: new Date().toISOString(), type: 'calibration', duration_seconds: 0 });
}

// Retrospective break
function logRetrospectiveBreak() {
  const lastEnd = localStorage.getItem(LAST_SESSION_END_KEY);
  if (!lastEnd) return;
  const gap = (Date.now() - new Date(lastEnd).getTime()) / 1000;
  if (gap >= BREAK_MIN_SECONDS) {
    logBreakEvent(new Date(lastEnd).getTime(), Date.now());
    breaksTaken++;
  }
}

// ---- Break control ----
function startBreak(manual = false) {
  if (breakActive) return;
  breakActive = true;
  manualBreak = manual;
  breakStart = Date.now();
  if (slouchStartedAt !== null) { logSlouchEvent(slouchType, slouchStartedAt, Date.now()); slouchStartedAt = null; slouchType = null; }
  addAlertToFeed('break', manual ? 'Manual break started' : 'Break started (camera lost)');
  breakToggleBtn.textContent = 'End break';
  breakToggleBtn.style.backgroundColor = '#C98A2C';
}
function endBreak() {
  if (!breakActive || !breakStart) return;
  const end = Date.now();
  const dur = (end - breakStart) / 1000;
  if (dur >= BREAK_MIN_SECONDS) {
    logBreakEvent(breakStart, end);
    breaksTaken++;
  }
  breakActive = false;
  manualBreak = false;
  breakStart = null;
  breakToggleBtn.textContent = 'Take a break';
  breakToggleBtn.style.backgroundColor = '';
  addAlertToFeed('break', 'Break ended');
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
  bgAudioBtn.textContent = 'Background audio: on';
}
function stopBgSilentAudio() { if (silentAudioEl) silentAudioEl.pause(); bgAudioEnabled = false; bgAudioBtn.textContent = 'Allow background audio'; }

// ---- Voice ----
function updateVoiceReady(ready) {
  voiceReady.classList.toggle('ready', ready);
}
async function ensurePiperVoice(voiceId) {
  if (piperSession && piperSessionVoice === voiceId) return true;
  try {
    testVoiceBtn.textContent = 'Loading voice…';
    try { Object.defineProperty(navigator, 'hardwareConcurrency', { value:1, configurable:true }); } catch(e){}
    piperSession = await piperTTS.TtsSession.create({
      voiceId, wasmPaths: PIPER_WASM_PATHS,
      progress: p => { testVoiceBtn.textContent = `Downloading… ${Math.round(p.loaded*100/p.total)}%`; }
    });
    await piperSession.waitReady;
    piperSessionVoice = voiceId;
    testVoiceBtn.textContent = 'Test voice';
    updateVoiceReady(true);
    return true;
  } catch(err) { console.warn('Piper:', err); testVoiceBtn.textContent = 'Test voice'; updateVoiceReady(false); return false; }
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
const WELCOME_BACK_SHORT = ["Welcome back — short break.", "Quick break, good to see you."];
const WELCOME_BACK_LONG = ["Welcome back — nice long break.", "Great break — you're refreshed."];
let leftIdx = 0, rightIdx = 0, slumpIdx = 0, breakIdx = 0, welcomeIdx = 0;

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
  startBtn.disabled = true; startBtn.textContent = 'Loading…';
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
    stopBtn.disabled = false; calibrateBtn.disabled = false; breakToggleBtn.disabled = false;
    startBtn.textContent = 'Camera started'; startBtn.style.backgroundColor = '#2C6E8E'; startBtn.style.borderColor = '#2C6E8E'; startBtn.disabled = true;
    calibrateBtn.textContent = 'Calibrate posture'; calibrateBtn.style.backgroundColor = '#C0492F'; calibrateBtn.style.borderColor = '#C0492F';
    breakToggleBtn.textContent = 'Take a break'; breakToggleBtn.style.backgroundColor = '';
    lastFrameTime = performance.now();
    logRetrospectiveBreak();
    await mergeRemoteStats();
    presenceStart = null; lastBreakEnd = Date.now(); breakStart = null; isPersonPresent = false; breaksTaken = stats.breaksTaken; breakActive = false; manualBreak = false;
    ensurePiperVoice(currentVoiceId); await ensureAudioUnlocked();
    if (bgAudioEnabled) startBgSilentAudio();
    loop();
  } catch(err) {
    placeholder.textContent = `Camera error: ${err.message}`;
    startBtn.disabled = false; startBtn.textContent = 'Start camera'; startBtn.style.backgroundColor = ''; startBtn.style.borderColor = '';
  }
}

function stopCamera() {
  running = false; if (rafId) cancelAnimationFrame(rafId);
  if (slouchStartedAt !== null) { logSlouchEvent(slouchType, slouchStartedAt, Date.now()); slouchStartedAt = null; slouchType = null; }
  localStorage.setItem(LAST_SESSION_END_KEY, new Date().toISOString());
  if (video.srcObject) { video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject = null; }
  placeholder.style.display = 'flex'; placeholder.textContent = 'Camera off. Click Start camera.';
  stopBtn.disabled = true; calibrateBtn.disabled = true; breakToggleBtn.disabled = true;
  startBtn.disabled = false; startBtn.textContent = 'Start camera'; startBtn.style.backgroundColor = ''; startBtn.style.borderColor = '';
  calibrateBtn.textContent = 'Calibrate good posture'; calibrateBtn.style.backgroundColor = ''; calibrateBtn.style.borderColor = '';
  breakToggleBtn.textContent = 'Take a break'; breakToggleBtn.style.backgroundColor = '';
  if (breakActive) endBreak();
  stopBgSilentAudio(); saveStats();
}

// ---- Camera picker (unchanged) ----
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
function setStatus(mode, text) { statusCard.classList.remove('good','alert','idle'); statusCard.classList.add(mode); statusValue.textContent = text; }

function drawPostureMap(lateral, compression) {
  const w = postureMap.width, h = postureMap.height;
  pmCtx.clearRect(0,0,w,h);
  // Draw tolerance rings
  const latTol = Number(toleranceSlider.value) * w * 0.9;   // scale to canvas
  const compTol = Number(compressionToleranceSlider.value) * h * 0.9;
  pmCtx.strokeStyle = '#ccc'; pmCtx.lineWidth = 1;
  pmCtx.setLineDash([4,4]);
  pmCtx.beginPath(); pmCtx.ellipse(w/2, h/2, latTol, compTol, 0, 0, 2*Math.PI); pmCtx.stroke();
  pmCtx.setLineDash([]);
  // Crosshair
  pmCtx.strokeStyle = '#ddd'; pmCtx.beginPath(); pmCtx.moveTo(w/2,0); pmCtx.lineTo(w/2,h); pmCtx.moveTo(0,h/2); pmCtx.lineTo(w,h/2); pmCtx.stroke();
  // Dot
  const scaleX = w*0.45, scaleY = h*0.45;
  const dotX = w/2 - lateral * scaleX*2;
  const dotY = h/2 + compression * scaleY*5;
  const cx = Math.max(6, Math.min(w-6, dotX)), cy = Math.max(6, Math.min(h-6, dotY));
  const outLat = Math.abs(lateral) > latTol/(scaleX*2), outComp = compression > compTol/(scaleY*5);
  const color = (outLat && outComp) ? '#C0492F' : (outLat || outComp) ? '#C98A2C' : '#27AE60';
  pmCtx.fillStyle = color; pmCtx.beginPath(); pmCtx.arc(cx, cy, 6, 0, 2*Math.PI); pmCtx.fill();
  // Axis labels
  pmCtx.fillStyle = '#888'; pmCtx.font = '9px sans-serif'; pmCtx.textAlign = 'center';
  pmCtx.fillText('L', 10, h/2+3); pmCtx.fillText('R', w-10, h/2+3);
  pmCtx.fillText('Tall', w/2, 10); pmCtx.fillText('Slump', w/2, h-4);
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

    // Presence update
    if (!isPersonPresent) {
      // person just appeared
      if (breakActive) {
        // if automatic break (camera lost) and person returned, end break
        if (!manualBreak && breakStart) {
          const gap = (Date.now() - breakStart)/1000;
          if (gap >= BREAK_MIN_SECONDS) {
            logBreakEvent(breakStart, Date.now());
            breaksTaken++;
            const mins = Math.round(gap/60);
            const msg = mins >=5 ? WELCOME_BACK_LONG[welcomeIdx%WELCOME_BACK_LONG.length] : WELCOME_BACK_SHORT[welcomeIdx%WELCOME_BACK_SHORT.length];
            speak(msg); addAlertToFeed('break', `Break ended (${mins}m)`); welcomeIdx++;
          }
        }
        endBreak();
      }
      isPersonPresent = true;
      presenceStart = Date.now();
      lastBreakEnd = Date.now();
    }

    // if currently on manual break, skip slouch tracking
    if (breakActive) {
      setStatus('idle', 'On break');
      rafId = requestAnimationFrame(loop);
      return;
    }

    stats.sessionSeconds += dt;

    const lateral = baselineLateral!==null ? lateralDeviation(earMid,shMid,leftSh,rightSh) - baselineLateral : 0;
    const neckRatio = neckCompressionRatio(earMid,shMid,leftSh,rightSh);
    const compression = baselineNeckRatio!==null ? baselineNeckRatio - neckRatio : 0;

    drawPostureMap(lateral, compression);

    if (baselineLateral===null || baselineNeckRatio===null) {
      setStatus('idle', 'Calibrate to begin');
    } else {
      const latTol = Number(toleranceSlider.value), compTol = Number(compressionToleranceSlider.value), sus = Number(sustainSlider.value)*1000;
      const leftLean = lateral > latTol, rightLean = lateral < -latTol, comp = compression > compTol;
      const isSlouching = leftLean || rightLean || comp;
      const currentType = leftLean ? 'lateral_left' : rightLean ? 'lateral_right' : comp ? 'compression' : null;

      if (isSlouching) {
        stats.slouchSeconds += dt;
        if (!slouchStartedAt) { slouchStartedAt = Date.now(); slouchType = currentType; }
        const dur = Date.now() - slouchStartedAt;
        setStatus('alert', `Slouching — ${Math.round(dur/1000)}s`);
        if (dur > sus && Date.now() - lastPostureNudgeAt > 5000) {
          let phrase;
          if (currentType==='compression') { phrase = SLUMP_PHRASES[slumpIdx%SLUMP_PHRASES.length]; slumpIdx++; }
          else if (currentType==='lateral_left') { phrase = LEFT_PHRASES[leftIdx%LEFT_PHRASES.length]; leftIdx++; }
          else { phrase = RIGHT_PHRASES[rightIdx%RIGHT_PHRASES.length]; rightIdx++; }
          speak(phrase); addAlertToFeed(currentType, phrase); stats.postureNudges++; lastPostureNudgeAt = Date.now();
        }
      } else {
        if (slouchStartedAt) { logSlouchEvent(slouchType, slouchStartedAt, Date.now()); slouchStartedAt = null; slouchType = null; }
        setStatus('good', 'Sitting well');
      }

      if (presenceStart && !breakActive) {
        const cont = (Date.now() - presenceStart)/60000;
        if (cont >= Number(breakSlider.value) && Date.now() - lastBreakNudgeAt > 60000) {
          const p = BREAK_PROMPT_PHRASES[breakIdx% BREAK_PROMPT_PHRASES.length]; breakIdx++;
          speak(p); addAlertToFeed('break_prompt', p); stats.breakNudges++; lastBreakNudgeAt = Date.now();
        }
      }
    }
  } else {
    // No person detected
    if (isPersonPresent && !breakActive) {
      // person just left
      if (slouchStartedAt) { logSlouchEvent(slouchType, slouchStartedAt, Date.now()); slouchStartedAt = null; }
      breakStart = Date.now();
      isPersonPresent = false;
      setStatus('idle', 'No person detected');
      // auto break will start after BREAK_MIN_SECONDS of continuous absence
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

// ---- Calibration ----
calibrateBtn.addEventListener('click', () => {
  const result = landmarker.detectForVideo(video, performance.now());
  if (result.landmarks && result.landmarks.length>0) {
    const lm = result.landmarks[0];
    const earMid = midpoint(lm[7],lm[8]), shMid = midpoint(lm[11],lm[12]);
    baselineNeckRatio = neckCompressionRatio(earMid, shMid, lm[11], lm[12]);
    baselineLateral = lateralDeviation(earMid, shMid, lm[11], lm[12]);
    gaugeCaption.textContent = 'Posture calibrated.';
    speak("Calibrated. That's your good posture.");
    addAlertToFeed('calibration', 'Posture calibrated'); logCalibrationEvent();
    calibrateBtn.textContent = 'Posture calibrated'; calibrateBtn.style.backgroundColor='#2C6E8E'; calibrateBtn.style.borderColor='#2C6E8E';
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

// ---- Report modal ----
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
  else if (range==='week') { const d=new Date(curDate+'T00:00:00'); d.setDate(d.getDate()-6); start=d.toISOString().slice(0,10); end=curDate; }
  else if (range==='month') { const d=new Date(curDate+'T00:00:00'); d.setDate(d.getDate()-29); start=d.toISOString().slice(0,10); end=curDate; }

  const events = await fetchEventsForRange(start, end);
  const logs = await fetchDailyLogs(start, end);

  // pre-populate all dates in range
  const dateMap = {};
  const d = new Date(start+'T00:00:00');
  while (d.toISOString().slice(0,10) <= end) {
    const ds = d.toISOString().slice(0,10);
    dateMap[ds] = { break:0, left:0, right:0, slump:0, breaks:0, sessionSeconds:0 };
    d.setDate(d.getDate()+1);
  }
  events.forEach(e => {
    const ds = e.date;
    if (!dateMap[ds]) dateMap[ds] = { break:0, left:0, right:0, slump:0, breaks:0, sessionSeconds:0 };
    const dur = e.duration_seconds||0;
    if (e.type==='break') { dateMap[ds].break += dur; dateMap[ds].breaks++; }
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

  // summary
  let totalBreak = 0, totalSession = 0, totalSlouch = 0, totalBreaks = 0;
  Object.values(dateMap).forEach(day => {
    totalBreak += day.break; totalSession += day.sessionSeconds; totalSlouch += day.left+day.right+day.slump; totalBreaks += day.breaks;
  });
  const overall = totalBreak + totalSession;
  const slouchPct = overall ? Math.round(totalSlouch / overall * 100) : 0;
  const avgBreak = totalBreaks ? Math.round(totalBreak / totalBreaks / 60) : 0;
  reportSummary.innerHTML = `
    <div class="metric"><div class="value">${Math.round(overall/60)}m</div><div class="label">Monitored</div></div>
    <div class="metric"><div class="value">${slouchPct}%</div><div class="label">Slouch</div></div>
    <div class="metric"><div class="value">${totalBreaks}</div><div class="label">Breaks</div></div>
    <div class="metric"><div class="value">${avgBreak}m</div><div class="label">Avg break</div></div>
  `;

  if (currentChart) currentChart.destroy();
  currentChart = new Chart(slouchChartCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Break', data:breakMin, backgroundColor:'#B0BEC5' },
        { label:'Good posture', data:goodMin, backgroundColor:'#27AE60' },
        { label:'Slouch left', data:leftMin, backgroundColor:'#E74C3C' },
        { label:'Slouch right', data:rightMin, backgroundColor:'#F39C12' },
        { label:'Slump', data:slumpMin, backgroundColor:'#8E44AD' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      scales: { x:{ stacked:true }, y:{ stacked:true, title:{ display:true, text:'Minutes' } } },
      plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} min` } } }
    }
  });
}

reportBtn.addEventListener('click', () => {
  modalOverlay.classList.add('open');
  const activeTab = document.querySelector('.tab.active');
  showReport(activeTab ? activeTab.dataset.range : 'today');
});
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
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
testVoiceBtn.addEventListener('click', () => speak('This is what a nudge sounds like.'));
muteBtn.addEventListener('click', () => { muted = !muted; muteBtn.textContent = muted ? 'Unmute' : 'Mute'; });
bgAudioBtn.addEventListener('click', () => { if(bgAudioEnabled) stopBgSilentAudio(); else startBgSilentAudio(); });

toleranceSlider.addEventListener('input', () => toleranceVal.textContent = toleranceSlider.value);
compressionToleranceSlider.addEventListener('input', () => compressionToleranceVal.textContent = compressionToleranceSlider.value);
sustainSlider.addEventListener('input', () => sustainVal.textContent = `${sustainSlider.value}s`);
breakSlider.addEventListener('input', () => breakVal.textContent = `${breakSlider.value} min`);
