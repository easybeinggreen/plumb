// Reads everything in /logs, aggregates stats, asks the Anthropic API for a short
// written summary, and writes the result to /data/summary.json for summary.html to read.
//
// Requires an ANTHROPIC_API_KEY environment variable (set as a GitHub Actions secret).
// Uses Node's built-in fetch (Node 18+).

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'summary.json');
const MODEL = 'claude-haiku-4-5-20251001'; // cheap + plenty for a short summary of small numeric logs

function loadLogs() {
  if (!fs.existsSync(LOGS_DIR)) return [];
  const entries = [];
  for (const file of fs.readdirSync(LOGS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const parsed = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, file), 'utf8'));
    if (Array.isArray(parsed)) entries.push(...parsed);
    else entries.push(parsed);
  }
  // de-dupe by date (keep whichever entry appears last)
  const byDate = {};
  for (const e of entries) {
    if (e && e.date) byDate[e.date] = e;
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

function aggregate(logs) {
  const recent = logs.slice(-14);
  const toMinutes = (s) => Math.round((s || 0) / 60);

  const days = recent.map(d => ({
    date: d.date,
    sessionMinutes: toMinutes(d.sessionSeconds),
    slouchMinutes: toMinutes(d.slouchSeconds),
    postureNudges: d.postureNudges || 0,
    moveNudges: d.moveNudges || 0
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
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (add it as a repo secret).');

  const prompt = `Here is a person's posture and movement tracking log for their last ${stats.daysLogged} tracked days ` +
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
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '(no summary text returned)';
}

(async () => {
  const logs = loadLogs();

  if (logs.length === 0) {
    console.log('No logs found in /logs yet — nothing to summarize.');
    process.exit(0);
  }

  const stats = aggregate(logs);
  const summaryText = await getSummary(stats);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    stats,
    summary: summaryText
  }, null, 2));

  console.log('Wrote summary to', OUTPUT_PATH);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
