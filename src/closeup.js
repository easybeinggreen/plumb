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

export const CLOSEUP_THRESHOLDS = {
  centreOffset: 0.12,      // |screen x of nose - 0.5| before "off centre"
  eyeLineHigh: 0.22,       // eye line above this fraction of frame height = head near top edge
  eyeLineLow: 0.5,         // eye line below this = lots of empty space above the head
  eyeDistFar: 0.08,        // inter-eye distance / frame width below this = too far away
  eyeDistNear: 0.22,       // above this = too close
  tiltDeg: 5,              // matches ERGO_TILT_LEVEL_DEG
  faceDim: 0.25,           // mean face luminance (0-1)
  faceBright: 0.8,
  faceSkew: 0.12,          // matches LIGHT_SKEW_TOLERANCE
  backlight: 0.15,         // background brighter than face by this much
  glareLum: 0.95,          // pixel counts as blown out
  glareFraction: 0.04,     // fraction of face pixels blown out before flagging
  shoulderVisibility: 0.5
};

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
    add('headroom', 'headroom', 'fix', 'Your head is close to the top edge -- lower the camera or sit a little lower.');
  } else if (eyeMidY > T.eyeLineLow) {
    add('headroom', 'headroom', 'fix', 'Lots of empty space above your head -- raise the camera or sit up a little.');
  } else add('headroom', 'headroom', 'ok', 'Eye line sits in a good spot.');

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
