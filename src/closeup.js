// "Ready for my close-up": one-frame, fully local checks on framing and
// lighting before a video call. Pure function of (pose landmarks, a small
// grayscale luminance frame) so it can be tested without a camera.
//
// Coordinates: landmarks and `lum` are in the RAW video frame, which is NOT
// mirrored -- the on-screen self-view is. "screen left/right" below means
// what the person sees of themselves, i.e. raw x flipped.
//
// Every threshold is a first guess from general video-call framing advice
// (eyes roughly on the upper third, head-and-shoulders shot), NOT measured
// against real webcam data -- same honesty as ERGO_DIST_NEAR/FAR in main.js.
// Tune them from real use rather than trusting them.
//
// Deliberately NOT checked: camera too high/low (can't verify which way the
// error points without a real camera -- see PROJECT_NOTES.md), sharpness/lens
// smudge (no validated threshold), and anything needing to understand image
// content (hair, outfit, what's in the background) -- that needs a vision
// model, planned as a separate opt-in phase.

// Rough distance from eye spacing: a pinhole-camera estimate assuming an
// average adult inter-pupil distance (~63mm) and a typical laptop-webcam
// horizontal field of view (~65deg; real ones range ~60-90deg, which is
// where most of the error comes from). `eyeFrac` = eye-to-eye distance as a
// fraction of frame WIDTH. Good for "roughly 50 or 90cm?", not for precision.
export const WEBCAM_HFOV_DEG = 65;
export const IPD_M = 0.063;
export function estimateDistanceCm(eyeFrac) {
  if (!(eyeFrac > 0)) return null;
  const halfFov = (WEBCAM_HFOV_DEG * Math.PI) / 360;
  return (100 * IPD_M) / (2 * Math.tan(halfFov) * eyeFrac);
}

export const CLOSEUP_THRESHOLDS = {
  centreOffset: 0.12,      // |screen x of nose - 0.5| before "off centre"
  eyeLineHigh: 0.28,       // eye line above this fraction of frame height = head near top edge (also the top of the shaded guide band)
  eyeLineLow: 0.5,         // eye line below this = lots of empty space above the head (bottom of the guide band)
  eyeDistFar: 0.06,        // inter-eye distance / frame width below this (~80cm+) = too far away
  eyeDistNear: 0.14,       // above this (~35cm or closer) = too close
  tiltDeg: 5,              // head roll before "tilted" -- how you look on a call, not a desk-setup issue
  faceDim: 0.25,           // mean face luminance (0-1)
  faceBright: 0.8,
  faceSkew: 0.12,          // matches LIGHT_SKEW_TOLERANCE
  backlight: 0.15,         // background brighter than face by this much
  glareLum: 0.95,          // pixel counts as blown out
  glareFraction: 0.04,     // fraction of face pixels blown out before flagging
  shoulderVisibility: 0.5
};

// Mic check: `rmsDb` is one dBFS reading per short frame over a few seconds of
// the person speaking; `clippedFrames` counts frames with samples at full
// scale. Measured with the browser's echo-cancel/noise-suppress/auto-gain
// switched OFF so it reflects the raw device level -- call apps process the
// signal, so treat this as "is the hardware/OS level sensible", not a
// prediction of exactly how it sounds on a call. Thresholds are first guesses
// (typical laptop-mic speech sits roughly -30 to -20 dBFS, a quiet room
// roughly -60 to -50), not validated on real hardware.
export const MIC_THRESHOLDS = {
  silent: -60,       // p90 below this = basically nothing heard
  quiet: -40,        // p90 below this = too quiet
  loud: -8,          // p90 above this = too loud
  clipFrames: 3,
  noisyFloor: -45,   // p10 above this = noisy room
  minSnrDb: 20       // p90 - p10 below this = voice not clearly above background
};

function percentile(sorted, p) {
  if (!sorted.length) return -Infinity;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

export function analyzeMic({ rmsDb, clippedFrames = 0 }) {
  const T = MIC_THRESHOLDS;
  const sorted = rmsDb.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 10) return [{ id: 'mic-data', label: 'microphone', status: 'unknown', msg: "Didn't get enough audio -- try again." }];
  const voice = percentile(sorted, 0.9), floor = percentile(sorted, 0.1);
  const out = [];
  const add = (id, label, status, msg) => out.push({ id, label, status, msg });

  if (voice < T.silent) {
    add('mic-level', 'mic level', 'fix', "Couldn't hear anything -- check the right microphone is selected and not muted.");
  } else if (voice < T.quiet) {
    add('mic-level', 'mic level', 'fix', "You're coming through quietly -- move closer or raise the input volume in your system settings.");
  } else if (clippedFrames >= T.clipFrames || voice > T.loud) {
    add('mic-level', 'mic level', 'fix', "You're very loud or clipping -- lower the input volume or move back a little.");
  } else add('mic-level', 'mic level', 'ok', 'Voice level looks healthy.');

  if (voice >= T.silent) {
    if (floor > T.noisyFloor || voice - floor < T.minSnrDb) {
      add('mic-noise', 'background noise', 'fix', 'Your voice is not standing clearly above the background -- fans, traffic or a distant mic can do that.');
    } else add('mic-noise', 'background noise', 'ok', 'Background is quiet enough.');
  }
  return out;
}

