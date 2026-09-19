# Plumb — project notes

This is a handoff/context document, not a user-facing README (that's [README.md](README.md)).
It exists so that a new developer, or a fresh AI session with no memory of prior
conversations, can pick this project up cold and understand what it's for, what's
actually true about its current state, what decisions were made and why, and
what's still open. Update it when you make a decision worth remembering, not
after every commit. Written for a reader who may have no chat history at all —
if you're that reader, this file plus git log/PRs should be enough.

## Handover — 2026-09-19

Written because this file has grown into a long chronological log (useful
for archaeology, slow for "what's true right now"). Read this section
first; it points into the rest of the file for detail rather than
repeating it. Everything below was current as of the session that ended
2026-09-19 — a huge amount landed in a short span, so verify anything
load-bearing rather than trusting it's still accurate by the time you
read it.

**Confirmed working, live-tested by the user on real hardware:**
- Core posture detection (lateral lean, neck-drop, lean-in, sitting-low),
  retuned twice from real feedback. Currently on `main`, not a branch.
- Ambient brightness box (blurred to a silhouette, real resolution
  bumped) and the light-level nudges (dim/bright + why, not just skew).
- Device tracking, ergonomic setup wizard (now live-before-camera-start
  with a real-time diagram, not the original one-shot version), weekly
  pattern analysis + daily check-in, OpenRouter connectivity end to end
  including in real CI.
- The category color palette was redone 2026-09-19 using the `dataviz`
  skill's `validate_palette.js` against the actual chart surface
  (`#F5F2EC`) — not eyeballed. Passes every adjacent-pair check; some
  non-adjacent pairs still fail the harshest "all-pairs" floor because 7
  genuinely-needed categories can't all clear it (documented at the
  `CATEGORY_COLORS` definition in `src/main.js`).

**Confirmed still broken or unverified — check these before assuming
they work:**
1. **The chair-as-person presence bug is NOT resolved.** Two attempts
   (a visibility-threshold check, then raising that threshold) did not
   stop it per the user's own live report ("even the eye thing didn't
   stop it seeing my chair as me"). Diagnostic logging was added
   (`checkFaceVisibility`, logs real visibility numbers to the alert
   feed on every presence transition) specifically so the *next*
   occurrence gives real numbers to tune against instead of a third
   guess. Current best theory: BlazePose was never trained to output
   "no person," so it can extrapolate confident-but-wrong face-landmark
   positions onto a chair-shaped blob — a model-confidence problem, not
   a simple threshold miscalibration. Don't re-attempt a threshold tweak
   blind; get the logged numbers from a real occurrence first.
2. **Brightness sensitivity is an open question, not a bug fix.** User
   reported the room got noticeably brighter mid-afternoon but the
   number barely moved. Leading theory is webcam auto-exposure
   compensating before Plumb ever sees the pixels (flagged as a risk
   before this was ever built) — not something a software "sensitivity"
   setting can fix on its own. Two real options were raised and not
   built: locking camera exposure via `MediaTrackConstraints` (real API,
   inconsistent device/browser support) or adaptive range-stretching
   against the session's own observed min/max. Needs a decision, not
   just another number tweak.
3. Several 2026-09-18 fixes (face-visibility grace period, lateral
   tolerance 0.07, ergo-wizard live diagram) were pushed but the specific
   confirmation of "does this feel right now" from the user is mixed in
   with the items above — re-read the dated entries below before
   assuming any one of them is settled.

**If picking this up cold, do these first:**
- Read the "Still open, not yet fixed" list below in full — it's been
  added to several times and mixes old low-priority items (name
  normalization) with the two active bugs above.
- Don't start any new posture-detection tuning without first asking
  whether the chair-presence bug has recurred and what the logged
  numbers showed.
- The `feature/eye-nose-posture-signals` branch mentioned partway
  through the dated log below **was merged to `main` the same day** —
  ignore any note below that still calls it unmerged; `main` is current.

## What this is

A personal, self-hosted posture and movement tracker. Runs entirely in the
browser: webcam → MediaPipe pose landmarks → compares your shoulder/ear
position against a calibrated baseline → speaks nudges via a local neural TTS
voice (Piper, offline after first download) when you're slumping, leaning, or
have been still/sitting too long. Syncs stats to Supabase every ~10s. Deploys
to GitHub Pages via GitHub Actions on every push to `main`. Single-maintainer,
prototype-quality, not a medical device, not a commercial product.

Positioning, if it comes up: not "achieve perfect posture" — more like an
ambient companion/coach that quietly keeps you from sitting badly for *too
long*. The name "plumb" (a plumb line/bob hangs there passively showing true
vertical while you work) fits that better than the current tagline
("aligned for life") does — tagline was discussed and deliberately left
alone for now, not forgotten.

## Stack

- **Frontend**: Vite + vanilla JS (no framework), single `src/main.js`
  (~2100 lines) driving a single `index.html`. `@mediapipe/tasks-vision` for
  pose detection, `@mintplex-labs/piper-tts-web` for offline neural voice.
- **Backend**: Supabase (Postgres + PostgREST), accessed directly from the
  browser via `fetch` — no server code except the GitHub Action script.
  Project ref `keacpowuykzcnwwdbjkd` (URL `https://keacpowuykzcnwwdbjkd.supabase.co`),
  org/project named "Plumb". Uses the newer `sb_publishable_...` key format
  (what used to be called the "anon" key) — safe to expose, same as before.
- **Hosting**: GitHub Pages, built by `.github/workflows/deploy.yml`, live at
  `easybeinggreen.github.io/plumb/`.
- **AI summary** (currently dormant, see below): `scripts/generate-summary.cjs`
  runs in the Monday-morning scheduled Action, reads `posture_events` from
  Supabase, calls the Anthropic API, writes `public/data/summary.json`.

## Git / deployment state (as of 2026-09-14)

Work now happens directly on `main` via `git push` from a local clone,
authenticated through Claude's Filesystem MCP connector (edits written
locally, then committed/pushed by the user from their own terminal) —
not the GitHub web editor, and not exclusively PRs anymore. **`main` has
branch protection requiring PRs, but pushes as the repo owner bypass it**
(GitHub prints "Bypassed rule violations" rather than rejecting the push);
worth knowing before assuming a direct push will be blocked. GitHub Pages
still deploys automatically on every push to `main`, via Actions.

