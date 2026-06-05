---
name: kratos
description: >
  Kratos workout-tracker agent. Owns all operations on the kratos repo:
  uploading new workout logs, assigning them to weeks/days, diagnosing
  display issues, and fixing CSV format bugs. Use when workout logs are
  not showing, when new logs need assigning, or when the kratos site
  needs to be updated.
tools:
  - read_file
  - replace_string_in_file
  - multi_replace_string_in_file
  - create_file
  - run_in_terminal
  - get_terminal_output
  - fetch_webpage
  - file_search
  - grep_search
  - mcp_gitkraken_cli_git_add_or_commit
  - mcp_gitkraken_cli_git_push
  - mcp_gitkraken_cli_git_status
  - mcp_gitkraken_cli_git_pull
  - mcp_gitkraken_cli_repository_get_file_content
  - github_text_search
---

# Kratos — Workout Tracker Agent

I own all operations on the **oveku/kratos** repo, cloned at `c:\source\kratos`.

## Repo structure

```
preload/
  Kopi av 3-dagers oppkjøringsprogram UF - Uke N.csv   # program weeks 1–9
  workout-YYYY-MM-DD.csv                                 # daily logs from Klaudette/OpenClaw
  workout-index.json                                     # ordered list of all log files
  workout-assignments.json                               # { "workout-YYYY-MM-DD.csv": { "uke": N, "dag": N } }
assets/script.js                                         # static frontend parser
data/glossary.json                                       # exercise name/category lookup
openclaw-skill/workout-logger/scripts/workout_log.py    # voice-logger CLI on Klaudette
nas-uploader/uploader.py                                 # NAS → repo uploader daemon
```

## Data pipeline

```
User speaks → OpenClaw (Klaudette Pi) → workout_log.py → NAS CSV file
                                                              ↓
                                              nas-uploader.py (NAS daemon)
                                                              ↓
                                          kratos repo preload/ (committed by Klaudetteoveq)
                                                              ↓
                                    GitHub Pages → oveku.github.io/kratos
```

## CSV column layout (14 cols, 0-indexed)

| Col | Field          | Notes                              |
|-----|----------------|------------------------------------|
| 0   | (blank)        |                                    |
| 1   | 1RM            |                                    |
| 2   | Øvelseskategori| Category — blank in workout logs   |
| 3   | Dag/Øvelse     | **Exercise name or ID** — KEY col  |
| 4   | Sett           | Set number                         |
| 5   | Reps           |                                    |
| 6   | RPE_low        |                                    |
| 7   | "-"            | Separator, always literal dash     |
| 8   | RPE_high       |                                    |
| 9   | %              | Percentage of 1RM                  |
| 10  | Vekt           | Weight in kg                       |
| 11  | "-"            | Separator, always literal dash     |
| 12  | "0"            | Always zero                        |
| 13  | Kommentar      | Note/comment                       |

## Exercise IDs

`assignExerciseIds()` in `script.js` walks the program week CSVs in order (Uke 1–9,
then each day) and assigns a zero-padded integer ID (`01`, `02`, ...) to each unique
exercise name (normalized). Workout logs may use either the full name or the numeric ID
in col 3.

## Known failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Logs uploaded but not showing | Not in workout-assignments.json | Add entry with correct uke/dag |
| Logs show wrong exercises | Exercise ID in col 2 instead of col 3 | Run workout-log-ops skill: repair-csv |
| Warning: `findWorkoutSets(...)` key not found | Exercise name mismatch vs glossary | Check normalizeName(), update glossary.json |
| New log not in workout-index.json | Index not updated | Add filename to index array |

## Standard operations

### Check for unassigned logs

```powershell
cd c:\source\kratos
$index = Get-Content preload\workout-index.json | ConvertFrom-Json
$assignments = Get-Content preload\workout-assignments.json | ConvertFrom-Json
$unassigned = $index | Where-Object { -not $assignments.$_ }
```

### Infer uke/dag from log content

Read the log CSV and look for:
1. "Dag N" marker row (col 3 matches `^Dag \d+`)
2. "Uke N" or "uke N" in the comment column (col 13)
3. Exercise weights/reps pattern matching a specific day's program

### Repair wrong-column logs

A log has the bug if data rows have a numeric value in col 2 and empty col 3.
Fix: shift col[2] → col[3], blank col[2], set col[11] = "-".

### Commit and push

After any change to preload files:
```
git add preload/
git commit -m "fix: <description>"
git push
```
GitHub Pages redeploys in ~60 seconds.

## Skills

- `.github/skills/workout-log-ops/SKILL.md` — Detect, assign, and repair workout logs
