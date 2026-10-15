# Backups

```bash
npm run backup          # snapshot + prune, keeps the 14 most recent
npm run backup:list     # what is currently held
node scripts/backup.js --keep 30
```

Snapshots land in `data/backups/`, named `launchpad-<ISO timestamp>.db`.

## What it does, and why it is not `cp`

The database runs in WAL mode, so at any moment some committed data lives in
`launchpad.db-wal` and has not yet been folded into `launchpad.db`. Copying the
file while the server is running can therefore produce a torn snapshot that
restores short — or refuses to open.

`scripts/backup.js` uses SQLite's online backup API instead, which walks the
database page by page under the right locks. **The server does not need to be
stopped**, and the result is consistent even under live traffic.

Each new snapshot is then reopened and checked — `PRAGMA integrity_check`, plus
a read of the user, ledger and completion counts — *before* any older snapshot
is pruned. A snapshot that fails is deleted and the script exits non-zero, so a
bad backup never silently replaces a good one.

## Scheduling

**On the free Render plan this file does not apply.** There is no disk; the
database lives in Cloudflare KV, which keeps a dated daily copy for 14 days
(see DEPLOY.md, *Day to day*).

**On a hosting platform with a disk, set `BACKUP_EVERY_HOURS=24`.** The server
then runs this script itself. It has to: the disk is
attached to that one service, so no separate cron job could reach the database.

"Due" is worked out from the newest snapshot on disk, not from when the server
started — so redeploying does not create extra backups, and a server that was
down past its slot catches up about a minute after it comes back. Each run logs
one line, and failures are prefixed `[backup] FAILED`, which is the string to
alert on.

Snapshots are written as single self-contained files (rollback-journal mode, not
WAL), so a downloaded snapshot is complete on its own — there are no `-wal` or
`-shm` companions to fetch with it.

**On your own server, use cron or Task Scheduler instead.** Exit code 0 means
success, 1 means failure. Alert on non-zero.

**Linux / macOS** — `crontab -e`, nightly at 03:15:

```
15 3 * * * cd /srv/career-launchpad && /usr/bin/node scripts/backup.js >> /var/log/launchpad-backup.log 2>&1
```

**Windows** — Task Scheduler, daily:

```powershell
$action  = New-ScheduledTaskAction -Execute "node" -Argument "scripts\backup.js" -WorkingDirectory "C:\path\to\career-launchpad"
$trigger = New-ScheduledTaskTrigger -Daily -At 3:15am
Register-ScheduledTask -TaskName "Launchpad backup" -Action $action -Trigger $trigger -Description "Nightly SQLite snapshot"
```

**Docker / PaaS** — run it as a sidecar cron or a scheduled job in the same
container, with `data/` on the same persistent volume the app writes to.

## Getting the backups off the box

A snapshot sitting next to the database does not survive the disk dying or the
instance being recycled. Copy them somewhere else — this is the step people
skip:

```bash
npm run backup && rclone copy data/backups remote:launchpad-backups
```

or `aws s3 sync data/backups s3://your-bucket/launchpad/`, or anything
equivalent. `data/` is in `.gitignore`, so backups are never committed.

## Restoring

1. **Stop the server.** Restoring under a running process corrupts state.
2. Delete the WAL sidecars, or SQLite replays them over what you just restored:
   ```bash
   rm -f data/launchpad.db-wal data/launchpad.db-shm
   ```
3. Copy the snapshot into place:
   ```bash
   cp data/backups/launchpad-2026-09-22T18-19-09-306Z.db data/launchpad.db
   ```
4. Start the server and confirm the boot line reads `storage=sqlite`.

This cycle has been tested end to end: an account with 9 ledger rows and 1
completion was created, snapshotted while the server was live, deleted, and
restored intact.

## Before you rely on it

Do a restore drill onto a scratch copy once, now, rather than discovering the
procedure during an incident. An untested backup is a guess.
