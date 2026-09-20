# Plumb database: current schema (snapshot, 2026-09-20)

Generated from the live Supabase project (`keacpowuykzcnwwdbjkd`, ap-southeast-2)
by querying `information_schema` / `pg_policies` / `pg_proc`. It is a
**description of what exists, not a tested install script.** Migrations were
applied through the Supabase tooling and are not kept as files in this repo, so
this document is the record. If you change the schema, update it.

The README's older setup SQL only knew about the retired `posture_logs` table;
ignore it in favour of this file.

## Access model, in one paragraph

The browser talks to Postgres directly with the public **anon** key (it is in the
site's JavaScript by design). "Login" is only a name label typed into the app, not
authentication, so most tables are deliberately open to `anon` (`using (true)`).
That is a data-partitioning convenience, **not a privacy boundary**. The
exceptions are the two tables that hold something more sensitive or costly:
`calendar_events` (meeting times) and `camera_review_usage` (spend guard). Those
have **no** anon/authenticated access at all; only server-side code using the
service key can touch them.

**Recurring gotcha (bitten four times):** creating a table grants nothing to
`anon` / `authenticated` / `service_role`. After adding any table, or pointing a
new script at an existing one, check the role's real privileges (for example with
`has_table_privilege(role, 'public.tbl', 'select')` -- note that
`information_schema.role_table_grants` can show nothing useful from the query
tool) and run the real client or workflow once. Direct SQL cannot catch a missing
`anon` grant.

## Tables

| Table | Rows (2026-09-20) | anon | service_role | Purpose |
|---|---|---|---|---|
| `posture_events` | ~14.8k | select, insert | select | Every interval as its own row: `presence`, `break`, `away`, `not_tracking` and the five slouch types (`lateral_left`, `lateral_right`, `compression`, `lean_in`, `sitting_low`). Source of truth. Never downsampled or deleted (except three corrupted rows removed on 2026-09-17). |
| `posture_daily_summary` | ~260 | select | select, insert, update | Nightly read-side cache of `posture_events` per (date, user, type). Written by `scripts/rollup-summary.cjs`. |
| `hydration_events` | 34 | all | select | Each drink logged (`volume_ml`, `drink_type`). |
| `light_readings` | ~280 | all | select | Ambient brightness/skew sample every ~5 min while tracking. |
| `app_settings` | 1 | select, insert, update | none | One row per user: tolerances, timings, hydration sizes, plus `extras` jsonb (see below). |
| `weekly_goals` | 1 | select, insert, update | all | The Friday weekly analysis: `patterns`, `goals` (jsonb), `question`, the user's `user_response`. Unique on (user_id, week_start). |
| `calendar_events` | 21 | **none** | all | Meeting **times only** (never titles), `is_call` flag. Synced hourly from a private iCal link. |
| `camera_review_usage` | 2 | **none** | all | Per-user and global (`__all__`) daily counters that cap the AI camera review. |

Columns worth knowing (not exhaustive):

- `posture_events`: `date text` (local YYYY-MM-DD), `start_time`/`end_time` timestamptz,
  `type`, `duration_seconds`, `user_id` (default `'default'`), `ended_by`, `kind`,
  `pre_break_sitting_seconds`, `lateness_seconds`, `device_label`.
- `app_settings`: `tolerance` (lateral), `compression`, `lean`, `sink`, `sustain`,
  `break_interval`, `stillness`, `hydration_target_ml`, `glass_ml`, `mug_ml`, `can_ml`,
  `bottle_ml`, `updated_at`, `user_id`, `extras jsonb`.
- `app_settings.extras` (jsonb, added 2026-09-20) holds settings that sync across
  devices: `hydrationPace {on,start,end}`, `reminders [ {id,text,kind,time,everyMin,weekdaysOnly,enabled} ]`,
  `pomodoro {focus,short,long,rounds}`, `wrap {on,time}`, `voice` (selected voice id).
- `calendar_events`: primary key (`user_id`, `event_key`); `event_key` = event uid + instance start.

### Data notes

- User ids in use: `Paul` (all current data) and `default` (an older set from before
  names existed: ~2.9k events and ~100 summary rows). No case/whitespace variants
  exist. `default` has not been merged into `Paul`; that is the owner's call.
- Row cap: PostgREST returns at most `db_max_rows` per request. It was raised to 100000
  (`alter role authenticator set pgrst.db_max_rows = 100000`) after the week/month
  report was silently truncated at 1000 rows.
- `public.posture_logs` (the old denormalised per-day counter) was **dropped on
  2026-09-20**; its 24 rows (2026-08-02..25) were backed up locally first.

## Functions

| Function | Who can run it | What it does |
|---|---|---|
| `in_call_now(p_user text) -> boolean` | anon, authenticated, service_role | Security definer. "Is this user in a call right now?" A bare yes/no (from one minute before start until end). This is all the browser can learn about the calendar. |
| `_in_call_at(p_user, p_at)` | service_role only | The time-parameterised version. Kept private so nobody can probe arbitrary times to rebuild a schedule. |
| `camera_review_take(p_user, p_user_cap, p_global_cap) -> boolean` | service_role only | Atomically counts one AI review against the per-user and global daily caps. |
| `camera_review_refund(p_user)` | service_role only | Gives that count back when a review fails. |
| `rls_auto_enable()` | event trigger | Supabase-provided helper that enables RLS on new tables. |

## Edge function

`camera-review` (Deno, `supabase/functions/camera-review/`, currently version 6,
`verify_jwt` off because there is no user auth and the publishable key is not a
JWT). Takes one 640px JPEG plus a user label, asks a vision model on OpenRouter
about hair / clothing / background / things behind the head, returns four short
rows. Protections: 1.5MB body cap, 10 reviews/user/day and 150/day overall, CORS
limited to `https://easybeinggreen.github.io` and localhost, the OpenRouter key held
only as the function secret `OPENROUTER_API_KEY`. The image is never stored or
logged. Model is `openrouter/free` with retries inside a 115s budget (named free
models failed almost every call). Deployment is through the Supabase tooling; the
files in the repo are the source of truth, keep them in sync when redeploying.

## Scheduled jobs (GitHub Actions)

| Workflow | When | What |
|---|---|---|
| `deploy.yml` | every push to `main`, plus Monday 08:00 UTC | Builds and deploys to GitHub Pages. The Monday run also tries `scripts/generate-summary.cjs` (the older, dormant AI summary; it fails harmlessly with `continue-on-error`). |
| `rollup.yml` | 02:00 Brisbane nightly | Recomputes `posture_daily_summary`. |
| `weekly-analysis.yml` | Friday 16:00 Brisbane | OpenRouter analysis of the week into `weekly_goals`. |
| `calendar-sync.yml` | hourly | Reads the private iCal link, writes `calendar_events`. |

Repository secrets in use: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`,
`CALENDAR_ICS_URL`, `ANTHROPIC_API_KEY` (only used by the dormant summary script).
GitHub secrets are write-only: they cannot be read back, only used by workflows.
The Supabase function has its own separate copy of the OpenRouter key.
