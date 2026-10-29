# Domain, Google login and optional Google Books

No DNS values, external approval or legal identity have been fabricated. Google OAuth configuration and Brevo SMTP credentials have been supplied in the protected local `.env`; neither integration has been verified end to end. `APP_URL` is still `http://localhost:3000`, and public registration remains disabled. The purchased domain is used in these setup instructions; application branding and URLs remain environment configuration.

## Point citimoriunde.eu to the VPS

1. Obtain the **actual public IPv4 address of the intended VPS** from the hosting control panel. The agent's development VM/private address is not automatically a suitable hosting address.
2. In Namecheap: **Domain List → Manage → Advanced DNS → Host Records**. These controls apply when the domain uses Namecheap BasicDNS/PremiumDNS/FreeDNS. If nameservers point elsewhere, edit the authoritative DNS provider instead. Preserve existing MX/TXT and unrelated records.
3. Create/update only the website records:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `@` | actual VPS public IPv4 | Automatic |
| CNAME | `www` | `citimoriunde.eu` | Automatic |

Remove conflicting parking/redirect/A/CNAME records **for these website hosts only**. Add AAAA only when the VPS has working public IPv6 and the proxy/firewall handles it; an incorrect AAAA can break visits. DNS does not use a URL, scheme, path or port as the A record value.

4. Confirm DNS from an external network: `dig +short citimoriunde.eu A` and `dig +short www.citimoriunde.eu`. Allow propagation; check actual results rather than waiting a fixed interval and assuming success.
5. Reserve external TCP ports 80/443 for this site's proxy and UDP443 for optional HTTP/3. Leave database port5432 private. Preserve SSH access and any existing websites/proxy configuration. If another proxy owns80/443, add this host to that existing proxy under operator control instead of overwriting it.
6. Set `.env`: `APP_ENV=production`, `APP_URL=https://citimoriunde.eu`, `SITE_DOMAIN=citimoriunde.eu`, `TLS_EMAIL=<actual monitored email>`, plus all launch settings. Keep `REGISTRATION_ENABLED=false`.
7. Deploy the production Compose override as described in README. Caddy will request a certificate only after DNS and inbound reachability work. Verify `curl -I https://citimoriunde.eu/api/health` and certificate hostname/chain from outside the VPS. **HTTPS is not claimed working before this check.**

The production Caddyfile serves configured `SITE_DOMAIN` and redirects `www.<SITE_DOMAIN>` to configured `APP_URL`, preserving the path. Set `SITE_DOMAIN` to the apex host, configure the shown www CNAME, and verify HTTPS/redirects for both names. Do not advertise either host before those checks. OAuth uses the single canonical apex callback.

