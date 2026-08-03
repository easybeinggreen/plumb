// Reads the last ~2 weeks of rows from Supabase, asks Anthropic for a summary,
// and writes the result to public/data/summary.json.
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, and ANTHROPIC_API_KEY as secrets.

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'summary.json');
const MODEL = 'claude-haiku-4-5-20251001';

async function fetchRows() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set – skipping summary generation.');
    return null;
  }

  const res = await fetch(`${url}/rest/v1/posture_logs?select=*&order=date.asc&limit=100`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });

  if (!res.ok) {
    console.error(`Supabase read error ${res.status}: ${await res.text()}`);
    return null;
  }

  const data = await res.json();
  console.log(`Fetched ${data.length} rows from posture_logs`);
  return data;
}

function aggregate(rows) {
  const recent = rows.slice(-14);
  const toMinutes = (s) => Math.round((s || 0) / 60);

  const days = recent.map((r) => ({
    date: r.date,
    sessionMinutes: toMinutes(r.session_seconds),
    slouchMinutes: toMinutes(r.slouch_seconds),
    postureNudges: r.posture_nudges || 0,
    breakNudges: r.break_nudges || 0,
    breaksTaken: r.breaks_taken || 0
  }));

  const totalSession = days.reduce((s, d) => s + d.sessionMinutes, 0);
  const totalSlouch = days.reduce((s, d) => s + d.slouchMinutes, 0);
  const totalBreakNudges = days.reduce((s, d) => s + d.breakNudges, 0);
  const totalBreaksTaken = days.reduce((s, d) => s + d.breaksTaken, 0);

  return {
    daysLogged: days.length,
    totalSessionMinutes: totalSession,
    totalSlouchMinutes: totalSlouch,
    slouchRatePct: totalSession ? Math.round((totalSlouch / totalSession) * 100) : 0,
    totalBreakNudges,
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
