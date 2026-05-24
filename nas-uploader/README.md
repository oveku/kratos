# kratos NAS uploader

Watches `/volume1/Download/kratos-workouts/` on the Synology NAS and pushes any
new or changed `workout-*.csv` to the [kratos](https://github.com/oveku/kratos)
repo under `preload/`. Runs as a long-lived container; ticks every 15 minutes
between 06:00 and 20:00 Europe/Oslo.

## Architecture

```
Telegram (Klaus) ─► OpenClaw on Klaudette
                        │ workout-logger skill
                        ▼
              /mnt/nas-download/kratos-workouts/   (CIFS mount on Klaudette)
                        │ same disk on NAS:
                        ▼
              /volume1/Download/kratos-workouts/   (bind-mounted into this container)
                        │ git add + commit + push
                        ▼
              github.com/oveku/kratos  preload/ + UPDATES.md
```

## Behaviour

- Scans `workout-*.csv` and tracks sha256 in `.uploaded.json` (lives alongside the CSVs).
- Re-uploads when the hash changes (so edits flow through).
- Batches all changes from a tick into a single commit:
  `chore: add 2, update 1 workout log(s) (2026-05-20..24)`.
- Rewrites `UPDATES.md` at the repo root listing every `preload/workout-*.csv`
  currently present, as a manual-review todo.
- Skips ticks outside the active window (default 06:00-20:00).

## Deploy on Synology DSM

1. SSH into the NAS and copy the folder to `/volume1/docker/kratos-uploader/`.
2. `cp .env.example .env` and paste the PAT from 1Password
   (item `openclaw-kratos-repo-write`). `chmod 600 .env`.
3. `sudo docker compose up -d --build`.
4. `sudo docker logs -f kratos-uploader` to verify the first tick.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `REPO_URL` | `https://github.com/oveku/kratos.git` | Target repo |
| `BRANCH` | `main` | Target branch |
| `GITHUB_TOKEN` | _(required)_ | PAT with `repo` scope |
| `GIT_USER_NAME` | `Klaudetteoveq` | Commit author |
| `GIT_USER_EMAIL` | `klaudette@local` | Commit email |
| `ACTIVE_START_HOUR` | `6` | Earliest hour to run a tick |
| `ACTIVE_END_HOUR` | `20` | Latest hour to run a tick |
| `INTERVAL_SECONDS` | `900` | Seconds between ticks |
| `WATCH_DIR` | `/watch` | Container path; bind-mount the NAS folder here |
| `REPO_DIR` | `/work/kratos` | Where the repo is cloned inside the container |
