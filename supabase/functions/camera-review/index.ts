// "Are you camera ready?" AI review. Takes ONE webcam frame (JPEG, base64),
// asks a vision model on OpenRouter about hair / clothing / background /
// things behind the head, returns short checklist rows. The frame is never
// stored or logged. Runs with verify_jwt off because the app has no user
// auth (name label only) and the project's publishable key isn't a JWT --
// so the real protection is: size cap, per-user and global daily caps
// (public.camera_review_take), CORS limited to the app's origins, and the
// OpenRouter key living only as a function secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SYSTEM_PROMPT, USER_PROMPT, CHECK_IDS } from './prompt.js';

// The free router picks whichever free model is available. Named free models were tried
// individually (2026-09-19) and failed almost every time (timeouts, empty replies, 403/404);
// the router succeeded roughly 2 in 7 attempts, so askWithRetries keeps trying within a time budget.
const MODEL = Deno.env.get('CAMERA_REVIEW_MODEL') || 'openrouter/free';
const USER_DAILY_CAP = Number(Deno.env.get('CAMERA_REVIEW_USER_CAP') || 10);
const GLOBAL_DAILY_CAP = Number(Deno.env.get('CAMERA_REVIEW_GLOBAL_CAP') || 150);
const MAX_BODY_BYTES = 1_500_000;
const BUDGET_MS = 115_000;   // total retry budget; the platform wall-clock limit is 150s on the free plan
const ATTEMPT_MS = 40_000;   // per-attempt cap so one hung free model can't eat the whole budget

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

async function askModel(apiKey: string, imageB64: string, model: string, jsonMode: boolean, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 600,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: USER_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}` } }
          ] }
        ]
      })
    });
    if (!res.ok) throw new Error(`model_http_${res.status}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    return { parsed: JSON.parse(cleaned), model: data.model || model };
  } finally {
    clearTimeout(timer);
  }
}

async function askWithRetries(apiKey: string, image: string, model: string) {
  const start = Date.now();
  let jsonMode = true;
  let attempt = 0;
  while (Date.now() - start < BUDGET_MS - 6_000) {
    attempt++;
    const timeoutMs = Math.min(ATTEMPT_MS, BUDGET_MS - (Date.now() - start));
    try {
      const r = await askModel(apiKey, image, model, jsonMode, timeoutMs);
      const { items, summary } = normalise(r.parsed);
      return { items, summary, model: r.model, attempts: attempt };
    } catch (e) {
      const msg = String((e as Error).message);
      console.error(`camera-review attempt ${attempt} failed: ${msg}`);
      if (msg === 'model_http_401') return null; // bad key -- retrying won't help
      if (msg === 'model_http_400') jsonMode = false; // some free models reject JSON mode
      await new Promise((r) => setTimeout(r, msg === 'model_http_429' ? 3000 : 500));
    }
  }
  return null;
}

function normalise(parsed: any) {
  const byId: Record<string, any> = {};
  (Array.isArray(parsed?.items) ? parsed.items : []).forEach((it: any) => { if (it && typeof it.id === 'string') byId[it.id] = it; });
  const items = CHECK_IDS.map((id) => {
    const it = byId[id];
    if (!it || typeof it.msg !== 'string') return null;
    return { id, status: it.status === 'ok' ? 'ok' : 'fix', msg: it.msg.slice(0, 220) };
  }).filter(Boolean);
  if (items.length === 0) throw new Error('bad_shape');
  return { items, summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 260) : '' };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);

  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return json({ error: 'not_configured', message: 'The AI review is not set up yet.' }, 503, origin);

  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return json({ error: 'too_large', message: 'That picture is too large.' }, 413, origin);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400, origin); }
  const userId = typeof body?.user_id === 'string' ? body.user_id.trim().slice(0, 60) : '';
  let image = typeof body?.image === 'string' ? body.image : '';
  image = image.replace(/^data:image\/jpeg;base64,/, '');
  if (!userId || !image || image.length > MAX_BODY_BYTES || !image.startsWith('/9j/')) return json({ error: 'bad_request', message: 'Expected a JPEG picture and a user name.' }, 400, origin);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: allowed, error: capErr } = await supabase.rpc('camera_review_take', { p_user: userId, p_user_cap: USER_DAILY_CAP, p_global_cap: GLOBAL_DAILY_CAP });
  if (capErr) return json({ error: 'server_error', message: 'Could not check today\'s usage.' }, 500, origin);
  if (!allowed) return json({ error: 'daily_limit', message: `You've used today's ${USER_DAILY_CAP} AI reviews (or the shared daily limit was reached). Try again tomorrow.` }, 429, origin);

  const result = await askWithRetries(apiKey, image, MODEL);
  if (!result) {
    await supabase.rpc('camera_review_refund', { p_user: userId }); // a failed review shouldn't use up the daily allowance
    return json({ error: 'model_failed', message: 'The free AI service is busy right now and could not finish the review. Please try again in a minute.' }, 502, origin);
  }
  return json(result, 200, origin);
});
