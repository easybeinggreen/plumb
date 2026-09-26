# Plumb — project notes

This is a handoff/context document, not a user-facing README (that's [README.md](README.md)).
It exists so that a new developer, or a fresh AI session with no memory of prior
conversations, can pick this project up cold and understand what it's for, what's
actually true about its current state, what decisions were made and why, and
what's still open. Update it when you make a decision worth remembering, not
after every commit. Written for a reader who may have no chat history at all —
if you're that reader, this file plus git log/PRs should be enough.

## Handover — 2026-09-26 (read first; the 2026-09-23 and 2026-09-20 sections below still hold unless contradicted here)

### START HERE (state at the end of the 2026-09-26 session)

- **Merged and live:** PRs #8-#18 (settings-sync fix, per-user keys, presence grace, OpenRouter AI summary,
  generate/update weekly summary button, sleep-gap fix + data repair, out-of-plumb wording, voices, popup, main
  panel). PRs and their reasoning are in `git log`; this section is the map. Site: https://easybeinggreen.github.io/plumb/
  (deploys on every push to `main`; the live bundle file name should equal a local `npm run build` of `main`).
- **Supabase project** `keacpowuykzcnwwdbjkd`. Edge functions: `camera-review` v7, `weekly-analysis` v2 (both
  `verify_jwt` off, deliberately: the app has no user auth; protection is daily caps + CORS + server-side key).
  New table `ai_summary`. Anthropic is not used anywhere any more (secret deleted); everything AI is OpenRouter free.
- **Demo on Wednesday 2026-09-30:** the owner sets up a separate 'Demo' login (high sensitivity: lateral tolerance
  0.03, sustained 3s). Calibration is NOT persisted across page reloads, so recalibrate after loading.
- **Open items, roughly by importance:**
  1. Verify in real life: the morning after a laptop sleep, the night shows grey "not tracking" (not blue away);
     the popup in the owner's real Chrome; how Angus/Matilda sound reading a real nudge.
  2. Most days read 54-74% "out of plumb" even after the artifact repair: probably the calibration baseline /
     tolerances drifting over a day rather than real slouching. Worth investigating (recalibration prompts? drift
     handling?).
  3. Chair-as-person presence bug: get real numbers from `plumbPresenceDiag()` (browser console on the affected
     device) after the next occurrence; don't guess a third threshold.
  4. Weekly summary text varies with whichever free model the router picks; consider comparing models on real data
     and re-pinning one. The button (generate / update weekly summary) exists as the workaround.
  5. Known and left: hydration isn't queued offline; local vs cloud break-target maths differ; the tab-hidden
     `not_tracking` handler is unreachable; stray `app_settings` rows (`''`, `ZZ_DEBUG_DELETE_ME`) and the old
     `default` user's rows (which have the same overnight-away artifacts) were left for the owner to decide.
  6. Owner-only cleanups: delete the untracked `voice-gen/` folder and `~/.claude.json.bak-before-supabase-removal`
     by hand (the tooling refused the delete).
- **How to work here (the owner's process):** branch -> PR -> the owner says "merge N" -> squash merge. Never merge
  without that explicit go-ahead. Pushes straight to `main` are blocked for everyone but the owner. Keep changes
  small, say plainly what was and wasn't verified, and never guess URLs or data.
- **Verifying UI changes:** `npm run build`, then run `npx vite preview --port 5173 --host 127.0.0.1 --strictPort`
  in the background and open `http://localhost:5173/plumb/` in the browser pane (use `localhost`, not 127.0.0.1). Set
  `localStorage 'plumb:userId'` to a throwaway name (`preview-test`) and delete any test rows afterwards (the app
  talks to the REAL database). To try the popup, put `#statusCard` (with class `pip-mode`) alone in the body and resize
  the viewport. Stop the server afterwards (PowerShell: find the PID listening on 5173 and `Stop-Process`).
- **Gotchas learned:** large bash heredocs containing quotes break -- write patch scripts to files and run them;
  `preview_start` launches the CAPS app when the session's directory is CAPS (serve Plumb by hand as above);
  browser-pane click coordinates are in the screenshot's frame, not CSS pixels; audio needs a real click (a scripted
  `.click()` doesn't unlock the AudioContext); the Supabase query tool is read-only (use `apply_migration`, and
  deploying an edge function means pasting the file contents); `posture_daily_summary` is a cache the rollup only adds
  to, so delete stale rows before rebuilding it.
- **The owner's taste (all reinforced this session):** serious/professional tone, no gimmicks (no tomato icon, no
  mascot); the app's own vocabulary is **plumb / out of plumb**; spoken lines avoid the word "posture" (mispronounced
  by every voice); popup small and stacked with the text below; message in green with orange text; free tier only.

Full code review done ahead of a demo on Wednesday 2026-09-30, then the fixes below (branch
`fix/demo-readiness`). The owner will use a separate **'Demo'** login (own settings row) with the
sensitivity set high (lateral tolerance down to 0.03, "sustained before nudge" down to 3s) to show the dot
respond to leaning left/right within a few seconds.

