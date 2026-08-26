# Plumb — project notes

This is a handoff/context document, not a user-facing README (that's [README.md](README.md)).
It exists so that a new developer, or a fresh AI session with no memory of prior
conversations, can pick this project up cold and understand what it's for, what's
actually true about its current state, what decisions were made and why, and
what's still open. Update it when you make a decision worth remembering, not
after every commit.

## What this is

A personal, self-hosted posture and movement tracker. Runs entirely in the
browser: webcam → MediaPipe pose landmarks → compares your shoulder/ear
position against a calibrated baseline → speaks nudges via a local neural TTS
voice (Piper, offline after first download) when you're slumping, leaning, or
have been still/sitting too long. Syncs stats to Supabase every ~10s. Deploys
to GitHub Pages via GitHub Actions on every push to `main`. Single-maintainer,
prototype-quality, not a medical device, not a commercial product.

## Stack

- **Frontend**: Vite + vanilla JS (no framework), single `src/main.js` (~2000
  lines) driving a single `index.html`. `@mediapipe/tasks-vision` for pose
  detection, `@mintplex-labs/piper-tts-web` for offline neural voice.
- **Backend**: Supabase (Postgres + PostgREST), accessed directly from the
  browser via `fetch` — no server code except the GitHub Action script.
- **Hosting**: GitHub Pages, built by `.github/workflows/deploy.yml`.
- **AI summary** (currently dormant, see below): `scripts/generate-summary.cjs`
  runs in the Monday-morning scheduled Action, reads Supabase, calls the
  Anthropic API, writes `public/data/summary.json`.

## Current status (as of 2026-08-22)

**Confirmed working**, tested live in Chrome:
- Camera start → 10s alignment countdown with live pose-dot preview → PiP
  auto-opens with no second click
- Calibration usable immediately (not gated behind the countdown)
- Break gauge (live countdown to next break)
- Voice defaults correctly to a browser voice (see "voice selection" below)
- Per-user name picker: first-run flow, localStorage persistence, settings
  modal shows who's signed in + switch-user

**Implemented and code-reviewed, but not yet proven over real hours/days of
use** — this is the honest caveat, not false modesty:
- Cross-device session/slouch reconciliation (`mergeRemoteStats` /
  `reconcileTodayFromCloud`)
- Day-timeline gap-bridging for camera blips
- Per-user data isolation end-to-end (schema migration applied and verified
  by inspection, but not exercised by two real people trialing it yet)

**Deliberately dormant / paused on purpose** (not broken, just not switched
on — see "Decisions" below for why):
- AI weekly summary — `ANTHROPIC_API_KEY` is set as a GitHub secret but the
  script has never actually reached the Anthropic call (verified via Action
  logs) because the Supabase read failed on a permissions issue. Zero tokens
  spent so far. Left off intentionally until there's a stretch of trustworthy
  multi-day, multi-user data to summarize.

**Explicitly out of scope for now** (user's own call, not a technical limit):
- Real authentication (see "not real auth" below)
- Full UI/UX redesign — next planned piece of work
- Hydration icon resize/repositioning — small polish item, bundled into the
  UI pass

## Known issues / open questions

1. **Posture glyph (loop + dot) is visually miscalibrated.** The tolerance
   ellipse's radius is drawn *linearly* from the tolerance slider
   (`radius = tolerance × 210px`), but the dot's position is drawn from a
   `tanh`-curved mapping of the actual deviation (`offset = 64 × tanh(deviation
   × 12)`). `tanh` saturates fast: at the default 0.20 tolerance, the dot
   visually exits the loop at a deviation of ~0.07 — about a third of the way
   to the real detection threshold of 0.20. So the loop currently
   under-represents your real tolerance by roughly 3x. This is a real bug,
   not user error — confirmed by direct calculation, not just observation.
   Fix is to make the dot's mapping proportional to the tolerance value
   instead of a fixed curve. Not yet fixed — queued for the UI/UX pass.

2. **Name identity has no normalization.** `"Paul"`, `"paul"`, and `"Paul "`
   (trailing space) are three different users as far as the app and database
   are concerned — no trim, no case-folding. Fine solo; will cause silent
   data splitting once real people other than you start typing names. Cheap
   fix (trim + lowercase for comparison, keep original casing for display),
   not yet done.

3. **`generate-summary.cjs` doesn't filter by user.** Once more than one
   person's data exists in `posture_events`, the (currently dormant) weekly
   summary would blend everyone's stats into one narrative. Needs a
   `user_id` filter (or a per-user summary run) before it's turned on for
   real, multi-person use.

4. **`posture_logs` table still exists but is fully unused** by the app. Kept
   for now rather than dropped; safe to `drop table posture_logs;` whenever.

5. **RLS stays permissive at the database level.** Every table's row-level
   security policy is `using (true)` — the anon key (already public, embedded
   in the deployed site's source) can read/write any row for any user. The
   per-user separation described below is enforced entirely client-side (the
   app only ever queries its own `user_id`), not at the database level. This
   was a deliberate, discussed tradeoff (see "Decisions"), not an oversight —
   but it means the "login" system is a data-partitioning convenience, not a
   privacy boundary.

## The presence/break/away/not-tracking state model

This is the most conceptually tangled part of the app and worth understanding
before touching it. There are **two independent detection paths** for "the
person isn't being tracked right now," and they behave differently:

**Path A — camera-based** (tracking loop is running, but MediaPipe stops
seeing a person in frame). Classified in `classifyGap()`:
- < 60s (`BREAK_MIN_SECONDS`): discarded entirely, no event logged. The
  presence block still splits around it (ends, then a new one starts when the
  person reappears), which is harmless — just noise suppression.
- 60s–60min (`BREAK_MAX_SECONDS`): logged as a `break` event, counts toward
  the break gauge.
- \>60min: logged as an `away` event. Does **not** count as a break.

**Path B — tab/session-based**:
- Tab hidden while PiP is active: ignored entirely — the PiP window's own
  `requestAnimationFrame` loop keeps tracking regardless of main-tab
  visibility. This is the whole point of PiP.
- Tab hidden (no PiP, or PiP failed to open) for ≥2s: always logged as
  `not_tracking`, **never** credited as a break, regardless of duration. This
  is intentionally more conservative than Path A — we genuinely don't know
  what you were doing with the tab hidden, so it's never assumed to be a
  legitimate break.
- App closed and reopened later (`logStartupGap`, same calendar day only):
  <60s ignored, 60s–60min retroactively logged as a `break`, >60min logged as
  `not_tracking`.

**Known limitation**: `logStartupGap` only knows about the single device it's
running on (reads one `localStorage` key). If you stop tracking on Device A
and immediately pick up on Device B, then return to Device A hours later,
Device A has no way to know Device B was tracking in the meantime — it will
log that whole gap as `not_tracking` on Device A even though you were, in
fact, being tracked the whole time. Not fixed; would need a "was any device
tracking during this window" check against `posture_events` instead of a
purely local timestamp.

## Decisions made, and why

- **Event-sourced, not aggregate-first.** Every meaningful interval (presence,
  break, slouch type, away, not-tracking) is logged as its own row in
  `posture_events` with a start/end time. Daily totals are *computed* from
  these rows (client-side in the report tab, summed by date) rather than
  trusted from a single denormalized per-day counter. This is what makes
  multi-device correctness possible: each device's rows just add up, instead
  of one device's "current total" overwriting another's on every sync. The
  `posture_logs` table was the old denormalized-per-day approach and is why
  it's now retired — it had exactly the last-write-wins bug this model was
  built to avoid.

- **"Login" is a name label, not authentication.** Discussed explicitly with
  the user: real Supabase Auth (magic link, sessions, RLS keyed to
  `auth.uid()`) was considered and deliberately rejected in favor of a
  freeform name typed once and stored in `localStorage`, because the actual
  goal was "let different people trial this without clobbering each other's
  numbers," not "keep data private from each other." If that goal ever
  changes, this needs a real rework, not a patch.

- **PiP opens in two phases.** `documentPictureInPicture.requestWindow()`
  requires a live, recent user gesture (a real click) — it does **not**
  survive an `await`-based delay. The "start camera" click requests the PiP
  window immediately (so the browser grants it), but the actual video/status
  card only get moved into that (briefly empty) window after the 10s
  alignment countdown. This two-phase split (`requestPipWindow` +
  `movePipContent`) is why PiP can both open automatically *and* give you a
  full-size look at yourself first — either alone isn't possible under
  browser permission rules.

- **Tolerance/timing defaults are sourced, not arbitrary** — see the `i` info
  icons next to each slider in Settings (`RESEARCH_INFO` in `src/main.js`).
  The short version: there's no single "correct" posture angle in the
  literature, so tolerances are calibrated to *your own* baseline rather than
  a universal target; sustained fixed positions (of any kind) are treated as
  the real concern, which is why there's both a slouch-tolerance nudge and a
  separate stillness nudge. Sources are cited inline in that object — check
  there before changing a default, rather than guessing.

## Setup / dev quickstart

See [README.md](README.md) for full Supabase table setup and GitHub secrets.
Short version for local dev:

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev -- --host  # --host exposes it on your LAN for real cross-device testing
```

No camera or Supabase credentials are required for the app to load — it
degrades gracefully (local-only, no sync) if `.env` is missing or a table
doesn't have the expected columns yet. Console warnings, not crashes, are the
expected failure mode throughout this codebase — that pattern is intentional
and worth preserving in new code.
