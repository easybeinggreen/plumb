// Rolls raw posture_events older than 2 days into posture_daily_summary, so
// the week/month report can read a few dozen pre-summed rows instead of
// pulling thousands of individual nudge-level events through the REST API's
// row cap. This never touches or deletes posture_events -- it's a read-side
// cache, not an archive. Raw history stays exactly where it is, forever,
// for anything (today's timeline, a drilled-into past day, future
// pattern-detection work) that needs full granularity.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_KEY as secrets (same ones
// generate-summary.cjs already uses).
//
// The 2-day buffer exists because `date` is bucketed by each device's LOCAL
// wall-clock day, not UTC -- a session logged late at night in a timezone
// ahead of UTC could still be "today" or "yesterday" locally while looking
// older from here. Recomputing everything up to the cutoff on every run
// (rather than tracking what's "new") keeps this self-healing: a
// late-arriving write, a backdated correction, or a missed run all just get
// picked up cleanly next time.
//
// "Today" for that buffer must be computed in Brisbane time, not the
// runner's ambient UTC clock. The cron deliberately fires at 2am Brisbane
// (16:00 UTC the previous day), which is a UTC calendar date still one day
// behind Brisbane's -- computing the cutoff from raw UTC `now` silently
// landed the whole rollup a full day earlier than the app (running on the
// user's actual Brisbane-local browser clock) expects, every single night.
// Confirmed 2026-09-17: two runs on the same UTC day both produced cutoff
// 2026-09-14 while the client already expected 2026-09-15, leaving that day
// permanently blank in the week/month chart. AEST has no DST, so a fixed
// +10h offset is safe year-round.
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

function cutoffDate() {
  const brisbaneNow = new Date(Date.now() + BRISBANE_OFFSET_MS);
  brisbaneNow.setUTCDate(brisbaneNow.getUTCDate() - 2);
  return brisbaneNow.toISOString().slice(0, 10); // YYYY-MM-DD, Brisbane-local
}

async function fetchRows(url, key, cutoff) {
  const res = await fetch(
    `${url}/rest/v1/posture_events?select=date,user_id,type,duration_seconds&date=lte.${cutoff}&order=date.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) throw new Error(`Read error ${res.status}: ${await res.text()}`);
  return res.json();
}

function aggregate(rows) {
  const byKey = {};
  rows.forEach((r) => {
    const key = `${r.date}\u0000${r.user_id}\u0000${r.type}`;
    if (!byKey[key]) byKey[key] = { date: r.date, user_id: r.user_id, type: r.type, total_seconds: 0, event_count: 0 };
    byKey[key].total_seconds += r.duration_seconds || 0;
    byKey[key].event_count += 1;
  });
  return Object.values(byKey);
}

async function upsert(url, key, summaryRows) {
  if (summaryRows.length === 0) return;
  const now = new Date().toISOString();
  const payload = summaryRows.map((r) => ({ ...r, updated_at: now }));

  const res = await fetch(`${url}/rest/v1/posture_daily_summary?on_conflict=date,user_id,type`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Upsert error ${res.status}: ${await res.text()}`);
}

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set -- skipping rollup.');
    return;
  }

  const cutoff = cutoffDate();
  console.log(`Rolling up posture_events with date <= ${cutoff}`);

  const rows = await fetchRows(url, key, cutoff);
  console.log(`Fetched ${rows.length} raw rows`);

  const summaryRows = aggregate(rows);
  console.log(`Aggregated into ${summaryRows.length} summary rows`);

  await upsert(url, key, summaryRows);
  console.log('Upsert complete.');
})().catch((err) => {
  console.error('Rollup failed:', err.message);
  process.exit(1);
});
