// Weekly pattern analysis, shared by two callers so there is ONE copy of the
// aggregation, the prompt and the model call:
//   - scripts/generate-weekly-analysis.cjs (the Friday GitHub Action, all users)
//   - supabase/functions/weekly-analysis/index.ts (the app's "generate weekly
//     summary" button: one user, holds the OpenRouter key server-side)
// Plain ES module using only fetch, so it runs unchanged in Node 22 and Deno.
//
// Aggregates the last 7 days of posture, hydration and ambient-light data per
// user, works out the two things the owner cares about in code (when water is
// drunk against the target, and whether slumping rises after lunch), asks a free
// OpenRouter model for exactly TWO points, each a finding backed by numbers plus
// one recommendation, and upserts the result into weekly_goals (unique on
// user_id + week_start). The row keeps its old shape: `patterns` is two lines
// ("hydration: <finding>"), `goals` is the two recommendations in the same order,
// `question` and `tracker_reminder` are left empty.
//
// Uses OpenRouter's `openrouter/free` router. It used to be pinned to
// deepseek/deepseek-v4-flash-0731:free (the most reliable of several tested),
// but OpenRouter retired that free slug on 2026-09-25 and the Friday run 404'd.
// The router can't 404 that way, at the cost of the underlying model changing
// call to call -- earlier testing saw real quality swings (one draft called an
// afternoon brightness *peak* a "dip" and built a goal on that backwards
// premise). `weekly_goals.model` records which model wrote each row.
const MODEL = 'openrouter/free';

// Same reasoning as rollup-summary.cjs's cutoffDate(): the runner's ambient
// clock is UTC, but "a week" needs to mean the same thing it does on the
// user's own Brisbane-local browser clock, or this runs a day off from what
// the app itself considers "this week." AEST has no DST, so a fixed +10h
// offset is safe year-round.
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

function toDateStr(d) { return d.toISOString().slice(0, 10); }
function brisbaneNow() { return new Date(Date.now() + BRISBANE_OFFSET_MS); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}
function brisbaneHour(isoTs) {
  return new Date(new Date(isoTs).getTime() + BRISBANE_OFFSET_MS).getUTCHours();
}

const POSTURE_TYPES = ['lateral_left', 'lateral_right', 'compression', 'lean_in', 'sitting_low'];

