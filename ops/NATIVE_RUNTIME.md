# Running native preview

The current host serves https://citimoriunde.eu through the separate
`citimoriunde-caddy.service`. The canonical application also listens locally at
`http://127.0.0.1:3000`. PostgreSQL 18.6 listens only on loopback. SSH and existing
services remain intact. These native units are separate from the unexecuted
Docker/Compose deployment path.

`biblioteca-preview.service` and `biblioteca-worker.service` run as the dedicated
non-login `biblioteca` user. Application code and dependencies under
`/opt/biblioteca` are root-owned and readable by this group. Persistent image and
backup directories under `/var/lib/biblioteca` are service-owned, mode0700. The
worker processes one job at a time with its own two-connection database pool.
The standalone web server has its required `public` and `.next/static` assets
copied beside `server.js` before startup.

The original `/root/biblioteca/.env` remains unchanged and mode0600. Each unit
uses systemd `LoadCredential` to provide a protected, read-only runtime copy;
`CONFIG_ENV_FILE=%d/app.env` loads that copy without granting access to `/root`.
No environment file is packaged into `/opt/biblioteca` or standalone build
artifacts. The build wrapper checks generated artifacts for copied private paths
and configured credentials.

The units explicitly set production mode, canonical HTTPS origin,
`REGISTRATION_ENABLED=false`, `ADS_MODE=off`, trusted proxy and persistent paths.
The application is reachable while public launch prerequisites remain unresolved.
Changing the source environment alone cannot enable registration in these units.
After every launch prerequisite passes, enabling registration requires a reviewed
unit change as well as the actual validated configuration; do not clear the
override simply to make readiness green.

All three units are enabled and running. Use the following read-only checks:

```sh
systemctl status biblioteca-preview biblioteca-worker citimoriunde-caddy
curl --fail --silent --show-error https://citimoriunde.eu/api/health
curl --silent --show-error https://citimoriunde.eu/api/readiness
```

Health currently returns200 with `running:true`. Readiness deliberately returns503
with `running:true,readyForPublicLaunch:false`. Email signup returns403
`REGISTRATION_DISABLED`. The database contains53 retained libraries:35 active EU cities and18 archived
non-EU libraries, with nine migrations and no copies at redesign verification.
Existing accounts and historical references are preserved. No policies are published. Synthetic fixtures exist
only in disposable test databases.

To restart the existing installation without rebuilding:

```sh
systemctl restart biblioteca-preview biblioteca-worker
```

To stop serving the preview deliberately, stop its units; this does not remove
code, credentials, data or SSH access:

```sh
systemctl stop citimoriunde-caddy biblioteca-preview biblioteca-worker
```

For updates, preserve a known working runtime and a validated database/image
backup first. Build once in `/root/biblioteca` with production origin and closed
registration, using `npm ci` and the generated lockfile. Stop app/worker during
runtime replacement, copy only reviewed source/dependencies/migrations and clean
standalone/static/public artifacts, preserve root ownership/group access and
`/var/lib/biblioteca`, apply required migrations, then restart and verify health,
registration and readiness. Never copy `.env`, test artifacts, backups or Git
into the runtime. A failed build must not replace the last working runtime.

Memory limits are1GiB for web,384MiB for worker and192MiB for Caddy; CPU quotas
are1,0.25 and0.15 cores respectively. These are limits, not capacity measurements.
The worker stop timeout is70seconds for the current60second grace configuration;
increase the unit timeout if the configured grace increases. Monitoring, real
offsite backup, provider delivery/login and full resource/capacity checks remain
launch work. See `TEST_REPORT.md`, `GO_LIVE_CHECKLIST.md` and
[HTTPS configuration](NATIVE_HTTPS.md).