**What changed**
- **Settings sync no longer clobbers.** `pushAppSettings` used to send every field from the tab's memory,
  which is how the 2026-09-23 working-hours (08:00-16:00) and 1000ml change was reverted within a day by a
  stale tab. Now: only changed fields are sent, nothing is sent until the first fetch finishes, and `extras`
  is merged key-by-key onto the server copy (`scheduleSettingsPush('field' | 'extras.key')`). Verified
  against the real database with a throwaway user (partial push leaves other columns null; a reminder added
  from a stale page kept the server's working hours). **Any device with an old tab open must be refreshed.**
- **`plumb:extras`, `plumb:reminderFired`, `plumb:pomodoro` are now per-user** like the other person-level keys.
  Before, a new name on the same device inherited the previous person's reminders and working hours.
- **Presence grace (5s).** One dropped frame used to end the presence block and restart the sitting clock;
  51% of all logged presence rows were <=3s. Presence now ends only after `PRESENCE_LOSS_GRACE_MS` of no
  detection, back-dated to when detection was lost. A gap of 5-60s still restarts the sitting clock (by design).
- **Chair-as-person diagnostics are now persistent.** Previously the visibility numbers went to the 15-line
  alert feed and were gone. Now `logPresenceDiag` keeps the newest 400 entries in localStorage
  (`plumb:presenceDiag`); on an affected device run `plumbPresenceDiag()` in the browser console. Each entry has
  landmark visibilities, eye gap and `dNose` (movement since the previous entry; a phantom on furniture may
  be perfectly still). Still no threshold change: get real numbers from an occurrence first. 2026-09-25 evidence:
  a real 12:39-12:52 break was followed by presence blocks at 12:52/13:03/13:08 although the owner was out until
  about 13:30.
- **AI summary now works, via OpenRouter.** The Monday job used to call Anthropic (paid) and commit
  `public/data/summary.json` to `main`; that push never ran (a bug in the workflow) and could not have worked
  anyway (PR-required protection, no bot bypass). It also mixed all users together. Now `ai-summary.yml` +
  `scripts/generate-summary.cjs` write one row per user to the new `ai_summary` table (`openrouter/free`), and
  the report tab reads that. `deploy.yml` is push-only and uses `npm ci`. Delete the `ANTHROPIC_API_KEY` repo secret.
- **Weekly analysis** was failing since OpenRouter retired the pinned free slug (404 on 2026-09-25); it now uses
  `openrouter/free`. The serving model is stored in `weekly_goals.model` -- check it if a week reads oddly.
- **Popup (PiP), final state.** Stacked layout only: the dot and loop on top, the status text BELOW in its original
  small fixed font (16px value, 11px caption). The owner rejected a side-by-side/landscape layout and larger fonts
  ("very ugly") -- don't reintroduce them. The window is requested as narrow as Chrome allows (`requestWindow`
  140x152 plus a `resizeTo(140,152)` inside the opening click, because Chrome remembers a size the user dragged
  the window to and enforces its own minimum width; the owner's Windows Chrome kept it about 1.6:1 wide). The glyph
  scales with the window (`max(56px, min(70vw, 48vh))`), the ring's pulse is deliberately small in the popup
  (1.35x / 1.5x keyframes `dz-ring-pulse-*-pip`) so it stays inside the window, and the dot's travel limit keeps the
  whole ring (dotR + 7) inside the drawing (`updatePostureGlyph`). Checked at 140x152 and 300x190 in a browser
  pane; the owner has confirmed the layout in a real popup screenshot.
  **The popup's on-screen message (toast)** is the app's text green (`--ink`, solid) with light orange text (`#FFAA66`,
  6.1:1 contrast), split into two balanced rows (`toastRows`) and larger (13px at the small size). Orange on the
  brighter accent green (`--accent`) fails contrast (~3:1), so don't use that pairing.
  **Main panel and controls (owner's list):** two button rows -- row 1: start camera, calibrate plumb position,
  start a break, nudges on/muted switch; row 2: focus, workstation setup, desk gym, how do I look? (was "are you
  camera ready?"), then the icons pop-out, book, settings. No tomato icon anywhere (dropped at the owner's request).
  The **book icon** opens "why the alerts are set this way", built from `RESEARCH_INFO` (the same notes as the small
  "i" buttons beside each setting in Settings). The hero under the tracking-in-popup heading reads "sitting plumb
  today" (the wrap's "sitting well" rows became "sitting plumb"; the report tile says "out of plumb"; the chart
  legend's "good posture" is just "plumb"). While the summary shows, its box is only as tall as its content (`:has()`
  rule) so the buttons sit directly beneath it. **Colours:** `break` and `away` are stone/taupe (`#CFC6B6` light,
  `#9E9382` darker) -- neither counts as posture and the old brown/blue read as bad posture; `CATEGORY_COLORS` is the
  single source for every chart.
- **Angus and Matilda never made a sound (fixed 2026-09-26, found by reproducing in a browser pane).** They
  downloaded and synthesised fine, but `auPcm2Wav` wrote its four WAV chunk tags as big-endian integers, storing
  "FFIR"/"EVAW" instead of "RIFF"/"WAVE", so `decodeAudioData` rejected every clip ("Unable to decode audio data").
  The 2026-09-23 note that they "work" only ever verified the download. Tags are now written as ASCII. Verified:
  Matilda's calibration and test lines decode to valid 2.25s / 1.75s audio and play. Still an open QUALITY question
  (literary reading style) -- the owner has not yet heard them speak a real Plumb nudge.
- **Instant calibration confirmation.** The calibration line (now "Calibrated, that's your plumb position.") arrived seconds after the
  button because Piper synthesises on demand. Now every spoken line's audio is cached per voice (a repeat plays
  ~1ms after the trigger), the calibration line is pre-generated as soon as the voice is ready, synthesis runs one
  at a time, and a line that finishes after a newer one has started is dropped instead of playing over it.
  Voices: Alba stays the default; Alan and Cori removed (8 Piper voices + Angus and Matilda now).
  **Popup text and voice start together (2026-09-26).** `speak()` used to show the popup text at once and speak
  after Piper had generated the audio (a second or more later). Now the text is shown at the moment the audio
  starts (measured: TOAST and PLAY within the same millisecond for a cached line). If the voice is still loading or
  no audio can be made, the text shows immediately so an alert is never invisible. Piper runs on the page's main
  thread and takes ~2-4s of processing per line, so background pre-generation (`queuePrewarm`/`pumpPrewarm`) is
  restricted to idle moments -- tracking not running, nobody in frame, or on a break -- and never runs while a
  line is being generated for someone waiting; the queue holds the calibration line, the first line of each posture
  nudge, and the next line of any list after one is spoken. A line someone is waiting for always goes first.
  **Spoken lines must avoid the word "posture"** -- every Piper voice mispronounces it (owner, 2026-09-26). Say
  "position" instead ("Reset your position.", morning greeting now just "a new day of tracking"). On-screen text may
  still say posture. The calibration confirmation is now "Calibrated, that's your plumb position."
- **Sleep-gap artifacts (found from the week report showing 98% slouching, one day at 250%, and "16h 40m away").**
  When the laptop slept with Plumb open, whatever was open was closed at WAKE-UP time: a slouch block became a
  single 15.33h `compression` event (id 17171, 2026-09-22 16:45 -> 09-23 08:05) and four overnight absences became
  15.4-15.7h `away` events (ids 4409, 6950, 9917, 19187; 62h of "away" in total). `handleLoopGap` (src/main.js) now
  detects a >30s gap between frames, ends everything open at the last frame actually seen (breaks are ended
  silently) and logs the gap as `not_tracking`. **Data repair, applied 2026-09-26:** those five rows were relabelled
  `not_tracking` (to revert: set `type` back to `away` for 4409/6950/9917/19187 and `compression` for 17171), and the
  matching `posture_daily_summary` cache rows were deleted and rebuilt by running `rollup.yml` (the rollup only
  upserts, so it never removes stale cache rows -- remember that if raw rows are ever corrected). After the repair
  the week showed 19.0h slouching of 35.3h tracked (54%), away 1.3h. Same-shaped older rows for the pre-name
  `default` user (2026-08-05..21, up to 29h) were NOT touched. The weekly analysis also now ignores any single slouch
  block over 2 hours. **Still open:** even after the repair most days read 54-74% "slouching", which suggests the
  calibration baseline / tolerances drift over a day rather than genuinely slouching that much -- worth a look.
- Smaller: Alan removed from the voices; spoken weekly-goal line removed (it overlapped the morning "let's
  calibrate"); morning greeting only 05:00-12:00; stopping the camera during a break no longer leaves a phantom
  presence timer; a failed camera start releases the stream; events the server rejects with a 4xx are dropped
  rather than retried forever; stale 2L/2000ml copy fixed; `onnxruntime-web` declared explicitly.

**Known and deliberately left**
- Calibration is not persisted across page reloads (recalibrate after each load, including before the demo).
- Hydration entries are not queued offline (a failed POST is lost at the next cloud sync); undo during an
  in-flight POST cannot delete the cloud row. Local break target and cloud-reconciled target use different maths.
- The tab-hidden `not_tracking` handler in `visibilitychange` is unreachable while the popup exists, and in
  browsers without Document PiP returning to the tab stops the camera. Chrome desktop (the owner's setup) is fine.
- The anon key has full rights on the core tables (documented as accepted). `default` user rows and stray
  `app_settings` rows (`''`, `ZZ_DEBUG_DELETE_ME`) still exist -- owner said leave them.
- `voice-gen/` (dead ElevenLabs tooling) and `~/.claude.json.bak-before-supabase-removal` were approved for
  deletion but the tooling refused the delete; remove by hand.

## Handover — 2026-09-23 (supersedes 2026-09-20 below wherever they disagree; read after the 2026-09-26 section above)

Written because the owner may be about to move to a different Claude account, which would lose this
conversation's memory and the claude.ai doc referenced below -- everything that matters from this session is
captured here instead, in the repo, so it survives that. The 2026-09-20 section right below this one is still
correct for everything it covers that this section doesn't touch (architecture, secrets, general "how to work
here" facts) -- read both.

### 1. What actually changed and shipped (all pushed to `main`, deployed)

- **Hydration model reworked.** The day-window used to be "first check-in + 9 hours"; it's now an explicit
  **working hours** setting (Settings → hydration, default **08:00–16:00**), and the default daily target
  dropped from 2000ml to **1000ml** (half of the usual ~2L guidance, reasoned as "roughly half your waking
  day"). The 300ml-behind trigger itself was deliberately left as a flat amount, not scaled to the new lower
  target -- owner's explicit call ("if I'm 300 behind I'm 300 behind"). The owner's own live Supabase row
  (`user_id = 'Paul'`) was updated directly via migration to match (`hydration_target_ml: 1000`,
  `extras.hydrationPace: {start: "08:00", end: "16:00"}`) -- new devices/fresh installs get the new defaults
  automatically; existing saved settings needed this one-time push.
- **Morning greeting varied** (`MORNING_PHRASES`, 5 lines, picked at random -- the one exception to every other
  group's step-through-in-order pattern) and **break-return phrasing widened** (7 long-break + 9 short-break
  variants) so it stops repeating "that was a nice stretch" -- direct owner feedback that it always said the
  same thing.
- **Camera-ready AI review tuned down**: the prompt (`supabase/functions/camera-review/prompt.js`) now
  explicitly tells the model to ignore a few stray flyaway hairs and only flag genuinely messy hair -- owner
  reported it fixating on normal minor flyaways. Deployed directly via the Supabase edge-function deploy tool
  (version 7); the repo's copy of `index.ts`/`prompt.js` matches what's actually live.
- **Chin tucks now link to a real demo video** the owner chose (`https://www.youtube.com/shorts/pAps-PUqwv0`)
  instead of a generic YouTube search -- `src/deskgym.js` gained an optional `video` field per entry that, when
  present, wins over the search-link fallback; the other four stretches are unchanged (still search links).
- **Two real bugs found and fixed in Piper voice switching** (see "The real Piper bug" below for the full
  story -- worth reading in full if this area breaks again). Net effect: switching voices in Settings now
  actually works, confirmed by the owner listening to real captured audio, not just by code review.
- **Microsoft's browser-voice (SAPI) entries removed outright** from the voice picker's "browser voices" group
  -- not deprioritised, excluded even as a fallback when no Google/Samantha/Daniel voice exists on a device.
  Owner's words: "they are awful."
- **Piper voice roster expanded from 1 to 10.** Discovered mid-session that 8 official Piper voices were
  *already* wired in code (`PIPER_VOICES` in `src/main.js`) but never mentioned to the owner or exercised --
  Alan, Nathan, Alba, Southern, Cori, Jenny, Aru, Semaine (all UK accents, mixed genders). Added two more:
  **Angus** and **Matilda**, a community Australian-English model (see below) -- all ten are free, local,
  already deployed, and selectable today in Settings → voice.

### 2. The real Piper bug (read this before touching voice-switching code again)

Two separate, real bugs stacked on top of each other. Fixing only the first one was not enough --
**confirmed the fix by listening to real captured audio, not by code review or byte/checksum comparison**,
because Piper's model has genuine run-to-run randomness that makes byte-level comparison actively misleading
(the same voice, same text, repeated, produces different output lengths -- checksums looked "different" for
switched voices when it was actually just noise, more than once, before real audio settled it).

1. **A real but secondary race** (`ce7131e`): `ensurePiperVoice()` cached the loaded voice in two shared
   variables. If a slow download for voice A was still in flight when the owner switched to voice B, A's
   download could finish *later* and silently clobber B's already-loaded session. Fixed with a request-sequence
   counter so a superseded, late-finishing load can no longer overwrite a newer one.
2. **The actual root cause** (`26966cd`), only found after the owner insisted the fix hadn't worked and a live
   reproduction (see below) proved it: `piper-tts-web`'s `TtsSession` class is an **undocumented singleton**.
   `TtsSession.create()` for a *different* `voiceId`, once any instance already exists, just relabels that same
   instance's `.voiceId` property and returns it -- the actual loaded ONNX model (a private field) is **never
   reloaded**. Confirmed directly against the live library in a browser console: `create('A')` then `create('B')`
   returns the *identical object*. This is why switching voices "locked" onto the first one loaded, forever,
   regardless of how long you waited or which voice you picked next -- fix #1 above was real and worth keeping,
   but could never have fixed this. Fixed by clearing `piperTTS.TtsSession._instance = null` (a plain,
   non-private static property) immediately before every `create()` call the app has already decided needs a
   genuinely different voice.
3. **How this was actually verified**, since it's a pattern worth reusing if audio bugs come up again: captured
   the real `AudioContext.decodeAudioData` input via a monkey-patched hook in the live deployed app (not a
   local mock), for a real sequence of voice switches through the real Settings UI, saved the raw bytes as
   actual playable `.wav` files, and sent them to the owner to listen to directly -- twice, once proving the bug
   was still present after fix #1 alone, once confirming it was gone after fix #2. The owner's ears caught what
   byte/length/checksum comparison could not.

### 3. Angus and Matilda (Australian voices) -- how they actually work

Not an official Piper voice -- Piper ships no `en_AU` locale at all (confirmed against the real
`rhasspy/piper-voices` Hugging Face repo listing: only `en_GB` and `en_US` exist). The owner asked for
Australian voices anyway, so this uses a community model instead:
**`DataCraftsmanAustralia/piper-en_AU-librivox-medium`** on Hugging Face, one file, ten speakers. Two real
library limits meant it couldn't just be added to `PIPER_VOICES` like the others:

- `piper-tts-web`'s built-in `PATH_MAP` only knows the one official HF repo it ships with.
- Its `predict()` hardcodes speaker id `0`, with no public way to select a different speaker.

So it's driven by a small hand-written path instead (`AU_MODEL_BASE`, `AU_SPEAKER_IDS`, `ensureAuModelLoaded`,
`AuVoiceSession` -- all in `src/main.js`, right before `ensurePiperVoice`), which mirrors
`piper-tts-web`'s own `init()`/`predict()` almost line for line: same phonemizer chunk (imported by a relative
file path into `node_modules`, not a package import, since the package's own `package.json` `exports` map only
declares `"."`), same `onnxruntime-web`, same WASM paths, just pointed at the different repo and given an
explicit `sid` tensor per call. `ensurePiperVoice()` branches to this path early for `en_AU-angus` /
`en_AU-matilda`, before reaching any of the official-voice / singleton-workaround code.

- **The voice: Angus, not "Algy."** The owner initially asked for "Algy" -- that's the *narrator's pen name* in
  the model's voice table, not a voice id. The actual voice slot he narrates is called Angus (speaker id 4,
  male). Matilda is speaker id 7 (female) and *is* a real voice name in this model.
- **~75MB shared file.** Both voices come from the one download -- whichever is picked first pays the real cost
  (confirmed live: took a genuine ~15-20s), the other loads near-instantly afterward (confirmed live: Matilda
  right after Angus needed no new download).
- **Known quality caveat, from the model's own card, not yet independently judged by the owner beyond a first
  listen of the author's own demo samples**: trained on 19th/early-20th-century LibriVox audiobook narration --
  a formal literary reading style, not conversational, and it struggles with modern short phrasing, numbers, and
  abbreviations, which is most of what Plumb actually says. The author's own card says it was "still improving
  slowly when training was paused." Owner said "go for" both after hearing the author's official demo clips
  (fixed sentence, not Plumb's own wording) -- **worth a follow-up check once the owner has actually heard them
  speak a real Plumb nudge line**, not just the demo sentence, since that's a materially different test.

### 4. ElevenLabs: tried, abandoned, don't restart without reading this

The owner wanted 4+ distinct gendered voices and started down the ElevenLabs path before landing on expanding
Piper instead (see above). Kept here so nobody repeats the same dead end:

- **Free-plan API access is blocked entirely** -- confirmed directly: a real API key with real TTS permission
  got `402 payment_required "Free users cannot use library voices via the API"` for *both* a Voice Library
  voice *and* a plain default premade voice (Rachel). Not a library-specific restriction as the error message
  implies -- free-plan API access to voice synthesis appears blocked outright, at least for this account.
- **Manual generation via the website (not blocked) produced genuinely corrupted-sounding audio** on a bulk
  run (35 clips in ~23 minutes) -- confirmed the files were NOT truncated downloads (a byte-level MP3 frame
  parity check on all 35 passed clean), so the corruption was baked into the actual generated audio content
  itself, most likely free-tier generation congestion under rapid back-to-back requests. All 35 clips from that
  run are unusable and were never salvaged or aligned to specific phrases -- not worth the effort once the
  audio itself was bad.
- **Decision: not pursuing further.** Owner: "leave them out, not needed."
- A `voice-gen/` folder (phrases.json, voices.json, a real `generate.mjs` script that would batch-call the
  ElevenLabs API once entries are added to `voices.json`) was built and works, but **was deliberately never
  committed to git** -- it sits locally only, untracked, along with an uncommitted `.gitignore` addition for
  `voice-gen/output`. If ElevenLabs is ever revisited, that tooling still exists locally on this machine (not
  guaranteed to survive an account switch, but does survive independent of the Claude account since it's just
  files on disk) -- otherwise it can be safely deleted, nothing else depends on it.

### 5. The "Plumb spoken phrases" doc -- now mirrored into the repo, doc itself is NOT durable

A claude.ai doc (`https://claude.ai/code/artifact/f7c7bc8e-ac2c-4236-bbef-7ca21b11dfe8`) was created to list
every spoken line for the (later-abandoned) ElevenLabs recording pass, and the owner made real wording edits
in it while reviewing. **That doc lives on a Claude account and will not survive an account switch** -- its
current content (as of rev 83) has been copied verbatim into **`docs/spoken-phrases.md`** in this repo, which
is now the durable copy.

The owner's edited wording in that doc **has now been applied to `src/main.js`** (2026-09-23, owner confirmed
"apply the wording changes to the code") -- `LEAN_PHRASES`, `BREAK_PROMPT_PHRASES`, `STILLNESS_PHRASES`,
`BREAK_RETURN_SHORT_PHRASES`, `MORNING_PHRASES`, and the calibrated line all match the doc/`docs/spoken-phrases.md`
now. `docs/spoken-phrases.md` is genuinely current, not just a snapshot of a decision still pending.

The doc also has a second tab, "Lee recording checklist" -- a per-line checklist for a manual ElevenLabs
recording pass that got partway through (36 of ~79 lines ticked) before the whole ElevenLabs path was
abandoned. Harmless leftover, not acted on further, also not durable (same account risk as the main tab).

### 6. Also cleaned up, not code but worth knowing

- **A local Supabase MCP server config in `~/.claude.json` had an expired token** and was removed (backed up
  first as `~/.claude.json.bak-before-supabase-removal`, a plaintext copy of the old token -- delete that backup
  once you've confirmed nothing needed recovering from it). The **account-managed Supabase connector** is the
  one actually used for everything in this project (migrations, edge function deploys) and was untouched --
  confirm it's still connected if a future session reports Supabase tool calls failing with "Unauthorized."

## Handover — 2026-09-20 (superseded by 2026-09-23 above wherever they disagree; still correct for everything else)

This section is the single source of truth for "what is true right now". The
rest of the file is a long dated log kept for archaeology; where it disagrees
with this section, this section wins. A very large amount landed on
2026-09-19/20, so verify anything load-bearing rather than trusting it.

### 1. What Plumb is

A personal, self-hosted posture and desk-wellbeing companion. Runs in the browser
(webcam -> MediaPipe pose landmarks -> compared with your calibrated baseline),
speaks and shows short alerts, tracks hydration/light, logs everything to Supabase,
and produces a weekly AI analysis. Single user (the owner, "Paul"); not a medical
device; prototype quality. Live at `https://easybeinggreen.github.io/plumb/`, repo
`easybeinggreen/plumb`, local clone `C:\Users\green\OneDrive\Documents\Plumb\plumb`.

### 2. How to work here (practical, learned the hard way)

- **Git:** work directly on `main`; the owner's pushes bypass branch protection (GitHub
  prints "Bypassed rule violations"). Pages redeploys on every push (~30s). Use
  `Co-Authored-By` trailers as in the log. One exception was declared by the owner:
  slouch-*calibration* changes go on their own branch, not `main`.
- **Dev server:** `npm run dev -- --port 5173`, then open `http://localhost:5173/plumb/`
  (the `/plumb/` base matters). `.claude/launch.json` can start the wrong project
  depending on the session's working directory; start it by hand if so.
- **Windows/bash gotcha:** large inline heredocs containing quotes break the Bash tool.
  Write patch scripts to `.claude/*.py` with the file-write tool, run them, delete them.
  `.claude/` is untracked; never commit it.
- **Running the app locally syncs to the REAL database** (`.env` holds the live URL and
  anon key). Test edits to settings/reminders/voice push to production `app_settings`.
  This happened twice and was cleaned up each time -- always restore what you touch.
- **Supabase tooling:** the query tool is READ-ONLY (a one-row `update` fails with
  "read-only transaction"; use `apply_migration` even for data fixes, and say so).
  It cannot `set role`; `information_schema.role_table_grants` shows nothing useful, so
  check privileges with `has_table_privilege(...)`; multi-statement queries return only
  the last result set. Edge functions are deployed with the deploy tool and the repo
  copy under `supabase/functions/` must be kept in sync by hand.
- **Testing approach that worked:** put logic in pure modules (`src/closeup.js`,
  `src/companion.js`, `src/deskgym.js`) and test with node using real Dates; 113 checks
  passed on 2026-09-20 (test files lived in a temp folder and were not kept -- rewrite
  from the function contracts if needed). DOM behaviour is checked in the browser pane
  (it has NO webcam or microphone; screenshots only work when the pane is visible; a
  screenshot taken immediately after a change can predate the render, take another).
- **Docs:** `docs/database-schema.md` is the real schema/grants/functions/jobs reference.
  The README's setup section now points at it (its old SQL only knew a retired table).

### 3. Architecture map

- `index.html` (~960 lines) + `src/main.js` (~4,600 lines, vanilla JS, no framework).
- `src/companion.js` -- pure logic: hydration pacing, reminders, goal-time parsing, focus
  timer state machine, alert-blocking rules, end-of-day wrap maths, name normalisation.
- `src/closeup.js` -- pure logic: "are you camera ready?" framing/lighting checks, mic
  analysis, webcam distance estimate. `src/deskgym.js` -- the five stretches (data only).
- `scripts/` -- `rollup-summary.cjs` (nightly), `generate-weekly-analysis.cjs` (Friday),
  `sync-calendar.cjs` (hourly), `generate-summary.cjs` (dormant, see section 6).
- `.github/workflows/` -- `deploy.yml`, `rollup.yml`, `weekly-analysis.yml`, `calendar-sync.yml`.
- `supabase/functions/camera-review/` -- the AI camera review edge function (+ `prompt.js`).
- Supabase project `keacpowuykzcnwwdbjkd` (ap-southeast-2, free plan). Details in
  `docs/database-schema.md`.

### 4. What exists (all pushed to `main`)

**Tracking core.** Pose-based detection of lateral lean, neck-drop ("compression"),
lean-in (eye distance), sitting-low (nose drop). Event-sourced: every interval is a
`posture_events` row; totals are computed, never trusted from a counter. Presence,
break (60s-60min, camera-based), away (>60min), not_tracking (tab hidden). Every path
that ends presence must also flush any open slouch block (a `visibilitychange` path
leaked this for weeks; fixed 2026-09-17). Camera-loss handling, PiP popup in two phases.

**Alert pipeline (important to understand before touching anything).** Every alert goes
through `speak(text, force, userInitiated, kind)`, which (1) drops it if
`alertsSuppressed(kind)`, (2) counts it as an interruption, (3) shows an on-screen
toast over the status card (the popup) for 3s+, (4) speaks it. `kind` is one of
`nudge | break | stillness | hydration | reminder | wrap | pomodoro`. Alerts are
suppressed during **calls** (calendar) and during a **focus block**; see below. The
popup is the status card moved into a Document-PiP window; alerts live there because it
is always visible while tracking runs (owner's decision; no browser-notification
fallback wanted).

**Popup glyph.** Base dot 13.2 radius; the loop is a fixed 58x34 marking the THRESHOLD
(dot exactly on it = state flips good->mild and the sustain clock starts). It is not a
limit: the dot travels past it toward the drawing edge. The dot rests near the TOP
because neck-drop only moves it down. Smoothing is untouched.

**Voice.** Default is **Alba** (Piper `en_GB-alba-medium`, the Scottish female voice),
the owner's favourite; the voice is the owner's stated key to the product. The choice
syncs across devices via `app_settings.extras.voice`. History: the default used to be the
browser's "Google UK English Female" (robotic), which any device without a saved choice
silently got -- migrated away 2026-09-20. If a Piper voice is not ready (first download,
offline) Plumb shows the alert on screen only and logs it; it **never** falls back to the
browser's robotic default for a Piper choice. ElevenLabs voices are planned for later,
pre-generating the fixed nudge phrases so there is no per-nudge network call; wait until
the owner has finished reviewing the wording/headings so the phrase set is settled. The
never-robot fallback rule and the cross-device sync carry over to any new voice engine.

**"Are you camera ready?"** (button; formerly "ready for my close-up"). A live mirrored
preview with a centre line and two dotted eye-height lines; checks that auto-refresh:
centring, headroom, framing (head-and-shoulders), head tilt, face brightness, left/right
lighting evenness, backlight, glare; a 5-second microphone test; and an opt-in "get a
fuller AI review" that sends ONE 640px frame to the `camera-review` edge function (hair,
clothing, background, things behind the head). Local checks never leave the device.
Verified against the owner's real photos: all 8 local checks pass. Thresholds are
unvalidated first guesses (`CLOSEUP_THRESHOLDS`).

