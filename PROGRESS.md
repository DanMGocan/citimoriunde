# Progress — 2026-10-09

## Current outcome

The application in `/root/biblioteca` now has installed, locked dependencies and a working native PostgreSQL environment. TypeScript, real database/domain tests, the isolated production-build browser suite and a native database/image backup/restore roundtrip pass. The official UN population snapshot and geographic review produce exactly 50 reproducible city libraries. The earlier network, dependency and local-socket restrictions are historical.

The production-built preview and bounded worker are running under unprivileged native services. The local application listens at `127.0.0.1:3000`, and the preview is available at **https://citimoriunde.eu** through Caddy with a valid Let’s Encrypt certificate. Public-launch acceptance remains pending: signup returns 403 and readiness returns 503 with `running=true` and `readyForPublicLaunch=false`. **Public registration remains disabled until launch prerequisites pass.** The live HTTPS browser pass also succeeds across 20 public pages at four widths.

## Inspection and preservation

- The application repository remains isolated below `/root/biblioteca`; protected root Git, credentials, SSH/proxy settings, unrelated files and existing services are preserved.
- The resumed host is Ubuntu 26.04 ARM64 with 2 CPUs, 3891 MiB RAM and no swap. Native execution uses Node 22.22.1, npm 9.2.0 and PostgreSQL 18.6. PostgreSQL is bound to loopback; no public database port was opened.
- Dependencies are installed with a real npm lockfile v3, and a clean `npm ci` passes. The installed application pins include Next 16.4.0, React 19.3.0, Better Auth 1.7.7, Drizzle 0.45.2 and Sharp 0.35.5. The latest dependency audit reports 0 vulnerabilities.
- `.env` and existing provider settings are preserved. The protected file remains ignored and mode 0600; credential values are never printed. Build cleanup removes generated standalone `.env` copies, preserving the workspace source file.
- The app, worker and separate Caddy proxy are enabled and active under unprivileged systemd services. Runtime files are under `/opt/biblioteca`; app/worker read the preserved `.env` through protected `LoadCredential`. Web and PostgreSQL listen on loopback. Docker/Compose execution remains unverified.

## Delivered source

- Typed single configuration module, fail-closed production settings, safe browser/admin projections, closed public registration and separate health/public-launch readiness.
- Better Auth password/email verification/reset/session revocation, supported Google code/subject flow and explicit secure linking, avatar suppression, supported TOTP plus session-bound production admin step-up, one-time verified Google bootstrap.
- Eight ordered SQL migrations with work/edition/physical-copy separation, search/identifier constraints, canonical library request approval, immutable XP and physical lifecycle checks. Private server actor/object/scoped authorization and audits.
- Search-first catalogue, Romanian normalization/author evidence/ISBN equivalence, deterministic candidates/manual Romanian/bilingual editions, moderated covers, transactional merges preserving copies/history/reviews/aliases/redirects.
- Sharp validation/re-encoding/orientation/metadata stripping, bounded dimensions/photos/quota/concurrency, random keys, private local/S3 storage abstraction and orphan cleanup.
- Requests that do not reserve, exclusive accepted reservation, lender physical handover, separate receipt acknowledgement, borrower return-pending/lender physical receipt, extension IDs/retries, expiry/reminders/disputes and accepted permanent gifts transferring the existing private copy.
- Private text conversations/contact/block/pagination/unread/polling; safe message retries; signed limited report evidence; durable preference-aware notifications/email jobs.
- Book and double-blind transaction reviews, edition context edits, private reading states, exact collection/loan/return/gift/reading statistics.
- Append-only idempotent XP, incompatible return/gift prevention, pair/copy/time caps, suspicious flags/audited compensating changes, levels, 19 badges, annual goals/monthly challenges and opt-in rankings.
- Global/local forum with safe Markdown/spoilers, titles/tags/replies/quotes/mentions/search/pagination/read markers/bookmarks/follows/likes/revisions/tombstones; scoped pin/lock/move/merge/hide/restore/warnings/suspensions.
- Report/case workflow, audited evidence access and scoped exports, anonymous service contact/appeal route without opening private cases; responsive admin for roles/libraries/catalogue/photos/loans/reviews/forum/rewards/legal/privacy/jobs/readiness/banner preview.
- Eight Romanian policy drafts, versioned publication and acceptance, protected initial review/bootstrap, private export/deletion/retention documentation. No invented operator or legal approval.
- Actual responsive ad-slot components in off/placeholder/adsense modes; authorized per-session admin gallery/preview, production placeholder suppression, reviewed-content gating, certified Cookiebot seam, consent/revocation/private-boundary handling and nonce CSP. Optional Google tags remain separately configured with coarse public pageviews and no automatic conversions.
- Romanian editorial UI/32 built-in icons, public SSR/metadata/canonicals/sitemap/index restrictions, mobile forms/confirmations/errors/retries/focus/tabs/touch targets, original app icon/manifest and no private service worker.
- Compose production-build path with private PG18/Caddy/web/worker, volumes/health/graceful shutdown/log caps/pool limits; local/HTTPS configs, safe update and offsite backup/separate restore scripts.