function boxMean(lum, w, h, x0, y0, x1, y1) {
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(w, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(h, Math.ceil(y1));
  let sum = 0, n = 0;
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { sum += lum[y * w + x]; n++; }
  return n ? { mean: sum / n, n } : null;
}

export function analyzeCloseup({ lm, lum, w, h }) {
  const T = CLOSEUP_THRESHOLDS;
  if (!lm) return [{ id: 'presence', label: 'in frame', status: 'unknown', msg: "Can't see you clearly -- sit into frame and check again." }];

  const nose = lm[0], lEye = lm[2], rEye = lm[5], lSh = lm[11], rSh = lm[12];
  const results = [];
  const add = (id, label, status, msg) => results.push({ id, label, status, msg });

  const dxPx = (lEye.x - rEye.x) * w, dyPx = (lEye.y - rEye.y) * h;
  const eyeDistPx = Math.hypot(dxPx, dyPx);
  const eyeMidY = (lEye.y + rEye.y) / 2;

  // Position: screen x = 1 - raw x. Left of centre in the picture means
  // moving to your own right brings you back (the self-view is mirrored).
  const screenX = 1 - nose.x;
  const off = screenX - 0.5;
  if (Math.abs(off) > T.centreOffset) {
    add('centre', 'centred', 'fix', off < 0
      ? "You're left of centre in the picture -- shift a little to your right."
      : "You're right of centre in the picture -- shift a little to your left.");
  } else add('centre', 'centred', 'ok', 'Nicely centred.');

  if (eyeMidY < T.eyeLineHigh) {
    add('headroom', 'eye height', 'fix', 'Your eyes are too high in the picture (head near the top edge) -- lower the camera or sit a little lower.');
  } else if (eyeMidY > T.eyeLineLow) {
    add('headroom', 'eye height', 'fix', 'Your eyes are too low in the picture (lots of empty space above your head) -- raise the camera or sit up a little.');
  } else add('headroom', 'eye height', 'ok', 'Eyes are in the shaded band -- good.');

  const eyeFrac = eyeDistPx / w;
  const shouldersOk = [lSh, rSh].every(p => p && (typeof p.visibility !== 'number' || p.visibility >= T.shoulderVisibility) && p.y < 0.98);
  if (eyeFrac < T.eyeDistFar) add('distance', 'distance', 'fix', "You look a long way from the camera -- sit a bit closer.");
  else if (eyeFrac > T.eyeDistNear) add('distance', 'distance', 'fix', 'Quite close to the camera -- sit back a little.');
  else if (!shouldersOk) add('distance', 'distance', 'fix', 'Your shoulders are cut off -- sit back a little so head and shoulders are both in view.');
  else add('distance', 'distance', 'ok', 'Head-and-shoulders framing looks right.');

  // Fold the eye-line angle into 0-90 so it doesn't matter which eye landmark
  // lands on which side of the raw frame.
  const ang = ((Math.atan2(dyPx, dxPx) * 180 / Math.PI) % 180 + 180) % 180;
  const tiltAbs = Math.min(ang, 180 - ang);
  if (tiltAbs > T.tiltDeg) add('tilt', 'head level', 'fix', `Head looks tilted about ${Math.round(tiltAbs)}° -- level it out or check the camera isn't crooked.`);
  else add('tilt', 'head level', 'ok', 'Head looks level.');

  if (!lum || !w || !h) return results;

  const cx = nose.x * w, cy = eyeMidY * h + 0.5 * eyeDistPx;
  const hw = 1.2 * eyeDistPx, hh = 1.7 * eyeDistPx;
  const face = boxMean(lum, w, h, cx - hw, cy - hh, cx + hw, cy + hh);
  if (!face || face.n < 20) return results;

  if (face.mean < T.faceDim) add('face-light', 'face brightness', 'fix', 'Your face is on the dark side -- add a lamp or face a window.');
  else if (face.mean > T.faceBright) add('face-light', 'face brightness', 'fix', 'Your face is very bright and may look washed out -- ease the light or turn away from it.');
  else add('face-light', 'face brightness', 'ok', 'Face brightness looks fine.');

  // Screen-left half of the face box is the RAW right half.
  const rawLeft = boxMean(lum, w, h, cx - hw, cy - hh, cx, cy + hh);
  const rawRight = boxMean(lum, w, h, cx, cy - hh, cx + hw, cy + hh);
  if (rawLeft && rawRight) {
    const skew = rawLeft.mean - rawRight.mean; // >0 = brighter on screen-right
    if (Math.abs(skew) > T.faceSkew) {
      add('even-light', 'even lighting', 'fix', `One side of your face is noticeably brighter (${skew > 0 ? 'right' : 'left'} side) -- a second light source or a blind on that side evens it out.`);
    } else add('even-light', 'even lighting', 'ok', 'Light falls evenly across your face.');
  }

  const bgLeft = boxMean(lum, w, h, 0, 0, w * 0.15, h * 0.6);
  const bgRight = boxMean(lum, w, h, w * 0.85, 0, w, h * 0.6);
  if (bgLeft && bgRight) {
    const bg = (bgLeft.mean + bgRight.mean) / 2;
    if (bg - face.mean > T.backlight) add('backlight', 'backlight', 'fix', "It's brighter behind you than on your face -- a window or lamp behind you can turn you into a silhouette.");
    else add('backlight', 'backlight', 'ok', 'Background is not overpowering your face.');
  }

  let blown = 0, total = 0;
  for (let y = Math.max(0, Math.floor(cy - hh)); y < Math.min(h, Math.ceil(cy + hh)); y++) {
    for (let x = Math.max(0, Math.floor(cx - hw)); x < Math.min(w, Math.ceil(cx + hw)); x++) {
      total++;
      if (lum[y * w + x] >= T.glareLum) blown++;
    }
  }
  if (total && blown / total > T.glareFraction) add('glare', 'glare', 'fix', 'Bright hot spots on your face or glasses -- soften or reposition the light.');
  else add('glare', 'glare', 'ok', 'No obvious glare or shine.');

  return results;
}
