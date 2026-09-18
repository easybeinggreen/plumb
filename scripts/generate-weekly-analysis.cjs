// Weekly pattern analysis: aggregates the last 7 days of posture, hydration,
// and ambient-light data per user into hour-of-day buckets, sends it to an
// LLM (via OpenRouter) to describe how the day tends to unfold and propose
// concrete goals for the week ahead, and stores the result in weekly_goals
// for the app to display and for next week's run to reference for
// continuity. Model prompt/choice validated by hand against real data
// before wiring this up -- see PROJECT_NOTES.md.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENROUTER_API_KEY as secrets.
//
// Pinned to a specific free model rather than the `openrouter/free` router:
// that router picks a different underlying model every call, and testing
// showed real quality swings run to run -- one draft called an afternoon
// brightness *peak* a "dip" and built a goal on that backwards premise.
// deepseek/deepseek-v4-flash-0731:free was the most reliable of several
// tested on this exact task (see PROJECT_NOTES.md for the comparison).
// Free-tier availability can still change; if this model disappears,
// re-run the same comparison before picking a replacement -- don't just
// swap in whatever's newest.
const MODEL = 'deepseek/deepseek-v4-flash-0731:free';

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
      out[uid][hour] = { brightness: round3(b / n), skew: round3(s / n) };
    });
  });
  return out;
}

function buildSystemPrompt() {
  return `You are writing a private weekly reflection for someone using Plumb, a self-tracking posture/hydration/ambient-light app. You are not a doctor -- never diagnose a condition, never make clinical claims. This is a casual self-tracking tool, not a health device. Never invent a pattern the numbers don't actually support -- if something is ambiguous or a domain's data is too sparse to say anything real, say so plainly instead of overstating it.

Critical: the posture data is summed across the whole week, which can make one unusually bad (or good) day look like a recurring pattern. A separate "daily peaks" list shows which hour was actually worst on each individual day for each state. Before claiming any hour is "the" peak or "worst" time for a state, check that list -- if the peak hour is genuinely similar across most of the days, it's a real pattern and you can say so plainly (with the shared hour). If it jumps around day to day, say that instead ("this varies a lot day to day, no single hour stands out") rather than picking one hour from the weekly sum and presenting it as consistent. Do not average or split the difference between different days' peak hours into a fake middle hour either.

Style for the "patterns" field: write it in plain, concrete, everyday language -- like explaining it to a friend over coffee, not a report and not a poem. State what happened and roughly when, directly. Do not invent casual-sounding metaphors, slang, or filler phrases to sound relatable (e.g. never write things like "stacks into a long hunchy block," "gets sticky," "rolls in," "a quiet pocket") -- if a sentence would only make sense as a vibe rather than a literal description, rewrite it as a literal description instead. Reference at most one specific number per sentence, and only when it actually strengthens the point -- do not recite the data back as a list of stats with times and figures in parentheses either.

Respond with strict JSON only, matching the schema given, no markdown fencing, no other text.`;
}

function buildUserPrompt({ postureByHour, dailyPeaks, hydrationByHour, lightByHour, lastWeek }) {
  const dataBlock = `Posture data: seconds spent in each state, by hour of day (24h, local time), summed across the week -- see the daily-peaks list below before drawing conclusions from this, since a week-long sum can hide day-to-day inconsistency. All five states (lateral_left, lateral_right, compression, lean_in, sitting_low) are slouch/problem states -- none of them is good posture, so more time in any of them at a given hour is worse, not a recovery from another one:\n${JSON.stringify(postureByHour)}\n\nDaily peaks: for each state, only the days with a meaningful amount of that state (under a minute or two total that day is omitted as noise), which hour was worst that specific day:\n${JSON.stringify(dailyPeaks)}\n\nHydration: total ml logged, by hour of day, summed across the week:\n${JSON.stringify(hydrationByHour)}\n\nAmbient light: average brightness (0=dark, 1=bright) and average left/right skew (positive=brighter on right), by hour of day:\n${JSON.stringify(lightByHour)}`;

  const continuity = lastWeek
    ? `\n\nLast week's goals were: ${JSON.stringify(lastWeek.goals)}. They were asked: "${lastWeek.question}" and replied: "${lastWeek.user_response || '(no reply logged)'}"​. Take that into account if it's relevant -- don't repeat a goal they already addressed or rejected without acknowledging it.`
    : '';

  const task = `Using only the data above, write:
1. "patterns": 3-5 sentences, following the style instructions above -- plain and concrete, and honest about which patterns are consistent across days (per the daily-peaks list) versus which are dominated by one or two days.
2. "goals": exactly 3 concrete, specific actions to try next week -- one about posture timing, one about hydration timing, one about the ambient light pattern. Each must be tied directly to a real, cross-day-consistent pattern in the data (not generic advice like "sit up straight," and not built on a single outlier day), and specific enough to act on (a time of day, a trigger, a concrete swap) -- if a domain's pattern is genuinely too weak, flat, or inconsistent to justify an action, say so in that slot instead of inventing one.
3. "question": one specific question inviting the person to confirm, adjust, or reject one of the three goals above -- something they can answer in a sentence.
4. "trackerReminder": one short, friendly sentence reminding them to keep Plumb running through the week so next week's check-in has real data to work from.

Respond as JSON: {"patterns": string, "goals": [string, string, string], "question": string, "trackerReminder": string}`;

  return `${dataBlock}${continuity}\n\n${task}`;
}

