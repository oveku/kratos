---
name: workout-log-ops
user-invocable: true
description: >
  Detect, assign, and repair workout log files in the kratos repo.
  Use when new workout logs have been uploaded by Klaudette but are
  not assigned to a week/day, or when logs are assigned but not
  displaying in the UI. Handles both missing assignments and CSV
  column format bugs.
---

# Workout Log Ops

Automate the full lifecycle of a new workout log: detect → infer week/day → repair if broken → assign → commit → push.

## When to invoke

- A new `workout-YYYY-MM-DD.csv` appears in `preload/` but is not showing on the site
- User says "logs not showing", "uke N not displaying", "fix workout"
- Klaudette has uploaded files but the assignment step was skipped

## Step 1 — Detect unassigned logs

```powershell
cd c:\source\kratos
git pull origin main
$index       = Get-Content preload\workout-index.json | ConvertFrom-Json
$assignments = Get-Content preload\workout-assignments.json | ConvertFrom-Json
$unassigned  = $index | Where-Object { -not $assignments.$_ }
```

If `$unassigned` is empty, all known logs are assigned. Check if any log files are missing from the index:

```powershell
$onDisk = Get-ChildItem preload\workout-*.csv | Select-Object -ExpandProperty Name
$missing = $onDisk | Where-Object { $index -notcontains $_ }
```

Add missing files to `workout-index.json` (append to the array, sorted by date).

## Step 2 — Infer uke and dag

For each unassigned log, read its content:

```powershell
$rows = Get-Content preload\workout-YYYY-MM-DD.csv
```

Look for:
1. **Day marker**: a row where col 3 matches `^Dag \d+` → extract day number
2. **Uke comment**: any row where col 13 contains `Uke \d+` → extract week number

If both found, create the assignment `{ "uke": N, "dag": N }`.

If ambiguous or missing, compare exercise IDs/names to program week CSVs to determine which week fits.

## Step 3 — Repair CSV column bugs

Check if rows have the **wrong-column bug** (exercise ID/name in col 2, col 3 empty):

```powershell
$rows = Import-Csv preload\workout-YYYY-MM-DD.csv -Header (0..13 | ForEach-Object { "$_" })
$buggy = $rows | Where-Object { $_.'2' -match '^\d{1,3}$' -and $_.'3' -eq '' }
```

If buggy rows exist, repair with this PowerShell function:

```powershell
function Repair-WorkoutLog($file) {
    $lines = [System.IO.File]::ReadAllLines(
        (Resolve-Path $file).Path,
        [System.Text.UTF8Encoding]::new($false)
    )
    $out = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $lines) {
        $f = $line -split ','
        if ($f.Count -ge 13 -and $f[2] -match '^\d{1,3}$' -and $f[3] -eq '') {
            $f[3] = $f[2]; $f[2] = ''; $f[11] = '-'
        }
        $out.Add(($f -join ','))
    }
    [System.IO.File]::WriteAllLines(
        (Resolve-Path $file).Path, $out,
        [System.Text.UTF8Encoding]::new($false)
    )
}
Repair-WorkoutLog "preload\workout-YYYY-MM-DD.csv"
```

## Step 4 — Write assignments

Update `preload/workout-assignments.json` — add entries for all newly assigned files.
Update `preload/workout-index.json` — add any files that were missing from the index.

Both files must stay valid JSON. Preserve existing entries.

## Step 5 — Commit and push

```powershell
cd c:\source\kratos
git add preload\workout-*.csv preload\workout-assignments.json preload\workout-index.json
git commit -m "chore: assign and repair workout logs for Uke N"
git push
```

GitHub Pages redeploys automatically. The site will reflect changes within ~60 seconds.

## Step 6 — Verify

Fetch the live site and check:

```
https://oveku.github.io/kratos/
```

Navigate to the week and day. Confirm exercises show actual sets (green/highlighted) next to the programmed sets.

If sets still don't appear, check the browser console for `findWorkoutSets` warnings — these indicate exercise name normalization mismatches. Update `data/glossary.json` if needed.

## Common exercise ID → name mapping (Uke 1–3 program order)

IDs are assigned by `assignExerciseIds()` walking Uke 1 → 9, Day 1 → 3 in program order.
When in doubt, run the site locally and check the browser console:
```
[...state.exerciseById.entries()]
```

## Root cause of the col-2 bug

An older version of `openclaw-skill/workout-logger/scripts/workout_log.py` deployed on
Klaudette wrote exercise names/IDs to `row[2]` (Øvelseskategori) instead of `row[3]`
(Dag/Øvelse), and omitted `row[11] = "-"`. The current repo version is correct (`row[3]`).
Klaudette needs to pull the latest script if the bug recurs:

```bash
# On Klaudette (Pi):
cd ~/kratos
git pull origin main
```
