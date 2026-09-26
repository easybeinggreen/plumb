// Friday weekly pattern analysis (all users): a thin wrapper around the shared
// module in supabase/functions/weekly-analysis/analysis.js, which is also what the
// app's "generate weekly summary" button runs (via the weekly-analysis edge
// function). All the aggregation, the prompt and the OpenRouter call live there.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENROUTER_API_KEY as secrets.
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!supabaseUrl || !serviceKey || !openrouterKey) {
    console.warn('SUPABASE_URL, SUPABASE_SERVICE_KEY, or OPENROUTER_API_KEY not set -- skipping.');
    return;
  }

  const modulePath = path.join(__dirname, '..', 'supabase', 'functions', 'weekly-analysis', 'analysis.js');
  const { generateWeeklyAnalysis } = await import(pathToFileURL(modulePath).href);

  // The 7 days ending yesterday (Brisbane), for every user with data.
  const results = await generateWeeklyAnalysis({ supabaseUrl, serviceKey, openrouterKey, endDay: 'yesterday' });

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`${failed.length}/${results.length} user(s) failed.`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Weekly analysis failed:', err.message);
  process.exit(1);
});