Source: [Namecheap A-record setup](https://www.namecheap.com/support/knowledgebase/article.aspx/319/2237/how-can-i-set-up-an-a-address-record-for-my-domain/).

## Google sign-in: OAuth client, not an API key

1. Open [Google Cloud Console](https://console.cloud.google.com/) with the account that will own the integration. Create/select a project.
2. In **Google Auth Platform**, configure Branding with the actual app label, support email, homepage, privacy and terms URLs. Configure Audience as External for a public community service; while testing, add the designated administrator's Google account as a test user. Meet any Google verification/domain requirements shown by the console.
3. In **Clients**, create an **OAuth client ID → Web application**. Older console layouts put this under APIs & Services → Credentials.
4. Add the exact redirect URI used by the running application:

| Environment | Authorized JavaScript origin | Authorized redirect URI |
|---|---|---|
| Native localhost preview | `http://localhost:3000` | `http://localhost:3000/api/auth/callback/google` |
| Compose localhost preview | `http://localhost:8080` | `http://localhost:8080/api/auth/callback/google` |
| Production apex | `https://citimoriunde.eu` | `https://citimoriunde.eu/api/auth/callback/google` |

Use separate development and production OAuth clients. Origins contain no path. Redirects must match scheme, hostname, port and path exactly. Accessing a preview through an IP address or SSH-forwarded URL does not change the registered callback automatically. Google generally requires HTTPS for non-localhost web redirect URIs.

5. Store the issued client ID in `GOOGLE_CLIENT_ID` and client secret in `GOOGLE_CLIENT_SECRET` inside `.env` mode0600. Never put the secret in this document, Git, a browser field, chat, a client bundle or shell command history. Both blank cleanly disables the Google option; a partial pair fails configuration validation.
6. Request identity scopes only: `openid`, `email`, `profile`. There is no Gmail/Drive/calendar access. The built-in provider handles the authorization-code exchange and provider subject ID. The application discards provider pictures and uses its built-in icon collection.
7. Restart/recreate web and worker after configuration. Test real sign-in, logout, denied-consent and callback mismatch. Existing local accounts with the same email are **not silently linked**. Log in through the existing method, reauthenticate, then explicitly connect Google in account settings.
8. For admin: complete initial reviewed-policy publication with the protected `legal:export` / `legal:bootstrap` commands in README first. Sign in with the Google account designated by `ADMIN_BOOTSTRAP_EMAIL`, accept published policies and the adult/profile declaration, enable TOTP in settings and verify the authenticator code. Run the one-time local admin bootstrap command. No placeholder account/password is created. A fresh TOTP step-up is required for production administrative domain actions, including OAuth sessions.

Sources: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Better Auth Google configuration](https://better-auth.com/docs/authentication/google), [explicit account linking](https://better-auth.com/docs/concepts/users-accounts), [TOTP and passwordless enrolment](https://better-auth.com/docs/plugins/2fa).

## Optional Google Books API key

Google Books metadata lookup is independent of Google login. In the same or a separate Cloud project, enable **Books API** in API Library, then Credentials → Create credentials → API key. Restrict the key to **Books API** and, for this server-side integration, the actual VPS egress IP when available; browser referrer restrictions are not suitable for server calls. Configure a conservative quota/budget alert. Set `GOOGLE_BOOKS_API_KEY` and `GOOGLE_BOOKS_ENABLED=true` only after the provider contract tests and actual lookup work.

Local catalogue search and manual Romanian/bilingual entry require no external API. Provider results are bibliographic suggestions, with provenance and edition selection; lookup is not a licence to copy a cover. Check [Google Books API usage](https://developers.google.com/books/docs/v1/using) and relevant terms before caching/displaying provider material. Do not enable an integration solely because a key was issued.

## Brevo SMTP: configured locally, delivery unverified

The following non-secret settings are saved locally. The operator supplied the sender as verified; sender/domain status has not been independently checked by this application.

| Setting | Current value |
|---|---|
| `MAIL_MODE` | `smtp` |
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` — use STARTTLS on the submission connection |
| `SMTP_REQUIRE_TLS` | `true` — refuse a connection without the TLS upgrade |
| `SMTP_FROM` | `citimoriunde <contact@citimoriunde.eu>` |

Authentication values remain solely in `.env` mode0600 and are omitted here. Brevo documents this relay and port587 with STARTTLS. [Brevo Node SMTP example](https://developers.brevo.com/docs/node-smtp-relay-example), [Brevo SMTP transport settings](https://developers.brevo.com/docs/supabase-smtp-integration).

No email has been sent. The dependency runner is unavailable, and this VM's DNS lookup failed with `EAI_AGAIN`; SMTP connection, TLS negotiation, authentication, sender acceptance and delivery remain unverified. Once dependencies and network access work, run `npm run smtp:check`. That command verifies the connection/TLS/authentication without sending email; it does not prove inbox delivery. After the production URL and sender/domain checks are ready, test actual verification and password-reset messages to operator-controlled recipients, check received headers and spam placement, and record the result. Keep public registration disabled until these checks and the other launch prerequisites pass. Leave `SMTP_VERIFIED=false` until real authentication, sender acceptance and delivery evidence has been recorded; `smtp:check` never sets this attestation. Before sending public-service links, change `APP_URL` to the verified HTTPS deployment URL and restart web/worker; the current localhost URL is unsuitable for public recipients.

In Brevo, open **Settings → Senders, Domains, IPs → Domains** and inspect the exact records for `citimoriunde.eu`. Copy account-specific record names, types and values into the authoritative DNS provider; never invent SPF/DKIM/DMARC values. The standard domain-authentication flow uses a Brevo verification code, DKIM and DMARC; Brevo says SPF/MX records are not required for that flow and are supplied for dedicated-IP setup. If your selected setup requires SPF, use the exact Brevo-provided value and coordinate with existing senders. Preserve existing MX records, avoid duplicate SPF/DMARC records, and review existing DMARC policy before any replacement. Verify domain status in Brevo after adding the required records. [Brevo domain authentication and DNS requirements](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC), [current guided domain setup](https://help.brevo.com/hc/en-us/articles/35337929909778-Set-up-your-domain-in-Brevo).

The worker's notification emails omit private-message bodies. Declaring Brevo in the processor register and reviewing the applicable DPA, retention and tracking configuration remain operator tasks; see [PRIVACY.md](PRIVACY.md). Setting `MAIL_MODE=disabled` stops sending without fabricating verification or exposing tokens.

## Optional services

Mistral requires an actual account/API key and budget; set it only after bounded, bibliographic-only structured extraction is validated. `MISTRAL_MAX_REQUEST_COST_CENTS=0` leaves paid calls disabled; set a conservative per-request upper bound using the chosen model's actual published price and bounded tokens. S3 requires actual endpoint/bucket credentials and a supported adapter; local disk is the initial storage path.

AdSense requires actual site approval, publisher and numeric placement IDs plus a currently Google-certified CMP. The implemented CMP seam supports Cookiebot only: set `CMP_PROVIDER=cookiebot`, `CMP_SCRIPT_URL=https://consent.cookiebot.com/uc.js`, and the real Cookiebot domain-group UUID in `CMP_PUBLISHER_ID`. Configure the domain group and IAB integration in the vendor console, verify its current certification and applicable signals, then explicitly enable `CMP_CSP_ENABLED`, `CMP_CERTIFIED` and `CMP_VALIDATED` after testing. The vendor bootstrap may load its consent interface before an advertising choice; no advertising/analytics request is authorized by bootstrap alone. Inspect accept/reject/manage/revoke behavior from actual fresh browsers before enabling live slots. An internal preference button is not a replacement for a certified CMP. See [Cookiebot developer documentation](https://www.cookiebot.com/en/developer/) and [Google CMP requirements](https://support.google.com/adsense/answer/13554116?hl=en). Analytics and Google Ads conversion tracking are separate opt-ins, disabled by default.

If optional Google measurement is later approved, disable GA4 enhanced measurement/automatic history-based pageviews and verify the actual stream configuration first. The app emits only manual coarse public-path pageviews, without search queries, member/book IDs, contact data or private page titles; it sends no automatic conversion event. Disable automatic Google Ads remarketing, enhanced conversions and any account rules that collect extra identifiers before enabling its separate flag. `GOOGLE_ADS_CONVERSION_LABEL` must come from a real reviewed conversion definition; configuring it alone does not emit an event. Keep off/placeholder modes free of both ad and measurement calls. Test fresh consent/refusal/revocation and client navigation against real vendor behavior before turning on either integration. Sources: [GA4 manual views](https://developers.google.com/analytics/devguides/collection/ga4/views), [gtag configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config), [consent configuration](https://developers.google.com/tag-platform/security/guides/consent).

To edit protected deployment settings on this VM: `vi /root/biblioteca/.env` (press `i`, edit, then `Esc`, `:wq`, Enter). No running web/worker exists here yet; after actual deployment use the documented restart/recreate procedure. Do not paste credential values into chat.
