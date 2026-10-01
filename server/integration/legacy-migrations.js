"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const { pool } = require("../src/db/pool");
const { up } = require("../src/db/migrate");
const { adoptExisting } = require("../src/db/legacy-migrations");
const db = new PGlite({ extensions: { pgcrypto } });
const realEnd = pool.end.bind(pool);
// pg accepts multi-statement unparameterised migrations; emulate its simple-query path.
pool.query = async (sql, args) =>
  args ? db.query(sql, args) : (await db.exec(sql)).at(-1);
pool.connect = async () => ({ query: pool.query, release() {} });
async function main() {
  const directory = path.join(__dirname, "../src/db/migrations");
  const files = fs
    .readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  await db.exec(
    "CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  for (const filename of files.filter((f) => f < "022")) {
    await db.exec(fs.readFileSync(path.join(directory, filename), "utf8"));
    await db.query("INSERT INTO schema_migrations(filename) VALUES($1)", [
      filename,
    ]);
  }
  assert.equal(await adoptExisting(db, "022_notifications.sql"), false);
  assert.equal(await adoptExisting(db, "023_standing_engine.sql"), false);
  // Simulate teammates' already-applied migrations under their old filenames.
  for (const filename of ["022_notifications.sql", "023_standing_engine.sql"]) {
    await db.exec(fs.readFileSync(path.join(directory, filename), "utf8"));
    await db.query("INSERT INTO schema_migrations(filename) VALUES($1)", [
      filename.replace(/^\d+/, "016"),
    ]);
  }
  const club = (
    await db.query(
      "INSERT INTO club(name,short_name,club_type) VALUES('Existing club','EX','Rotating') RETURNING club_id",
    )
  ).rows[0];
  const user = (
    await db.query(
      "INSERT INTO user_account(phone,full_name,password_hash,postal_address) VALUES('0830000000','Existing person','unused','Test') RETURNING user_id",
    )
  ).rows[0];
  await db.query(
    "INSERT INTO notification(club_id,sent_by,title,message) VALUES($1,$2,'Keep me','Existing notification')",
    [club.club_id, user.user_id],
  );
  await db.exec("DROP INDEX notification_club_idx");
  await assert.rejects(up(), /differs in indexes/);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM schema_migrations WHERE filename='022_notifications.sql'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("SELECT message FROM notification")).rows[0].message,
    "Existing notification",
  );
  await db.exec(
    "CREATE INDEX notification_club_idx ON notification(club_id,created_at DESC)",
  );
  await up();
  const after = (
    await db.query(
      "SELECT filename,applied_at FROM schema_migrations ORDER BY filename",
    )
  ).rows;
  for (const filename of files)
    assert(after.some((r) => r.filename === filename));
  assert(after.some((r) => r.filename === "016_notifications.sql"));
  assert(after.some((r) => r.filename === "016_standing_engine.sql"));
  await up();
  assert.deepEqual(
    (
      await db.query(
        "SELECT filename,applied_at FROM schema_migrations ORDER BY filename",
      )
    ).rows,
    after,
  );
  assert.equal(
    (await db.query("SELECT message FROM notification")).rows[0].message,
    "Existing notification",
  );
  await db.exec("DROP TRIGGER standing_change_no_update ON standing_change");
  await assert.rejects(
    adoptExisting(db, "023_standing_engine.sql"),
    /differs in triggers/,
  );
  console.log(
    "PASS: existing teammate schemas verified and registered; old migration history and notification data retained; mismatch refuses without registration; repeat migration is a no-op.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
    await realEnd();
  });
