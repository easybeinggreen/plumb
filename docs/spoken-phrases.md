# Plumb spoken phrases

**This is the owner's reviewed/edited wording from a review pass on 2026-09-22/23**, synced here verbatim from
the "Plumb spoken phrases" doc (`https://claude.ai/code/artifact/f7c7bc8e-ac2c-4236-bbef-7ca21b11dfe8`) as of
doc rev 83, because that doc lives on a Claude account and would be lost on an account switch — this file is
the durable copy. It was originally drafted for an ElevenLabs recording pass that was abandoned (see
`PROJECT_NOTES.md`'s 2026-09-23 handover) once Piper became the committed voice path.

This wording **has been applied to `src/main.js`** (2026-09-23, owner confirmed) -- this file and the code now
match. Piper speaks straight from these phrase-array strings, so this is genuinely what the live app says.

{N} marks a live variable (a number spoken aloud). The weekly-goal and reminder lines contain text written
elsewhere and can never be fixed wording. Within each group Plumb steps through the lines in order (the morning
greeting is the one exception, picked at random).

## 1. Starting the day

**Morning greeting** -- plays once, when a new calendar day begins while Plumb is running.

- Good morning! A new day of posture tracking has started. Lets calibrate
- Morning! Ready when you are — let's make it a good day. Calibrate
- Good morning. Fresh day, fresh start — let's calibrate
- Hello, and welcome to a brand new day. Lets calibrate
- Morning! Sit tall, and let's begin calibrating.

**After calibrating**

- Calibrated. That's set your good posture.

**Weekly goal** -- no longer spoken (removed 2026-09-26: it overlapped the morning "let's calibrate" line). The goal
is still shown in the "this week" panel.

## 2. Posture nudges

Each plays once a slouch of that kind has lasted longer than your "sustain" setting, then at most once every 30
seconds while it continues.

**Leaning left**
- You're leaning left — straighten up.
- Left drift — bring head centre.
- Tilting left — correct it.
- Drifting left — ease back to centre.
- A little left lean — straighten up.
- Left side's dropped — bring it back.

**Leaning right**
- Leaning right — centre yourself.
- Right drift — straighten up.
- Tilting right — adjust.
- Drifting right — ease back to centre.
- A little right lean — straighten up.
- Right side's dropped — bring it back.

**Neck dropping**
- Neck's dropping — sit taller.
- Neck sinking — lengthen spine.
- Shoulders dropping — open up.
- Reset your posture.
- Sinking a bit — lift through the chest.
- Spine's rounding — sit a touch taller.
- Shoulders back and down — reset.

**Too close to the screen**
- You've drifted in close — ease back.
- Getting close to the monitor — sit back a little.
- Give yourself some space from the screen.
- A bit close to the screen — ease back.
- Crept toward the monitor — give it room.
- Pull back a little from the screen.

**Sitting low in the chair**
- You've slid down in the seat — sit back up.
- Slipping low in the chair — scoot back and sit tall.
- You've sunk down — reposition and sit up.
- Chair's swallowing you — sit up in it.
- Settle back up in your seat.

## 3. Breaks and movement

**Time for a break** -- plays after sitting continuously for your "break interval" setting, then at most once a
minute until you step away.

- Time for a break — stand up, come back refreshed.
- You've been sitting a while — step away.
- Take a short break — enjoy it.
- Good time for a stretch — up you get.
- Your body could use a change of scenery.
- Stand, shake it out, then carry on.

**Stillness** -- held nearly the same posture for your "stillness" setting, at most once a minute.

- You've held the same shape a while — shift position.
- Time to change something — stand, stretch, or just re-settle.
- Give your spine a change of scenery for a moment.
- Same spot a while — a small shift will do.
- Bodies like variety — change something, even slightly.
- Worth a little wiggle — you've been still a while.

**Back from a long break (5 minutes or more)**
- Great long break — you're refreshed.
- Nice long break — welcome back.
- That was a proper break — good stuff.
- Well rested — good to have you back.
- Welcome back — that was a well-earned rest.
- Back again — hope you got some fresh air.
- Good to see you — that break did you good.

**Back from a short break (1 to 5 minutes)** -- under a minute away says nothing.
- Nice one — welcome back.
- Good change of scenery — back to it.
- That's the way — short and sweet.
- Welcome back — hope that helped.
- Right on time — back at it.
- Good reset — off you go.
- Back already — nicely done.
- Welcome back. Ease into it.
- Good move — a little movement goes a long way.

## 4. Light

Below 25% brightness is dim, above 80% is bright; a sustained left/right imbalance counts as glare, at most
once every 10 minutes.

**Glare on the left**
- Strong light on your left — worth adjusting the blind.
- It's gotten bright on your left side.
- Left side's quite bright now — check the light.

**Glare on the right**
- Strong light on your right — worth adjusting the blind.
- It's gotten bright on your right side.
- Right side's quite bright now — check the light.

**Room too dim**
- Pretty dim in here — a lamp on would ease the strain of a bright screen against a dark room.
- Room's gone dark around you — worth turning on a light nearby.
- Low light — your eyes work harder with the screen this much brighter than the room.

**Room too bright**
- Bright in here — worth dimming the room or turning your screen up so they're not fighting each other.
- Strong light overall — easing it back, or bumping screen brightness, is easier on your eyes.
- Quite bright now — worth the blind or a brighter screen so the contrast isn't straining your eyes.

## 5. Water, focus and everything else

**Water** -- plays when you're at least 300ml behind pace, at your desk, and it's neither the first nor last
hour of your working day (default 08:00 to 16:00), at most once an hour. {N} rounds to the nearest 50ml.

- You're about {N}ml behind for this time of day. Have a drink.
- Water check: roughly {N}ml behind pace. Time for a glass.
- You've fallen about {N}ml behind today. Have some water.

**Focus timer** -- {N} is 5 for a short break, 15 for a long one, so both can be fixed lines.

- Focus block done. Take {N} minutes.
- Focus block done. Take {N} minutes — a long break.
- Break over. Start the next focus block when you are ready.

**End of day** -- plays once at 16:00 while tracking runs.

- Your day's wrap is ready. Open it from the top of the page.

**Reminders** -- can't be pre-recorded, the words are the owner's own.

- Reminder: {your reminder text}

**Test button**

- This is what a nudge sounds like.
