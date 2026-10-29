import { configurationReadiness } from "../lib/config";
import { query } from "../lib/db";
import { initialPolicySlugs } from "../lib/legal-publication.ts";
import cityManifest from "../../data/cities.manifest.json";
import { EU_COUNTRY_CODES } from "./geography.ts";

const initialCitySourceIds = cityManifest.cities.map(city => city.source_id);

export type DatabaseLaunchChecks = {
  publishedPolicies: number;
  sourcedLibraries: number;
  verifiedAdministrators: number;
};
// One bounded query shared by the CLI, public health/readiness projection and
// member/admin integration gates. Unrelated/future/draft policies cannot satisfy
// launch checks; an enabled factor without a verified factor record is insufficient.
export async function databaseLaunchChecks(): Promise<DatabaseLaunchChecks> {
  const result = await query<DatabaseLaunchChecks>(`SELECT
    (SELECT count(DISTINCT slug)::int FROM legal_documents
      WHERE slug=ANY($1) AND NOT is_draft AND published_at IS NOT NULL AND published_at<=now()) AS "publishedPolicies",
    (SELECT count(*)::int FROM libraries WHERE source_id=ANY($2::text[]) AND rank IS NOT NULL
      AND active AND country_code=ANY($3::text[])) AS "sourcedLibraries",
    (SELECT count(*)::int FROM members m JOIN "user" u ON u.id=m.id
      WHERE m.role='ADMIN' AND m.status='ACTIVE' AND m.adult
        AND u."emailVerified" AND u."twoFactorEnabled"
        AND EXISTS(SELECT 1 FROM "twoFactor" t WHERE t."userId"=u.id AND t.verified=true)) AS "verifiedAdministrators"`, [initialPolicySlugs,initialCitySourceIds,EU_COUNTRY_CODES]);
  const checks = result.rows[0];
  if (!checks || ![checks.publishedPolicies, checks.sourcedLibraries, checks.verifiedAdministrators].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Launch database checks are unavailable.");
  return checks;
}
export async function launchReadiness() {
  const checks = await databaseLaunchChecks();
  const configured = configurationReadiness();
  const blockers = [...configured.blockers];
  if (checks.publishedPolicies !== initialPolicySlugs.length) blockers.push("Cele opt documente juridice necesare nu sunt toate publicate și revizuite.");
  if (checks.sourcedLibraries !== initialCitySourceIds.length) blockers.push(`Lista inițială de ${initialCitySourceIds.length} de orașe din Uniunea Europeană nu este încă verificată, încărcată și activă.`);
  if (!checks.verifiedAdministrators) blockers.push("Nu există un administrator adult activ cu email și autentificare în doi pași confirmate.");
  return { readyForPublicLaunch: blockers.length === 0, blockers, checks };
}
