# Verification report — 2026-10-09

The application now passes real installed-dependency, PostgreSQL and rendered-browser checks: **77/77 unit tests, 57/57 integration tests and 17/17 Chromium tests**. The official population snapshot produces exactly 50 sourced cities, and a real native isolated database/image backup and restore succeeds. A production-config build and artifact checks pass. The native app, worker and Caddy proxy are enabled and running; host-side HTTPS is verified at **https://citimoriunde.eu**. **Public registration remains disabled; public-launch readiness still reports 7 blockers.** These results do not establish external authentication/email or public-launch acceptance.

## Environment and preservation

Native checks run on Ubuntu 26.04.1 ARM64 with 2 CPUs, 3,891 MiB RAM and no swap, using Node 22.22.1, npm 9.2.0 and loopback-only PostgreSQL 18.6. Next 16.4.0, React/React DOM 19.3.0, TypeScript, Better Auth 1.7.7, Sharp 0.35.5 and Playwright Chromium are actually installed. A real npm lockfile v3 exists, and the final `npm ci` succeeds. Playwright uses its Ubuntu 24.04 ARM64 browser fallback on this host. AMD64/container execution remains unverified.

The protected deployment `.env` remains mode `0600`, ignored by Git/Docker, and unchanged. Credential values are not printed in check reports. Existing services, proxy and SSH settings are preserved. The native app/worker runtime is `/opt/biblioteca`, root-owned and group-readable, with processes run by the unprivileged `biblioteca` service account; protected runtime configuration is supplied through systemd `LoadCredential`.

Integration, browser, load and restore harnesses require a dedicated `*_test` maintenance database, create disposable targets, and isolate configuration and image/backup directories. They do not migrate, truncate or restore deployment data. Suites run sequentially; integration uses pool 4 for merge/concurrency observers, and browser/load subprocesses retain pool 2. One build/browser worker is used at a time.

Sharp was updated to **0.35.5** and the latest audit of the installed dependency graph reports **0 vulnerabilities**. Compatibility and official package references are recorded in [docs/DEPENDENCY_COMPATIBILITY.md](docs/DEPENDENCY_COMPATIBILITY.md). This audit result describes the checked dependency graph, not a container or external-service assessment.

## Checks actually completed

| Check | Actual result | Scope and evidence |
|---|---|---|
| Final `npm ci` | Passed; 232 packages installed | Reproducible install using the real lockfile. `/tmp/biblioteca-ci.log`. |
| Final `npm test` | **77 passed, 0 failed, 0 skipped** | Installed TypeScript/tsx dependencies, configuration subprocesses, normalization, lending rules, ad/CSP policy, evidence signing, auth projections, provider boundaries, PostgreSQL CLI handling, archive checks and artifact isolation. `/tmp/biblioteca-unit.log`. |
| TypeScript checks | Passed | Actual `npm run typecheck` after source fixes; final production build also completed its TypeScript phase. Precise catalogue/statistics row types and correctly typed child environments replace the failing inferred shapes. |
| `npm run test:integration` | **57 passed, 0 failed, 0 skipped** | 19 authentication/readiness, 35 domain and 3 actual Sharp/database cases against disposable PostgreSQL with all 8 migrations. `/tmp/biblioteca-integration.log`. |
| Production-config build | **Passed, including the final registration-spacing fix** | Next production output with `APP_ENV=production`, canonical origin, registration disabled and ads off. The separate browser build passed with `NODE_ENV=production`, isolated `APP_ENV=test` and one build worker. |
| `npm run test:browser` | **17 passed**, one Chromium worker, **4.1 minutes** | Rendered public/member/admin and upload/lending/return/gift/forum journeys at 320, 390, 768 and 1440 px; keyboard, overflow/control, anonymous API and inert SDK navigation checks. `/tmp/biblioteca-browser.log`, `test-artifacts/browser-report/`. |
| `npm run test:restore` | **Passed native isolated roundtrip** | Real backup and separate PostgreSQL/image restore: 1 library, 1 copy, 1 loan, 1 photo record, 8 migrations and 3 WebP variants. Record/image fingerprints match; source data and bytes remain unchanged; generated restore database is cleaned up. `test-results/restore-test.json`, `/tmp/biblioteca-restore.log`. |
| Official city extraction and strict seed | **50 sourced cities; 50 libraries inserted, 0 on rerun** | Actual UN WUP2025 F21 XLSX, checksum and reviewed geography. Preview has 0 members/books and 0 published policies; legal drafts remain unpublished. |
| Final build artifact checks | **Passed; 0 findings** | 1,767 standalone files, 23 browser text files and 1,172 server text files; 0 env/private paths, escaping links, credential matches, missing artifacts or read failures. Independent deployment-config scan also passed. Counts describe the final production-build scan snapshot. |
| `npm run loadtest` | **0 errors**; 160 searches and 30 reservation-write cycles | Domain benchmark conditions and exact measurements below; no production-capacity claim. `test-results/load-test.json`. |
| `npm run test:operations` | **9 passed, 0 failed** | Synthetic filesystem checks for local secret creation, restrictive modes, preservation, symlink refusal and targeted SMTP updates/redaction. Tests do not mutate the real `.env`. |
| Source/configuration checks | Passed | Recorded source run: 127 TypeScript/TSX files parsed; 1,407 Romanian copy references and 353 local imports with 0 missing targets; 14/14 isolated configuration policy groups and 135/135 documented keys. Source checks complement native execution. `/tmp/biblioteca-source-checks.log`. |
| Historical mocked policy harnesses | Recorded passing results | 7 signup assertions, 13 SMTP groups, 5 worker-shutdown groups, 7 client-adapter groups, and 12 forum server scenarios plus 4 form/adapter cases. Mocked boundaries do not establish provider, production-worker or deployment success. |
| `npm run smtp:check` | **Failed; SMTP remains unverified** | Actual installed transport reported a redacted failure. No email sent or delivery attestation enabled. `/tmp/biblioteca-smtp.log`. |
| Native app/worker/Caddy and health/readiness | Enabled/running; health **200**, readiness **503** | Unprivileged app/worker with protected configuration; active Caddy. Readiness reports runtime running, public launch false, 50 sourced cities, 0 published policies, 0 qualified administrators and 7 launch blockers. |
| Host-side DNS/HTTPS and redirects | **Passed from this host** | Apex and `www` resolve to the host's `152.53.12.147`; trusted HTTPS home and health requests return 200 with TLS verification result 0. HTTP redirects 308 to HTTPS; HTTPS `www` redirects 301 to the apex. Independent remote fetch verification was unavailable. |
| Live HTTPS page/screens checks | **20/20 pages return 200**, no overflow | 5 public routes × 4 widths; 0 page errors, 0 unexpected failed requests and 0 external requests. 306 cancelled RSC prefetches caused by deliberate full-navigation teardown are counted separately. `test-artifacts/live/report.json`. |

