# Plumb — project notes

This is a handoff/context document, not a user-facing README (that's [README.md](README.md)).
It exists so that a new developer, or a fresh AI session with no memory of prior
conversations, can pick this project up cold and understand what it's for, what's
actually true about its current state, what decisions were made and why, and
what's still open. Update it when you make a decision worth remembering, not
after every commit. Written for a reader who may have no chat history at all —
if you're that reader, this file plus git log/PRs should be enough.

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

**Still open, not yet fixed**:
1. **Name identity has no normalization.** `"Paul"`, `"paul"`, `"Paul "`
   (trailing space) are three different users to the app and database — no
   trim, no case-folding. Fine solo; will silently split data once other
   real people type names. Cheap fix, not done.
2. **`generate-summary.cjs` doesn't filter by user.** Once more than one
   person's data exists in `posture_events`, the (still-dormant) weekly
   summary would blend everyone's stats into one narrative.
3. **`posture_logs` table still exists in Supabase, fully unused by the
   app** (the write path was removed when per-user login was built — it
   only ever fed the old denormalized daily-total approach, which is why it
   was retired, see "Decisions" below). Safe to `drop table posture_logs;`
   whenever; not urgent.
4. **RLS stays permissive at the database level** on every table
   (`using (true)`). Per-user separation is enforced entirely client-side.
   Deliberate tradeoff (see "Decisions"), not an oversight — but it means
   "login" is a data-partitioning convenience, not a privacy boundary.
5. **Cross-device session/slouch reconciliation and per-user data
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
2. **Connect OpenRouter for basic AI analysis.** Distinct from the
   already-built-but-dormant `generate-summary.cjs` (which calls the
   Anthropic API directly). Natural first use case once connected: item 6
   below, which needs a vision-capable model.
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
   nudge, or a cached-phrase approach instead.
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