async function fetchAll(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Read error ${res.status} (${path}): ${await res.text()}`);
  return res.json();
}

// Summing a whole week into one hour-of-day table hides whether a "peak
// hour" is a real recurring pattern or just one bad day getting averaged
// in with the rest -- confirmed on real data (2026-09-19): a week's worth
// of compression summed to a clean 11am peak, but the actual per-day worst
// hour was 11am, 8am, 3pm, and noon on the four days that had any --
// four different hours, no real pattern, the "peak" was entirely one
// unusually bad day (1097s of the week's 1880s at 11am came from a single
// Monday). This computes each day's own peak hour per type instead, so the
// prompt can tell the model to check for actual cross-day agreement rather
// than trust the aggregate. MIN_DAY_SECONDS filters out days with only
// noise-level time in a type (not enough to call anything a "peak").
const MIN_DAY_SECONDS = 120;
function dailyPeaksByUserType(rows) {
  const byUserTypeDate = {}; // uid -> type -> date -> {hour: sec}
  rows.forEach((r) => {
    const uid = r.user_id, type = r.type, date = r.date;
    const hour = brisbaneHour(r.start_time);
    if (!byUserTypeDate[uid]) byUserTypeDate[uid] = {};
    if (!byUserTypeDate[uid][type]) byUserTypeDate[uid][type] = {};
    if (!byUserTypeDate[uid][type][date]) byUserTypeDate[uid][type][date] = {};
    byUserTypeDate[uid][type][date][hour] = (byUserTypeDate[uid][type][date][hour] || 0) + (r.duration_seconds || 0);
  });
  const out = {}; // uid -> type -> [{date, peakHour, sec}]
  Object.entries(byUserTypeDate).forEach(([uid, byType]) => {
    out[uid] = {};
    Object.entries(byType).forEach(([type, byDate]) => {
      const days = [];
      Object.entries(byDate).forEach(([date, byHour]) => {
        let peakHour = null, peakSec = 0, total = 0;
        Object.entries(byHour).forEach(([hour, sec]) => {
          total += sec;
          if (sec > peakSec) { peakSec = sec; peakHour = Number(hour); }
        });
        if (total >= MIN_DAY_SECONDS) days.push({ date, peakHour, sec: peakSec });
      });
      days.sort((a, b) => a.date.localeCompare(b.date));
      out[uid][type] = days;
    });
  });
  return out;
}

// Buckets raw rows into { user_id: { hour: seconds/ml, ... } } per type/metric.
function bucketByUserHour(rows, tsField, valueField, typeField) {
  const out = {};
  rows.forEach((r) => {
    const uid = r.user_id;
    const hour = brisbaneHour(r[tsField]);
    if (!out[uid]) out[uid] = {};
    if (typeField) {
      const t = r[typeField];
      if (!out[uid][t]) out[uid][t] = {};
      out[uid][t][hour] = (out[uid][t][hour] || 0) + (r[valueField] || 0);
    } else {
      out[uid][hour] = (out[uid][hour] || 0) + (r[valueField] || 0);
    }
  });
  return out;
}

function round3(n) { return Math.round(n * 1000) / 1000; }

function buildLightByHour(rows) {
  const sums = {}; // user -> hour -> {b, s, n}
  rows.forEach((r) => {
    const uid = r.user_id;
    const hour = brisbaneHour(r.logged_at);
    if (!sums[uid]) sums[uid] = {};
    if (!sums[uid][hour]) sums[uid][hour] = { b: 0, s: 0, n: 0 };
    sums[uid][hour].b += r.brightness || 0;
    sums[uid][hour].s += r.skew || 0;
    sums[uid][hour].n += 1;
  });
  const out = {};
  Object.entries(sums).forEach(([uid, byHour]) => {
    out[uid] = {};
    Object.entries(byHour).forEach(([hour, { b, s, n }]) => {
      // n is included deliberately -- an hour averaged from 1-2 readings
      // (camera briefly covered, a transient reading right as tracking
      // started/stopped) can produce an extreme average that looks like a
      // real pattern next to hours backed by 20+ readings. Confirmed on
      // real data 2026-09-19: hour 17 averaged to 0.063 brightness (vs.
      // ~0.4-0.6 in neighboring hours) off a single reading, and the model
      // built a whole goal around it as "the one clear light pattern."
      // Same class of bug as the posture weekly-sum issue -- the model
      // needs the sample count to tell noise from signal itself.
      out[uid][hour] = { brightness: round3(b / n), skew: round3(s / n), n };
    });
  });
  return out;
}

// Spreads a block across the Brisbane hours it covers, in whole-minute chunks.
function spreadByHour(bucket, startIso, durationSec) {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return;
  for (let t = 0; t < durationSec; t += 60) {
    const h = new Date(start + t * 1000 + BRISBANE_OFFSET_MS).getUTCHours();
    bucket[h] = (bucket[h] || 0) + Math.min(60, durationSec - t);
  }
}

const pctOf = (n, d) => (d > 0 ? Math.round((Math.min(n, d) / d) * 100) : 0);

// Slumping = neck dropping (compression) + sitting low. Left/right lean is reported separately: the
// owner's view is that it is fine and the slump is the problem. Everything is worked out here, from the
// raw rows, so the model quotes numbers instead of estimating them from an hourly table.
export function buildSlumpSummary(postureRows, presenceRows) {
  const trackedByHour = {}, neckByHour = {}, lowByHour = {};
  let tracked = 0, neck = 0, low = 0, lateral = 0, leanIn = 0;
  presenceRows.forEach((r) => { const d = r.duration_seconds || 0; tracked += d; if (r.start_time) spreadByHour(trackedByHour, r.start_time, d); });
  postureRows.forEach((r) => {
    const d = r.duration_seconds || 0;
    if (r.type === 'compression') { neck += d; if (r.start_time) spreadByHour(neckByHour, r.start_time, d); }
    else if (r.type === 'sitting_low') { low += d; if (r.start_time) spreadByHour(lowByHour, r.start_time, d); }
    else if (r.type === 'lateral_left' || r.type === 'lateral_right') lateral += d;
    else if (r.type === 'lean_in') leanIn += d;
  });
  if (tracked < 3600) return null;
  const period = (from, to) => {
    let t = 0, n = 0, l = 0;
    for (let h = from; h <= to; h++) { t += trackedByHour[h] || 0; n += neckByHour[h] || 0; l += lowByHour[h] || 0; }
    return t >= 1800 ? { trackedMin: Math.round(t / 60), slumpPct: pctOf(n + l, t), neckDroppingPct: pctOf(n, t), sittingLowPct: pctOf(l, t) } : null;
  };
  const byHour = Object.keys(trackedByHour).map(Number).sort((a, b) => a - b).filter((h) => trackedByHour[h] >= 1800)
    .map((h) => ({ hour: h, trackedMin: Math.round(trackedByHour[h] / 60), slumpPct: pctOf((neckByHour[h] || 0) + (lowByHour[h] || 0), trackedByHour[h]) }));
  return {
    trackedHours: Math.round(tracked / 360) / 10,
    shareOfTrackedTimePct: { slumping: pctOf(neck + low, tracked), neckDropping: pctOf(neck, tracked), sittingLow: pctOf(low, tracked), leaningLeftOrRight: pctOf(lateral, tracked), leaningIn: pctOf(leanIn, tracked) },
    morning_before_12: period(5, 11),
    lunchtime_12_to_1pm: period(12, 12),
    afternoon_1pm_to_6pm: period(13, 18),
    byHour
  };
}

// When water is drunk, against the target. Days are the days tracking ran, so a day with no water
// logged counts as zero rather than being ignored.
export function buildHydrationSummary(rows, { targetMl, startHour, endHour, trackedDays }) {
  const perDay = {};
  rows.forEach((r) => {
    const h = brisbaneHour(r.logged_at), v = r.volume_ml || 0;
    const d = perDay[r.date] || (perDay[r.date] = { total: 0, before12: 0, noonTo3: 0, from3: 0, byEnd: 0 });
    d.total += v;
    if (h < 12) d.before12 += v; else if (h < 15) d.noonTo3 += v; else d.from3 += v;
    if (h < endHour) d.byEnd += v;
  });
  const days = Math.max(trackedDays, Object.keys(perDay).length);
  if (days === 0) return null;
  const sum = (k) => Object.values(perDay).reduce((a, d) => a + d[k], 0);
  const avg = (k) => Math.round(sum(k) / days);
  const total = sum('total');
  return {
    daysTracked: days, daysWithAnyWaterLogged: Object.keys(perDay).length,
    dailyTargetMl: targetMl, workingHours: `${String(startHour).padStart(2, '0')}:00 to ${String(endHour).padStart(2, '0')}:00`,
    averageLoggedPerDayMl: avg('total'), averagePctOfTarget: targetMl > 0 ? pctOf(avg('total'), targetMl) : null,
    averageMl: { before_noon: avg('before12'), noon_to_3pm: avg('noonTo3'), from_3pm: avg('from3'), by_end_of_working_day: avg('byEnd') },
    shareOfWaterDrunkBeforeNoonPct: total > 0 ? pctOf(sum('before12'), total) : null
  };
}

function buildSystemPrompt() {
  return `You are writing a private weekly reflection for someone using Plumb, a self-tracking posture/hydration/ambient-light app. You are not a doctor -- never diagnose a condition, never make clinical claims. This is a casual self-tracking tool, not a health device. Never invent a pattern the numbers don't actually support -- if something is ambiguous or a domain's data is too sparse to say anything real, say so plainly instead of overstating it.

Critical: the posture data is summed across the whole week, which can make one unusually bad (or good) day look like a recurring pattern. A separate "daily peaks" list shows which hour was actually worst on each individual day for each state. Before claiming any hour is "the" peak or "worst" time for a state, check that list -- if the peak hour is genuinely similar across most of the days, it's a real pattern and you can say so plainly (with the shared hour). If it jumps around day to day, say that instead ("this varies a lot day to day, no single hour stands out") rather than picking one hour from the weekly sum and presenting it as consistent. Do not average or split the difference between different days' peak hours into a fake middle hour either.

Critical: the ambient-light data includes "n", the number of readings that hour's average is built from. An hour with only 1-2 readings can average out to an extreme value purely by chance (one reading taken right as the camera started, or briefly covered) and look like a dramatic standout next to hours built from 15-25 readings -- that is noise, not a lighting pattern, no matter how extreme the number looks. Only treat an hour's brightness/skew as meaningful if it has a reasonable sample count roughly in line with neighboring hours (as a rule of thumb, treat anything under 5 readings as too sparse to draw a conclusion from) -- otherwise leave that hour out of the light pattern entirely rather than naming it as "the" bright or dark hour.

What to write: exactly TWO points, most useful first. Each point is a FINDING backed by the numbers you were given, followed by one RECOMMENDATION. The person wants to be told what to do, not shown a report. Choose the two points that matter most from: when water is drunk against the daily target, slumping (neck dropping and sitting low) and whether it gets worse after lunch, breaks, and light. Unless the numbers clearly show something more important, make them hydration and slumping. Left/right leaning is not a problem to raise unless it is large (over about 15% of tracked time).

What the owner has said about themselves, as context: they tend to drink mostly in the morning and reach the end of the day under their target, and they tend to slump after lunch. Use these ONLY if this week's numbers support them, and never state one without quoting the number that shows it. If the numbers say otherwise, say what they do show. Recommendations you may use when the numbers justify them: keep drinking through the afternoon (say roughly how much and by when), recalibrate after lunch (the app also re-sets the sitting height itself after a break of a minute or more), and take a short break at regular intervals through the afternoon.

Make each finding a comparison, not a lone figure. For slumping, compare the slumping percentage before 12 with the percentage after 1pm (morning_before_12 against afternoon_1pm_to_6pm), with neck dropping alongside. For water, lead with how much was drunk by the end of the working day against the daily target (averageMl.by_end_of_working_day), then the share drunk before noon; do not lead with the overall daily average, which can look fine while the day's timing is not.

Rules for the words: a finding is one or two short sentences and must contain at least one concrete figure from the data (a percentage, an amount in ml, an hour). A recommendation is ONE sentence under 25 words: a specific action with a time, an amount or a trigger, not generic advice. Plain, concrete, everyday language, no report tone, no metaphors or slang. Never use the raw state identifiers (lateral_left, lateral_right, compression, lean_in, sitting_low) in any output: write neck dropping, sitting low in the chair, leaning left or right, leaning in. "Sitting low" can read higher than the truth on days before 26 September 2026 because of a calibration drift; neck dropping is the steadier signal, so when you cite sitting low, cite neck dropping alongside it, and do not build a recommendation on sitting low alone. If a point's data is too thin to say anything real, say so plainly in that point instead of inventing a pattern.

Respond with strict JSON only, matching the schema given, no markdown fencing, no other text.`;
}

function buildUserPrompt({ postureByHour, dailyPeaks, hydrationByHour, lightByHour, coverage, lastWeek, slump, hydration }) {
  const summaries = `Slumping summary (worked out from the raw data; quote these numbers): ${JSON.stringify(slump)}\n\nWater summary (worked out from the raw data; quote these numbers): ${JSON.stringify(hydration)}\n\n`;
  const dataBlock = `${summaries}Data coverage this week: tracking was running on ${coverage.daysTracked} of 7 days, about ${coverage.hoursTracked} hours in total. Treat anything under roughly 25 tracked hours as a thin week and say so.\n\nPosture data: seconds spent in each state, by hour of day (24h, local time), summed across the week -- see the daily-peaks list below before drawing conclusions from this, since a week-long sum can hide day-to-day inconsistency. All five states (lateral_left, lateral_right, compression, lean_in, sitting_low) are slouch/problem states -- none of them is good posture, so more time in any of them at a given hour is worse, not a recovery from another one:\n${JSON.stringify(postureByHour)}\n\nDaily peaks: for each state, only the days with a meaningful amount of that state (under a minute or two total that day is omitted as noise), which hour was worst that specific day:\n${JSON.stringify(dailyPeaks)}\n\nHydration: total ml logged, by hour of day, summed across the week:\n${JSON.stringify(hydrationByHour)}\n\nAmbient light: average brightness (0=dark, 1=bright), average left/right skew (positive=brighter on right), and "n" = how many readings that hour's average came from, by hour of day -- see the instructions above about treating low-n hours as noise, not pattern:\n${JSON.stringify(lightByHour)}`;

  const continuity = lastWeek
    ? `\n\nLast week's recommendations were: ${JSON.stringify(lastWeek.goals)}. Take that into account if it is relevant: if the numbers show the same problem again, say it has continued rather than presenting it as new.`
    : '';

  const task = `Using only the data above, write exactly two points as JSON: {"points": [{"label": string, "finding": string, "recommendation": string}, {"label": string, "finding": string, "recommendation": string}]}
"label" is one lowercase word for the topic ("hydration", "posture", "breaks" or "light"). Follow the rules above for findings and recommendations.`;

  return `${dataBlock}${continuity}\n\n${task}`;
}

