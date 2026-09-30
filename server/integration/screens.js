"use strict";
// Isolated PostgreSQL + real authenticated HTTP requests. No external database.
process.env.DATABASE_URL =
  "postgresql://unused:unused@127.0.0.1/isolated_screens";
process.env.DATABASE_SSL = "false";
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pool } = require("../src/db/pool");
const { todayIso, addDays } = require("../src/lib/dates");
const database = new PGlite({ extensions: { pgcrypto } });
const realEnd = pool.end.bind(pool);
pool.query = (sql, args) => database.query(sql, args);
pool.connect = async () => ({ query: pool.query, release() {} });
const one = async (sql, args) => (await database.query(sql, args)).rows[0];
let server;
async function main() {
  for (const f of fs
    .readdirSync(path.join(__dirname, "../src/db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await database.exec(
      fs.readFileSync(path.join(__dirname, "../src/db/migrations", f), "utf8"),
    );
  const clubs = [];
  for (let i = 0; i < 2; i++) {
    clubs.push(
      await one(
        "INSERT INTO club(name,short_name,club_type) VALUES($1,$2,'Rotating') RETURNING *",
        [`Screen club ${i}`, `SC${i}`],
      ),
    );
    await one(
      `INSERT INTO constitution(club_id,version,effective_date,contribution_amount,cycle_start_date,payout_order_method)
      VALUES($1,1,$2,100,$2,'Negotiated') RETURNING *`,
      [clubs[i].club_id, addDays(todayIso(), -30)],
    );
  }
  const people = [];
  for (let i = 0; i < 6; i++) {
    const user = await one(
      "INSERT INTO user_account(phone,full_name,password_hash,postal_address) VALUES($1,$2,'test','Test town') RETURNING *",
      [`083000000${i}`, `Screen user ${i}`],
    );
    const member = await one(
      "INSERT INTO member(club_id,user_id,role,join_date) VALUES($1,$2,$3,$4) RETURNING *",
      [
        clubs[i === 5 ? 1 : 0].club_id,
        user.user_id,
        [
          "Chairperson",
          "Treasurer",
          "Secretary",
          "Member",
          "Member",
          "Chairperson",
        ][i],
        addDays(todayIso(), -20),
      ],
    );
    const token = crypto.randomBytes(32).toString("hex");
    await database.query(
      "INSERT INTO session(user_id,active_club_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [
        user.user_id,
        member.club_id,
        crypto.createHash("sha256").update(token).digest("hex"),
      ],
    );
    people.push({ user, member, token });
  }
  server = require("../src/app").createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function req(url, who = 0, method = "GET", body) {
    const multipart = body instanceof FormData;
    return fetch(origin + url, {
      method,
      headers: {
        Cookie: `sas_session=${people[who].token}`,
        ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
      },
      body: multipart ? body : body ? JSON.stringify(body) : undefined,
    });
  }
  async function json(url, who, method, body, status = 200) {
    const r = await req(url, who, method, body);
    const d = await r.json();
    assert.equal(r.status, status, JSON.stringify(d));
    return d;
  }
  await json(
    "/api/cycles",
    1,
    "POST",
    { startDate: todayIso(), dueDate: addDays(todayIso(), 7) },
    201,
  );
  const cycle = await json("/api/cycles/current", 1);
  const own = cycle.contributions.find(
    (c) => c.memberId === people[3].member.member_id,
  );
  const another = cycle.contributions.find(
    (c) => c.memberId === people[4].member.member_id,
  );
  const proofPath = `/api/contributions/${own.contributionId}/proof`;
  const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF");
  function form(
    data = pdf,
    type = "application/pdf",
    filename = "payment.pdf",
  ) {
    const f = new FormData();
    f.append("file", new Blob([data], { type }), filename);
    return f;
  }
  await json(proofPath, 1, "POST", form(), 422);
  await json(`/api/contributions/${own.contributionId}/capture`, 1, "POST", {
    amount: 100,
    receiptDate: todayIso(),
    method: "Cash",
  });
  assert.equal((await json(proofPath, 3)).proof, null);
  await json(proofPath, 3, "POST", form(), 403);
  await json(proofPath, 1, "POST", form(Buffer.from("fake")), 400);
  await json(proofPath, 1, "POST", form(Buffer.alloc(0)), 400);
  await json(
    proofPath,
    1,
    "POST",
    form(Buffer.alloc(5 * 1024 * 1024 + 1)),
    400,
  );
  await json(proofPath, 1, "POST", form(), 201);
  assert.equal((await json(proofPath, 3)).proof.filename, "payment.pdf");
  for (const who of [4, 5]) {
    await json(proofPath, who, "GET", undefined, 404);
    await json(proofPath + "/file", who, "GET", undefined, 404);
  }
  const file = await req(proofPath + "/file", 3);
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.equal(file.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
  await json(
    proofPath,
    1,
    "POST",
    form(pdf, "application/pdf", "replacement.pdf"),
    201,
  );
  assert.equal((await json(proofPath, 0)).proof.filename, "replacement.pdf");
  await json(proofPath + "/delete", 0, "POST", {}, 403);
  await json(proofPath + "/delete", 1, "POST", {});
  assert.equal((await json(proofPath, 3)).proof, null);
  await json("/api/contributions/not-an-id/proof", 1, "GET", undefined, 400);
  // Metadata and bytes remain accessible after the cycle closes.
  await json(proofPath, 1, "POST", form(), 201);
  await database.query("UPDATE cycle SET status='Closed' WHERE cycle_id=$1", [
    cycle.cycle.cycleId,
  ]);
  assert.equal(
    (await json(`/api/cycles/${cycle.cycle.cycleId}`, 3)).contributions.length,
    1,
  );
  assert.ok((await json(proofPath, 3)).proof);
  console.log(
    "PASS: proof upload, replace, delete, bytes, limits, captured-only rule, roles and tenant/owner isolation",
  );
  const penalty = await one(
    "INSERT INTO penalty(club_id,member_id,cycle_id,amount,reason) VALUES($1,$2,$3,25,'Late fixture') RETURNING *",
    [clubs[0].club_id, people[3].member.member_id, cycle.cycle.cycleId],
  );
  await require("../src/modules/ledger/ledger.service").appendEntry(
    { query: pool.query },
    {
      clubId: clubs[0].club_id,
      memberId: people[3].member.member_id,
      penaltyId: penalty.penalty_id,
      entryType: "Penalty",
      amount: "25.00",
      description: "Late fixture",
      postedBy: people[1].user.user_id,
    },
  );
  assert.equal(
    (await json("/api/contributions/penalties", 3)).penalties.length,
    1,
  );
  assert.equal(
    (await json("/api/contributions/penalties", 4)).penalties.length,
    0,
  );
  assert.equal(
    (await json("/api/contributions/penalties", 5)).penalties.length,
    0,
  );
  await json(
    "/api/contributions/penalties?status=bad",
    0,
    "GET",
    undefined,
    400,
  );
  await json(
    "/api/contributions/penalties?offset=-1",
    0,
    "GET",
    undefined,
    400,
  );
  const waive = `/api/contributions/penalties/${penalty.penalty_id}/waive`;
  await json(waive, 1, "POST", { reason: "Mistake" }, 403);
  await json(waive, 5, "POST", { reason: "Mistake" }, 404);
  await json(waive, 0, "POST", { reason: "" }, 422);
  await json(waive, 0, "POST", { reason: "Verified incorrect penalty" });
  const waived = (await json("/api/contributions/penalties?status=waived", 0))
    .penalties[0];
  assert.equal(waived.status, "Waived");
  assert.equal(waived.outstandingAmount, "0.00");
  assert.equal(waived.waiverReason, "Verified incorrect penalty");
  assert.equal(
    (await json("/api/contributions/penalties?status=outstanding", 0)).penalties
      .length,
    0,
  );
  await json(waive, 0, "POST", { reason: "Again" }, 422);
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM ledger_entry WHERE penalty_id=$1 AND entry_type='Reversal'",
        [penalty.penalty_id],
      )
    ).n,
    1,
  );
  // Paging is stable and scoped, without truncating away older penalties.
  await database.query(
    "INSERT INTO penalty(club_id,member_id,amount,reason) SELECT $1,$2,1,'Page fixture '||s FROM generate_series(1,51) s",
    [clubs[0].club_id, people[4].member.member_id],
  );
  const first = await json("/api/contributions/penalties", 0),
    second = await json("/api/contributions/penalties?offset=50", 0);
  assert.equal(first.penalties.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(second.penalties.length, 2);
  assert.equal(second.hasMore, false);
  assert.equal(
    new Set([...first.penalties, ...second.penalties].map((p) => p.penaltyId))
      .size,
    52,
  );
  console.log(
    "PASS: paged penalty register, filters, privacy, chair-only waiver, reason and single reversal",
  );
  const queue = await json("/api/queue", 0);
  assert.equal(queue.candidates.length, 5);
  assert.equal((await json("/api/queue", 3)).candidates.length, 0);
  assert.ok(queue.candidates.every((c) => c.fullName));
  const ids = queue.candidates.map((c) => c.memberId).reverse();
  await json("/api/queue/establish", 1, "POST", { order: ids }, 403);
  await json("/api/queue/establish", 0, "POST", {}, 400);
  await json("/api/queue/establish", 0, "POST", { order: ids.slice(1) }, 400);
  await json(
    "/api/queue/establish",
    0,
    "POST",
    { order: [ids[0], ...ids.slice(0, -1)] },
    400,
  );
  await json(
    "/api/queue/establish",
    0,
    "POST",
    { order: [people[5].member.member_id, ...ids.slice(1)] },
    400,
  );
  // A candidate removed after opening the screen makes its submitted order stale.
  await database.query(
    "UPDATE member SET standing='Exited',exit_date=$2 WHERE member_id=$1",
    [people[4].member.member_id, todayIso()],
  );
  await json("/api/queue/establish", 0, "POST", { order: ids }, 400);
  const activeIds = ids.filter((id) => id !== people[4].member.member_id);
  await json("/api/queue/establish", 0, "POST", { order: activeIds });
  assert.deepEqual(
    (await json("/api/queue", 0)).entries.map((e) => e.memberId),
    activeIds,
  );
  console.log(
    "PASS: negotiated candidates, permissions, incomplete/duplicate/foreign/stale order refusal and exact saved order",
  );
  console.log(
    "Screen integration checks passed. No external database was used.",
  );
}
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise((r) => server.close(r));
    await database.close();
    await realEnd();
  });
