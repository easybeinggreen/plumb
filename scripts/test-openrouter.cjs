// Basic connectivity check for OpenRouter -- confirms OPENROUTER_API_KEY works
// and shows which underlying model actually answered. Uses the `openrouter/free`
// meta-model rather than naming a specific free model directly: OpenRouter's
// free-model lineup changes often, and the router auto-picks a compatible free
// model per-request (including filtering for vision support when the request
// needs it) instead of you having to track which free model id is current.
//
// Run locally: OPENROUTER_API_KEY=sk-or-... node scripts/test-openrouter.cjs
//
// Free-tier limits (per OpenRouter docs, as of 2026-09): 20 req/min always;
// 50 req/day per account until you've bought $10+ in credits at any point,
// then 1000 req/day. Fine for this proof-of-connectivity script and for
// occasional interactive use later; a scheduled Action calling this on every
// run would need the $10 credit bump to avoid hitting the 50/day ceiling.

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set.');
    process.exit(1);
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'user', content: 'Reply with exactly one word: connected.' }]
    })
  });

  if (!response.ok) {
    console.error(`OpenRouter API error ${response.status}: ${await response.text()}`);
    process.exit(1);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content;
  console.log('Served by:', data.model);
  console.log('Reply:', reply);
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