// ---- Model call ---------------------------------------------------------------
// The router often lands on a reasoning model that spends its whole token budget
// thinking and returns an empty reply (seen live: finish_reason "length" with an
// empty content), or emits malformed JSON, or times out. So: a generous
// max_tokens, tolerant JSON extraction, and several attempts within a time budget.
function extractJson(raw) {
  const cleaned = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('reply contained no JSON object');
  return JSON.parse(cleaned.slice(start, end + 1)); // throws on malformed JSON -- caller retries
}

function validateAnalysis(p) {
  const pts = p && p.points;
  const ok = Array.isArray(pts) && pts.length === 2 && pts.every((x) => x
    && typeof x.label === 'string' && x.label.trim()
    && typeof x.finding === 'string' && x.finding.trim()
    && typeof x.recommendation === 'string' && x.recommendation.trim());
  if (!ok) throw new Error('reply did not contain exactly two points, each with a finding and a recommendation');
  return {
    patterns: pts.map((x) => `${x.label.trim().toLowerCase()}: ${x.finding.trim()}`).join('\n'),
    goals: pts.map((x) => x.recommendation.trim()),
    question: '',
    trackerReminder: ''
  };
}

async function callOnce(apiKey, ctx, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(ctx) }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenRouter error ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const data = await response.json();
    const choice = data.choices?.[0];
    const raw = choice?.message?.content || '';
    if (!raw.trim()) throw new Error(`empty reply (model ${data.model || '?'}, finish_reason ${choice?.finish_reason || '?'})`);
    return { ...validateAnalysis(extractJson(raw)), model: data.model || MODEL };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// `parallel` requests are fired at once and the first valid answer wins: the router picks
