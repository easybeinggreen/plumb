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

## Migrating your existing repo

You already pushed the v1 files. For this version:

1. Delete the old `logs/`, `data/`, and `.github/workflows/weekly-summary.yml`
   from your repo (they're superseded by the files here).
2. Copy everything in this folder into your repo, replacing `index.html`,
   `summary.html`, and `README.md`, and adding the new `package.json`,
   `vite.config.js`, `.gitignore`, `.env.example`, `src/`, and the updated
   `.github/workflows/deploy.yml`.
3. Commit and push as normal.

## Setup

### 1. Supabase (the "no manual sync" database)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run:

    ```sql
    create table if not exists posture_logs (
      date text primary key,
      session_seconds integer not null default 0,
      slouch_seconds integer not null default 0,
      posture_nudges integer not null default 0,
      move_nudges integer not null default 0,
      updated_at timestamptz not null default now()
    );

    alter table posture_logs enable row level security;

    -- Supabase now requires explicit grants in addition to RLS policies
    -- for tables created after May 2026 — this line covers that.
    grant select, insert, update on posture_logs to anon, authenticated;

    create policy "anon can insert rows"
      on posture_logs for insert
      to anon
      with check (true);

    create policy "anon can update rows"
      on posture_logs for update
      to anon
      using (true)
      with check (true);
    ```

    Note there's deliberately no `select` policy for `anon` — the browser can
    write but not read back, and the GitHub Action reads using a separate,
    non-public key. This means the public key sitting in your site's source
    can be used to write junk rows, but not to read your data. Low stakes for
    a personal tracker, but worth knowing.

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
| `ANTHROPIC_API_KEY` | from console.anthropic.com | **Yes — keep private** |

### 3. GitHub Pages source

Because this version has a build step, go to Settings → Pages → Source and
change it to **"GitHub Actions"** (not "Deploy from a branch" like before).

### 4. Push, then check the Actions tab

Pushing to `main` triggers a build + deploy automatically. The AI summary step
only runs on the Monday schedule or when you manually trigger the workflow
(Actions tab → "Summarize, build, and deploy" → Run workflow) — useful for
testing without waiting for Monday.

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
