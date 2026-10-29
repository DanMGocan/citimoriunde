# Configuration reference

All application environment reads pass through `src/lib/config.ts`, which loads the gitignored `.env`, validates type/range/URLs and exposes a small non-secret browser allowlist. Database records contain application data (members, canonical libraries, moderation, categories, legal versions, preferences), not integration credentials. Admin effective settings show boolean configured status, never secret values, and cannot edit arbitrary environment files.

`CONFIG_ENV_FILE` optionally selects another protected environment-file path. The native systemd services use `LoadCredential` and `CONFIG_ENV_FILE=%d/app.env` to supply a read-only service credential while preserving the workspace `.env` at mode0600. Existing process environment overrides take precedence. The current preview units force production mode, `APP_URL=https://citimoriunde.eu`, registration disabled and ads off; changing `.env` alone cannot open registration in these units. See [native operations](ops/NATIVE_RUNTIME.md).

`npm run local:env` creates a new `.env` with random **local** authentication/database secrets only when no file exists. It preserves existing content and applies mode0600. `.env*` are excluded from Git and Docker contexts except `.env.example`. Secure off-machine recovery of real secrets is an operator responsibility; database/image backups intentionally exclude `.env`.

## Settings

`.env.example` is the complete annotated key list. Supported groups and safe defaults are:

| Group | Keys and behavior |
|---|---|
| Runtime/brand | `APP_ENV` development/test/production; `APP_NAME` neutral temporary label; `APP_URL` exact canonical origin; `PREVIEW_HOST=127.0.0.1`, `PREVIEW_PORT=3000`; `REGISTRATION_ENABLED=false`. Native production-build start uses the typed host/port and limits V8 heap to75% of configured web memory. Web/database/worker/proxy memory defaults1024/768/384/128MB and CPU caps1/0.6/0.25/0.15 are separately overridable through `.env`; these are limits, not measured usage. |
| Database | `DATABASE_URL` required PostgreSQL URL; `DB_POOL_MAX=6`, `WORKER_DB_POOL_MAX=2`; statement timeout10000ms. The native/Compose worker selects its own pool by entrypoint. Compose uses POSTGRES_USER/DB/PASSWORD with a private service hostname. `TEST_DATABASE_URL` must identify a separate private `_test` maintenance database; the runner creates and removes a random disposable test target. |
| Authentication | `AUTH_SECRET` ≥32chars; session14days; auth max10/minute; `GOOGLE_CLIENT_ID/SECRET` both or neither; `ADMIN_BOOTSTRAP_EMAIL=gocandan@gmail.com`; admin step-up30minutes. No role claims accepted from clients/providers. |
| Operator/launch | `OPERATOR_NAME/ADDRESS/COUNTRY`, `SUPPORT_EMAIL`, `LEGAL_REVIEWED=false`, `PUBLIC_LAUNCH_REVIEWED=false`. Real values/legal publication required. Production public registration also requires both review flags; flags must follow actual evidence. |
| Proxy/TLS | `TRUSTED_PROXY=false`; Compose sanitizes `X-Real-IP`; `SITE_DOMAIN`, `TLS_EMAIL` real production values. `PROXY_MAX_BODY_MB=16` must exceed configured upload size by at least1MB for multipart framing; Caddy receives this through Compose. Native loopback preview should not trust arbitrary incoming proxy headers. |
| SMTP | `MAIL_MODE=disabled|smtp`; HOST, PORT587, SECUREfalse, REQUIRE_TLStrue, USER, PASSWORD, FROM. Enabled SMTP requires a host/sender, TLS and either both auth fields or an explicitly authorised relay without credentials. TLS≥1.2/certificate validation, one pooled connection/recipient, external/file content disabled, no provider debug logs. DNS/connect/greeting/socket timeouts default5000/10000/10000/15000ms. `SMTP_VERIFIED=false` remains a launch blocker until the operator verifies authentication, sender acceptance and inbox delivery; this is an attestation, not automatic detection. |
| Book lookup | Google Books/Open Library switches false; API key; daily limit100; metadata cache30days. Optional/manual workflow works without providers. |
| Mistral | enabledfalse; API key; model `mistral-small-latest`; timeout4000ms; daily20; monthly budget500cents. `MISTRAL_MAX_REQUEST_COST_CENTS=0` disables paid calls until the operator supplies a conservative per-request upper bound based on the real selected model's pricing and bounded input/output. Bibliographic text only; rejected/failed AI never authorizes a merge. |
| Storage | driverlocal; `STORAGE_PATH=./storage/images`; optional S3 endpoint/region/bucket/key/secret. Explicit S3 selection requires an origin-only endpoint, bucket and both credentials; production requires HTTPS. `UPLOAD_MAX_PHOTOS=3`, max10MB incoming, max40million decoded pixels, member quota200MB, processing concurrency1. |
| Lending | duration28days, maximum90, active limit5, reservation72hours, reminder3days. Handover starts due date. Physical lender receipt closes a return. |
| Retention/backups | review defaults: base365days, message365, audit730, backups14; paths, offsite rsync destination. Unresolved interactions require proportional case review; TTLs do not excuse indefinite retention. |
| XP/challenges | version2026-01; pair cooldown30days; monthly reading/listing caps10; lender30, borrower15, on-time5, reading5, donor20, listing3. Append-only awards retain rule version. `CHALLENGE_READING_TARGET=3`, `CHALLENGE_GENRES_TARGET=2` control visible monthly self-reported progress, without additional transaction XP. |
| Reviews/forum/messages | blind review14days; own-post edit60minutes; daily unsolicited contacts5; message rate10/minute; `FORUM_MINUTE_LIMIT=5`. |
| Worker | poll2000ms; retry limit5; concurrency1; stale claim recovery10minutes. `WORKER_STOP_GRACE_SECONDS=60` controls Compose worker shutdown and must exceed SMTP phase budgets by at least10seconds. Socket timeout is an inactivity limit, so this does not prove total shutdown duration; measure and tune real shutdown. Stops fresh claims after signals; interrupted claims release conditionally, in-flight jobs finish. Failures store short safe codes, not email payloads or provider responses. Delivery retries use stable Message-ID but cannot guarantee exactly-once provider delivery. |
| Ads | off/placeholder/adsense; public production placeholdersfalse; catalogue/inline/sidebar flags true, lowerfalse; inline after8; verified actual AdSense publisher and separate slot IDs. |
| Consent/measurement | Supported seam: `CMP_PROVIDER=cookiebot`, exact `CMP_SCRIPT_URL=https://consent.cookiebot.com/uc.js`, real domain-group UUID as `CMP_PUBLISHER_ID`; `CMP_CSP_ENABLED=false`, certifiedfalse, validatedfalse. All must be explicitly enabled and verified for live ads. `ANALYTICS_ENABLED=false` with an optional validated `G-…` ID; separate `GOOGLE_ADS_CONVERSION_ENABLED=false` and numeric `AW-…` ID. `GOOGLE_ADS_CONVERSION_LABEL` reserves a real operator-approved conversion definition; no conversion event is emitted automatically. Off/placeholder modes suppress both ad and measurement requests. |

