# Working agreement

- Implement the supplied community library brief; preserve existing files and secrets.
- Interface, validation and emails are Romanian. Developer documentation is English.
- Use a modular Next.js/TypeScript monolith, PostgreSQL, Better Auth and bounded workers.
- All environment access belongs in `src/lib/config.ts`; never log credentials or tokens.
- Authorisation and lifecycle rules belong in domain services and database constraints.
- Public data must not expose contact information, messages or exact reading/loan histories.
- Use parameterised SQL, origin checks, bounded inputs and idempotent transactions.
- Production contains no demo members/books. Optional integrations fail closed.
- Run one build/browser worker at a time. Record actual checks and blockers in PROGRESS.md.
- Do not overwrite proxy/SSH settings, use public database ports, or mutate production in tests.