History: PR #1–#4 = cross-device sync fixes, per-user login, slouch%
formula fix. PR #5–#6 = the visual redesign. PR #7 = slouch-state-leak
fix + voice fixes, merged 2026-08-30. Everything since has landed as
direct commits to `main` (see "Fixed" entries below for what and why).

Housekeeping: PRs #1 and #2's branches sat open for weeks after their
work was already fully merged into `main` (confirmed via
`git merge-base --is-ancestor` — every commit on both branches was
already an ancestor of `main`) — GitHub just never got told to close
them. If old-looking open PRs turn up again, check ancestry before
assuming they're unmerged work; don't go by the "behind" count alone,
it's misleading once a branch has been merged by anything other than
the merge button.

One real gotcha that already happened once: a PR can get merged from an
*older* snapshot of the branch if more commits get pushed to it between
opening the PR and clicking merge (GitHub merges whatever the branch's head
was *at merge time*, not necessarily what you last looked at). This silently
orphaned a whole commit once (PR #5 merged, but the very next commit on the
branch never made it into `main` until a separate PR #6 caught it days
later). If something seems "not up to date" after a merge, don't assume
user error — check `git merge-base --is-ancestor <branch> origin/main`
before concluding the working tree is stale.

## Current status

**The visual redesign is implemented and live**, not just mocked up:
- Wordmark in Space Grotesk, Karla everywhere else, weight scale rebalanced
  lighter throughout
- Posture glyph: dot position is genuinely proportional to tolerance on each
  axis now — touching the loop edge means "at the real slouch threshold"
  (this used to be a real, confirmed bug — see git history if curious, it's
  fixed now, not just diagnosed)
- Mild→sustained escalation has a real visual jump (pulsing ring, loop
  tint), not two near-identical browns
- Break gauge is an SVG ring with live countdown, not a repurposed
  liquid-fill tube
- The video panel shows a live "how's today going" summary once PiP takes
  the camera feed, reusing the exact same timeline-rendering code as the
  report modal (hour markers, "now" line, real segments) — not a
  flattened/simplified version
- Per-user name picker is live: first-run flow, localStorage persistence,
  settings modal shows who's signed in + switch-user

**Still visually unstyled / not part of the redesign yet**: the settings
modal and the report modal's week/month view (still Chart.js vertical bars,
not the horizontal small-multiples layout that was discussed and agreed as
the better design — never implemented, not even mocked up further than the
one exploration artifact). A Claude Design canvas exists from the redesign
planning with the settled typography direction and the finalized screens
(popup card, main page idle/active) — ask the user for the link if you need
to see it; it's a claude.ai artifact URL, not stored in this repo.

**Fixed 2026-08-26, from real live-usage bug reports** (see git log on
`fix/sync-and-alignment-flow` for exact commits):
- `hydration_events` inserts were silently failing *since the table was
  created* — granting `INSERT` on a table doesn't grant `USAGE` on the
  sequence backing its auto-increment `id` column; they're separate grants.
  Fixed directly on the live Supabase project (not just in a migration
  file) — verify `grant usage on sequence hydration_events_id_seq to anon,
  authenticated;` is still in effect if hydration ever silently stops
  saving again.
- **Slouch-state leak across presence gaps** — the more serious one. Slouch
  tracking (`slouchStartedAt`/`slouchAccumulatedMs`) was only flushed when a
  break started or the camera stopped, not when the camera simply lost
  sight of the person or the tab went hidden. A slouch flag open at exactly
  that moment could sit stuck in memory and keep absorbing time from a
  later, unrelated session instead of closing when that presence actually
  ended. Confirmed on real data before fixing (not guessed): one
  `compression` event logged as 15.7 hours on a day with 5.5 hours of total
  tracked presence — impossible unless it bridged a gap like this.
  **The general rule this establishes: every code path that ends a presence
  block must also flush any open slouch block.** If you add a new way for
  presence to end, check this.
- Piper (offline) voice had no interruption logic before starting new
  playback — two nudges close together played on top of each other. Fixed
  by tracking the current `AudioBufferSourceNode` and stopping it first.
- Test-voice button silently obeyed the mute toggle (did nothing on click
  if muted — indistinguishable from broken). Now bypasses mute via a
  `force` param on `speak()`.

**Fixed 2026-09-13/14, from real live-usage bug reports:**
- **"Voice sometimes just stops working" — root cause found, not just
  patched.** This was the item listed as unreproduced below as of
  2026-08-26; it turned out to be much bigger than voice. `loop()` (the
  main rAF tracking loop) had zero error handling and no listener on the
  camera track's `ended` event. When another app took the camera (Zoom,
  Teams, OS camera app) or the `<video>` element stalled on a stale/
  zero-size frame, the pose model would throw, which silently killed the
  rAF chain — `running` stayed `true`, the button still said "stop
  camera", and whatever presence/slouch block was open at that moment
  never got finalized or flushed. That's not just "voice stops" — it's
  why whole afternoons were going missing from the report. Fixed with a
  try/catch around the loop body plus a `track.addEventListener('ended', ...)`
  listener, both routed through a new `handleCameraLost()` that closes
  things down the same clean way a manual stop does, but visibly (console
  warning + alert-feed entry + a distinct placeholder message), so it's
  never silent again. **General rule this establishes: any place video/
  camera state is touched needs to consider "what if this feed just
  disappears," not assume `getUserMedia` succeeding once means it stays
  good.**
- **Calibrate button's first click after starting the camera genuinely did
  nothing** — confirmed by the user (not just a stale-cursor rendering
  quirk, which was the first hypothesis and turned out wrong). Root cause:
  `calibrateBtn.disabled = false` was being set *after* `await
  requestPipWindow()`, so there was a real window where the video was
  already visibly playing and the button looked ready, but was still
  genuinely disabled underneath. Moved the enable earlier, right after the
  video is confirmed live. Also hardened the click handler itself to give
  explicit feedback ("camera not ready" / "no person detected") instead of
  ever failing silently again, regardless of what timing edge case might
  still be lurking.
