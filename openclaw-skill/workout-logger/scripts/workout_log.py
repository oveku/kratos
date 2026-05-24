#!/usr/bin/env python3
"""Append workout sets to a daily kratos-format CSV on the NAS.

Subcommands: start, log, repeat, amend, show, finish.

CSV layout (14 cols, 0-indexed):
  0=blank 1=1RM 2=Øvelseskategori 3=name|"Dag N" 4=Sett 5=Reps
  6=RPE_low 7="-" 8=RPE_high 9=% 10=Vekt 11="-" 12=0 13=Kommentar
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PRIMARY_DIR = Path("/mnt/nas-download/kratos-workouts")
FALLBACK_DIR = Path.home() / "workout-logs"
TZ = ZoneInfo("Europe/Oslo")
HEADER = [
    "", "1RM", "Øvelseskategori", "Dag/Øvelse", "Sett", "Reps",
    "RPE", "-", "RPE_h", "%", "Vekt", "-", "0", "Kommentar",
]


def workout_dir() -> tuple[Path, bool]:
    """Return (dir, is_nas). Falls back to local if NAS not mounted."""
    if PRIMARY_DIR.parent.is_mount() or PRIMARY_DIR.exists():
        try:
            PRIMARY_DIR.mkdir(parents=True, exist_ok=True)
            probe = PRIMARY_DIR / ".probe"
            probe.write_text("ok")
            probe.unlink()
            return PRIMARY_DIR, True
        except OSError:
            pass
    FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
    return FALLBACK_DIR, False


def today_str() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


@dataclass
class State:
    day: int | None = None
    last_exercise: str | None = None
    last_row: list[str] | None = None
    set_counter: dict[str, int] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "State":
        if not path.exists():
            return cls()
        data = json.loads(path.read_text())
        return cls(**data)

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(self.__dict__, ensure_ascii=False, indent=2))


def paths_for(date: str) -> tuple[Path, Path, bool]:
    d, is_nas = workout_dir()
    return d / f"workout-{date}.csv", d / f".state-{date}.json", is_nas


def ensure_csv(csv_path: Path) -> None:
    if not csv_path.exists():
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(HEADER)


def append_row(csv_path: Path, row: list[str]) -> None:
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(row)


def write_day_marker(csv_path: Path, day: int) -> None:
    row = [""] * 14
    row[3] = f"Dag {day}"
    append_row(csv_path, row)


def make_row(state: State, exercise: str, sett: int, reps: int,
             weight: float, rpe: float | None, note: str) -> list[str]:
    row = [""] * 14
    row[3] = exercise
    row[4] = str(sett)
    row[5] = str(reps)
    if rpe is not None:
        rpe_str = f"{rpe:g}"
        row[6] = rpe_str
        row[8] = rpe_str
    row[7] = "-"
    row[10] = f"{weight:g}"
    row[11] = "-"
    row[12] = "0"
    row[13] = note
    return row


def cmd_start(args: argparse.Namespace) -> int:
    date = today_str()
    csv_path, state_path, is_nas = paths_for(date)
    ensure_csv(csv_path)
    state = State.load(state_path)
    state.day = args.day
    state.last_exercise = None
    state.set_counter = {}
    write_day_marker(csv_path, args.day)
    state.save(state_path)
    where = "NAS" if is_nas else "LOCAL (NAS not mounted)"
    print(f"Started Dag {args.day} → {csv_path.name} [{where}]")
    return 0


def cmd_log(args: argparse.Namespace) -> int:
    date = today_str()
    csv_path, state_path, is_nas = paths_for(date)
    ensure_csv(csv_path)
    state = State.load(state_path)

    if state.day is None and not args.allow_no_day:
        print("ERROR: no day set. Run `start --day N` first or pass --allow-no-day.", file=sys.stderr)
        return 2

    exercise = args.exercise.strip()
    sets = max(1, args.sets)
    added = []
    for _ in range(sets):
        n = state.set_counter.get(exercise, 0) + 1
        state.set_counter[exercise] = n
        row = make_row(state, exercise, n, args.reps, args.weight, args.rpe, args.note or "")
        append_row(csv_path, row)
        state.last_row = row
        added.append(row)
    state.last_exercise = exercise
    state.save(state_path)

    for row in added:
        rpe = f" @{row[6]}" if row[6] else ""
        print(f"{exercise} set {row[4]}: {row[5]}r × {row[10]}kg{rpe}")
    if not is_nas:
        print("(local fallback — NAS not mounted)", file=sys.stderr)
    return 0


def cmd_repeat(args: argparse.Namespace) -> int:
    date = today_str()
    csv_path, state_path, _ = paths_for(date)
    state = State.load(state_path)
    if not state.last_row or not state.last_exercise:
        print("ERROR: nothing to repeat yet.", file=sys.stderr)
        return 2
    last = state.last_row
    ns = argparse.Namespace(
        exercise=state.last_exercise,
        reps=int(last[5]),
        weight=float(last[10]),
        rpe=float(last[6]) if last[6] else None,
        note="",
        sets=args.sets,
        allow_no_day=True,
    )
    return cmd_log(ns)


def cmd_amend(args: argparse.Namespace) -> int:
    date = today_str()
    csv_path, state_path, _ = paths_for(date)
    state = State.load(state_path)
    if not state.last_row:
        print("ERROR: no row to amend.", file=sys.stderr)
        return 2
    rows = list(csv.reader(csv_path.open(encoding="utf-8")))
    if len(rows) < 2:
        print("ERROR: csv empty.", file=sys.stderr)
        return 2
    row = rows[-1]
    if args.reps is not None:
        row[5] = str(args.reps)
    if args.weight is not None:
        row[10] = f"{args.weight:g}"
    if args.rpe is not None:
        rpe_str = f"{args.rpe:g}"
        row[6] = rpe_str
        row[8] = rpe_str
    if args.note is not None:
        row[13] = args.note
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)
    state.last_row = row
    state.save(state_path)
    print(f"Amended: {row[3]} set {row[4]} → {row[5]}r × {row[10]}kg @{row[6] or '-'}")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    date = today_str()
    csv_path, _, is_nas = paths_for(date)
    if not csv_path.exists():
        print(f"No log for {date} yet.")
        return 0
    print(f"=== workout-{date}.csv ({'NAS' if is_nas else 'local'}) ===")
    for i, row in enumerate(csv.reader(csv_path.open(encoding="utf-8"))):
        if i == 0:
            continue
        name = row[3]
        if name.lower().startswith("dag "):
            print(f"\n-- {name} --")
            continue
        rpe = f" @{row[6]}" if row[6] else ""
        note = f"  // {row[13]}" if row[13] else ""
        print(f"  {name} set {row[4]}: {row[5]}r × {row[10]}kg{rpe}{note}")
    return 0


def cmd_finish(args: argparse.Namespace) -> int:
    date = today_str()
    csv_path, state_path, is_nas = paths_for(date)
    if state_path.exists():
        state_path.unlink()
    cmd_show(args)
    if not is_nas:
        print("\nWARNING: saved locally — sync to NAS when available.", file=sys.stderr)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="workout_log", description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("start"); s.add_argument("--day", type=int, required=True); s.set_defaults(func=cmd_start)

    s = sub.add_parser("log")
    s.add_argument("--exercise", required=True)
    s.add_argument("--reps", type=int, required=True)
    s.add_argument("--weight", type=float, required=True)
    s.add_argument("--rpe", type=float)
    s.add_argument("--sets", type=int, default=1)
    s.add_argument("--note", default="")
    s.add_argument("--allow-no-day", action="store_true")
    s.set_defaults(func=cmd_log)

    s = sub.add_parser("repeat"); s.add_argument("--sets", type=int, default=1); s.set_defaults(func=cmd_repeat)

    s = sub.add_parser("amend")
    s.add_argument("--reps", type=int); s.add_argument("--weight", type=float)
    s.add_argument("--rpe", type=float); s.add_argument("--note")
    s.set_defaults(func=cmd_amend)

    sub.add_parser("show").set_defaults(func=cmd_show)
    sub.add_parser("finish").set_defaults(func=cmd_finish)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
