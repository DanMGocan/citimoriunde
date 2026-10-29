import { randomUUID } from "node:crypto";
import { config } from "../../src/lib/config";
import { pool, query, transaction } from "../../src/lib/db";
import type { Actor } from "../../src/domain/access";
export function assertIsolatedDatabase() {
  const target = new URL(config.databaseUrl);
  if (config.environment !== "test" || !/^[a-z0-9_]+_test$/.test(decodeURIComponent(target.pathname.slice(1)))) throw new Error("Integration tests require APP_ENV=test and a dedicated *_test database. Refusing to touch this database.");
  if (!config.storagePath.startsWith("/tmp/community-tests-")) throw new Error("Integration tests require harness-managed isolated images in /tmp/community-tests-*.");
}
export async function fixtureMember(options: { id?: string; role?: Actor["role"]; verified?: boolean; adult?: boolean; status?: "ACTIVE"|"SUSPENDED"|"DELETION_PENDING"|"DELETED"; displayName?: string } = {}): Promise<Actor> {
  assertIsolatedDatabase();
  const id = options.id ?? randomUUID();
  const handle = `test_${randomUUID().replaceAll("-", "").slice(0,20)}`;
  const role = options.role ?? "MEMBER", verified = options.verified ?? true, adult = options.adult ?? true, status = options.status ?? "ACTIVE";
  await transaction(async client => {
    await client.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,$4)', [id, options.displayName ?? "Cititor de test", `${handle}@example.invalid`, verified]);
    await client.query('INSERT INTO members(id,display_name,handle,role,adult,status) VALUES($1,$2,$3,$4,$5,$6)', [id, options.displayName ?? "Cititor de test", handle, role, adult, status]);
  });
  return { id, role, verified, adult, active: status === "ACTIVE", homeLibraryId: null, icon: "book", sessionId: `test_${randomUUID()}`, stepUp: true };
}
export async function fixtureLibrary(): Promise<string> {
  assertIsolatedDatabase();
  const name = `Localitate sintetică ${randomUUID()}`;
  return (await query("INSERT INTO libraries(name,display_name,country_code) VALUES($1,$1,'RO') RETURNING id", [name])).rows[0].id;
}
export async function closeTestPool() { await pool.end(); }