- **Week/month report was silently truncated to roughly the first two days
  of any range.** Root cause: Supabase's REST API caps responses at 1,000
  rows by default (`pgrst.db_max_rows`, unset = platform default), and a
  single week of this app's per-nudge event volume is 2,000+ rows. Ordered
  `date.asc`, the cap cut the response off mid-week, so later days just
  looked like zero data — indistinguishable from "didn't use it that day"
  without checking the raw row count directly. Confirmed via direct
  Supabase queries before concluding this (not guessed): every session,
  including the ones the user was certain about, was correctly in the
  database the whole time. Immediate fix: raised
  `alter role authenticator set pgrst.db_max_rows = 100000;` +
  `NOTIFY pgrst, 'reload config';` — live now. This also means
  `generate-summary.cjs`'s unfiltered, undated fetch of all of
  `posture_events` (see item below) was almost certainly hitting the same
  cap and only ever seeing the earliest rows in the table's whole history,
  not recent ones — worth re-checking once that script is actually turned
  on.

**New: daily summary rollup + day drill-down (2026-09-14).** The row-cap
fix above is a real ceiling, not just a config bump — raw event volume
only grows, so week/month reports need a fetch that doesn't scale with
total history. Added:
- `posture_daily_summary` table — one row per `(date, user_id, type)` with
  `total_seconds`/`event_count`, RLS mirrored exactly from
  `posture_events` (`using (true)`, matching the pragmatic single-user
  stance — see "Decisions"). **Purely a read-side cache, never a
  replacement for raw data** — nothing in this design ever deletes or
  downsamples `posture_events`; the point was explicitly to keep full
  granularity available forever for future AI pattern-detection/calendar-
  correlation work, not trade it away for report performance.
- `scripts/rollup-summary.cjs` + `.github/workflows/rollup.yml` — nightly
  (2am Brisbane), same secrets/style as the existing (still-dormant)
  `generate-summary.cjs`. Recomputes everything up to a 2-day-old cutoff
  on every run (full recompute, not incremental) so it's self-healing
  against late writes or backdated corrections. Confirmed working via a
  real `workflow_dispatch` run on 2026-09-16 — see "Fixed 2026-09-16"
  below for why it didn't run at all before that.
- `showReport()` now reads `posture_daily_summary` for anything older than
  2 days and raw `posture_events` for the last 2 days (not yet rolled up),
  merged through one shared `addToBucket()` so both paths compute
  identically. `today` view is untouched — always raw, always full
  granularity, since the minute-by-minute timeline needs it.
- Clicking a bar in the week/month chart now drills into that day's real
  timeline (reuses `renderTodayTimeline`, generalized to take an optional
  reference date instead of always assuming "now"). Always fetches raw
  `posture_events` for the single clicked day regardless of whether it's
  been rolled up — the raw row is permanent either way.
- **Not yet tested in an actual browser.** Built and verified via direct
  Supabase queries + `node --check` + DOM-id cross-referencing, not a real
  click-through. Worth doing before trusting the drill-down UI works as
  intended.

**Fixed 2026-09-16, from a user report of the week/month chart barely
correlating with what the day felt like (hour-by-hour view showing real
slumping, day/week chart looking "mostly fine"):**
- **The nightly rollup had never run, not once, since the one-time manual
  backfill.** Root cause was two separate bugs stacked on top of each
  other:
  1. `.github/workflows/rollup.yml` existed on disk but was **never
     `git add`ed, committed, or pushed** — `git log --all` had zero
     commits touching it, so GitHub Actions had no idea the workflow
     existed and had never scheduled it. The file was also corrupted
     (line 1 read `git statusname: Roll up daily summary` — looks like a
     `git status` command's output got pasted into the file instead of
     the terminal), which would have broken it even if it had been
     pushed as-is.
  2. Once pushed and manually triggered, it failed immediately with
     `permission denied for table posture_daily_summary` — `service_role`
     had never been granted `SELECT`/`INSERT`/`UPDATE` on that table (the
     same class of bug as the `hydration_events` sequence grant from
     2026-08-26: creating a table doesn't automatically grant every role
     DML on it). Fixed via migration `grant_service_role_daily_summary`.
  Net effect: `posture_daily_summary` was frozen at 2026-09-11 (the
  manual-backfill cutoff) while raw `posture_events` kept growing
  normally. `showReport()`'s 2-day-raw / older-than-2-days-rollup split
  meant every day in between had **no data at all** in the week/month
  chart — not wrong data, just silently blank bars, which reads as "fine"
  at a glance. The "today" tab and the ambient hour-by-hour timeline were
  never affected — both always read raw `posture_events` directly.
  **General rule this establishes: after adding a Supabase table, verify
  `service_role`'s actual grants directly (`information_schema.role_table_grants`)
  rather than assuming CREATE TABLE implies write access — this is now
  the second time a forgotten grant silently broke a feature.** Also:
  after adding a scheduled GitHub Actions workflow, confirm `git log --all
  -- <path>` shows it landed on the remote default branch, not just that
  the file exists locally.
- Backfilled via a manual `workflow_dispatch` run immediately after the
  fix (234 rows, current through 2026-09-14) rather than waiting for the
  next 2am Brisbane cron.

**Fixed 2026-09-17, from a root-and-branch audit prompted by the user
being repeatedly burned by data-integrity issues since the start (their
words: "tempted me to give up a few times").** Three unrelated bugs, all
found by querying live data directly rather than reasoning from the code:

1. **Rollup cutoff computed from the GitHub runner's UTC clock instead of
   Brisbane time.** The cron fires at 2am Brisbane (16:00 UTC the previous
   day), a UTC calendar date still one day behind Brisbane's — so the
   cutoff landed a full day short of what the client (on the user's actual
   Brisbane-local clock) expected, every single night. Fixed in
   `rollup-summary.cjs`'s `cutoffDate()` by shifting into Brisbane time
   (+10h, no DST) before doing the date math, instead of using raw UTC
   `now()`.
