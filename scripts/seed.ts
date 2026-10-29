import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { pool, transaction } from "../src/lib/db";
import { POLICY_DRAFTS } from "../src/domain/policies";
import { validateCities, type CityManifest, type SeedCity } from "../src/domain/geography";
export { validateCities } from "../src/domain/geography";

export async function seed(allowBlocked = false) {
  const manifest = JSON.parse(await readFile(resolve("data/cities.manifest.json"), "utf8")) as CityManifest;
  let cities: SeedCity[] = [];
  if (manifest.status === "verified") {
    cities = validateCities(manifest);
    const snapshot = resolve(manifest.source_snapshot!);
    if (!relative(resolve("data"), snapshot).startsWith("snapshots/")) throw new Error("Source snapshot must be stored under data/snapshots.");
    const digest = createHash("sha256").update(await readFile(snapshot)).digest("hex");
    if (digest !== manifest.source_sha256) throw new Error("Source snapshot checksum does not match the manifest.");
  } else if (!allowBlocked) {
    validateCities(manifest);
  }
  const counts = await transaction(async client => {
    // Prevent concurrent seeds from colliding while preserving all administrator changes.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('community-library-seed-v1'))");
    let librariesInserted = 0;
    for (const city of cities) {
      const result = await client.query(`INSERT INTO libraries
        (source_id,name,display_name,aliases,country_code,region,latitude,longitude,population,population_year,population_definition,source_url,rank)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [city.source_id,city.name,city.display_name,city.aliases,city.country_code,city.region ?? null,city.latitude,city.longitude,city.population,city.population_year,city.population_definition,city.source_url,city.rank]);
      librariesInserted += result.rowCount ?? 0;
    }
    const categories = [
      ["announcements", "Anunțuri", "Noutăți și anunțuri ale echipei.", 0, true],
      ["rules", "Reguli și ajutor", "Regulile comunității și ajutor pentru folosirea platformei.", 1, true],
      ["reading", "Despre cărți", "Recomandări și discuții despre lectură. Marchează spoilerele.", 2, false],
      ["community", "Viața comunității", "Idei, întâlniri în locuri publice și inițiative ale cititorilor.", 3, false],
      ["families", "Lecturi pentru copii", "Cărți pentru copii și experiențe ale părinților și tutorilor.", 4, false],
    ];
    for (const row of categories) await client.query("INSERT INTO forum_categories(id,title,description,sort_order,announcement) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",row);
    for (const policy of POLICY_DRAFTS) await client.query("INSERT INTO legal_documents(slug,version,title,body,is_draft) VALUES($1,1,$2,$3,true) ON CONFLICT DO NOTHING",[policy.slug,policy.title,policy.body]);
    return { librariesInserted, categories: categories.length, legalDrafts: POLICY_DRAFTS.length, cityManifestStatus: manifest.status };
  });
  if (manifest.status === "blocked") console.warn("City seed BLOCKED. Draft policies and categories seeded; no population ranking or city library was invented.");
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  seed(process.argv.includes("--allow-blocked"))
    .then(result => console.info(JSON.stringify(result)))
    .catch(() => { console.error("Seed failed. Inspect manifest provenance, migrations and database configuration; details are redacted."); process.exitCode = 1; })
    .finally(() => pool.end());
}
