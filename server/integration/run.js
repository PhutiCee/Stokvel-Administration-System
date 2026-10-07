"use strict";
// Each suite creates its own isolated in-memory database. Never reset the user's database.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
for (const file of [
  "legacy-migrations",
  "completion",
  "review-fixes",
  "exit-writeoffs",
  "governance",
  "screens",
  "ledger-reversals",
  "source-compensation",
]) {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, file + ".js")],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