2. **The real root cause of three separate multi-hour bogus slouch
   events** (87.9h on 2026-08-21, 15.7h on 2026-08-26 — the one this file
   previously and incorrectly described as fixed, see below — and 14.2h on
   2026-09-15, found by scanning all of `posture_events` for
   `duration_seconds > 3600`). The `visibilitychange` handler's
   return-to-visible branch flushed any open slouch block **and** the
   presence block using `Date.now()` (the moment visibility returns)
   instead of `hiddenStart` (the moment it was lost) — so a tab hidden
   across a long real-world gap (laptop asleep overnight, lid closed over
   a meal) got the entire gap attributed as continuous slouching *and*
   continuous presence, on top of the same span being separately logged as
   `not_tracking` a few lines later. **The 2026-08-26 entry above
   describing this class of bug as fixed was wrong** — that fix addressed
   a real but different leak path (camera-based presence gaps in the main
   loop); this `visibilitychange` path was never touched and kept leaking
   for another three weeks. Fixed by giving `finalizePresenceBlock()` an
   optional `endTs` parameter and passing `hiddenStart` through both flush
   calls. The three known-bad historical rows are still sitting in
   `posture_events` uncorrected as of this writing — ask the user whether
   to delete them (there's no way to reconstruct the true value, since
   `hiddenStart` wasn't preserved in those already-written rows) before
   trusting any all-time stat that touches those three dates.
3. **`anon` was never granted `SELECT` on `posture_daily_summary`.** This
   is arguably the biggest one: every fetch the browser client made to
   that table returned `401`, silently, for the table's entire existence
   (created 2026-09-14) — `fetchDailySummaryForRange()`'s `catch` swallows
   the error and returns `[]`, so it looked exactly like "no data," not
   "can't read." This means the 2026-09-16 rollup-cron fix above, while
   real and necessary, **could never have actually fixed what the user was
   seeing on its own** — the client literally could not read the table
   regardless of how current its contents were. Only caught because the
   browser was actually driven end-to-end against the real anon key
   (`this month` tab, live) rather than verified via direct SQL/
   service-role queries, which don't exercise this permission at all.
   Fixed via migration `grant_anon_select_daily_summary` (mirrors the
   `SELECT` grant `posture_events` already had for the same role).
   **General rule now established three times over** (`hydration_events`
   sequence `USAGE`, 2026-08-26; `service_role` on `posture_daily_summary`,
   2026-09-16; `anon` on `posture_daily_summary`, today): creating a table
   grants nothing to `anon`/`authenticated`/`service_role` beyond
   PostgreSQL's default (`TRIGGER`/`TRUNCATE`/`REFERENCES`, none of them
   useful here). After adding any table, check
   `information_schema.role_table_grants` for every role that will
   actually touch it, and — critically — verify reads by driving the real
   client (browser + anon key) end-to-end, not just by querying Supabase
   directly with elevated access. Direct SQL/service-role checks cannot
   catch an `anon`-role permission bug by construction.

Also added: the week tab now renders each day as a row pairing a
consolidated totals bar with a compact minute-by-minute pattern strip
(click through to the full timeline), instead of only the aggregate
stacked bar — see `renderWeekDayRows()` in `src/main.js`. Week now always
fetches raw events for the full 7-day range rather than leaning on the
rollup table for most of it (cheap at that volume); month is unchanged and
still needs the rollup split. Explicit motivation from the user: getting
totals and the real per-minute pattern into the same shape, per day, is
what eventual AI summarization needs to work from.

**Timeline rendering, 2026-09-17: four iterations in one afternoon, worth
reading before touching `computeMinuteData`/`drawPixelBands` again.** All
from direct, immediate user feedback on each attempt — the lesson here is
more about *how fast this loop was*, and to trust explicit visual feedback
over "more accurate" instincts:
1. Per-minute cells first showed slouch density as **opacity** (alpha =
   fraction of that minute spent slouching) over the dark "good" color.
   Technically correct, but alpha-blending a color onto a near-black
   backdrop desaturates it — and since slouch events average ~8s (see the
   2026-09-15 finding), most density values are low, so most "orange"
   rendered as a barely-tinted near-black smudge, not orange. This is
   *why* the totals bar and the minute strip looked like they disagreed
   even after their color constants were unified (`CATEGORY_COLORS`) —
   same hex value, desaturated by opacity math, doesn't read as the same
   color.
2. Switched opacity → **height** (a small full-saturation bar rising from
   the bottom of each minute, height = density). Fixed the desaturation,
   but 1440 individual minute-columns at full-day scale still read as a
   "chaotic barcode," per the user's own words — accurate isn't the same
   as legible.
3. Tried **bucketing** (grouping ~10-20 min into one wider column, each
   drawn as a small proportional stack — same technique as the totals bar,
   repeated at finer time resolution). Smoother, but still fundamentally a
   composition chart, which is what the user objected to next: "the chart
   is purely horizontal bands... not half a band or 2/3."
4. **Landed on `drawPixelBands()`**: one solid, single color per physical
   pixel column, chosen by majority vote of whichever category actually
   made up the most of that pixel's span of minutes — never a blend, never
   a stack, never a partial fill. A timeline reads as flat bands or it
   isn't one; composition belongs to the totals bar alone. Turns out
   majority vote *also* solves problem #2 for free, as a side effect of
   just picking one color like a timeline should: a brief 8s correction
   that's a minority of its pixel's ~2-3 real minutes loses the vote and
   that pixel reads as good, no opacity/height trick required. Real pixel
   widths measured before building this (not guessed): ~1.7 min/px on the
   full single-day timeline, ~2.9 min/px on the week view's per-day strips
   at typical window size — both are canvases, so this scales with window
   width, not a fixed grid.

The totals bar (left side of each week row) was **never** part of this —
it's deliberately a composition chart (`drawTotalsBar()`, blocks summed and
stacked), confirmed by the user as working as intended throughout. Also
fixed same day: its bar length now scales against the longest day in the
same week (`maxSeconds` in `renderWeekDayRows()`) instead of always filling
edge-to-edge regardless of how much was actually tracked — a 20-minute day
and a 10-hour day used to look equally "full."

Also 2026-09-17: every duration display now goes through one
`formatMinutes()` helper (minutes under an hour, `Xh Ym` past that) —
applied to day-row meta text, report summary metrics, the month chart's
axis/tooltips, and the dormant AI summary chart. A basic hydration trend
was added too: week gets a per-day water bar in each row, month gets its
own Chart.js chart (litres/day vs. a dashed 2L target line) — logs quietly
in the background, no chart, was the prior state; this closed that gap
once the user asked to actually see the trend.

**Brightness box fixes, 2026-09-17/18, from direct user feedback on the
box built earlier that day:**
- **Left/right were genuinely backwards.** The raw `<video>` frame `sampleLight()`
  reads via `drawImage()` is **not** mirrored — only the on-screen
  `#video`/`#overlay` elements are, via CSS `transform: scaleX(-1)`. So raw
  x<20 is actually the *right* side of what the user sees of themselves on
  screen, not the left. The original code assigned raw x<20 straight to
  "left." Swapped in `sampleLight()`; verified with synthetic data end-to-
  end (both the numeric label and the canvas render) before shipping, not
  just reasoned through.