**"Workstation setup"** (button; formerly "set up your desk"). One-off wizard: eye height
vs the top of the screen (eye line as a fraction down the picture; assumes a camera that
faces straight out), estimated distance in cm (pinhole estimate from eye spacing, ~+/-
10cm, 50-70cm target), lighting, a desk checklist, then calibrate. Head tilt was
removed from it (not a setup property; it had a real bug: the eye angle was measured in
the un-mirrored frame so a level head read ~180deg and the diagram flipped).

**Calendar + calls.** `CALENDAR_ICS_URL` (GitHub secret, a private Google iCal link) ->
hourly `calendar-sync.yml` -> `calendar_events` (times only, never titles; Meet/Zoom/
Teams/Webex link = call). The table is service-role-only. The browser can only ask
`in_call_now(user)` for a bare yes/no. While in a call, all alerts pause and the popup
pill shows "in a call"; setting "pause nudges during calls" (default on). In-person
meetings do not mute. Single user; multi-user is deliberately not offered (see 7).

**Hydration pacing.** Target spread evenly over "active hours" (default 07:00-19:00). A
dashed pace line on the water gauge and a label ("on pace" / "NNNml behind pace"). A
nudge only when tracking runs, you're present, not in a call/focus block, >=300ml behind,
at most hourly, never in the last hour of the window.