async function callOnce(apiKey, userId, ctx) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      // Requests constrained JSON decoding where the endpoint supports it --
      // reduces but (per real testing) does not eliminate malformed output,
      // hence the retry in analyzeUser below as well.
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(ctx) }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenRouter error ${response.status} for ${userId}: ${await response.text()}`);
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  // Models occasionally wrap JSON in a fence despite instructions -- strip it defensively.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const parsed = JSON.parse(cleaned); // throws on malformed JSON -- caller retries
  return { ...parsed, model: data.model };
}

// Real testing found the pinned free model occasionally emits malformed JSON
// (once literally forgot to close the "goals" array before "question") --
// a random per-call glitch, not something a prompt tweak reliably fixes, so
// retrying once is cheaper and more honest than pretending one call is
// always enough.
async function analyzeUser(apiKey, userId, ctx) {
  try {
    return await callOnce(apiKey, userId, ctx);
  } catch (e) {
    console.warn(`First attempt failed for ${userId} (${e.message}) -- retrying once.`);
    return await callOnce(apiKey, userId, ctx);
  }
}

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!url || !key || !openrouterKey) {
    console.warn('SUPABASE_URL, SUPABASE_SERVICE_KEY, or OPENROUTER_API_KEY not set -- skipping.');
    return;
  }

  const weekEnd = addDays(toDateStr(brisbaneNow()), -1); // yesterday, Brisbane-local
  const weekStart = addDays(weekEnd, -6);
  console.log(`Analyzing week ${weekStart} to ${weekEnd}`);

  const [postureRows, hydrationRows, lightRows] = await Promise.all([
    fetchAll(url, key, `posture_events?select=user_id,type,date,start_time,duration_seconds&date=gte.${weekStart}&date=lte.${weekEnd}&type=in.(${POSTURE_TYPES.join(',')})`),
    fetchAll(url, key, `hydration_events?select=user_id,logged_at,volume_ml&date=gte.${weekStart}&date=lte.${weekEnd}`),
    fetchAll(url, key, `light_readings?select=user_id,logged_at,brightness,skew&date=gte.${weekStart}&date=lte.${weekEnd}`)
  ]);
  console.log(`Fetched ${postureRows.length} posture, ${hydrationRows.length} hydration, ${lightRows.length} light rows`);

  const postureByUserHour = bucketByUserHour(postureRows, 'start_time', 'duration_seconds', 'type');
  const dailyPeaksByUser = dailyPeaksByUserType(postureRows);
  const hydrationByUserHour = bucketByUserHour(hydrationRows, 'logged_at', 'volume_ml', null);
  const lightByUserHour = buildLightByHour(lightRows);

  const userIds = Object.keys(postureByUserHour);
  console.log(`${userIds.length} user(s) with posture data this week: ${userIds.join(', ')}`);

  const results = [];
  for (const userId of userIds) {
    try {
      const lastWeekRes = await fetchAll(url, key, `weekly_goals?select=goals,question,user_response&user_id=eq.${encodeURIComponent(userId)}&order=week_start.desc&limit=1`);
      const lastWeek = lastWeekRes[0] || null;

      const analysis = await analyzeUser(openrouterKey, userId, {
        postureByHour: postureByUserHour[userId] || {},
        dailyPeaks: dailyPeaksByUser[userId] || {},
        hydrationByHour: hydrationByUserHour[userId] || {},
        lightByHour: lightByUserHour[userId] || {},
        lastWeek
      });

      // Upsert on (user_id, week_start): a re-run for a week already analyzed
      // (manual re-trigger, a retry after a partial failure) replaces that
      // week's row instead of piling up duplicates.
      const insertRes = await fetch(`${url}/rest/v1/weekly_goals?on_conflict=user_id,week_start`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{
          user_id: userId,
          week_start: weekStart,
          week_end: weekEnd,
          patterns: analysis.patterns,
          goals: analysis.goals,
          question: analysis.question,
          tracker_reminder: analysis.trackerReminder,
          model: analysis.model
        }])
      });
      if (!insertRes.ok) throw new Error(`Insert error ${insertRes.status}: ${await insertRes.text()}`);

      console.log(`Wrote weekly analysis for ${userId} (served by ${analysis.model})`);
      results.push({ userId, ok: true });
    } catch (err) {
      console.error(`Failed for ${userId}:`, err.message);
      results.push({ userId, ok: false, error: err.message });
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`${failed.length}/${results.length} user(s) failed.`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Weekly analysis failed:', err.message);
  process.exit(1);
});
