"""Watch the NAS workout-logs folder and push new/changed CSVs to the kratos repo.

Designed to run as a long-lived container on the NAS. Single tick:
  1. If outside the active window, sleep and loop.
  2. Hash every workout-*.csv in WATCH_DIR.
  3. Compare against state file; collect changed/new files.
  4. If any, clone-or-pull the repo, copy files into preload/, rewrite UPDATES.md,
     commit + push as Klaudetteoveq.
  5. Persist new hashes to state file.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Oslo")
WATCH_DIR = Path(os.environ["WATCH_DIR"])
REPO_DIR = Path(os.environ.get("REPO_DIR", "/work/kratos"))
STATE_FILE = WATCH_DIR / ".uploaded.json"
PRELOAD_SUBDIR = "preload"
UPDATES_FILE = "UPDATES.md"

REPO_URL = os.environ["REPO_URL"]               # https://github.com/oveku/kratos.git
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GIT_USER_NAME = os.environ.get("GIT_USER_NAME", "Klaudetteoveq")
GIT_USER_EMAIL = os.environ.get("GIT_USER_EMAIL", "klaudette@local")
BRANCH = os.environ.get("BRANCH", "main")

ACTIVE_START = time(int(os.environ.get("ACTIVE_START_HOUR", "6")), 0)
ACTIVE_END = time(int(os.environ.get("ACTIVE_END_HOUR", "20")), 0)
INTERVAL_SECONDS = int(os.environ.get("INTERVAL_SECONDS", "900"))


def log(msg: str) -> None:
    print(f"[{datetime.now(TZ).isoformat(timespec='seconds')}] {msg}", flush=True)


def in_active_window(now: datetime) -> bool:
    return ACTIVE_START <= now.timetz().replace(tzinfo=None) <= ACTIVE_END


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_state() -> dict[str, str]:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict[str, str]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


@dataclass
class Change:
    path: Path
    name: str
    sha: str
    is_new: bool


def scan() -> tuple[list[Change], dict[str, str]]:
    state = load_state()
    changes: list[Change] = []
    current: dict[str, str] = {}
    for p in sorted(WATCH_DIR.glob("workout-*.csv")):
        digest = sha256(p)
        current[p.name] = digest
        if state.get(p.name) != digest:
            changes.append(Change(path=p, name=p.name, sha=digest, is_new=p.name not in state))
    return changes, current


def authed_url() -> str:
    # https://x-access-token:<token>@github.com/owner/repo.git
    return REPO_URL.replace("https://", f"https://x-access-token:{GITHUB_TOKEN}@", 1)


def run(cmd: list[str], cwd: Path | None = None) -> None:
    redacted = [_redact(a) for a in cmd]
    log("$ " + " ".join(redacted))
    subprocess.run(cmd, cwd=cwd, check=True)


def _redact(s: str) -> str:
    # Mask https://x-access-token:<token>@host -> https://x-access-token:***@host
    if "x-access-token:" in s:
        head, _, tail = s.partition("x-access-token:")
        _, _, rest = tail.partition("@")
        return f"{head}x-access-token:***@{rest}" if rest else f"{head}x-access-token:***"
    return s


def ensure_repo() -> None:
    if (REPO_DIR / ".git").exists():
        run(["git", "remote", "set-url", "origin", authed_url()], cwd=REPO_DIR)
        run(["git", "fetch", "origin", BRANCH], cwd=REPO_DIR)
        run(["git", "checkout", BRANCH], cwd=REPO_DIR)
        run(["git", "reset", "--hard", f"origin/{BRANCH}"], cwd=REPO_DIR)
    else:
        REPO_DIR.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "--depth", "1", "--branch", BRANCH, authed_url(), str(REPO_DIR)])
    run(["git", "config", "user.name", GIT_USER_NAME], cwd=REPO_DIR)
    run(["git", "config", "user.email", GIT_USER_EMAIL], cwd=REPO_DIR)


def render_updates_md(pending: list[str]) -> str:
    if not pending:
        return "# Workout updates\n\nNo pending workout files. All synced.\n"
    lines = [
        "# Workout updates",
        "",
        f"**{len(pending)} new or changed workout file(s) ready for manual review.**",
        "",
        f"_Last updated by Klaudette uploader at {datetime.now(TZ).isoformat(timespec='seconds')}._",
        "",
        "## Pending files",
        "",
    ]
    for name in pending:
        lines.append(f"- `preload/{name}`")
    lines.append("")
    return "\n".join(lines)


def all_workout_files_in_preload() -> list[str]:
    preload = REPO_DIR / PRELOAD_SUBDIR
    return sorted(p.name for p in preload.glob("workout-*.csv"))


def tick() -> None:
    changes, current = scan()
    if not changes:
        log("No changes.")
        return
    log(f"Detected {len(changes)} changed/new file(s): {[c.name for c in changes]}")

    ensure_repo()
    preload = REPO_DIR / PRELOAD_SUBDIR
    preload.mkdir(exist_ok=True)
    for c in changes:
        shutil.copy2(c.path, preload / c.name)
        run(["git", "add", f"{PRELOAD_SUBDIR}/{c.name}"], cwd=REPO_DIR)

    all_workouts = all_workout_files_in_preload()

    updates_md = render_updates_md(all_workouts)
    (REPO_DIR / UPDATES_FILE).write_text(updates_md, encoding="utf-8")
    run(["git", "add", UPDATES_FILE], cwd=REPO_DIR)

    index_path = REPO_DIR / PRELOAD_SUBDIR / "workout-index.json"
    index_path.write_text(json.dumps(all_workouts, indent=2), encoding="utf-8")
    run(["git", "add", f"{PRELOAD_SUBDIR}/workout-index.json"], cwd=REPO_DIR)

    new_names = [c.name for c in changes if c.is_new]
    upd_names = [c.name for c in changes if not c.is_new]
    parts: list[str] = []
    if new_names:
        parts.append(f"add {len(new_names)}")
    if upd_names:
        parts.append(f"update {len(upd_names)}")
    summary = ", ".join(parts)
    first_date = changes[0].name.removeprefix("workout-").removesuffix(".csv")
    last_date = changes[-1].name.removeprefix("workout-").removesuffix(".csv")
    range_str = first_date if first_date == last_date else f"{first_date}..{last_date}"
    msg = f"chore: {summary} workout log(s) ({range_str})"

    run(["git", "commit", "-m", msg], cwd=REPO_DIR)
    run(["git", "push", "origin", BRANCH], cwd=REPO_DIR)

    save_state(current)
    log(f"Pushed: {msg}")


def main() -> int:
    log(f"kratos-uploader starting. Watching {WATCH_DIR}, window {ACTIVE_START}-{ACTIVE_END}, every {INTERVAL_SECONDS}s.")
    if not WATCH_DIR.is_dir():
        log(f"ERROR: WATCH_DIR {WATCH_DIR} not found.")
        return 1
    import time as _time
    while True:
        now = datetime.now(TZ)
        if in_active_window(now):
            try:
                tick()
            except subprocess.CalledProcessError as e:
                log(f"git command failed: {e}. Will retry next tick.")
            except Exception as e:  # noqa: BLE001
                log(f"Unexpected error: {e!r}. Will retry next tick.")
        else:
            log(f"Outside active window ({ACTIVE_START}-{ACTIVE_END}); skipping.")
        _time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