**Reminders.** Settings -> reminders: at a clock time (weekdays option; may fire up to 10
min late, 30 after a focus block) or every N minutes (5-240, within active hours; clock
starts on first sight, restarts after a long absence). Weekly goals containing a time
("At 1:30pm...") get a "remind me at 13:30" button. Fire per device (two open devices
would both fire).

**Focus timer (tomato).** Button in the control row; 25/5/15, long break every 4th
(configurable). **Focus freezes EVERY alert** (tracking/logging carries on). During the
timer's own breaks only Plumb's "take a break"/"move" prompts are held back. Starts on a
work block; nothing auto-starts; a break ends into idle. State is per device
(localStorage `plumb:pomodoro`). One status pill on the popup shows the tomato timer
and/or "in a call".

**End-of-day wrap.** "today's wrap" header button plus a once-a-day "wrap ready" notice
at 17:30 while tracking runs (retried after a call/focus block). Tracked time,
sitting-well % vs yesterday, breaks, longest sit, most common slouch, steadiest/roughest
hour, water, focus blocks, count of alerts Plumb sent, and the week's first goal. Calls
are not in it yet (calendar table is server-only).

**Desk gym.** "desk gym" button: five seated stretches, each two sentences (what + why)
and a YouTube *search* link (a search URL is always valid; a specific video id can't be
verified). On demand only, never a prompt. Not medical advice.

