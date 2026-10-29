# Seed data

`cities.manifest.json` is the **verified** source of truth for the 35 initial EU libraries: the 32 EU cities retained from the earlier Europe list, plus Cluj-Napoca, Iași and Timișoara. Population and centroid values come from the checked-in UN WUP2025 F21 workbook; see `docs/POPULATION_PROVENANCE.md` for source, licence and reproduction commands.

`eu-countries.json` records the 27 allowed member-country codes, the UN M49 mapping and the official EU membership source checked on 2026-10-09. The extractor and domain validation share this policy. `geography-review.json` records the explicit retained/added source-ID selection and Romanian labels/aliases. Earlier continental-boundary evidence remains for historical provenance and is not an admission rule.

`migrations/009_eu_city_scope.sql` upgrades existing databases without deleting member, copy or loan history. Apply normal migrations before seeding or deploying the new eligibility rule. The database never needs a live population or EU-membership API.

Keep the exact XLSX under `snapshots/`, its manifest checksum and selection evidence together. Never store member/contact data, credentials or demo book collections in this directory.