// a different model per call, and a slow reasoning model can burn a whole attempt, so a
// batch of three finds a fast one far more often than trying one at a time. If a whole
// batch fails, the next batch starts, up to `attempts` requests in total.
async function analyseWithRetries(apiKey, ctx, { attemptMs, budgetMs, attempts, parallel = 1, log }) {
  const started = Date.now();
  let used = 0, lastError = null;
  while (used < attempts) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 15000) break; // not enough time left for a real attempt
    const batch = Math.min(parallel, attempts - used);
    used += batch;
    const timeoutMs = Math.min(attemptMs, remaining - 2000);
    try {
      return await Promise.any(Array.from({ length: batch }, () => callOnce(apiKey, ctx, timeoutMs)));
    } catch (e) {
      const errors = e && e.errors ? e.errors : [e];
      lastError = errors[errors.length - 1];
      log.warn(`Attempts ${used - batch + 1}-${used}/${attempts} failed: ${errors.map((x) => x.message).join(' | ')}`);
      if (errors.some((x) => /OpenRouter error 401/.test(x.message))) break; // bad key: retrying won't help
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastError || new Error('ran out of time before the model answered');
}

// ---- Entry point ----------------------------------------------------------------
// userId: analyse just that user (the button); null = every user with data (Friday job).
// endDay: 'yesterday' = the 7 days ending yesterday (the scheduled run); 'today' = the
// 7 days ending today (the button, so a brand-new user with only today's data can use it).
// Returns one result per user: { userId, ok, ... } or { userId, ok:false, code, message }.
export async function generateWeeklyAnalysis({
  supabaseUrl: url, serviceKey: key, openrouterKey, userId = null, endDay = 'yesterday',
  minPresenceSec = 0, attemptMs = 90000, budgetMs = Infinity, attempts = 4, parallel = 1, log = console
}) {
  const weekEnd = endDay === 'today' ? toDateStr(brisbaneNow()) : addDays(toDateStr(brisbaneNow()), -1);
  const weekStart = addDays(weekEnd, -6);
  log.log(`Analyzing week ${weekStart} to ${weekEnd}${userId ? ` for ${userId}` : ''}`);
  const uf = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : '';

  const presenceRows = await fetchAll(url, key, `posture_events?select=user_id,date,start_time,duration_seconds&date=gte.${weekStart}&date=lte.${weekEnd}&type=eq.presence${uf}`);
  const coverageByUser = {};
  presenceRows.forEach((r) => {
    const c = coverageByUser[r.user_id] || (coverageByUser[r.user_id] = { days: new Set(), seconds: 0 });
    c.days.add(r.date);
    c.seconds += r.duration_seconds || 0;
  });

  const [allPostureRows, hydrationRows, lightRows, settingsRows] = await Promise.all([
    fetchAll(url, key, `posture_events?select=user_id,type,date,start_time,duration_seconds&date=gte.${weekStart}&date=lte.${weekEnd}&type=in.(${POSTURE_TYPES.join(',')})${uf}`),
    fetchAll(url, key, `hydration_events?select=user_id,date,logged_at,volume_ml&date=gte.${weekStart}&date=lte.${weekEnd}${uf}`),
    fetchAll(url, key, `light_readings?select=user_id,logged_at,brightness,skew&date=gte.${weekStart}&date=lte.${weekEnd}${uf}`),
    fetchAll(url, key, `app_settings?select=user_id,hydration_target_ml,extras${uf}`)
  ]);
  // A single unbroken slouch block over 2 hours is not real posture data: the app used to
  // log the whole time a laptop was asleep as one block (a 15-hour "compression" event on
  // 2026-09-22), and rows are bucketed by START hour, so one of those would dump the lot
  // into a single hour and dominate the analysis. Ignore them.
  const MAX_SLOUCH_BLOCK_SEC = 2 * 3600;
  const postureRows = allPostureRows.filter((r) => (r.duration_seconds || 0) <= MAX_SLOUCH_BLOCK_SEC);
  const ignored = allPostureRows.length - postureRows.length;
  log.log(`Fetched ${postureRows.length} posture${ignored ? ` (ignored ${ignored} implausibly long)` : ''}, ${hydrationRows.length} hydration, ${lightRows.length} light rows`);

  const postureByUserHour = bucketByUserHour(postureRows, 'start_time', 'duration_seconds', 'type');
  const dailyPeaksByUser = dailyPeaksByUserType(postureRows);
  const hydrationByUserHour = bucketByUserHour(hydrationRows, 'logged_at', 'volume_ml', null);
  const lightByUserHour = buildLightByHour(lightRows);

  const userIds = userId ? [userId] : Object.keys(postureByUserHour);
  log.log(`${userIds.length} user(s) to analyse: ${userIds.join(', ')}`);

  const results = [];
  for (const uid of userIds) {
    const coverage = coverageByUser[uid];
    if (!postureByUserHour[uid] || !coverage) {
      results.push({ userId: uid, ok: false, code: 'no_data', message: 'No tracked posture data in the last 7 days yet. Run the camera for a while first.' });
      continue;
    }
    if (coverage.seconds < minPresenceSec) {
      results.push({ userId: uid, ok: false, code: 'not_enough_data', message: 'Not enough tracked time yet for a summary. Track for at least 10 minutes first.' });
      continue;
    }
    try {
      // Last week's row for continuity: the newest one for an EARLIER week (never the row being replaced).
      const lastRows = await fetchAll(url, key, `weekly_goals?select=goals,question,user_response&user_id=eq.${encodeURIComponent(uid)}&week_start=lt.${weekStart}&order=week_start.desc&limit=1`);
      const analysis = await analyseWithRetries(openrouterKey, {
        postureByHour: postureByUserHour[uid] || {},
        dailyPeaks: dailyPeaksByUser[uid] || {},
        hydrationByHour: hydrationByUserHour[uid] || {},
        lightByHour: lightByUserHour[uid] || {},
        coverage: { daysTracked: coverage.days.size, hoursTracked: Math.round(coverage.seconds / 360) / 10 },
        lastWeek: lastRows[0] || null,
        slump: buildSlumpSummary(postureRows.filter((r) => r.user_id === uid), presenceRows.filter((r) => r.user_id === uid)),
        hydration: (() => {
          const st = settingsRows.find((r) => r.user_id === uid) || {};
          const pace = (st.extras && st.extras.hydrationPace) || {};
          const hourOf = (hhmm, dflt) => { const m = /^(\d{1,2}):\d{2}$/.exec(hhmm || ''); return m ? Number(m[1]) : dflt; };
          return buildHydrationSummary(hydrationRows.filter((r) => r.user_id === uid), {
            targetMl: st.hydration_target_ml || 1000, startHour: hourOf(pace.start, 8), endHour: hourOf(pace.end, 16), trackedDays: coverage.days.size
          });
        })()
      }, { attemptMs, budgetMs, attempts, parallel, log });

      // Upsert on (user_id, week_start): regenerating the same week replaces that
      // week's row. A new analysis asks a new question, so any earlier reply is cleared.
      const insertRes = await fetch(`${url}/rest/v1/weekly_goals?on_conflict=user_id,week_start`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{
          user_id: uid, week_start: weekStart, week_end: weekEnd,
          patterns: analysis.patterns, goals: analysis.goals, question: analysis.question,
          tracker_reminder: analysis.trackerReminder, model: analysis.model,
          user_response: null, responded_at: null
        }])
      });
      if (!insertRes.ok) throw new Error(`Insert error ${insertRes.status}: ${await insertRes.text()}`);
      log.log(`Wrote weekly analysis for ${uid} (served by ${analysis.model})`);
      results.push({ userId: uid, ok: true, weekStart, weekEnd, model: analysis.model });
    } catch (err) {
      log.error(`Failed for ${uid}: ${err.message}`);
      results.push({ userId: uid, ok: false, code: 'model_failed', message: err.message });
    }
  }
  return results;
}