**Weekly analysis + daily check-in.** Friday 16:00 Brisbane, `openrouter` model
`deepseek/deepseek-v4-flash-0731:free` pinned, per-day peak checks, light sample counts
(`n`) so a 1-reading hour isn't called a pattern, three short labelled lines + three
one-sentence goals + real tracked-coverage line. Shown in the "this week" panel.

**Reports.** Today/week/month + day drill-down, minute-band timeline with majority-vote
pixels, totals bars, hydration trend; `CATEGORY_COLORS` is the single colour source for
every chart and legend (palette validated, documented at its definition).

**Settings that sync across devices** live in `app_settings` (tolerances, timings,
hydration sizes) plus `app_settings.extras` jsonb (hydration pacing, reminders, focus
lengths, wrap time, voice). Remote wins on load. **Your saved lateral tolerance was
0.20 from 2026-08-22 and silently overrode the 0.07 code default until it was set to
0.07 on 2026-09-20.**

### 5. Verification status (be honest about this)

Verified: pure logic (113 node checks); every UI flow in the desktop browser pane
(reminder fires on the exact minute and once only; focus freezes then releases a due
reminder; focus->break->idle transitions; wrap with fake events, numbers hand-checked;
desk gym links; voice default/migration/sync; in-call pill, feed and end message with a
faked answer); the calendar parser against a synthetic calendar in UTC and Brisbane time
zones and then the real sync (21 events); `in_call_now` boundaries on real data and its
grants; the AI review end-to-end through the deployed function (accurate, ~15-60s).

