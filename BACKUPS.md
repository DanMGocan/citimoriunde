# Backup and safe restore

The local storage backup includes a PostgreSQL custom-format dump, re-encoded uploaded images, and SHA256 manifest. An optional S3 deployment needs an operator-managed bucket/version backup; this script refuses to claim a complete S3 backup. They contain personal data. They exclude `.env`; keep secrets in a separate protected recovery procedure. Local backup folders use mode0700/files0600. Configure encrypted off-server storage/transport and access controls; an rsync path alone is not an encryption-at-rest guarantee.

## Create a backup

Prerequisites for both paths: installed app dependencies from a reviewed lockfile, host Node/Docker CLI for Compose, and real protected `.env`. Dependency downloads are currently blocked and the lockfile is missing; first resume `npm install`, review/commit the generated lockfile, then use `npm ci` for reproducible installs. No container build or database restore is claimed to have passed. Native backup/restore additionally requires host `pg_dump`/`pg_restore` version18 or compatible with the database, `tar`, and optional `rsync`. Use the same or newer PostgreSQL client major as the server. Native writes must be paused briefly by the operator so a referenced photo cannot disappear between DB snapshot and image archive:

```sh
npx tsx scripts/backup.ts
```

Compose path automatically pauses web and worker, leaves database running, snapshots database and images, and restarts the paused services in `finally`:

```sh
npx tsx scripts/backup.ts --compose
```

Run it from the project directory, using the operator's local deployment configuration. The Compose project name is fixed; production overrides do not change these service/volume names. This command requires the host Node dependencies and Docker CLI. It does **not** copy `.env` into a container.

Set `BACKUP_OFFSITE_DESTINATION` to an actual rsync/SSH destination, e.g. a restricted backup account with a configured path. Do not embed passwords; use the operator's SSH keys/policy. The script verifies archive hashes and records offsite success only when rsync succeeds. It does not delete old offsite data automatically; schedule operator-reviewed retention according to `BACKUP_RETENTION_DAYS`, legal needs and restore drills. A failed backup is never reported as successful.

For scheduled backups, use one systemd timer/cron job outside the web process with a lock (`flock`) and notifications on failure. Never run another image/build worker while a snapshot is stressing the small VPS. Monitor free disk and retain several generations on a different machine; a backup on the VPS alone does not cover VPS loss.

## Test restoration safely

Both drills validate the manifest/checksums, inspect the image archive, create a random **new** `restore_test_*` database, restore into it, write photos into a private random `/tmp/community-restore-*` folder, check schema/loan invariants, counts and every referenced photo's three variant byte totals, then remove only those temporary resources. No original database or image volume is a restore/drop target. Native path:

```sh
npx tsx scripts/restore-test.ts /absolute/path/to/backups/<timestamp>
```

Compose path, with PostgreSQL18 clients already inside the private database container:

```sh
npx tsx scripts/restore-test.ts /absolute/path/to/backups/<timestamp> --compose
```

Run from this project directory after the database service is healthy. The script pipes the dump and SQL directly into `docker compose exec -T database`; passwords stay in that container's existing environment. The web image does not need PostgreSQL client packages, the host does not need PostgreSQL tools for this path, and5432 remains unpublished. It restores into a separate database while the original app database remains available; schedule the drill off-peak because both share CPU/memory/disk. The random database is dropped only after its creation succeeded. A failed cleanup returns a failure and identifies the generated temporary resource for operator investigation.

Image validation rejects absolute/traversal paths, symlinks/hardlinks, nested directories, PAX/extended headers, duplicate entries, malformed/checksum-invalid/truncated headers and variants larger than16MiB. Only a flat set of `<32 hex characters>-320.webp`, `-640.webp`, `-1200.webp` regular files and the optional archive root directory are accepted. Images are written through exclusive mode0600 file creation; no external `tar` extraction runs. Archive validation and extraction use the same opened descriptor, and validation finishes before any database creation. Actual parser/extraction checks passed13 assertions against synthetic archives and a real GNU tar archive; that is separate from an unexecuted PostgreSQL restoration.

Use only trusted, operator-controlled archives created by this system. A PostgreSQL dump can contain executable database instructions; image path validation does not make an untrusted database dump safe. The database role needs CREATE DATABASE for the drill; use an operator account in the private environment, never give public application users that privilege. Production app roles should have narrower privileges; perform backup drills with separately controlled maintenance access. The initial single-service Compose bootstrap role owns the database, so harden that operator/app split before launch.

Do not publish5432 to make restoration convenient. A successful build or archive-parser test does not count as a database restore drill; capture actual native/Compose drill output in TEST_REPORT.md. Neither database path has been executed while Docker/PostgreSQL/dependency access is unavailable.

## Recovery/update

1. Stop the application/worker; preserve the incident database and files.
2. Validate manifest hashes and restore to a new private database/volume first.
3. Compare library/copy/loan counts, photo files, ownership/active-loan constraints and auth schema; review that the backup date meets recovery objectives.
4. Update protected `DATABASE_URL`/storage volume only after operator authorization for the concrete recovery target. Restart with no workers until migrations/readiness pass.
5. Verify sign-in, catalogue, private access isolation, a synthetic loan on a separate test database, job recovery and user-facing state. Resume worker. Rotate compromised credentials if required.

Never use `docker compose down -v`, `DROP DATABASE` against production, or blind migration rollback as an update command. Backups/recovery objectives and final retention are subject to operator/legal review. No production restore or successful drill is claimed until executed.
