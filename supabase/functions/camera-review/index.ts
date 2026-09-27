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

// Free vision-capable models only, tried three at a time (first valid answer wins). It used to use
// OpenRouter's general `openrouter/free` router, which picks from ALL free models: on 2026-09-27 only
// 8 of 17 free models accepted an image at all (one of those is a safety classifier), so the router
// succeeded roughly 2 attempts in 7. The list below is the free models that take images; override it
// with the CAMERA_REVIEW_MODELS secret (comma separated) when OpenRouter changes what is free.
// Checked live on 2026-09-27 with a test frame: the two thinkingmachines/inkling models always return 403,
// dots-3-note-preview always returns an empty reply, so they are left out; qwen is often rate limited (429)
// and gemma-4-31b's gateway often times out (502/504), but both do answer sometimes.
const DEFAULT_MODELS = [
  'google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free', 'qwen/qwen3.8-27b:free'
].join(',');
const MODELS = (Deno.env.get('CAMERA_REVIEW_MODELS') || DEFAULT_MODELS).split(',').map((m) => m.trim()).filter(Boolean);
const PARALLEL = 3;
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

// Some free models reject JSON mode (HTTP 400): that model is retried once without it.
async function askOne(apiKey: string, image: string, model: string, timeoutMs: number) {
  try {
    return await askModel(apiKey, image, model, true, timeoutMs);
  } catch (e) {
    if (String((e as Error).message) === 'model_http_400') return await askModel(apiKey, image, model, false, timeoutMs);
    throw e;
  }
}

async function askWithRetries(apiKey: string, image: string) {
  const start = Date.now();
  let next = 0, attempts = 0;
  while (Date.now() - start < BUDGET_MS - 6_000) {
    const timeoutMs = Math.min(ATTEMPT_MS, BUDGET_MS - (Date.now() - start));
    const round = Array.from({ length: Math.min(PARALLEL, MODELS.length) }, () => MODELS[next++ % MODELS.length]);
    attempts += round.length;
    try {
      return await Promise.any(round.map(async (model) => {
        try {
          const r = await askOne(apiKey, image, model, timeoutMs);
          const { items, summary } = normalise(r.parsed);
          return { items, summary, model: r.model, attempts };
        } catch (e) {
          console.error(`camera-review ${model} failed: ${String((e as Error).message)}`);
          throw e;
        }
      }));
    } catch (e) {
      const errors = ((e as any)?.errors || []).map((x: Error) => String(x.message));
      if (errors.length > 0 && errors.every((m: string) => m === 'model_http_401')) return null; // bad key: retrying won't help
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
}

// Free models do not all answer in exactly the requested shape, so this accepts an `items` list whose
// entries use id/name/check, status/result and msg/message/comment, or an object keyed by the check names.
function normalise(parsed: any) {
  const byId: Record<string, any> = {};
  const list = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  list.forEach((it: any) => {
    const id = it && (it.id || it.name || it.check || it.item);
    if (typeof id === 'string') byId[id.toLowerCase().replace(/[^a-z_]/g, '_')] = it;
  });
  CHECK_IDS.forEach((id) => { if (!byId[id] && parsed && typeof parsed === 'object' && parsed[id] != null) byId[id] = parsed[id]; });
  const items = CHECK_IDS.map((id) => {
    const it = byId[id];
    if (it == null) return null;
    const msg = typeof it === 'string' ? it : (it.msg ?? it.message ?? it.comment ?? it.text);
    if (typeof msg !== 'string' || !msg.trim()) return null;
    const st = typeof it === 'object' ? String(it.status ?? it.result ?? '').toLowerCase() : '';
    return { id, status: ['ok', 'good', 'pass', 'fine'].includes(st) ? 'ok' : 'fix', msg: msg.slice(0, 220) };
  }).filter(Boolean);
  if (items.length === 0) {
    console.error(`camera-review bad shape, reply began: ${JSON.stringify(parsed).slice(0, 300)}`);
    throw new Error('bad_shape');
  }
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

  const result = await askWithRetries(apiKey, image);
  if (!result) {
    await supabase.rpc('camera_review_refund', { p_user: userId }); // a failed review shouldn't use up the daily allowance
    return json({ error: 'model_failed', message: 'The free AI service is busy right now and could not finish the review. Please try again in a minute.' }, 502, origin);
  }
  return json(result, 200, origin);
});
