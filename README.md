# Plumb — a posture &amp; movement companion

A free, self-hosted tool that watches your posture and how often you move using
your webcam, entirely in your browser, and gives you a weekly AI-written summary
of your trends. No paid services, no exposed API keys, no video ever leaves your
device.

## How it works

- **`index.html`** — the real-time app. Runs pose detection (MediaPipe) on your
  webcam feed locally in the browser. Tracks a forward-head angle relative to a
  posture you calibrate, speaks a nudge (using the browser's built-in
  text-to-speech) when you've been slouching for a while, and another nudge when
  you haven't moved in a set number of minutes. Logs only small numbers (angle
  deviations, timestamps, nudge counts) to `localStorage` — no video, ever.
- **`logs/`** — where you drop your exported log file to sync it into the repo.
  This *is* the "database" — just a JSON file, committed with everything else.
- **`.github/workflows/weekly-summary.yml`** — a GitHub Action that runs weekly
  (or whenever you push a new log, or manually), reads everything in `logs/`,
  and asks the Anthropic API for a short written summary of your patterns.
- **`scripts/generate-summary.js`** — the Node script the Action runs.
- **`data/summary.json`** — the Action's output: your latest AI summary + stats.
- **`summary.html`** — a page that displays that summary and a small chart.

## Setup (10 minutes)

1. **Push this folder to a new GitHub repository** (public repos get free,
   unlimited GitHub Actions minutes — that's what makes this free).

2. **Enable GitHub Pages**: repo Settings → Pages → Source: "Deploy from a
   branch" → Branch: `main`, folder `/ (root)`. Save. Your app will be live at
   `https://<your-username>.github.io/<repo-name>/`.

3. **Get an Anthropic API key**: [console.anthropic.com](https://console.anthropic.com)
   → API Keys → Create key. This costs a small amount per call (a weekly summary
   of a few numbers is a fraction of a cent), billed to your own account.

4. **Add it as a repo secret**: repo Settings → Secrets and variables → Actions
   → New repository secret → name it `ANTHROPIC_API_KEY`, paste the key.

5. **Visit `index.html`** on your Pages URL, click "Start camera", allow camera
   access, sit up straight and click "Calibrate good posture", then just leave
   the tab open while you work.

6. **Whenever you want a synced history**: click "Export log for GitHub" in the
   app. It downloads `posture-log.json` containing your full local history.
   Replace the file at `logs/posture-log.json` in your repo with it, commit, and
   push. That either triggers the Action immediately (via the `logs/**` push
   trigger) or it'll run on its own next Monday.

7. **Check `summary.html`** on your Pages URL after the Action runs (or trigger
   it manually: Actions tab → "Weekly posture & movement summary" → Run workflow).

## Notes and honest caveats

- **Nothing here is medical advice.** This is a casual self-tracking tool, not a
  posture or health device. If you have real neck/back pain, see an actual
  professional.
- **Calibration matters.** The forward-head angle is measured relative to
  *your* calibrated baseline, not an absolute "correct" posture — recalibrate
  if you change chair height, camera position, etc.
- **The AI layer is intentionally separate from the real-time layer.** Nudges
  are plain geometry (angle thresholds, movement thresholds) so they're instant
  and free. The Anthropic API is only used for the periodic written summary,
  because an API key can't safely live in browser-side JavaScript — anyone
  could view-source and take it. That's why syncing is a manual export/push
  step rather than automatic.
- **Camera access requires HTTPS or localhost.** GitHub Pages serves over
  HTTPS, so this works fine once deployed; it'll also work if you just open
  `index.html` via a local dev server.
- If you'd rather not do the manual export/push step, a natural next upgrade is
  wiring the app to a free hosted database (Turso or Supabase) with a
  write-only token — happy to help with that next if you want it.
