// Reads the last ~2 weeks of rows from Supabase, asks the Anthropic API for a short
// written summary, and writes the result to public/data/summary.json (served statically
// by the built site). Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, and ANTHROPIC_API_KEY
// as GitHub Actions secrets. Uses Node's built-in fetch (Node 18+).

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'summary.json');
const MODEL = 'claude-haiku-4-5-20251001'; // cheap + plenty for summarizing a handful of numbers

async function fetchRows() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set (add as repo secrets).');

  const res = await fetch(`${url}/rest/v1/posture_logs?select=*&order=date.asc&limit=100`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!res.ok) throw new Error(`Supabase read error ${res.status}: ${await res.text()}`);
  return res.json();
}

function aggregate(rows) {
  const recent = rows.slice(-14);
  const toMinutes = (s) => Math.round((s || 0) / 60);

  const days = recent.map((r) => ({
    date: r.date,
    sessionMinutes: toMinutes(r.session_seconds),
    slouchMinutes: toMinutes(r.slouch_seconds),
    postureNudges: r.posture_nudges || 0,
    moveNudges: r.move_nudges || 0
  }));

  const totalSession = days.reduce((s, d) => s + d.sessionMinutes, 0);
  const totalSlouch = days.reduce((s, d) => s + d.slouchMinutes, 0);
  const totalMoveNudges = days.reduce((s, d) => s + d.moveNudges, 0);

  return {
    daysLogged: days.length,
    totalSessionMinutes: totalSession,
    totalSlouchMinutes: totalSlouch,
    slouchRatePct: totalSession ? Math.round((totalSlouch / totalSession) * 100) : 0,
    totalMoveNudges,
    days
  };
}

async function getSummary(stats) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set (add as a repo secret).');

  const prompt =
    `Here is a person's posture and movement tracking log for their last ${stats.daysLogged} tracked days ` +
    `(from a webcam-based tracker that measures forward-head angle and time spent stationary — no video or images, just these numbers):\n\n` +
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

  if (!response.ok) throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '(no summary text returned)';
}

(async () => {
  const rows = await fetchRows();

  if (!rows || rows.length === 0) {
    console.log('No rows in Supabase yet — nothing to summarize.');
    process.exit(0);
  }

  const stats = aggregate(rows);
  const summary = await getSummary(stats);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), stats, summary }, null, 2)
  );

  console.log('Wrote summary to', OUTPUT_PATH);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
