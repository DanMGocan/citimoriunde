import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config";
const globalDb = globalThis as unknown as { communityPool?: Pool };
export const pool = globalDb.communityPool ?? new Pool({
  connectionString: config.databaseUrl, max: config.dbPoolMax, idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, statement_timeout: config.dbStatementTimeoutMs,
  application_name: "community-library",
});
if (config.environment !== "production") globalDb.communityPool = pool;
pool.on("error", () => { console.error("Database connection failed; details redacted."); });
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
