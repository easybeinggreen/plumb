// Reads the last ~2 weeks of rows from Supabase, asks Anthropic for a summary,
// and writes the result to public/data/summary.json.
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, and ANTHROPIC_API_KEY as secrets.

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'summary.json');
const MODEL = 'claude-haiku-4-5-20251001';

const SLOUCH_TYPES = ['lateral_left', 'lateral_right', 'compression', 'lean_in'];

async function fetchRows() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set – skipping summary generation.');
    return null;
  }

  // posture_events, not posture_logs: each device's chunks land as their own
  // row here, so summing per day is correct across however many devices were
  // used that day. posture_logs is one row per day, last sync wins, and
  // silently undercounts any multi-device day.
  const res = await fetch(`${url}/rest/v1/posture_events?select=date,type,duration_seconds&order=date.asc`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });

  if (!res.ok) {
    console.error(`Supabase read error ${res.status}: ${await res.text()}`);
    return null;
  }

  const data = await res.json();
  console.log(`Fetched ${data.length} rows from posture_events`);
  return data;
}

function aggregate(events) {
  const byDate = {};
  events.forEach((e) => {
    if (!byDate[e.date]) byDate[e.date] = { sessionSeconds: 0, slouchSeconds: 0, breakSeconds: 0, breaksTaken: 0 };
    const dur = e.duration_seconds || 0;
    if (e.type === 'presence') byDate[e.date].sessionSeconds += dur;
    else if (SLOUCH_TYPES.includes(e.type)) byDate[e.date].slouchSeconds += dur;
    else if (e.type === 'break') { byDate[e.date].breakSeconds += dur; byDate[e.date].breaksTaken++; }
  });

  const toMinutes = (s) => Math.round((s || 0) / 60);
  const days = Object.keys(byDate).sort().slice(-14).map((date) => ({
    date,
    sessionMinutes: toMinutes(byDate[date].sessionSeconds),
    slouchMinutes: toMinutes(byDate[date].slouchSeconds),
    breakMinutes: toMinutes(byDate[date].breakSeconds),
    breaksTaken: byDate[date].breaksTaken
  }));

  const totalSession = days.reduce((s, d) => s + d.sessionMinutes, 0);
  const totalSlouch = days.reduce((s, d) => s + d.slouchMinutes, 0);
  const totalBreaksTaken = days.reduce((s, d) => s + d.breaksTaken, 0);

  return {
    daysLogged: days.length,
    totalSessionMinutes: totalSession,
    totalSlouchMinutes: totalSlouch,
    slouchRatePct: totalSession ? Math.round((totalSlouch / totalSession) * 100) : 0,
    totalBreaksTaken,
    days
  };
}

async function getSummary(stats) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set – summary will be empty.');
    return null;
  }

  const prompt =
    `Here is a person's posture and movement tracking log for the last ${stats.daysLogged} days ` +
    `(from a webcam-based tracker that measures head position and neck compression — no video or images, just these numbers):\n\n` +
    `${JSON.stringify(stats.days, null, 2)}\n\n` +
    `Write a short (4-6 sentence) plain-prose summary. Note any real patterns (specific days that are worse, ` +
    `whether things are trending better or worse across the period), and end with exactly one small, concrete ` +
    `suggestion. Be warm and honest, not preachy, and do not use bullet points or headers. Do not diagnose any ` +
    `medical condition or make clinical claims — this is a casual self-tracking tool, not a health device.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
  });

  if (!response.ok) {
    console.error(`Anthropic API error ${response.status}: ${await response.text()}`);
    return null;
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}

(async () => {
  const rows = await fetchRows();

  let summaryObj = {
    generatedAt: new Date().toISOString(),
    stats: null,
    summary: "No data available yet."
  };

  if (rows && rows.length > 0) {
    const stats = aggregate(rows);
    const summaryText = await getSummary(stats);
    summaryObj = {
      generatedAt: new Date().toISOString(),
      stats,
      summary: summaryText || "Summary not available (API key missing or error)."
    };
  } else if (rows) {
    // rows fetched but empty
    summaryObj = {
      generatedAt: new Date().toISOString(),
      stats: null,
      summary: "No tracking data yet."
    };
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summaryObj, null, 2));
  console.log('Wrote summary to', OUTPUT_PATH);
})().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);   // only fail on unexpected errors
});