Archive cases cover GNU tar compatibility, traversal/absolute paths, links/PAX, duplicates, bounded sizes, truncation, trailing data and exclusive extraction with restrictive modes. The native restore roundtrip adds actual database/image recovery evidence, using synthetic local fixtures. Offsite delivery, production recovery and an operator recovery-time objective remain unverified.

The artifact checker reads configuration through `src/lib/config.ts` and emits numeric counts only. It scans configured credential values of at least 12 characters and their JSON/URL/base64 forms, including complete database URLs even when a password is short. Short scalar values are counted as skipped to avoid matching ordinary code such as the Docker placeholder `build`; the deployment-config scan skipped none. This targeted check does not constitute penetration testing. The build wrapper removes only generated standalone env copies and tracing excludes private storage, backups, test artifacts and Git data, and the checker rejects copied population snapshots. The source `.env` is preserved.

## Rendered screens and repaired failures

Twenty isolated-fixture screenshots exist in `test-artifacts/browser/`: `home`, `public`, `member`, `admin-ads` and `forum`, each at **320/390/768/1440 px**. Real browser checks cover viewport overflow, keyboard skip-link focus, accessible controls, public/private permissions, member settings, mobile administration, Sharp uploads, handover/receipt, extensions, borrower return versus lender receipt, permanent gifting and safe forum rendering. No ad/analytics requests were observed in monitored off/private paths. Live vendor behavior was not exercised.

An additional 20 live HTTPS screenshots exist in `test-artifacts/live/` for `/`, `/catalog`, `/biblioteci`, `/comunitate` and `/inregistrare` at all four widths. The recorded live run returned 200 for every page without horizontal overflow, page errors, unexpected failed requests or external requests. Its 306 cancelled React Server Component prefetch requests resulted from deliberate full-document navigation and page teardown and are classified separately in `report.json`.

Visual inspection covered the live home at 390/1440 px, registration and libraries at 390 px, forum at 1440 px, and earlier member/admin/forum fixtures at mobile and desktop widths. No broken layout was observed. Missing spaces between inline registration policy links were found and fixed in `src/components/account.tsx`; the rebuilt application was deployed and the final screen assertion confirms the complete, correctly spaced policy sentence at all four widths.

