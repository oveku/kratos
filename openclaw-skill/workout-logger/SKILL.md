---
name: workout-logger
description: Log a live strength-training session set-by-set to a daily CSV file in kratos format. Use when the user says they are starting a workout, finished a set, or want to review/finish today's session. Triggers on phrases like "start workout", "starter trening", "logg set", "log set", "[exercise] [weight]kg [reps] reps RPE [N]", "ferdig med trening", "finish workout", "vis dagens trening", "show today's workout". The skill writes to a NAS-mounted CSV that another agent later pushes to the kratos repo.
---

# Workout Logger

Log a live strength session to a daily CSV file on the NAS, one row per set, in kratos column format.

## When to invoke

The user is doing a workout and reports activity in chat. Typical messages:

- "starter trening dag 3" / "start workout day 3"
- "knebøy 100kg 5 reps rpe 8"
- "bench 80 kg 3x5 rpe 7"  (3 sets of 5 — log three rows)
- "samme igjen" / "another set" (repeat last exercise's last set)
- "vis dagens" / "show today" (print the log so far)
- "ferdig" / "done" / "finish workout"

The user logs sets in real time between rest periods. Keep responses **short** (one line confirmation) — they are mid-workout.

## How to log

All operations go through `scripts/workout_log.py`. Do not write CSV directly.

```bash
python3 scripts/workout_log.py start --day 3
python3 scripts/workout_log.py log --exercise "knebøy" --reps 5 --weight 100 --rpe 8 [--note "..."]
python3 scripts/workout_log.py log --exercise "knebøy" --reps 5 --weight 100 --rpe 8 --sets 3   # logs the same set 3 times
python3 scripts/workout_log.py repeat                                                            # repeat last set
python3 scripts/workout_log.py show
python3 scripts/workout_log.py finish
```

The script picks today's date automatically (`Europe/Oslo`). Output is the CSV row(s) added, or a one-line status. Confirm to the user with the script's stdout verbatim plus a brief "✓".

## Parsing user input

Extract these fields from free-form Norwegian or English:

| Field | Required | Examples |
|---|---|---|
| exercise | yes | knebøy, squat, bench, benkpress, markløft, deadlift |
| weight (kg) | yes | "100kg", "100 kg", "100" |
| reps | yes | "5 reps", "x5", "5r", trailing number after weight |
| rpe | optional | "rpe 8", "@8", "rpe8" |
| sets | optional | "3x5" → sets=3 reps=5; default 1 |
| note | optional | anything in quotes or after "//" |

If a field is ambiguous, ask **one** short question. Do not interrogate.

If the user names an exercise differently from last set (e.g. "samme" / "same"), use `repeat` instead of `log`.

## Day context

A session belongs to a "Dag N" (training day in the program, typically 1–3). If the user didn't say `start workout dag N`:
- If today's file already has a day marker, use it.
- Otherwise ask once: "Hvilken dag er dette? (1, 2 eller 3)"

## File layout

- Daily log: `/mnt/nas-download/kratos-workouts/workout-YYYY-MM-DD.csv`
- State sidecar: `/mnt/nas-download/kratos-workouts/.state-YYYY-MM-DD.json` (current day, last exercise, set counter per exercise)

The CSV uses the kratos 14-column layout. The script handles all column placement.

## If the NAS is unavailable

The script falls back to `/home/openclaw/workout-logs/` and prints a warning. Tell the user: "NAS not mounted — logging locally, will sync when share is back."

## Out of scope

- Do **not** push to the kratos repo. A separate LAN agent picks up the CSV.
- Do **not** convert exercises to English or look up glossary entries. Write Norwegian names verbatim.
- Do **not** edit historical rows. If user says "feil, det var 8 reps" on the last set, call `scripts/workout_log.py amend --reps 8` (amends only the most recent row).
