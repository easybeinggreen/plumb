// Pure logic for the calibration baseline, kept free of the DOM so it can be
// tested with real numbers. A "sample" is the five raw measurements taken from
// one frame's landmarks: { t, lateral, neck, shoulderWidth, eyeDist, noseY }.

export const CALIBRATION_WINDOW_MS = 2000;   // calibrating uses the median of the last 2s of frames
export const CALIBRATION_MIN_SAMPLES = 8;    // fewer than this and we fall back to a single frame
export const CALIBRATION_MAX_AGE_MS = 500;   // the newest sample must be this fresh
export const NOSE_REBASE_SETTLE_MS = 5000;   // after a break, wait for them to sit down before measuring
export const NOSE_REBASE_MAX_SHIFT_TOLS = 2; // a sitting-height shift bigger than 2x the tolerance is not "sat a bit differently"

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Drop samples older than the window, so the buffer never grows.
export function pruneSamples(samples, now, windowMs = CALIBRATION_WINDOW_MS) {
  return samples.filter((s) => now - s.t <= windowMs);
}

// The median of each measurement over the recent window, or null if there is
// not enough fresh data (caller then falls back to a single frame). The median
// rather than the mean, so one blip frame cannot pull the baseline.
export function baselineFromSamples(samples, now) {
  const recent = pruneSamples(samples, now);
  if (recent.length < CALIBRATION_MIN_SAMPLES) return null;
  if (now - recent[recent.length - 1].t > CALIBRATION_MAX_AGE_MS) return null;
  const b = {
    lateral: median(recent.map((s) => s.lateral)),
    neck: median(recent.map((s) => s.neck)),
    shoulderWidth: median(recent.map((s) => s.shoulderWidth)),
    eyeDist: median(recent.map((s) => s.eyeDist)),
    noseY: median(recent.map((s) => s.noseY)),
  };
  return Object.values(b).every((x) => x !== null) ? b : null;
}

// Decide what to do with the sitting-height (nose) baseline after a break.
// `samples` must only hold frames taken after the person had settled.
//  - null: not enough data yet, keep waiting
//  - { action: 'rebase', noseY }: they just sit a bit differently; quietly move the baseline
//  - { action: 'recalibrate' }: too big a change (camera moved, different chair): ask, don't guess
// The shift is measured the same way sinkRatio does: in shoulder widths.
export function noseRebaseDecision(baselineNoseY, samples, sinkTol) {
  if (baselineNoseY === null || samples.length < CALIBRATION_MIN_SAMPLES) return null;
  const span = samples[samples.length - 1].t - samples[0].t;
  if (span < CALIBRATION_WINDOW_MS * 0.75) return null;
  const noseY = median(samples.map((s) => s.noseY));
  const sw = median(samples.map((s) => s.shoulderWidth));
  if (noseY === null || !sw) return null;
  const shift = (noseY - baselineNoseY) / sw;
  if (Math.abs(shift) <= NOSE_REBASE_MAX_SHIFT_TOLS * sinkTol) return { action: 'rebase', noseY, shift };
  return { action: 'recalibrate', shift };
}

// A saved baseline is only trusted on the day it was taken (a new day means a
// different chair position, clothes, light) and only if every value is a number.
export function parseStoredBaseline(raw, todayStr) {
  if (!raw) return null;
  let o;
  try { o = JSON.parse(raw); } catch (e) { return null; }
  if (!o || o.date !== todayStr) return null;
  const keys = ['lateral', 'neck', 'shoulderWidth', 'eyeDist', 'noseY'];
  if (!keys.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]))) return null;
  if (!(o.shoulderWidth > 0)) return null;
  return { lateral: o.lateral, neck: o.neck, shoulderWidth: o.shoulderWidth, eyeDist: o.eyeDist, noseY: o.noseY };
}
