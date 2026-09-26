# Plumb — a posture &amp; movement companion (v2)

A free, self-hosted tool that watches your posture and how often you move using
your webcam, entirely in your browser, speaks nudges in a real neural voice
(Piper, running locally), auto-syncs your stats to a free database, and gives
you a weekly AI-written summary of your trends.

## What changed from v1

- **Voice**: swapped the browser's built-in (often robotic) text-to-speech for
  **Piper**, a real local neural TTS model that runs fully offline after a
  one-time download. You can pick from a few voices in the app.
- **Sync**: no more manual export/drop-in-`logs/`/push. The app now writes your
  stats straight to a free Supabase database every ~10 seconds while it's
  running. The "Download local backup" button still exists as an optional
  personal safety copy, but it's no longer required.
- **Build step**: Piper's library needs to be bundled rather than loaded from a
  CDN in a plain `<script>` tag, so this version uses a small build tool
  (Vite). You never have to run it yourself — GitHub Actions does it on every
  push, still 100% free.
- **Pages source changes**: because there's now a build step, GitHub Pages
  needs to serve the *build output*, not your raw source files. See step 2
  below — you'll need to flip one setting.

## Setup

### 1. Supabase (the "no manual sync" database)

1. Create a free project at [supabase.com](https://supabase.com).
2. Create the tables, policies and functions described in
   [`docs/database-schema.md`](docs/database-schema.md). That file is a snapshot of the
   live database, not a tested install script, and it replaces the older SQL that used to
   be here (which only covered `posture_logs`, a table that has since been retired).
   Two things to know before you start: creating a table grants nothing to `anon`,
   `authenticated` or `service_role`, so grant what each one needs and check it; and RLS
   on most tables is deliberately open to `anon` because "login" is only a name label,
   which is a convenience for keeping people's data apart, not a privacy boundary.

3. In your project's Settings → API, copy three values: the **Project URL**,
   the **anon public key**, and the **service_role key** (keep this last one
   secret — it bypasses the restrictions above entirely).

### 2. GitHub repo secrets

Repo Settings → Secrets and variables → Actions → New repository secret, add:

| Name | Value | Sensitive? |
|---|---|---|
| `VITE_SUPABASE_URL` | your Project URL | No — safe to expose, kept here just for convenience |
| `VITE_SUPABASE_ANON_KEY` | your anon public key | No — same as above |
| `SUPABASE_URL` | your Project URL (same value again) | No |
| `SUPABASE_SERVICE_KEY` | your service_role key | **Yes — keep private** |
| `OPENROUTER_API_KEY` | from openrouter.ai/keys (used by the weekly analysis and the weekly ai summary, both on free models) | **Yes — keep private** |
| `CALENDAR_ICS_URL` | your calendar's private iCal link (optional; enables call detection) | **Yes — anyone with it can read your whole calendar** |

The AI camera review runs as a Supabase Edge Function and needs its **own** copy of
`OPENROUTER_API_KEY` under Edge Functions → Secrets in the Supabase dashboard (GitHub
secrets can't be read by Supabase). See `PROJECT_NOTES.md` for how everything fits together.

### 3. GitHub Pages source

Because this version has a build step, go to Settings → Pages → Source and
change it to **"GitHub Actions"** (not "Deploy from a branch" like before).

### 4. Push, then check the Actions tab

Pushing to `main` triggers a build + deploy automatically. The weekly AI summary
is a separate workflow ("Weekly AI summary") that runs Mondays and writes to the
`ai_summary` table; trigger it manually from the Actions tab (Run workflow) to
test without waiting for Monday.

### 5. Local development (optional)

```bash
npm install
cp .env.example .env   # fill in your Supabase URL + anon key
npm run dev
```

## Notes and honest caveats

- **Piper's voice model downloads once** (typically tens of MB total,
  including the ONNX runtime) and is cached by the browser afterward —
  subsequent visits and nudges are instant and fully offline.
- **Supabase's free tier pauses a project after 7 days with no API activity.**
  Regular use of the app (which syncs every ~10s while running) keeps it
  awake; if you don't use the tracker for over a week, you may need to
  manually resume the project from the Supabase dashboard before syncing
  works again.
- **Nothing here is medical advice.** This is a casual self-tracking tool.
- The forward-head angle is relative to *your* calibrated baseline —
  recalibrate if your chair, desk, or camera position changes.
