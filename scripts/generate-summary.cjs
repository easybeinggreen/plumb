// Weekly "ai summary" (the report's "ai summary" tab): reads each user's last
// 14 days of posture_events from Supabase, asks a free model on OpenRouter for a
// short plain-prose summary, and upserts one row per user into public.ai_summary.
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY and OPENROUTER_API_KEY as secrets.
//
// This used to call Anthropic and write public/data/summary.json, committed back to
// main by the workflow. That commit could never land (main requires pull
// requests and the Actions bot has no bypass), so the tab never had data, and
// it also mixed every user's history into one summary. It now goes through
// OpenRouter (free tier only, same as the weekly analysis) and lives in the database.

const MODEL = 'openrouter/free';
const WINDOW_DAYS = 14;
const SLOUCH_TYPES = ['lateral_left', 'lateral_right', 'compression', 'lean_in', 'sitting_low'];

// Same reasoning as the other scripts: "a day" means the Brisbane-local day the
// app itself uses. AEST has no DST, so a fixed +10h offset is safe year-round.
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;
function brisbaneDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + BRISBANE_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function fetchRows(url, key, sinceDate) {
  const res = await fetch(`${url}/rest/v1/posture_events?select=user_id,date,type,duration_seconds&date=gte.${sinceDate}&order=date.asc`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!res.ok) throw new Error(`Supabase read error ${res.status}: ${await res.text()}`);
  return res.json();
}

// posture_events, not the daily rollup: the rollup only reaches back to two
// days ago, and per-device chunks land as their own rows here, so summing per
// day is correct across however many devices were used.
function aggregateByUser(events) {
  const perUser = {};
  events.forEach((e) => {
    const u = perUser[e.user_id] || (perUser[e.user_id] = {});
    const day = u[e.date] || (u[e.date] = { sessionSeconds: 0, slouchSeconds: 0, breakSeconds: 0, breaksTaken: 0 });
    const dur = e.duration_seconds || 0;
    if (e.type === 'presence') day.sessionSeconds += dur;
    else if (SLOUCH_TYPES.includes(e.type)) day.slouchSeconds += dur;
    else if (e.type === 'break') { day.breakSeconds += dur; day.breaksTaken++; }
  });

  const toMinutes = (s) => Math.round((s || 0) / 60);
  const out = {};
  Object.entries(perUser).forEach(([userId, byDate]) => {
    const days = Object.keys(byDate).sort().map((date) => ({
      date,
      sessionMinutes: toMinutes(byDate[date].sessionSeconds),
      slouchMinutes: toMinutes(byDate[date].slouchSeconds),
      breakMinutes: toMinutes(byDate[date].breakSeconds),
      breaksTaken: byDate[date].breaksTaken
    }));
    const totalSession = days.reduce((s, d) => s + d.sessionMinutes, 0);
    const totalSlouch = days.reduce((s, d) => s + d.slouchMinutes, 0);
    out[userId] = {
      daysLogged: days.length,
      totalSessionMinutes: totalSession,
      totalSlouchMinutes: totalSlouch,
      slouchRatePct: totalSession ? Math.round((totalSlouch / totalSession) * 100) : 0,
      totalBreaksTaken: days.reduce((s, d) => s + d.breaksTaken, 0),
      days
    };
  });
  return out;
}

async function askModel(apiKey, stats) {
  const prompt =
    `Here is a person's posture and movement tracking log for the last ${stats.daysLogged} days ` +
    `(from a webcam-based tracker that measures head position and neck compression — no video or images, just these numbers):\n\n` +
    `${JSON.stringify(stats.days, null, 2)}\n\n` +
    `Write a short (4-6 sentence) plain-prose summary. Note any real patterns (specific days that are worse, ` +
    `whether things are trending better or worse across the period), and end with exactly one small, concrete ` +
    `suggestion. Be warm and honest, not preachy, and do not use bullet points or headers. The app's own term for slouching is "out of plumb" (slouchMinutes is minutes out of plumb); use that phrase rather than "slouching". Do not diagnose any ` +
    `medical condition or make clinical claims — this is a casual self-tracking tool, not a health device.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    // Generous max_tokens: the free router often lands on a reasoning model that spends
    // its budget thinking first, and with a small cap it returns an empty reply.
    body: JSON.stringify({ model: MODEL, max_tokens: 2500, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) throw new Error(`OpenRouter error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const choice = data.choices?.[0];
  // Some models wrap their thinking in <think> tags inside the content.
  const text = (choice?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!text) {
    const hadReasoning = !!(choice?.message?.reasoning || choice?.message?.reasoning_content);
    throw new Error(`OpenRouter returned an empty reply (model ${data.model || '?'}, finish_reason ${choice?.finish_reason || '?'}, reasoning present: ${hadReasoning})`);
  }
  return { text, model: data.model || MODEL };
}

// Free models are flaky (empty replies, timeouts, 429s), and the router picks a
// different one each call, so a few tries usually finds one that answers.
async function summarise(apiKey, stats) {
  const ATTEMPTS = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await askModel(apiKey, stats);
    } catch (e) {
      if (attempt >= ATTEMPTS) throw e;
      console.warn(`Attempt ${attempt}/${ATTEMPTS} failed (${e.message}) -- retrying.`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function upsertSummary(url, key, userId, stats, result) {
  const res = await fetch(`${url}/rest/v1/ai_summary?on_conflict=user_id`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ user_id: userId, generated_at: new Date().toISOString(), model: result.model, summary: result.text, stats }])
  });
  if (!res.ok) throw new Error(`Upsert error ${res.status}: ${await res.text()}`);
}

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!url || !key || !apiKey) {
    console.warn('SUPABASE_URL, SUPABASE_SERVICE_KEY, or OPENROUTER_API_KEY not set -- skipping.');
    return;
  }

  const since = brisbaneDateStr(-(WINDOW_DAYS - 1));
  const rows = await fetchRows(url, key, since);
  console.log(`Fetched ${rows.length} posture_events rows since ${since}`);
  const perUser = aggregateByUser(rows);
  const userIds = Object.keys(perUser).filter((u) => u && perUser[u].daysLogged > 0);
  console.log(`${userIds.length} user(s) with data: ${userIds.join(', ')}`);

  let failed = 0;
  for (const userId of userIds) {
    try {
      const result = await summarise(apiKey, perUser[userId]);
      await upsertSummary(url, key, userId, perUser[userId], result);
      console.log(`Wrote summary for ${userId} (served by ${result.model})`);
    } catch (err) {
      failed++;
      console.error(`Failed for ${userId}: ${err.message}`);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${userIds.length} user(s) failed.`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