Actual failures were repaired before the passing runs: PostgreSQL migration syntax, installed-library authentication contracts, TypeScript environment/query inference, and browser selectors for visible required markers and exact Romanian labels. Evidence context boundaries now stay in PostgreSQL so microsecond timestamps cannot duplicate the selected message and invalidate its signed preview. The regression checks unique bounded ordering and stored evidence for first/middle/last selections with explicit microsecond timestamps. Real builds revealed generated standalone env copies; successful builds now remove and check them. A synthetic native credential regression verifies quoted values and confirms that production origin and closed-registration overrides take precedence without editing the source file.

## Population source and seed provenance

`data/cities.manifest.json` is verified and contains exactly 50 unique ranked cities derived from the [official UN WUP2025 F21 DEGURBA population workbook](https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx), retrieved on **2026-10-09**. Snapshot: `data/snapshots/WUP2025-F21-DEGURBA-Cities_Pop.xlsx`; SHA-256: `3a96030d87aec6c1c50f658d5321067d6345e1ab936c5d2854524f972caa75c0`. Attribution and CC BY 3.0 IGO details appear in the manifest and [docs/POPULATION_PROVENANCE.md](docs/POPULATION_PROVENANCE.md).

The 2025 values describe harmonised DEGURBA cities at mid-year, converted from thousands to persons. They are not administrative city-proper or metropolitan populations. `data/geography-review.json` records all 25 transcontinental candidates capable of affecting the top 50 under the explicit Ural/Greater Caucasus/Turkish Straits boundary convention. Geographic decisions are documented project inferences from source positions and cited geography, not UN continent endorsements. Istanbul appears once using its whole-city source population, including both sides. The real strict seed inserted 50 libraries, then 0 on rerun; no demo members/books or published policies were inserted.

## Native domain benchmark

The disposable load run used ARM64, 2 CPUs, 3,891 MiB host RAM, pool 2 and 60 synthetic works. Search concurrency was 4; write concurrency was 1. The run overlapped incidental unit-runner activity. External services were disabled.

| Operation | Requests | p50 | p95 | Errors |
|---|---:|---:|---:|---:|
| Catalogue search | 160 | 16.28 ms | 28.07 ms | 0 |
| Request/accept/cancel reservation cycles | 30 | 26.51 ms | 51.72 ms | 0 |

Total measured duration: **1,790 ms**; benchmark-process RSS: **190 MiB**. These are small local domain-service measurements. HTTP, TLS, browser, worker and PostgreSQL RSS are excluded; concurrent-user capacity, whole-deployment memory and production latency are not established. Exact conditions/results are in `test-results/load-test.json`.

## Required acceptance matrix

Passing local behavior is bounded by the named fixtures and runtime; real launch prerequisites remain separate.

