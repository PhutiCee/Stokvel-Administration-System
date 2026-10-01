"use strict";
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
for (const timezone of [
  "UTC",
  "Africa/Johannesburg",
  "America/Los_Angeles",
  "Asia/Kolkata",
]) {
  test(`Calendar dates and SA instants on a ${timezone} host`, () => {
    const source = JSON.stringify(
      path.resolve(__dirname, "../../web/lib/format.js"),
    );
    const script = `import fs from 'node:fs';import assert from 'node:assert/strict';
    const f=await import('data:text/javascript;base64,'+fs.readFileSync(${source}).toString('base64'));
    assert.equal(f.fmtDate('2026-09-30'),'30 Sep 2026');
    assert.equal(f.fmtDateShort('2026-01-01'),'1 Jan');
    assert.equal(f.fmtDateTime('2026-09-29T22:15:00Z'),'30 Sep 2026, 00:15');
    assert.equal(f.todayIso(new Date('2026-12-31T22:01:00Z')),'2027-01-01');
    assert.equal(f.fmtDate(null),'—');`;
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: timezone },
    });
  });
}