## Review fixes

Server signup now requires true adult/policy assertions and saves actual legal version IDs only for captured genuine new accounts. Extension retries cannot approve a newer request. Hidden-copy holds survive owner editing and block new reservations. Book-review edition edits persist; a message key reused for another body/conversation rejects before notifications. Physical/history locations remain stable after ownership/home moves. Privacy deletion uses pseudonymous public handles while preserving required records; pending rights requests deduplicate transactionally. Photo rejection also disables dependent edition covers. Public copy projections exclude held/paused/restricted records.

Shared readiness/publication gates exclude draft, missing-date, future and unrelated policies, and require an actual verified adult administrator factor. Drizzle was changed to 0.45.2 to satisfy Better Auth 1.7.7's published peer range. Production Compose forces production environment; proxy upload envelope and CPU/memory limits are typed/env-configurable. UI review corrected CMP intermediate events, preview/live gating, async slot deduplication, admin authorization refresh, evidence display and mobile keyboard controls.

Final cross-layer review fixed independent work/edition volume payloads, explicit cleared review edition context, profile suppression of hidden works and review notification routes. Moderators now have a scoped queue with pending response/photo controls; work/copy moderation and response approval are available in UI. Copy approval preserves private visibility. Forum moves preserve current city by default and validate both destination scopes with from/to audit data. New loan requests/acceptance lock-check published works/active libraries. Database constraints reject null physical-confirmation actors, with native PostgreSQL checks now passing. Canonical review/reading writes share a cycle-free locked redirect helper. The separate native Caddy configuration validates and runs; request/access logging is disabled to avoid retaining headers, callbacks or tokens. Compose execution remains unverified.

The resumed execution found and fixed a PostgreSQL index name colliding with the reserved `session_user` identifier, missing concrete catalogue/statistics query types, and message evidence pagination that lost PostgreSQL timestamp microseconds through JavaScript `Date`. Evidence boundaries now remain in SQL, keeping the selected message out of its own surrounding context.

Browser fixtures now accommodate repeated synthetic logins with a test-only rate budget. Accessible form selectors handle required markers, loan/gift assertions target their own cards, and CMP route mocks wait for in-flight teardown. Production rate limits and protected deployment settings remain unchanged. Native startup copies required static/public assets and resolves storage paths before the standalone server changes its working directory. Generated-artifact checks reject copied private paths, escaping symlinks and configured credentials without exposing values. The live visual review also corrected missing spaces around registration/onboarding policy links.

## Actual verification

