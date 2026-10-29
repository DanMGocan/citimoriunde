# Public launch gates

This is an operator review checklist, not a claim of legal compliance. Keep `REGISTRATION_ENABLED=false` until security/legal/email prerequisites are configured and verified. Optional services stay off until their specific integration and approval work is complete.

The native preview is reachable at https://citimoriunde.eu with a genuine Let's
Encrypt certificate and canonical redirects. Application, worker and Caddy are
enabled and running under dedicated users; the application also listens on
loopback3000 and PostgreSQL remains private. The original `.env` is unchanged.
The preview units force registration disabled independently of that file. Native
build,77 unit,57 integration,17 browser and isolated restore checks pass; source
and the earlier idempotent seed checks covered 50 libraries without demo accounts/books.
The current selection contains 35 EU cities, including Cluj-Napoca, Iași and Timișoara;
migration 009 preserves the history of deactivated non-EU locations. A bounded
domain benchmark and live screen checks are recorded in `TEST_REPORT.md`.
These results leave operator/legal/admin/SMTP/OAuth/offsite and full deployment
review prerequisites outstanding. Health200 and HTTPS availability do not enable
registration. Review [native runtime controls](ops/NATIVE_RUNTIME.md) before any
eventual registration change.

- [ ] Actual2vCPU/4GB/64GB target measured: database/web/worker memory, sequential build peak, free disk, catalogue latency, request/write contention, errors. Record real conditions/results in TEST_REPORT.md.
- [x] Supported dependency pins/lockfile installed, typechecks/unit/integration/browser passed against isolated database; security audit reviewed; mobile320/390/768/1440 and keyboard workflows inspected.
- [ ] Complete sourced 35-city EU manifest/provenance, exact active sourced-city count, clean seed and idempotent upgrade/rerun preserving administrator changes and historical references verified. No public demo users/collections.
- [ ] Private PostgreSQL access and backed-up persistent image/db volumes; nonroot app processes, bounded workers/images, pool caps, log rotation, firewall and existing proxy reviewed without changing SSH.
- [ ] Real DNS/IP for `citimoriunde.eu`, canonical APP_URL, external HTTPS certificate and redirect checks. See docs/DOMAIN_AND_GOOGLE.md. Purchased domain alone is not deployed hosting.
- [ ] Real OAuth Web client with exact callback, minimal identity scopes, provider subject, explicit linking, Google photo rejection; real success/cancel/failure checks. `gocandan@gmail.com` signs in and completes verified TOTP before one-time bootstrap.
- [ ] Admin session step-up enforced for OAuth and local sessions, role/scoped moderation tested, session revocation/reset/logout verified. No default password or provider role claims.
- [ ] Saved Brevo configuration verified with `npm run smtp:check` (no email sent by diagnostic), account-required sender/domain records verified using exact Brevo values, real verification/reset and service notification delivered, retries/failure queue monitored. Set `SMTP_VERIFIED=true` only after real authentication/sender/delivery evidence. Preserve existing mail DNS; standard Brevo authentication does not require adding SPF/MX unless the chosen account setup calls for it. No private message text emailed.
- [ ] Real operator/legal identity, support and illegal-content contact, actual published legal versions, registration acceptance and privacy requests; independent legal review of draft policies. Before the first admin, export all eight drafts with `npm run legal:export -- /absolute/new-review-directory`, review/complete them, configure actual operator/contact values plus `LEGAL_REVIEWED=true`, then use `npm run legal:bootstrap -- /absolute/new-review-directory --confirm-reviewed` while registration remains disabled. The protected command records operator attestation, not independent legal approval.
- [ ] Irish/EU/UK applicability and operator establishment reviewed: GDPR lawful bases/minimisation/processors/international transfers/rights/retention; cookies and electronic marketing; EU DSA classification, notice/action/reasons/appeals/transparency and size-dependent obligations; UK regime where applicable. Do not infer exemptions or duties merely from a checklist.
- [ ] Lending/gifting/copyright and cover-photo/metadata rights reviewed by competent legal advice; no ebook/PDF/copied-text uploads; takedown route tested. Do not claim warranties/insurance/identity checks or disclaim all liability/non-excludable rights.
- [ ] Published safety/meeting and permanent-gift notices checked in Romanian; no public exact addresses/history; blocked active loans have mediated resolution; lost/disputed cases preserve evidence proportionately.
- [ ] Data inventory/processors/retention schedule approved; export excludes other people's private data/internal moderation; deletion retains active-loan/dispute evidence only with reviewed lawful basis/duration and human oversight.
- [ ] Backup complete with images+DB, protected off-server generation, restore drill to a random separate DB/temporary images passed. Production untouched. Recovery ownership and incident contact documented.
- [ ] Monitoring for health vs launch readiness, failed jobs, SMTP delivery, disk/storage quotas, overdue reminders, worker heartbeat and dependency upgrades configured; graceful restart verified.
- [ ] Optional book APIs/Mistral: actual credentials, metadata rights, provider limits/cache/provenance, validated bounded outputs and spending caps. Outage/malicious candidates fall back to deterministic manual selection. No private data sent.
- [ ] Optional AdSense: actual publisher/site approval/client+slot IDs, ads.txt only verified configuration, currently Google-certified CMP chosen; provider bootstrap, consent signals/reject/manage/revoke independently validated. No requests before required consent/after refusal; no ads on private/thin/unreviewed pages; no duplicate slot initialization or accidental control overlap. Analytics/conversion are separate off-default choices.
- [ ] `npm run readiness` reports all gates ready only after the above evidence and actual published document/admin/city checks. Set flags only after reviews, never to hide missing evidence.

Current primary review references: [Irish DPC principles](https://www.dataprotection.ie/en/individuals/data-protection-basics/principles-data-protection), [Irish CCPC unfair terms](https://www.ccpc.ie/consumer-advice/consumer-rights/buying-services/unfair-contract-terms), [European Commission DSA Q&A](https://digital-strategy.ec.europa.eu/en/faqs/digital-services-act-questions-and-answers), [Google CMP requirements](https://support.google.com/adsense/answer/13554116?hl=en). Final classification/legal decisions require actual operator facts and professional review.
