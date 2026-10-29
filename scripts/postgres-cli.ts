// Keep native utilities aligned with node-postgres URL query precedence.
// Passwords are returned separately for PGPASSWORD, never placed in command argv.
export function postgresCliConnection(databaseUrl: string, databaseName?: string) {
  const db = new URL(databaseUrl);
  const host = db.searchParams.get("host") || decodeURIComponent(db.hostname.replace(/^\[(.+)\]$/, "$1"));
  const port = db.searchParams.get("port") || db.port || "5432";
  const user = db.searchParams.get("user") || decodeURIComponent(db.username);
  const password = db.searchParams.get("password") || decodeURIComponent(db.password);
  const database = databaseName ?? decodeURIComponent(db.pathname.slice(1));
  return { args: ["-h", host, "-p", port, "-U", user, "-d", database], password };
}