**NOT verified -- the owner is about to live-test these; expect surprises:**
the real PiP popup (toast, status pill, focus countdown, the new glyph layout and dot
travel); the hydration nudge firing (only its gating rules are tested); the automatic
"wrap ready" notice; alert suppression inside `speak()` during a real call or focus
block (only its inputs were tested); the AI review button from the actual app (only
called directly); Alba on the owner's other devices; every threshold in the camera-ready
and workstation checks against a real webcam (the Brio is the owner's camera; the
browser's default camera is the laptop's, chosen in Settings -> device -> camera).

### 6. Open issues and pending decisions

1. **Chair-as-person presence bug: unresolved after two threshold attempts.** BlazePose
   can extrapolate confident face landmarks onto a chair. `checkFaceVisibility` logs the
   real numbers to the alert feed on every presence transition; get those from a real
   occurrence before touching thresholds. Do not guess a third time.
2. **Brightness barely tracks the room** (webcam auto-exposure compensates before Plumb
   sees pixels). Options: lock exposure via `MediaTrackConstraints` (the Brio supports
   manual exposure) or adaptive range-stretching. Trade-off: a locked exposure would also
   affect how "are you camera ready?" sees the face. Owner's decision pending.
3. **Popup size / address label.** Chrome's Document-PiP API documents no way to hide the
   window's title bar/origin (`disallowReturnToOpener` only hides the back-to-tab button).
   The window is already near the minimum for its content; shrinking means dropping the
   caption and live numbers. Owner has not answered.
4. **The dormant "AI summary" is not standalone.** `deploy.yml` has a `prepare-summary`
   job (Monday 08:00 UTC and manual, `continue-on-error`) that runs
   `scripts/generate-summary.cjs` and commits `public/data/summary.json`; the report's
   "ai summary" tab and `public/summary.html` read it. It is superseded by the weekly
   analysis. Removing it means editing the deploy pipeline and dropping that tab -- ask
   the owner first; it was offered as a "tidy-up" before this was known.
5. **`default` user data:** ~2.9k `posture_events` and ~100 daily-summary rows sit under
   user `default` (from before names existed). Not merged into `Paul`; owner's call.
6. **Owner is reviewing all headings/wording next**, which should finish before voices.
7. **Posture during calls in the weekly analysis:** wait for ~10 tracked hours in calls
   (only ~1.7 tracked hours overlapped 14 past calls). **Alert budget:** watch the wrap's
   alert count for a week before capping alerts per hour. **Brightness-exposure chart /
   auto-brighten the page:** wait for more light data / needs design.
8. **Roadmap not started:** "best self" photo comparison for the AI review (owner is
   still thinking about the photo), coached 20-20-20 folded into the start of each break,
   ElevenLabs voices (after wording is settled), optional "paste my own stretch video" and
   "watched it once" tick, a self-serve re-run button for the weekly analysis.

### 7. Owner preferences and decisions to respect

- Tone is **serious and professional**. A mascot/character was drawn and rejected as
  gimmicky ("on ice"); don't revive it. Voices, not visuals, are the personality.
- **Free tier only**: no paid services. Supabase free (Edge Functions incl.), OpenRouter
  free models, GitHub Actions. Free models are slow/flaky, hence the retry design.
- **Design worry:** a person could spend all day interacting with Plumb and get little
  done. Guardrails: focus freezes everything; calls mute; stretches are on-demand only;
  new features default to quiet; the wrap counts interruptions. New features must not add
  prompts by default.
- **Privacy:** video stays on the device except one frame sent on an explicit button
  press for the AI review (not stored). Calendar link is a secret, never logged, times
  only. Tables open to `anon` are a convenience, not a privacy boundary -- so anything
  sensitive goes server-side only (as `calendar_events` and `camera_review_usage` do).
  Do not offer calendar/AI features to other people without real accounts.
- The owner prefers being told plainly what is and isn't verified, wants real data
  checked (they have repeatedly been burned by silent data bugs), and likes small,
  reviewable steps with the reason given. Never guess URLs.
- Recurring bug class to check for on every new table/script: **missing role grants**
  (four times so far). Verify with `has_table_privilege` and by running the real thing.

### 8. Secrets and where they live

GitHub repo secrets (write-only, workflows only): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `CALENDAR_ICS_URL`,
`ANTHROPIC_API_KEY` (dormant script only). Supabase Edge Function secret:
`OPENROUTER_API_KEY` (a separate copy; created 2026-09-19). Nothing sensitive is in the
repo. The anon key in the built site is public by design.

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

- **Frontend**: Vite + vanilla JS (no framework), `src/main.js`
  (~4,600 lines) plus pure-logic modules (`src/companion.js`, `src/closeup.js`,
  `src/deskgym.js`), driving a single `index.html`. `@mediapipe/tasks-vision` for
  pose detection, `@mintplex-labs/piper-tts-web` for offline neural voice.
- **Backend**: Supabase (Postgres + PostgREST), accessed directly from the
  browser via `fetch` — no server code except the GitHub Action scripts and one
  Supabase Edge Function (`camera-review`). See `docs/database-schema.md`.
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
   "Handover — 2026-09-20" at the top of this file for the current
   theory and what to do next. Don't guess a third threshold blind.