- `npm run typecheck` passes against the installed dependencies. The isolated browser production build also completed its TypeScript phase and compiled successfully.
- The final native unit suite passes **77/77**, including build-artifact and PostgreSQL CLI checks, with no failures or skipped tests.
- Real PostgreSQL integration passes **57/57**: 19 authentication/readiness, 35 domain and 3 actual Sharp/image tests. Disposable test databases are separate from preview data.
- Operations checks pass **9/9** against temporary synthetic files, including protected settings, symlink protection and targeted SMTP updates.
- Chromium browser checks pass **17/17** using one worker after one production build. Public/member/admin, upload, physical handover/return/gift, forum, keyboard/no-overflow and private CMP-boundary journeys run at **320/390/768/1440 px**. Screenshots for home, public, member, ad administration and forum are saved under `test-artifacts/browser/`. Mobile and desktop home/member/admin screens were visually inspected. The browser CMP contracts use inert/mock boundaries and do not establish live vendor behavior.
- The live HTTPS browser pass covers **20 pages**: `/`, `/catalog`, `/biblioteci`, `/comunitate` and `/inregistrare` at **320/390/768/1440 px**. All return **200** with no horizontal overflow, page errors, failed requests or external requests. The report separately records **306 cancelled same-origin RSC prefetch requests** caused by deliberate full navigation/context teardown; they are not failed document/API requests. Actual home screens at 390/1440 px, registration/libraries at 390 px and forum at 1440 px were visually inspected, along with the earlier mobile/desktop member/admin/forum fixtures. Evidence is saved in `test-artifacts/live/report.json` and adjacent screenshots.
- Both the isolated browser build and final production preview build pass. The final artifact scan covers **1767 standalone files, 23 browser files and 1172 server files**, with **0 failures**: no detected private paths, escaping links, browser/server credential files, missing artifacts or read failures.
- `python3 scripts/extract-cities.py --self-test` passes **10** synthetic parser/ranking checks. The real official XLSX snapshot is stored with SHA-256 `3a96030d87aec6c1c50f658d5321067d6345e1ab936c5d2854524f972caa75c0`; 25 required geographic decisions are documented. An independent raw-XML audit verified all 50 extracted source IDs, names, populations and coordinates, and regeneration is byte-identical. See `docs/POPULATION_PROVENANCE.md`.
- Strict preview seeding inserts **50 libraries**, then **0** on rerun. Preview data contains **0 members, 0 books and 0 published policies**; synthetic accounts/catalogue/loans stay in isolated test fixtures.
- The native isolated backup/restore roundtrip passes: **1 library, 1 copy, 1 loan, 1 photo record, 8 migrations and 3 image variants**, with exact record/image fingerprints. Source records and image bytes remain unchanged; the generated restore database is cleaned up. `test-results/restore-test.json` records the result. Production recovery, offsite delivery and recovery time are not established.
- Earlier source/policy checks remain supplementary: 55 filesystem/archive/unit assertions, 14 configuration-policy groups, 135 documented configuration keys and source contract checks passed. Mocked signup/SMTP/worker/UI checks retain their stated boundary limits.
- The bounded isolated load harness completes **160 searches and 30 reservation writes with 0 errors**. Search p50/p95 is **16.28/28.07 ms**; write p50/p95 is **26.51/51.72 ms**; load-process RSS is **190 MiB**. Conditions: ARM64, 2 CPUs, 3891 MiB host RAM, pool 2, 60 synthetic works, search concurrency 4 and write concurrency 1. The unit runner overlapped this bounded load. These are local domain measurements excluding HTTP/TLS/browser/worker/PostgreSQL RSS; no production HTTP-capacity claim follows. See `test-results/load-test.json`.
- Apex and `www` DNS resolve to **152.53.12.147**, matching the host. Host-origin requests to HTTPS home and health return **200** with successful TLS verification; HTTP redirects **308**, and HTTPS `www` redirects **301** to the canonical origin. The Let’s Encrypt certificate is valid from **2026-10-09 to 2027-01-07**. The independent web-fetch tool could not access the site, so no independent external-monitor result is claimed.
- Production signup returns **403 / REGISTRATION_DISABLED**. Readiness returns **503**, with the application running but public launch blocked: **7 production blockers, 50 sourced libraries, 0 published policies and 0 verified administrators**. Docker/Compose, offsite recovery and external OAuth/SMTP/CMP integrations remain unverified.

## Population source

The official WUP2025 F21 workbook is available from the UN Population Division and stored under `data/snapshots/` with retrieval metadata and checksum. The extractor uses the actual F21 location and population-weighted-centroid headers, omits blank 2025 rows and converts source thousands to persons reproducibly. The city manifest is verified.

The documented geographic convention uses individual city evidence around the Urals, Caucasus and Turkish Straits; it does not include entire transcontinental countries automatically. Istanbul appears once with its whole-city estimate. Romanian names and aliases retain raw source names in the manifest. The final 50 range from Istanbul to Odesa; București is included.

## Operator updates

The current preview brand is **Biblioteca Diasporenilor**. The intended public domain remains `citimoriunde.eu`; runtime URL stays configurable. `docs/DOMAIN_AND_GOOGLE.md` explains the existing Namecheap A/CNAME instructions and the production Google callback `https://citimoriunde.eu/api/auth/callback/google`, with a separate optional Books API key. DNS and HTTPS now have the measured host-origin results recorded above; actual Google callback/account verification remains pending.

The existing Google fields and Brevo SMTP settings are preserved in the protected environment. Typed readiness reports Google/SMTP configured and registration disabled, with 50 sourced libraries, 0 published policies and 0 verified administrators. Configuration alone does not establish Google account control, valid callbacks or email delivery. The intended administrator remains a bootstrap target, not a fabricated or already-promoted account.

The real `npm run smtp:check` now starts and **fails verification**, with details redacted; protected settings were not changed. The diagnostic sends no mail. SMTP authentication, sender acceptance and actual inbox delivery must pass before delivery attestation is set. Worker shutdown settings and retries do not claim exactly-once provider delivery.