Production fails clearly for non-HTTPS/localhost origins, placeholder auth secrets, invalid database URL, partial OAuth credentials, or public registration without attested SMTP delivery and reviewed operator/legal settings. `npm run readiness` further checks published documents, all 35 active EU libraries identified by the sourced city manifest and a verified TOTP admin. Archived non-EU locations and unrelated sourced cities cannot satisfy the city gate; an application health response is **not** launch approval.

## Apply changes

Edit `.env` with a local protected editor; do not print its contents in logs or tickets. Check formatting and maintain mode0600. Native services require restart. Compose:

```sh
docker compose up -d --force-recreate web worker
```

For production add `-f compose.yml -f compose.production.yml` to every relevant Compose invocation. Browser-bundled code changes, dependency changes or new public build values require one sequential rebuild. Deployment settings themselves are server values; do not inject credential-bearing NEXT_PUBLIC variables. A branding/URL change requires metadata/OAuth redirect review and a restart/rebuild. Keep disabled integrations disabled until their real contract and network behavior are verified.

Admin banner preview is a session authorization record with an expiry, not a settings override; a public query parameter cannot enable it.

`npm run smtp:check` validates connection, TLS and authentication without sending mail. It cannot verify sender acceptance or delivery and never sets `SMTP_VERIFIED`. Provider details are redacted on failure; interruption may wait for transport timeouts. The local stdin-only SMTP setup helper preserves unrelated settings and resets earlier delivery attestation whenever credentials change. It is not exposed through admin pages.

## Sandbox check evidence

When npm dependencies cannot be installed, the system-provided Babel can run `node scripts/config-policy-check.cjs`. It transforms actual configuration into an isolated VM with synthetic values and no deployment `.env`. Its14 policy groups cover safe projections, production/registration gates, partial OAuth/SMTP rejection, TLS/delivery/grace gates, placeholders, CMP/storage validation, AI budget, isolated children, worker pools and native standalone absolute paths. This passed14/14 on this VM. `node scripts/config-coverage.cjs` checks all135 documented keys without reading `.env`. These supplement the installed semantic/build checks and77 passing unit tests. The native credential loader and Next test-environment isolation have dedicated regression checks.
