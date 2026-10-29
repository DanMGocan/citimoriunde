import test from "node:test";
import assert from "node:assert/strict";
import { postgresCliConnection } from "../../scripts/postgres-cli";

test("native PostgreSQL tools use the URL query Unix socket and connection overrides", () => {
  const db = postgresCliConnection("postgresql://url_user:url_secret@localhost:5432/community_test?host=%2Fvar%2Frun%2Fpostgresql&port=5433&user=socket_user&password=socket_secret");
  assert.deepEqual(db.args, ["-h", "/var/run/postgresql", "-p", "5433", "-U", "socket_user", "-d", "community_test"]);
  assert.equal(db.password, "socket_secret");
  assert.ok(!db.args.includes(db.password));
});

test("native PostgreSQL tools decode URL credentials/database and replace only the restore target", () => {
  const url = "postgresql://test%20user:synthetic%20secret@[::1]:5434/community%5Ftest";
  assert.deepEqual(postgresCliConnection(url).args, ["-h", "::1", "-p", "5434", "-U", "test user", "-d", "community_test"]);
  const target = postgresCliConnection(url, "restore_test_123");
  assert.equal(target.args.at(-1), "restore_test_123");
  assert.equal(target.password, "synthetic secret");
});
