// Pure maths for where the dot sits inside the loop, kept free of the DOM so it can be
// tested. `k` holds the drawing constants (DOT_CENTER, REST_Y, LOOP_RX, LOOP_RY,
// GLYPH_MIN, GLYPH_MAX, DOT_BASE_R, DOT_LEAN_MAX_DELTA, LEAN_CURVE_K).
//
// The loop marks the threshold: a dot exactly on the loop means "at the limit" for
// that measurement, and the alert state only flips when a measurement crosses its
// limit. So the dot must move for EVERY measurement that can flip the state, or it
// sits in the middle of the loop while the ring pulses.
//  - side to side: the dot moves left/right
//  - neck dropping: the dot moves down
//  - sitting low in the chair: the dot moves down too (same direction, same scale),
//    so whichever of the two is further gone decides how far down it is
//  - leaning in: the dot grows
export function dotPosition({ lateral, compression, lean, sink = 0, latTol, compTol, sinkTol = 0 }, k) {
  const leanNorm = Math.tanh(Math.max(lean, 0) * k.LEAN_CURVE_K);
  const dotR = k.DOT_BASE_R + leanNorm * k.DOT_LEAN_MAX_DELTA;

  const latRatio = latTol > 0 ? lateral / latTol : 0;
  const compRatio = compTol > 0 ? compression / compTol : 0;
  const sinkRatio = sinkTol > 0 ? sink / sinkTol : 0;
  // Sitting low can only push the dot further DOWN. It must never override the upward
  // movement of a neck that is taller than at calibration (compression below zero).
  const downRatio = sinkRatio > 0 && sinkRatio > compRatio ? sinkRatio : compRatio;

  // Keep the whole dot inside the drawing on every side.
  const xLim = Math.max(0, k.DOT_CENTER - k.GLYPH_MIN - dotR);
  const px = Math.max(-xLim, Math.min(xLim, -latRatio * k.LOOP_RX));
  const py = Math.max(k.GLYPH_MIN + dotR - k.REST_Y, Math.min(k.GLYPH_MAX - dotR - k.REST_Y, downRatio * k.LOOP_RY));
  return { px, py, dotR };
}
