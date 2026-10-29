# Native HTTPS service

Caddy 2.11.7 for Linux ARM64 is installed at `/usr/local/bin/caddy`. Its official
release SHA-512 checksum was verified before installation; release provenance
and the local SHA-256 digest are recorded in `CADDY_RELEASE_CHECKSUM.txt`.

The native proxy uses `/etc/citimoriunde/Caddyfile`,
`/etc/systemd/system/citimoriunde-caddy.service` and its own system user and
certificate storage. It does not replace `/etc/caddy/Caddyfile`, read the
application `.env`, or change SSH or other proxy settings.

`Caddyfile.native` serves `citimoriunde.eu`, redirects `www.citimoriunde.eu` to
the canonical HTTPS origin and proxies to the final application at
`127.0.0.1:3000`. Caddy obtains and renews genuine ACME certificates using the
default account configuration; no operator email is invented. The request-body
limit is 16 MB. Runtime and access logs are disabled to avoid retaining headers,
callback URLs or tokens; inspect service status and certificate metadata instead.

Activate only after the final production-built application is running at the
configured loopback address, with public registration disabled. Then run:

```sh
systemctl enable --now citimoriunde-caddy.service
curl --fail --silent --show-error https://citimoriunde.eu/api/health
curl --head --silent --show-error http://citimoriunde.eu/
curl --head --silent --show-error https://www.citimoriunde.eu/
```

Configuration changes require copying the reviewed Caddyfile to the separate
native configuration path, validating it and reloading this service. Its admin
API uses a private Unix socket under `/run/citimoriunde-caddy`; it has no public
TCP admin port. Certificates and private keys remain under
`/var/lib/citimoriunde-caddy`, owned by the service user with restrictive
permissions, outside the repository.

The site can be reachable while launch prerequisites remain incomplete. HTTPS
availability does not attest to SMTP delivery, OAuth callbacks, legal review,
population-source completion, administrator onboarding or public launch readiness.