- **The box is now an actual `<canvas>`** (`drawLightPattern()`) showing
  the real sampled 40x30 frame, recolored per-pixel through the
  dim→bright ramp and mirrored to match the self-view — not a flat
  two-stop CSS gradient standing in for "where the light is." Direct user
  ask: "is there a way of reproducing the light pattern... it looks like
  just a fader."
- Percentage now reads **"43% bright"**, not a bare ambiguous "43%" (user
  genuinely couldn't tell which direction the scale ran).
- Box nudged down (`margin-top: 30px` via `.gauge-col-light`) to roughly
  center with the 150px hydration gauge next to it, instead of top-
  aligning and looking stranded.
- Added a research-backed `RESEARCH_INFO.brightness` entry (ISO 8995-1
  desk lighting, general display-luminance-ratio/glare guidance) plus a
  new "ambient light" section in Settings with an info icon — confirmed
  the existing hydration/movement (`hydrationTarget`/`breakInterval`/
  `stillness`) entries are all still intact, nothing regressed there.
- **Not yet built, explicitly deferred, not forgotten:** charting
  acceptable-vs-unacceptable brightness exposure over time (the
  `light_readings` table has very little data yet — user explicitly said
  "collect data quietly" a few messages before asking for this chart, so
  building it now would be against their own recent instruction; revisit
  once there's a few real days logged), and auto-brightening/dimming the
  *page itself* to compensate for detected glare (real idea, floated as
  "would be cool," needs actual design thought before building).

**Workflow note for whoever picks this up next: the user's explicit
instruction (2026-09-17) is that slouch-detection calibration work — the
next planned phase — happens on a separate branch, not directly on `main`,
specifically so the current `main` state is preserved as a clean rollback
point before that work starts.** This is a deliberate change from the
"direct commits to main" pattern described earlier in this file, scoped to
that one upcoming phase. Don't start calibration changes on `main` without
checking whether that branch already exists / was already started.

**That phase started 2026-09-18, on branch `feature/eye-nose-posture-signals`
(merged to `main` the same day, after live-testing confirmed it was an
improvement — see "First live-test round" below).** Eyes/nose landmarks (already drawn since an earlier
pass but otherwise unused — see the "Experimental face-point signals"
comment that used to sit above them in `src/main.js`) are now wired into
real detection, prompted directly by the user's own account of what the app
was missing:
- **Presence gating (`hasVisibleFace()`)** — the user had noticed the chair
  sometimes got tracked as "present" when they weren't there. Root cause:
  presence was ever only `result.landmarks.length > 0`, i.e. "BlazePose
  fit *a* skeleton shape somewhere," with no check that any individual
  landmark was actually confidently seen. A chair back is roughly
  shoulder-shaped, so it can pass that check. Now also requires nose +
  both eyes above a visibility threshold — nothing else in frame has a
  face. Written defensively (missing `.visibility` data degrades to old
  behavior, not a crash) because this rests on an assumption about the
  MediaPipe build's output that could only be confirmed by reading the
  library's behavior, not by testing without a real camera in this
  environment — **needs live chair-vs-person testing before trusting it.**
- **Lean-in now driven by `interEyeDistanceRatio`, not shoulder width.**
  The old `leanInRatio` used shoulder width growing as a proxy for
  "moved closer to camera," which shoulder rotation/hunching could also
  trigger without the head moving at all. Inter-eye distance isolates the
  face specifically. Same relative-change formula/scale as before, so the
  existing tolerance range still roughly applies, but the user's own
  report was that lean-in was "very sensitive... great," so this needs
  a live check that swapping the underlying signal didn't change that feel.
- **New "sitting low in chair" signal (`sinkRatio`), previously not
  measured at all.** The user's own definition of "slumping" was sitting
  low in the seat — a different physical movement from neck compression
  (head drooping toward shoulders, torso staying put), which is what the
  app's existing "slump"/"slumping" label actually measured. Conflating
  the two under one label meant sitting low specifically was never being
  caught. New signal: nose-y drop from calibrated baseline, normalized by
  current shoulder width. Given its own tolerance slider, own phrases
  (`SINK_PHRASES`), own category (`sink`, color `#8C5B72`) threaded through
  every report/timeline/chart consumer of slouch categories. The old
  "slumping" label was renamed to "neck dropping"/"neck tolerance"
  throughout, reserving "sitting low" for the new, more literal meaning.
- **Lateral (left/right) default tolerance lowered 0.20 → 0.12.** User
  feedback: lean-in nudges easily, but lateral needed "a long way" of
  actual lean to trigger — the two were never on a comparable scale to
  begin with (0.20 vs. 0.10/0.12 for the others), not because of any
  documented reasoning (checked `RESEARCH_INFO` — these tolerances were
  never angle-backed, just "calibrated to your own baseline"). Brought in
  line with the others as a starting point; still needs live tuning.
- **Posture nudge cooldown 5s → 30s (`POSTURE_NUDGE_COOLDOWN_MS`).** User
  described repeated voice nudges as relentless while a slouch stayed
  sustained. Break (60s) and stillness (60s) nudges were already fine;
  this one was the actual outlier, firing a fresh line every 5 seconds.
- New `sink` column added to `app_settings` via migration
  `add_sink_tolerance_setting` so the new tolerance syncs like the others.

**None of the above has been tested with a real camera and a real body** —
this session's browser tooling has no webcam access, so verification
stopped at "renders correctly, settings persist, no console errors on
load/interaction." The presence-visibility assumption, the felt sensitivity
of the new lean-in signal, the sitting-low default, and the retuned lateral
default all need the user's own live testing before this merges to `main`.

**First live-test round (same day), from the user's real webcam:** overall
"pretty good" and "accurate." Three follow-ups, all addressed same session:
- Left/right lean needed "a lot" of real movement vs. lean-in measuring
  well -- confirmed the two metrics scale very differently for equivalent
  physical movement (eye-distance grows fast with forward motion; ear-to-
  shoulder x-offset grows slowly with sideways lean). Lateral default
  lowered again, 0.12 -> 0.07.
- Tracking felt "laggier," and the PiP popup didn't appear. PiP not
  opening is almost certainly unrelated pre-existing flakiness (two-phase
  gesture requirement, see "Decisions" above) -- this branch never touches
  that code. The lag's more likely cause: a single low-confidence frame
  could flip the new face-visibility presence check off and back on every
  other frame, each flip finalizing/reopening tracking blocks. Added a
  1.5s grace period (`FACE_VISIBILITY_GRACE_MS`) before a low-confidence
  read counts as a real absence. **Both fixes pushed but not yet
  re-verified live as of this writing.**
- Also fixed same round: the light box's blur/resolution (see roadmap
  item 1 below) and the "who's using this?" modal copy, which said stats
  stay separate "on this device" -- backwards, since the whole point of
  the shared name is that it merges across devices, not separates by one.

**Device tracking, added same session, user's own idea:** "we've made this
collect data across devices... interesting to track which device to help
identify when posture is better or worse." New, separate axis from user
identity: an auto-generated `device_label` (e.g. `device-i81l`), editable
in Settings -> device -> "device name," tagged onto every `posture_events`
row via the single shared `flushEvents()` upload point. Report gets a
device filter for today/week. **Deliberately not available for month** --
`posture_daily_summary` (the nightly rollup) groups by date/user/type only,
not device, so anything older than 2 days has no device info to filter on;
surfaced as a disabled control with an explanatory tooltip rather than
silently blending devices together. Only tags data going forward; nothing
to backfill since the concept didn't exist before today.

**Ergonomic setup wizard, added same session, user's idea.** A 5-step
guided flow before calibrating (welcome -> camera & screen distance ->
lighting -> desk/chair checklist -> calibrate), behind a new "set up your
desk" button next to calibrate. Deliberately conservative about what it
claims to measure:
- Camera/distance step gives a one-shot ("check now") eye-tilt/eye-
  distance reading, not a continuous loop -- `alignPreviewFrame()` already
  runs its own continuous `detectForVideo()` loop during the pre-
  calibration countdown, and MediaPipe's VIDEO mode needs strictly
  increasing timestamps across calls, so a second concurrent rAF loop
  risked colliding with it. It also does **not** claim to detect "camera
  too high/too low" -- I couldn't verify which direction that error would
  even point without a real camera in this environment (the exact kind of
  mistake that already bit the brightness left/right skew once), so it
  surfaces the honest numbers with generic guidance instead of inventing a
  verdict I can't back up.
- Lighting step just mirrors the existing ambient-brightness box's own
  live text, no new sampling.
- Desk/chair basics is a plain manual checklist (not camera-measurable).
- Final step calls the same `performCalibration()` the main calibrate
  button uses (extracted out so there's one calibration implementation,
  not two).
**Not yet tested live** -- same camera-access limitation as everything
else built this session.

**Weekly pattern analysis, 2026-09-18 -- OpenRouter's first real use case.**
User's own spec: identify how posture drifts across the day, when hydration
happens and stops, and flag the afternoon brightness pattern, then turn
that into concrete goals for the week ahead, ask a reflective question, and
remind them to keep tracking. Built and tested against real production
data (Paul, week of Sep 12-18) *before* wiring up the schedule, not after --
each design decision below came from an actual failure seen in that
testing, not anticipated in advance:
- **Model is pinned, not routed.** `openrouter/free` picks a different
  underlying model every call; comparing several on this exact task found
  real quality swings -- one draft (`google/gemma-4-26b-a4b-it:free`)
  called an afternoon brightness *peak* a "dip" and built a goal on that
  backwards premise. Pinned to `deepseek/deepseek-v4-flash-0731:free`,
  the most reliable of those tested (see git history on
  `scripts/generate-weekly-analysis.cjs` for the comparison). Free-tier
  availability shifts over time -- if this model disappears, re-run the
  same kind of comparison before picking a replacement, don't just grab
  whatever's newest.
- **Even pinned, one run produced genuinely malformed JSON** (forgot to
  close the `goals` array before `question`) -- a per-call reliability
  glitch, not a prompt-wording problem. Added `response_format:
  {type:"json_object"}` plus a one-time retry on parse failure, since no
  prompt tweak reliably prevents this.
- **A draft described "lean_in" as recovering into "a more upright
  lean"** -- treating one of the five slouch states as if returning to it
  from another were an improvement, when all five (lateral_left/right,
  compression, lean_in, sitting_low) are equally "bad." Prompt now says
  this explicitly.
- **Free-tier latency is real**: the OpenRouter call itself took ~3.5
  minutes in the actual GitHub Action run (vs. a few seconds testing
  locally) -- comfortably inside the job's timeout, but worth knowing
  before assuming a slow run means something's stuck.
- **Found and fixed the same recurring grant bug a fourth time**:
  `service_role` had never been granted `SELECT` on `hydration_events` or
  `light_readings` (creating a table doesn't grant service_role anything
  beyond Postgres defaults -- see the `hydration_events`/
  `posture_daily_summary` entries above, 2026-08-26 and 2026-09-16/17,
  for the first three times this exact class of bug hit). Only caught
  because the new workflow was actually run via `workflow_dispatch` and
  failed with a real 403, not because anyone remembered to check grants
  proactively. **The general rule keeps proving itself: after adding any
  new table OR pointing a new script at an existing one, verify that
  role's actual grants and run the real thing once, in CI, before trusting
  it's wired correctly.**
- Schema: new `weekly_goals` table (`user_id`, `week_start`/`week_end`,
  `patterns`, `goals` jsonb, `question`, `tracker_reminder`, `model`,
  `user_response`/`responded_at`), unique on `(user_id, week_start)`,
  upserted so a re-run replaces that week rather than duplicating, and
  never clobbers a saved `user_response` since that column isn't in the
  upsert payload. RLS mirrors `app_settings` (anon gets select/insert/
  update, not just insert) since the browser needs to both read it and
  write the reply.
- Runs Friday 4pm Brisbane (`.github/workflows/weekly-analysis.yml`,
  same cron-timezone approach as `rollup.yml`; moved from an original
  Monday-6am guess per the user's actual preference, ahead of the
  weekend). New home-page panel ("this week") shows the narrative, the
  3 goals, the question with a reply box, and the tracker reminder --
  hidden until a real row exists for the signed-in user.
- **Two real problems found by the user questioning the output against
  the actual data, not just reading it (2026-09-19), both fixed:**
  1. Summing a whole week into one hour-of-day table hid whether a
     "peak hour" was a real recurring pattern or one bad day dominating
     the sum. Confirmed on real data: the week's compression summed to
     a clean 11am peak, but the actual per-day worst hour was
     11am/8am/3pm/noon on the four days with any -- no real pattern,
     just one bad Monday. Added `dailyPeaksByUserType()`: each day's own
     peak hour per type, fed alongside the weekly sums, with explicit
     instructions to check cross-day agreement before claiming a
     pattern exists.
  2. The model invented vibe-y filler metaphors ("stacks into a long,
     hunchy block," "gets sticky," "a quiet pocket") that sounded
     relatable but described nothing concrete. Style instruction now
     explicitly bans invented casual metaphor/slang.
- **Third problem, found 2026-09-19 by checking the output against raw
  `light_readings`:** the "5pm is dark" claim came from a single reading
  (n=1, avg 0.063) at hour 17 vs 20+ readings at neighbouring hours --
  same class of bug as the weekly-sum posture issue, never applied to
  light. `buildLightByHour()` now passes `n` per hour and the prompt tells
  the model to treat hours under ~5 readings as noise. Re-run correctly
  picked 9am (n=24, 0.28 vs ~0.39 at 8am/10am) instead.
- **Format rework, same day:** user found the output long-winded. `patterns`
  is now exactly three labelled lines (`posture:`/`hydration:`/`light:`,
  no schema change -- still one text column, split client-side in
  `loadWeeklyGoals()`, old-format rows fall back to plain lines), goals
  are one short sentence each and labelled by index (order is mandated in
  the prompt), and `trackerReminder` states real coverage (days/hours
  computed from `presence` events, verified against raw: 5 days, 35.0h).
  Known nit: the model still writes raw state names like `lateral_right`.
  **The app cannot act on goals** -- they're display-only text; only the
  first goal is spoken once per day at tracking start. No clock-time alarm
  feature exists (break/stillness/hydration nudges are interval-based).
  The new UI rendering hasn't been checked in a browser yet.
- **On demand**, requested but not built: a true self-serve trigger
  from the app needs a Supabase Edge Function, since the OpenRouter and
  Supabase service-role keys can't go client-side on a public static
  site (same constraint as the "ready for your close-up" idea). For
  now, re-running is a `gh workflow run weekly-analysis.yml` away, not
  a button in the app.
- **Daily check-in, built 2026-09-19.** Deliberately not an LLM call --
  the weekly analysis already sets the week's direction; the daily
  piece is today's real numbers (tracked time, slouch %, breaks) plus a
  reference to the week's first goal, computed client-side from data
  already fetched elsewhere. Shows nothing rather than a fabricated-
  looking "0m tracked, 0% slouching" before the day's actually started.
  "Brought to attention" two ways: the passive home-page panel, and a
  one-time spoken line when tracking starts for the day ("This week,
  keeping an eye on: <goal>"), gated per calendar day via localStorage.
  Speech deliberately waits for `startCamera()`'s post-countdown point,
  not page load -- browsers block audio autoplay without a user
  gesture, and page load has none.
- **Found while wiring the daily piece up**: `TS_SLOUCH_TYPES` (drives
  the live "sitting well today" hero stat in the PiP panel) never got
  `sitting_low` added when that category was built -- a real
  regression, silently under-counting slouch time on that specific
  stat (the report itself used the correct type list throughout) since
  sitting_low was introduced. Fixed.

**Still open, not yet fixed**:
1. **Chair-as-person presence bug, unresolved after two attempts** — see
   "Handover — 2026-09-19" at the top of this file for the current
   theory and what to do next. Don't guess a third threshold blind.
2. **Brightness sensitivity to real ambient-light changes is weak**,
   likely webcam auto-exposure compensating before Plumb sees the raw
   pixels — see "Handover" at top for the two unbuilt options (exposure
   lock vs. adaptive range-stretch).
3. **Name identity has no normalization.** `"Paul"`, `"paul"`, `"Paul "`
   (trailing space) are three different users to the app and database — no
   trim, no case-folding. Fine solo; will silently split data once other
   real people type names. Cheap fix, not done.
4. **`generate-summary.cjs` doesn't filter by user.** Once more than one
   person's data exists in `posture_events`, the (still-dormant) weekly
   summary would blend everyone's stats into one narrative.
5. **`posture_logs` table still exists in Supabase, fully unused by the
   app** (the write path was removed when per-user login was built — it
   only ever fed the old denormalized daily-total approach, which is why it
   was retired, see "Decisions" below). Safe to `drop table posture_logs;`
   whenever; not urgent.
6. **RLS stays permissive at the database level** on every table
   (`using (true)`). Per-user separation is enforced entirely client-side.
   Deliberate tradeoff (see "Decisions"), not an oversight — but it means
   "login" is a data-partitioning convenience, not a privacy boundary.
7. **Cross-device session/slouch reconciliation and per-user data
   isolation** are implemented and code-reviewed but still haven't been
   proven by actual simultaneous multi-device or multi-person use — only
   solo, sequential testing so far.

~~6. The nightly rollup workflow has only ever run via manual
workflow_dispatch~~ — **resolved 2026-09-17**: a real unattended `schedule`-
triggered run succeeded at 19:37 UTC that day (run 35266011787). The 2am
Brisbane cron is confirmed working on its own now, not just via manual
trigger.

~~7. Three known-corrupted historical rows~~ — **resolved 2026-09-17**: user
confirmed, all three (87.9h/15.7h/14.2h bogus compression events) deleted
from `posture_events` and `posture_daily_summary` re-rolled. No known
corrupted rows remain as of this writing.

**Deliberately dormant / paused on purpose** (not broken, user's own call):
- AI weekly summary. `ANTHROPIC_API_KEY` is set as a GitHub secret, the
  scheduled Action has run several times, but it has **never once actually
  reached the Anthropic call** — confirmed by reading the Action's own logs,
  not assumed. It fails earlier, on the Supabase read (was a permissions
  error on `posture_logs`; may need re-checking now that `posture_logs` is
  unused — the script would need pointing at `posture_events` instead
  regardless, per item 3 above). Zero tokens spent. Left off intentionally
  until there's trustworthy multi-day, multi-user data worth summarizing.

## Roadmap (captured 2026-09-17, updated 2026-09-18 -- so nothing gets lost)

Listed in the order the user raised them, not priority.

1. **Directional brightness/glare square — built and iterated on, see
   "Brightness box fixes" above for the full detail.** Live in the `today`
   panel: `sampleLight()` samples every ~10s, `drawLightPattern()` renders
   the real (mirrored) low-res light pattern onto a canvas, `logLightReading()`
   persists to `light_readings` every 5 min (not yet charted anywhere --
   see items 1a/1b below). Left/right mirroring bug found and fixed
   2026-09-18.
   - **1a. Chart acceptable-vs-unacceptable brightness exposure over
     time** in the totals view, backed by real research (same
     `RESEARCH_INFO.brightness` sourcing already added -- ISO 8995-1 /
     luminance-ratio guidance) for what "acceptable" actually means, plus
     how much time was spent outside it and what to do about it. Explicitly
     deferred 2026-09-17 until `light_readings` has real days of data to
     chart -- don't build this against a near-empty table.
   - **1b. Auto-brighten/dim the page itself** to compensate for detected
     glare (e.g. bright ambient light → boost contrast/theme; dim
     surroundings → ease off). Floated as "would be cool," not scoped.
     Real constraint worth remembering when this gets picked up: JS can't
     touch the OS/monitor's actual brightness, only the page's own
     rendering (see the original brightness-scoping conversation for what
     that leaves on the table).
2. ~~Connect OpenRouter for basic AI analysis~~ -- **done 2026-09-18**,
   see "Weekly pattern analysis" below. Distinct from the
   already-built-but-dormant `generate-summary.cjs` (which calls the
   Anthropic API directly, still untouched). Item 6 below (which needs a
   vision-capable model) is still open and can now reuse this connection.
3. **Google Calendar integration** — correlate posture/slouch patterns
   against calendar events, specifically interested in whether posture
   changes during calls. Would need: OAuth to read the user's calendar
   (read-only), matching event time ranges against `posture_events`, and
   probably a new view for the correlation itself. Not scoped beyond that.
4. **Auto-disable voice nudges during video calls** (Zoom/Teams/etc using
   the camera). Real usability problem, not cosmetic — nudges interrupting
   a call is actively disruptive. No detection mechanism chosen yet;
   options worth weighing when this is picked up: `navigator.mediaDevices`
   can't directly tell you another app has the camera (Plumb already holds
   it), so likely needs either OS-level signal (not available to a web
   app) or an indirect proxy — e.g. detecting when the tab/window loses
   focus to a known call app, or a manual toggle as a fallback if no
   reliable auto-detection exists.
5. **ElevenLabs voices**, presumably alongside or replacing the current
   offline Piper TTS. Tradeoff to weigh when scoping: Piper's whole appeal
   is offline/private (`@mintplex-labs/piper-tts-web`, no network call per
   nudge); ElevenLabs would mean a network call and API cost per spoken
   nudge, or a cached-phrase approach instead. Specifically: use ElevenLabs
   to generate a *range* of selectable voices (not just one replacement
   voice) — likely pairs with the cached-phrase approach, since nudge text
   is a small fixed set, so each voice's full phrase set could be
   pre-generated once rather than synthesized live per nudge.
   **Explicitly deferred to last, user's own call (2026-09-18):** "leave
   ElevenLabs to the end when we know all the nudges" -- generating/caching
   voice lines for a phrase set that's still actively changing (see the
   eye/nose posture-signal work above, which already touched several
   phrase arrays) would mean redoing that work every time a nudge's
   wording changes. Don't start this until the nudge phrases have settled.
   **Phase 1 built 2026-09-19 ("ready for my close-up" button, local
   checks only, no LLM, nothing saved or sent):** `src/closeup.js` is a pure
   `analyzeCloseup({lm, lum, w, h})` -- framing (centred, headroom,
   distance/shoulders cut off), head tilt, face brightness, left/right
   evenness across the face, backlight (background vs face), glare. Reads
   `lastPose` (set by both `alignPreviewFrame` and `loop`, so no second
   `detectForVideo` call) plus one 160x120 frame. Logic verified with
   synthetic frames (good frame + each fault, including left/right
   direction under the mirrored self-view); UI verified in a browser only
   up to the no-camera state -- **never run against a real camera, and
   every threshold in `CLOSEUP_THRESHOLDS` is an unvalidated first guess.**
   Deliberately not checked: camera height/angle (direction can't be
   verified without a real camera), sharpness/lens smudge (no validated
   threshold). **Phase 2, not built:** hair, outfit, background contents,
   and comparison against a saved "best self" photo -- needs a vision
   model via a Supabase Edge Function (OpenRouter key can't go
   client-side), opt-in per press, frame never stored. Mic level check was
   floated, undecided.
6. **"My best self" / "call ready" self-check button.** Refined
   2026-09-17: not just a one-off check against a fixed prompt -- capture
   and save a reference "best self" photo (hair brushed, sitting up,
   dressed smartly) once, then a button that captures the current frame
   and compares it *against that saved reference* (teeth, hair, background
   clutter, etc.) via a vision-capable LLM, not just an absolute checklist.
   Confirmed doable, no new capture infra needed (same `video`/`overlay`
   elements everything else reads from) -- but explicitly blocked on item 2
   (OpenRouter) by the user's own admission ("we are going to need to
   connect to openrouter first i think"). Don't start this before that.

**Also noted 2026-09-17, not yet a scoped roadmap item:** the next phase of
work after all of the above is better calibration of the slouch-detection
monitor itself -- but per the user's explicit instruction, that happens on
its own branch, not on `main`. See the workflow note in "Fixed 2026-09-17/18"
above before starting it.

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

**Every one of these presence-ending paths must also flush any open slouch
block** (see the 2026-08-26 fix above) — this wasn't true until recently and
was a real, confirmed bug. If you add a new way for presence to end, check
this invariant holds.

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

- **Typography direction settled via a Claude Design canvas**, not chosen
  unilaterally: Space Grotesk for the wordmark specifically because it (and
  the geometric-sans category generally) gives `p`/`b` a true mirror and
  `u`/`m` a related shape — the user was explicit about wanting that
  letterform symmetry back after rejecting an earlier serif-only round.
  Karla for everything else, at lighter weights than the old Nunito setup
  (nothing above 700 anywhere in the stylesheet now).

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

When debugging a "the data looks wrong" report, prefer querying the live
Supabase table directly (`curl` with the publishable key works fine for
read-only checks) over guessing from the code — several real bugs this
project has had were only found by looking at what was actually stored, not
by reading the code and reasoning about what it *should* do.
