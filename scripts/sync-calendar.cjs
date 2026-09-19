// Syncs meeting TIMES (never titles, attendees or descriptions) from a
// private iCal link into public.calendar_events, so the weekly analysis can
// compare posture during calls against the rest of the day.
//
// Privacy: the link is a secret (anyone holding it can read the whole
// calendar) -- it is only ever read from CALENDAR_ICS_URL and never logged.
// The table has no anon/authenticated access, only service_role.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, CALENDAR_ICS_URL. Optional:
// CALENDAR_USER_ID (default "Paul"). Local testing: CALENDAR_ICS_FILE=path.ics
// DRY_RUN=1 parses and prints counts/times without touching the database.
const fs = require('fs');
const ical = require('node-ical');

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 35;
const FUTURE_DAYS = 14;
const CALL_RE = /(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|gotomeet\.me)/i;

function isCall(ev) {
  const text = [ev.location, ev.description, ev.url].map((v) => (typeof v === 'string' ? v : v && v.val) || '').join(' ');
  if (CALL_RE.test(text)) return true;
  return Object.keys(ev).some((k) => /conference/i.test(k)); // Google's X-GOOGLE-CONFERENCE
}

function ownerEmail(calendar) {
  const name = calendar && (calendar['WR-CALNAME'] || calendar['X-WR-CALNAME']);
  return typeof name === 'string' && name.includes('@') ? name.toLowerCase() : null;
}

function declinedByOwner(ev, owner) {
  if (!owner || !ev.attendee) return false;
  const list = Array.isArray(ev.attendee) ? ev.attendee : [ev.attendee];
  return list.some((a) => {
    const val = String((a && a.val) || '').toLowerCase();
    const partstat = String((a && a.params && a.params.PARTSTAT) || '').toUpperCase();
    return val.endsWith(owner) && partstat === 'DECLINED';
  });
}

// Returns [{ key, start, end, isCall }] for every busy, timed, non-cancelled
// instance (recurring events expanded) that starts inside [from, to].
function expand(parsed, from, to) {
  const owner = ownerEmail(Object.values(parsed).find((e) => e.type === 'VCALENDAR'));
  const out = [];
  const push = (uid, ev, start, end) => {
    if (!(start >= from && start <= to)) return;
    if (!(end > start)) return;
    out.push({ key: `${uid}|${start.toISOString()}`, start, end, isCall: isCall(ev) });
  };

  for (const [uid, ev] of Object.entries(parsed)) {
    if (ev.type !== 'VEVENT') continue;
    if (ev.status === 'CANCELLED') continue;
    if (ev.transparency === 'TRANSPARENT') continue;      // marked "free", not a busy meeting
    if (ev.datetype === 'date') continue;                 // all-day event
    if (declinedByOwner(ev, owner)) continue;
    if (!(ev.start instanceof Date) || !(ev.end instanceof Date)) continue;

    if (!ev.rrule) { push(uid, ev, ev.start, ev.end); continue; }

    const duration = ev.end.getTime() - ev.start.getTime();
    // Search a little wider so a series that started before the window still yields instances.
    ev.rrule.between(new Date(from.getTime() - DAY_MS), new Date(to.getTime() + DAY_MS), true).forEach((d) => {
      const dayKey = d.toISOString().slice(0, 10);
      if (ev.exdate && (ev.exdate[dayKey] || ev.exdate[d.toISOString()])) return;
      const override = ev.recurrences && (ev.recurrences[dayKey] || ev.recurrences[d.toISOString()]);
      if (override) {
        if (override.status === 'CANCELLED' || override.transparency === 'TRANSPARENT') return;
        push(uid, override, override.start, override.end);
      } else {
        push(uid, ev, d, new Date(d.getTime() + duration));
      }
    });
  }
  return out;
}

async function main() {
  const file = process.env.CALENDAR_ICS_FILE;
  const icsUrl = process.env.CALENDAR_ICS_URL;
  const dryRun = process.env.DRY_RUN === '1';
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const userId = process.env.CALENDAR_USER_ID || 'Paul';

  if (!file && !icsUrl) { console.warn('CALENDAR_ICS_URL not set -- skipping.'); return; }
  if (!dryRun && (!supabaseUrl || !key)) { console.warn('SUPABASE_URL / SUPABASE_SERVICE_KEY not set -- skipping.'); return; }

  let text;
  if (file) {
    text = fs.readFileSync(file, 'utf8');
  } else {
    // Deliberately no URL in any message below.
    let res;
    try { res = await fetch(icsUrl, { signal: AbortSignal.timeout(30000) }); } catch (e) { throw new Error(`Could not fetch the calendar (${e.name})`); }
    if (!res.ok) throw new Error(`Calendar link returned HTTP ${res.status} -- it may have been reset or removed.`);
    text = await res.text();
  }
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('The calendar link did not return an iCal file.');

  const now = Date.now();
  const from = new Date(now - PAST_DAYS * DAY_MS);
  const to = new Date(now + FUTURE_DAYS * DAY_MS);
  const events = expand(ical.sync.parseICS(text), from, to);
  const calls = events.filter((e) => e.isCall).length;
  console.log(`Found ${events.length} busy events in the window (${calls} with a call link).`);

  if (dryRun) {
    events.sort((a, b) => a.start - b.start).forEach((e) => console.log(`${e.start.toISOString()} -> ${e.end.toISOString()} call=${e.isCall}`));
    return;
  }

  const runStart = new Date().toISOString();
  const rows = events.map((e) => ({
    user_id: userId, event_key: e.key, start_time: e.start.toISOString(), end_time: e.end.toISOString(), is_call: e.isCall, synced_at: runStart
  }));
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${supabaseUrl}/rest/v1/calendar_events?on_conflict=user_id,event_key`, {
      method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 500))
    });
    if (!res.ok) throw new Error(`Upsert error ${res.status}: ${await res.text()}`);
  }

  // Anything in the window that wasn't seen this run has been cancelled, moved or removed.
  const del = await fetch(
    `${supabaseUrl}/rest/v1/calendar_events?user_id=eq.${encodeURIComponent(userId)}&start_time=gte.${from.toISOString()}&start_time=lte.${to.toISOString()}&synced_at=lt.${runStart}`,
    { method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' } }
  );
  if (!del.ok) throw new Error(`Cleanup error ${del.status}: ${await del.text()}`);
  console.log(`Synced ${rows.length} events for ${userId}.`);
}

if (require.main === module) {
  main().catch((err) => { console.error('Calendar sync failed:', err.message); process.exit(1); });
}
module.exports = { expand, isCall };
