// "Generate / update weekly summary" button. Runs the same analysis the Friday job
// runs (analysis.js), but for ONE user, on demand, over the 7 days ending today.
// Lives here rather than in the page because the OpenRouter key can't be public.
// Runs with verify_jwt off because the app has no user auth (name label only) and
// the project's publishable key isn't a JWT -- so, like camera-review, the real
// protection is: per-user and global daily caps (public.camera_review_take, under a
// "summary:<user>" key so it doesn't eat that user's camera-review allowance),
// CORS limited to the app's origins, and the OpenRouter key living only as a
// function secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { generateWeeklyAnalysis } from './analysis.js';

const USER_DAILY_CAP = Number(Deno.env.get('WEEKLY_SUMMARY_USER_CAP') || 6);
const GLOBAL_DAILY_CAP = Number(Deno.env.get('WEEKLY_SUMMARY_GLOBAL_CAP') || 150);
const MIN_PRESENCE_SEC = 10 * 60;   // at least 10 tracked minutes before it is worth asking a model
const BUDGET_MS = 115_000;          // total time for model attempts; the platform wall-clock limit is 150s on the free plan
const ATTEMPT_MS = 45_000;          // per-attempt cap so one hung free model can't eat the whole budget

const ALLOWED_ORIGINS = ['https://easybeinggreen.github.io'];
function corsHeaders(origin: string | null) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);

  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return json({ error: 'not_configured', message: 'The AI summary is not set up yet.' }, 503, origin);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400, origin); }
  const userId = typeof body?.user_id === 'string' ? body.user_id.trim().slice(0, 60) : '';
  if (!userId) return json({ error: 'bad_request', message: 'Expected a user name.' }, 400, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const capKey = `summary:${userId}`;
  const { data: allowed, error: capErr } = await supabase.rpc('camera_review_take', { p_user: capKey, p_user_cap: USER_DAILY_CAP, p_global_cap: GLOBAL_DAILY_CAP });
  if (capErr) return json({ error: 'server_error', message: 'Could not check today\'s usage.' }, 500, origin);
  if (!allowed) return json({ error: 'daily_limit', message: `You've used today's ${USER_DAILY_CAP} summaries (or the shared daily limit was reached). Try again tomorrow.` }, 429, origin);

  let result;
  try {
    const results = await generateWeeklyAnalysis({
      supabaseUrl, serviceKey, openrouterKey: apiKey, userId, endDay: 'today',
      minPresenceSec: MIN_PRESENCE_SEC, attemptMs: ATTEMPT_MS, budgetMs: BUDGET_MS, attempts: 6, parallel: 3
    });
    result = results[0];
  } catch (e) {
    console.error('weekly-analysis failed:', (e as Error).message);
    result = { ok: false, code: 'server_error', message: 'Something went wrong reading your data.' };
  }

  if (!result || !result.ok) {
    // A failed or empty run shouldn't use up the daily allowance.
    await supabase.rpc('camera_review_refund', { p_user: capKey });
    if (result?.code === 'no_data' || result?.code === 'not_enough_data') return json({ error: result.code, message: result.message }, 200, origin);
    return json({ error: 'model_failed', message: 'The free AI service is busy right now and could not finish the summary. Please try again in a minute.' }, 502, origin);
  }
  return json({ ok: true, week_start: result.weekStart, week_end: result.weekEnd, model: result.model }, 200, origin);
});