| # | Required behavior | Current evidence and remaining check |
|---|---|---|
| 1 | Signup/verification/login/reset/logout/revocation; Google/linking | Real Better Auth/PostgreSQL auth and TOTP/session protections pass. Google/linking contracts use explicit mocks; real Google control and SMTP delivery remain unverified. |
| 2 | Restricted actors/role authorization | Real actor/API guards, moderator scopes, admin-factor rules and last-admin races pass. Operator admin bootstrap/factor setup remains pending. |
| 3 | Canonical library approval/concurrency | Real request/approval, scope and concurrent canonical-library cases pass. |
| 4 | Exactly 50 sourced cities/idempotent seed | Official snapshot/checksum/geography verified; strict seed inserts 50 libraries and 0 on rerun. |
| 5 | Four title variants, authors/editions distinct | Actual normalization and PostgreSQL catalogue cases pass. |
| 6 | ISBN/duplicates/AI outage/malicious output/merge | Concurrent ISBN/edition and chained-merge/history cases pass; provider/schema/budget boundaries use transparent mocks. Real providers remain disabled/unverified. |
| 7 | Existing work adds copy/Romanian translations | Existing-work submissions and Romanian-language/foreign-author catalogue cases pass. |
| 8 | Images/re-encode/EXIF/quotas/mobile/ownership | 3 Sharp/PostgreSQL cases, browser uploads and native image recovery pass. Live S3 is unverified. |
| 9 | Reservation/self-borrow/authorization | Real acceptance concurrency, locks, actor checks and one-active-copy constraints pass. |
| 10 | Physical handover starts loan/date | Persisted lender-only handover/date/constraint cases and browser journeys pass. |
| 11 | Borrower indication versus lender receipt | Real return-pending/receipt/availability and all-width browser journeys pass. |
| 12 | Extensions/expiry/disputes/retries/reminders | Specific extension-ID binding/retries, original dates and expiry pass; browser extension passes. One native worker is active with pool 2 and no observed job errors; real email delivery and graceful mail drain remain unverified. |
| 13 | Permanent gift/ownership/reminder/return counters | Existing-copy transfer, private recipient listing, DONATED history, counters/reminders and browser gifting pass. |
| 14 | Return/gift race and incompatible XP | Actual races and outcome/reward-family constraints pass. |
| 15 | No reward farming | Canonical-work caps, toggles, cooldowns, gifting loops, append-only ledger and idempotent adjustments pass. |
| 16 | Reviews/privacy/statistics | Real double-blind release, eligibility, edition context, unique book reviews and counters pass. |
| 17 | Messages/evidence/scopes/block/mediation | Participant isolation, retry conflicts, microsecond-aware signed bounded snapshots and scoped/audited evidence pass. Public references cannot open private cases. |
| 18 | Forum/render/permissions/icons | Real revisions/scope/move/merge/lock cases and rendered safe forum journeys pass; browsers check 32 built-in icons. |
| 19 | No ad/analytics without consent/private/off | Pure policy/CSP and monitored off/private browser paths pass. SDK fixtures are inert; live CMP/AdSense/analytics remain unverified. |
| 20 | Responsive previews/production hiding/one init | Session-authorized admin placeholders/gallery and public/private navigation pass at all widths. No live vendor initialization result claimed. |
| 21 | No secret/history leaks | Auth/public projections, private exports and generated artifact checks pass for tested paths. Comprehensive cache/log/HTML security and penetration review remain outstanding. |
| 22 | Deletion/retention/restore | Deletion/loan races, export isolation and native synthetic DB/image restore pass. Legal retention review, offsite backup and production recovery remain unverified. |
| 23 | Primary mobile/admin journeys | 17/17 fixture cases and 20 live HTTPS pages pass at all widths. Mobile/desktop screens were visually inspected; the updated registration-spacing screen and text assertion also pass. |

## Native HTTPS and service observations

Caddy is enabled and active for `citimoriunde.eu` and `www.citimoriunde.eu`. Both DNS names resolve to `152.53.12.147`, matching the host address. Host-side HTTPS requests to the apex home and `/api/health` return **200** with curl TLS verification result **0**. Let's Encrypt certificates for the apex (`YE1` issuer) and `www` (`YE2` issuer) are valid from **2026-10-09 through 2027-01-07**. Plain HTTP redirects **308** to HTTPS; HTTPS `www` redirects **301** to the canonical apex. These are actual host-side DNS/TLS/HTTP observations; the independent remote web-fetch tool was inaccessible, so no independent remote reachability result is claimed.

The production public-signup endpoint returns **403 `REGISTRATION_DISABLED`**. `/api/readiness` returns **503** while reporting runtime running and public launch false, with 7 unresolved launch blockers. The ordinary health endpoint remains 200. The app and worker continue running as `biblioteca` with protected runtime configuration. One worker is active with database pool 2; no job errors were observed.

A service-memory observation recorded approximately **web 128 MiB, worker 114 MiB, Caddy 23 MiB and PostgreSQL 152 MiB**. These are contemporaneous snapshots, not peak RSS, a sustained-load measurement or a capacity promise. Real graceful draining of an in-flight SMTP job remains unverified; no production job was fabricated to exercise it.

## Remaining verification

- **Real worker mail drain and sustained resource/capacity checks: unverified.** Current running/pool/error observations and small synthetic domain timings do not establish them.
- **Docker/Compose and production-platform execution: unverified.** Native build, services and synthetic recovery do not establish container entrypoints, resource limits or AMD64 behavior.

## Remaining real launch gates

Public registration must remain disabled until launch prerequisites pass. The actual SMTP diagnostic failed and `SMTP_VERIFIED` remains false; authenticated transport and inbox delivery still require verification. Real Google OAuth login/linking, callback origins and account ownership remain unverified, despite the now-verified host-side domain/DNS/HTTPS configuration. Operator identity/address/contact details, legal review and publication of all eight required documents, the actual administrator's verified adult account/TOTP/session step-up, and the public-launch review remain incomplete. Readiness observes 0 published policies and 0 qualified administrators. No account promotion or legal approval has been fabricated.

Offsite delivery, production recovery and recovery objectives remain unverified. Native synthetic recovery does not satisfy them. Optional S3, book-provider/paid-AI calls, live AdSense/Cookiebot consent, analytics and conversion integrations remain disabled or gated until separately configured and verified. Passing source, database, browser, HTTPS, benchmark and artifact checks must not bypass these launch requirements.