2. **Brightness sensitivity to real ambient-light changes is weak**,
   likely webcam auto-exposure compensating before Plumb sees the raw
   pixels — see "Handover — 2026-09-20" at top for the two unbuilt options (exposure
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
   **Update, same day, after the user's first real try:** they couldn't see
   themselves in the modal, so it now has a live **mirrored preview**
   (second `<video>` on the same MediaStream -- the main `#video` is moved
   off-screen once tracking starts) with centre/thirds guides and eye/nose
   dots, and the checks auto-refresh every ~0.8s instead of a button. Added
   a **mic test** (5s, echo-cancel/noise-suppress/auto-gain off so it
   reflects the raw device level; level, clipping, noise floor -- pure
   `analyzeMic()`, synthetic-tested, thresholds unvalidated, mic never
   connected to speakers, tracks stopped after). The **setup wizard had a
   real bug**: `eyeTiltDegrees` measured left->right eye in the raw
   (un-mirrored) frame, where the "left" eye is on the image's right, so a
   level head read ~180deg and the diagram rendered upside down with L/R
   swapped. Fixed (mirrored, folded to -90..90). The user also pointed out
   head roll isn't a setup property -- correct -- so the wizard's tilt
   diagram was replaced with an **eye-height-in-frame indicator**
   (`ERGO_EYE_HIGH/LOW`, 0.25-0.5 down the picture ~ "top of screen at or
   just below eye level", assuming the camera faces straight out). This
   resolves the earlier "can't tell which direction" worry only in theory:
   **the direction/thresholds still need a real-camera check** (raise/lower
   yourself and watch the dots). Head tilt stays in the close-up check only,
   as "how you look on a call".

   **Renamed 2026-09-19 at the user's request:** "ready for my close-up" is
   now **"are you camera ready?"** (how you look/sound to others: headroom,
   framing, centring, face lighting, backlight, glare, mic) and "set up your
   desk" is now **"workstation setup"** (how the desk suits you: eye height
   vs top of screen, cm distance, lighting, desk checklist, calibrate). They
   deliberately share measurements (same landmarks/frame code) but ask
   different questions; camera-ready labels were reworded ("headroom",
   "framing") so the two don't read as duplicates. Older entries below still
   use the old names.

   **Phase 2 built 2026-09-19 (AI review, free tier):** camera-ready has an
   opt-in "get a fuller AI review" button that sends ONE 640px JPEG to the
   Supabase edge function `camera-review` (source in
   `supabase/functions/camera-review/`, shared prompt in `prompt.js`), which
   calls OpenRouter with the key held as a **Supabase function secret**
   (`OPENROUTER_API_KEY`; GitHub secrets are write-only so it had to be
   re-entered). Checks hair / clothing / background / things behind the head;
   prompt forbids commenting on face/body. `verify_jwt` is OFF (no user auth,
   publishable key isn't a JWT) so protection is: size cap, per-user (10/day)
   and global (150/day) caps via `camera_review_take`/`camera_review_refund`
   (a failed review is refunded), CORS limited to the Pages origin. **Free
   models are unreliable:** each named free vision model failed almost every
   call (504s, empty replies, 403/404, rate limits); the `openrouter/free`
   router succeeded ~2 in 7. So the function retries inside a 115s budget
   (typically 15-60s, succeeded on attempt 4 / 52s in a real test, served by
   `nex-agi/nex-n2.5-pro:free`, review was accurate: caught the flyaway hair).
   Free OpenRouter accounts are limited to ~50 requests/day and each retry
   counts, so ~10 reviews/day at worst. A cheap paid model
   (e.g. google/gemini-2.5-flash-lite, ~$0.0003/check) would be fast and
   reliable if this proves too slow. The temporary `TEST_MODELS` allow-list
   in the function is still there -- remove once settled. Verified with the
   user's real photos: all 8 local checks pass on both.

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

## Desk-companion roadmap, decided 2026-09-19 (user's calls)

- **On-screen alerts: built.** `showToast()` flashes the message over the
  status card (which *is* the popup while tracking runs) for 3s+, hooked
  into `speak()` so every existing nudge gets it, muted or not. Decision:
  the popup is always visible when Plumb is running, so it's the one place
  for alerts -- no browser-notification fallback wanted.
- **Approved, not built (hydration pacing, reminders, focus timer and wrap
  since built, see below):** coached 20-20-20 (user noted it's probably redundant with 25-min
  breaks -- plan is to fold a 20s "look far away" step into the start of
  each break rather than a separate timer).
- **Stretch routines on demand:** ~5 seated office stretches x ~5 slow reps
  with small animated visuals; general ergonomics guidance, not medical
  advice. Not built.
- **A Plumb character: ON ICE (2026-09-19).** Three concepts were drawn
  (balancer, the "l" as the plumb line, eyes on the dot); user decided
  against it -- the app's tone is serious/professional and a mascot would
  feel gimmicky, and voices are about to change. Don't revive it unprompted.
- **Focus timer (tomato) + end-of-day wrap: built 2026-09-20.**
  Timer logic in `src/companion.js` (100 checks pass in total incl. block
  cycle, long break every N, day rollover, sleeping through a block, alert
  blocking, grace window, wrap maths). **Focus freezes EVERY alert** (posture,
  water, reminders, light, wrap; only the timer's own messages pass) via
  `alertsSuppressed(kind)`; tracking/logging is untouched. During the
  timer's own breaks only Plumb's "take a break"/"move" prompts are held
  back (the timer is the break rhythm). Nothing auto-starts: focus -> break
  -> idle, you start the next block. A reminder that fell inside a block may
  land up to 30 min late once it ends. Button (tomato SVG) in the control row
  shows the countdown; one status pill on the popup card shows the tomato
  timer and/or "in a call". Timer state is per device (localStorage
  `plumb:pomodoro`); durations (25/5/15, long break every 4) and wrap
  settings sync in `app_settings.extras`. The main frame loop also ticks the
  timer because a hidden tab's own timers get throttled. **Wrap**
  ("today's wrap" header button + a once-a-day "wrap ready" notice at 17:30
  while tracking runs, retried after a call/focus block): tracked time,
  sitting-well % (vs yesterday), breaks, longest sit, most common slouch,
  steadiest/roughest hour, water, focus blocks, and the count of alerts
  Plumb sent you (per-device localStorage counter -- deliberate: measure the
  interruption load before capping it), plus the week's first goal. Calls are
  NOT in the wrap yet (the calendar table is server-only). **Verified live in
  the desktop preview:** focus start/freeze/resume (a due reminder was held
  for 32s then fired 5s after stopping), focus->break and break->idle
  transitions with messages, wrap layout with fake events (numbers checked by
  hand), settings validation + sync round trip. **Not verified:** the timer
  inside the real PiP window, and the auto "wrap ready" notice (needs
  tracking running).
- **Design worry raised by the user (2026-09-20):** could someone spend all
  day interacting with Plumb and get little done? Guardrails so far: focus
  freezes everything, calls mute, the wrap reports interruption count.
  Next: watch that count for a week, then consider an hourly alert budget.
  Stretches must stay on-demand only and tied to breaks, never a new prompt.
- **Desk gym: built 2026-09-20** (user's name for it; headings to be
  reviewed by the user). A "desk gym" button opens a window with five seated
  stretches (chin tucks, ear-to-shoulder neck stretch, shoulder rolls and
  blade squeeze, chest opener, seated twist), each with a two-sentence
  what-and-why and a "find a demo on YouTube" link. Links are YouTube
  *searches* (always valid; a specific video ID can't be verified from
  here). **On demand only -- nothing ever prompts you to open it**, by design
  (see the design worry above). Data in `src/deskgym.js`. Footer says it is
  general ergonomics guidance, not medical advice. Verified in the desktop
  preview (five entries, two sentences each, encoded search URLs, opens in a
  new tab). Not built: the "paste your own favourite video" field, or a
  "watched it once" tick.
- **Tidy-ups and voice fix, 2026-09-20.** (a) `normaliseUserName()` (tested, 13
  checks): names are trimmed, whitespace-collapsed, capped at 40 chars, and a typed
  name matching a known one ignoring capitals reuses the known spelling; a stored
  identity only ever has stray spaces trimmed. No case/whitespace variants existed in
  the data. (b) The temporary allow-listed model override was removed from the
  `camera-review` function (redeployed as v6; the live source was read back to confirm).
  (c) `public.posture_logs` was dropped after backing its 24 rows up locally (nothing read
  or wrote it); test rows `model-test-*` were removed from `camera_review_usage`.
  (d) README setup rewritten to point at `docs/database-schema.md` (its SQL only knew the
  retired table) and to list the missing secrets. (e) **Voice:** the default was the
  browser's robotic "Google UK English Female" for any device without a saved choice;
  now Alba, with a one-off migration of the old default, cross-device sync via
  `extras.voice`, and no robot fallback for Piper choices. Verified: fresh device and
  old-robot-default device both land on Alba, and the cloud row holds it. **Not done:**
  the dormant summary machinery (see Handover section 6, item 4).
- **Hydration pacing + reminders: built 2026-09-20.** Pure logic in
  `src/companion.js` (41 checks pass, incl. midday/midnight parsing,
  weekend/grace/double-fire cases). Pacing spreads the daily target evenly
  across "active hours" (default 07:00-19:00): a dashed line on the water
  gauge shows where you'd be, a label reads "on pace" / "NNNml behind
  pace"; a nudge fires only when tracking is running, you're present, no
  call is on, you're >=300ml behind, at most once an hour, never in the last
  hour of the window. Reminders (Settings -> reminders): at a clock time
  (weekdays-only option, still fires up to 10 min late so it can land just
  after a call) or every N minutes (5-240, only within active hours; the
  clock starts on first sight and restarts after a long absence rather than
  firing on reopen). Fire = on-screen toast + voice "Reminder: ...", logged
  to the alert feed, suppressed during calls. Weekly goals containing a
  time ("At 1:30pm...") get a "remind me at 13:30" button that creates a
  weekdays-only reminder with the "At 1:30pm," prefix stripped. Both
  settings sync via the new `app_settings.extras` jsonb column (migration
  `app_settings_extras`; verified round-trip). Reminders fire per device --
  two open devices would both fire. **Verified live in the desktop preview:**
  a reminder fired on the exact minute, once only; pace marker + label;
  goal buttons; sync round trip. **Not verified:** the hydration NUDGE
  itself (needs a running camera + presence -- only its gating logic is
  tested), and everything inside the real PiP popup.
- **Popup glyph reworked 2026-09-19:** base dot 11 -> 13.2 (+20%); the dot
  rests near the TOP of the drawing (y=50 of 170) because neck-drop only
  moves it down, so a centred rest wasted the upper half; the loop is a
  fixed generous size (58x34) instead of shrinking with the
  tolerance setting. **The loop marks the THRESHOLD** (dot exactly on it =
  state flips good->mild and the sustain clock starts, ratio 1); it is not
  a limit on movement -- the dot keeps travelling past it toward the edge
  of the drawing. A first attempt added a visual gain that put the dot on
  the loop at 80% of threshold; the user correctly rejected that because it
  breaks the meaning of the loop, so it was removed. Smoothing untouched. **Found while doing this:** the synced `app_settings`
  row (last written 2026-08-22) still had lateral tolerance 0.20 and it
  overrides the 0.07 code default on every load, so the retuned default
  never applied to the user -- likely why lateral "needed a long way".
  Chrome's Document PiP API documents no way to hide the window's title
  bar/origin; `disallowReturnToOpener` only hides the back-to-tab button.
- Still queued from before: camera picker (Brio), Google Calendar via a
  private iCal link (would also give "mute nudges during calls").
  **Built 2026-09-19 (stage 1, waiting on the secret):** hourly workflow
  `.github/workflows/calendar-sync.yml` runs `scripts/sync-calendar.cjs`
  (node-ical installed with `--no-save` in CI only): reads the private iCal
  link from GitHub secret `CALENDAR_ICS_URL` (never logged), expands
  recurring events (EXDATE and moved instances handled), skips all-day /
  cancelled / "free" / declined-by-owner events, flags events with a
  Meet/Zoom/Teams/Webex link as calls, and upserts **times only, never
  titles** into `public.calendar_events` (window -35d..+14d; rows not seen
  in a run are deleted). Table is **service_role only** -- anon and
  authenticated have no access, deliberately, because meeting times are more
  sensitive than posture data and the other tables are anon-readable. Parser
  verified against a synthetic Google-style calendar in UTC and Brisbane
  time zones (exact instants); the DB write path is only verified once the
  secret exists and the workflow has run. Single user (`CALENDAR_USER_ID`
  = Paul in the workflow). **Not built yet:** using the data -- posture
  during calls vs. rest of day in the weekly analysis (service key can read
  the table) -- deliberately waiting: only ~1.7 tracked hours overlapped
  calls as of 2026-09-20 (2 of 14 past calls), too thin to compare.
  **Mute during calls: built 2026-09-20.** SQL function `in_call_now(p_user)`
  (security definer, anon-callable) returns a bare yes/no for "right now";
  the time-parameterised `_in_call_at` is service_role only so nobody can
  probe arbitrary times to rebuild a schedule. The app polls it every 60s;
  while true (and Settings -> calls -> "pause nudges during calls" is on,
  default on) `speak()` suppresses ALL alerts, voice and on-screen, except
  `force` (test voice) and `userInitiated` (the "calibrated" confirmation).
  Tracking/logging is untouched. A small "in a call - nudges paused" pill
  shows on the popup card; alert feed logs start/end and a toast says "Call
  ended - nudges back on". Verified: SQL boundary logic on real synced data
  (middle/lead-in true, 5 min before/exact end false), anon key can call
  `in_call_now` but is refused on `_in_call_at`, and the UI flow with a
  faked response. **Not verified live:** the suppression inside `speak()`
  during a real call, and behaviour in the actual PiP window. In-person
  (no call link) meetings do NOT mute.
  A camera picker already existed (Settings -> device -> camera).
  **Multi-user is deliberately not offered:** other people would need to
  store their own private calendar links server-side, which isn't
  responsible without real auth (today "login" is a name label and RLS is
  open). Revisit only with proper auth, per-user revocable links, and
  opt-in.

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