## Remaining work and launch gates

1. Leave the running native application, worker and HTTPS proxy in place. Keep the measured checks and screenshots with the release records; cosmetic policy-link spacing is corrected in source and verified in the rebuilt running preview at all four widths.
2. Verify real Google OAuth against the configured callbacks and prove administrator account control; complete approved onboarding, verified TOTP and protected bootstrap. Preview currently has no verified administrator.
3. Verify Brevo TLS/authentication, sender acceptance and inbox delivery; set SMTP delivery attestation only after evidence. Complete actual operator identity/contact, legal review and initial publication of all eight required policies.
4. Complete offsite backup/recovery and the launch checklist. Docker/Compose and production HTTP/resource capacity still need separate verification. Live CMP/AdSense and optional provider integrations need their own configuration and evidence. Keep public registration closed while any required launch prerequisite remains unresolved.


## Minimal city-first redesign (2026-10-09)

The existing native Next.js application now opens with “Explorează cărți disponibile pentru împrumut în orașul tău.” A city selector and quiet city links replace the title search, illustration, numbered instructions and promotional panels. The catalogue puts city selection before book search, defaults to available books, validates old/invalid city URLs, and preserves location through book links, detail copies and the catalogue breadcrumb. Search controls wait for initial city/session state before accepting input.

Poppins uses the supplied Google Fonts stylesheet and preconnects. Shared styles use white, dark grey and black, with simpler navigation, dividers, forms and footer. UI text and app-managed email/draft-source punctuation no longer use long dashes. CSP admits only the requested Google stylesheet/font hosts while preserving existing script, connection and private-page restrictions. Design followed the published frontend skill and Sites design guidance within the existing native hosting architecture.

The current manifest retains 32 existing EU cities and adds Cluj-Napoca, Iași and Timișoara. Migration 009 keeps historical IDs and references, archives 18 non-EU libraries, adds the three sourced Romanian cities, and enforces EU eligibility for active libraries. Domain requests/approvals/linking and readiness follow the same EU policy and 35-city manifest. The deployed database contains 53 libraries: 35 active and 18 archived, with nine applied migrations and no copies at verification time. Existing account data is preserved.

Actual checks:

- Unit suite: 82/82 passed. Disposable PostgreSQL integration: 62/62 passed, including EU eligibility, migration reruns/alias reuse and manifest-specific readiness. Extractor self-test: 11 checks passed; all 35 selected records match the stored UN snapshot.
- The initial 18-case browser run passed 15 cases, including member/admin, uploads, physical lending/return/gift and forum flows. Three public cases exposed initial search-state timing and a narrow-screen community grid. The targeted rerun confirmed search, city links and consent navigation, while isolating the remaining grid sizing issue. Its grid tracks were then changed to minmax(0,1fr).
- Final production preview and deployed HTTPS browser passes each cover 24 pages: home, catalogue, cities, community, registration and login at 320/390/768/1440px. Search and expanded filters/community controls are exercised. Both passes have zero horizontal overflow, zero page errors and zero ad requests; Poppins actually loads and the body is white. Evidence is under test-artifacts/redesign/preview-report.json and live-report.json with screenshots.
- Final production build and artifact checks pass: 1770 standalone files, 23 browser files, 1181 server files and zero artifact failures. Scoped whitespace checks pass.
- The live library API returns exactly 35 EU cities and all three requested additions. Health returns 200/running:true; application, worker and HTTPS proxy are active. A pre-migration database/image backup is retained at /var/lib/biblioteca/backups/2026-10-09T16-16-47-311Z and the previous runtime at /opt/biblioteca-previous-20261009T161633Z. The temporary local preview was stopped after verification.

Public registration still follows the existing closed service configuration and launch prerequisites. This redesign does not attest provider login/email delivery or legal review. No synthetic accounts or books were added to the deployed database by this work.

## GitHub source export (2026-10-29)

Prepared the complete current source for `https://github.com/DanMGocan/citimoriunde`, including uncommitted implementation files, the dependency lockfile, migrations, tests, operations documentation and required public city reference inputs. The export uses a fresh Git history and does not change the running application or database.

Actual export checks: 199 candidate files passed a redacted credential audit; template credentials are generation markers, placeholders or test fixtures. The protected `.env`, dependencies, build output, database backups, uploaded storage and generated test artifacts are excluded. Copied file SHA-256 hashes match the source files. No application build or database-dependent test was rerun for this source transfer.
