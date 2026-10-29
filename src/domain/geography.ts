import countries from '../../data/eu-countries.json';

export const EU_COUNTRY_CODES: readonly string[] = countries.member_country_codes;
const euCountries = new Set(EU_COUNTRY_CODES);

export function isEuCountry(countryCode: unknown): countryCode is string {
  return typeof countryCode === 'string' && euCountries.has(countryCode);
}

export type SeedCity = {
  source_id: string; name: string; display_name: string; aliases: string[];
  country_code: string; region?: string; latitude: number; longitude: number;
  population: number; population_year: number; population_definition: string;
  source_url: string; retrieval_date: string; rank: number;
};

export type CityManifest = {
  status: 'verified' | 'blocked'; reason?: string; geography_scope?: string;
  source_snapshot: string | null; source_sha256: string | null; source_url: string;
  retrieval_date: string | null; reference_year: number; cities: SeedCity[];
  selection?: { retained_source_ids: string[]; added_source_ids: string[] };
};

const addedRomanianCities = ['un-wup2025-city:948', 'un-wup2025-city:2553', 'un-wup2025-city:262'];

export function validateCities(manifest: CityManifest) {
  if (manifest.status !== 'verified') throw new Error('Initial city seed blocked: official source snapshot and extraction are not verified. See docs/POPULATION_PROVENANCE.md.');
  if (manifest.geography_scope !== 'EU' || manifest.reference_year !== 2025 || manifest.cities.length !== 35) throw new Error('The sourced manifest must contain the 32 retained EU cities and the three requested Romanian cities for 2025.');
  if (!manifest.source_sha256 || !/^[a-f0-9]{64}$/.test(manifest.source_sha256) || !manifest.source_snapshot || !manifest.retrieval_date) throw new Error('Missing source snapshot, checksum or retrieval date.');
  const retained = manifest.selection?.retained_source_ids ?? [];
  const added = manifest.selection?.added_source_ids ?? [];
  const selected = new Set([...retained, ...added]);
  if (retained.length !== 32 || added.length !== 3 || selected.size !== 35 || !addedRomanianCities.every(id => added.includes(id))) throw new Error('The documented city selection must preserve the original EU subset and include Cluj-Napoca, Iași and Timișoara.');
  const identifiers = new Set<string>();
  let previous = Number.MAX_SAFE_INTEGER;
  for (const [index, city] of manifest.cities.entries()) {
    if (!/^un-wup2025-city:\d+$/.test(city.source_id) || identifiers.has(city.source_id) || !selected.has(city.source_id)) throw new Error('Repeated, missing or unselected stable source identifier.');
    identifiers.add(city.source_id);
    if (city.rank !== index + 1 || !Number.isSafeInteger(city.population) || city.population <= 0 || city.population > previous) throw new Error('Invalid ranking/population order.');
    previous = city.population;
    if (city.population_year !== 2025 || !isEuCountry(city.country_code) || !city.name || !city.display_name || !Array.isArray(city.aliases)) throw new Error('Incomplete city metadata or city outside the European Union.');
    if (addedRomanianCities.includes(city.source_id) && city.country_code !== 'RO') throw new Error('The requested Romanian cities must retain their source country.');
    if (!Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90 || !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180) throw new Error('Invalid source coordinates.');
    if (!city.population_definition || !city.source_url.startsWith('https://population.un.org/wup/') || city.retrieval_date !== manifest.retrieval_date) throw new Error('Missing consistent source provenance.');
  }
  return manifest.cities;
}
