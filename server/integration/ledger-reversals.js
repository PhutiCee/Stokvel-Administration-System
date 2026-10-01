"use strict";
// Isolated PostgreSQL + real authenticated HTTP requests. No external database.
process.env.DATABASE_URL =
  "postgresql://unused:unused@127.0.0.1/isolated_reversals";
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

  const ledger = require("../src/modules/ledger/ledger.service");
  const reversalService = require("../src/modules/ledger/reversals.service");
  const reversalRepo = require("../src/modules/ledger/reversals.repo");
  const { forClub } = require("../src/db/pool");
  let payoutCycle=0;
  async function entry(type, amount, club = 0) {
    let payoutId=null;
    if(['Payout','Claim'].includes(type)) {
      const memberId=people[3].member.member_id;
      await database.query('UPDATE member SET queue_position=1 WHERE member_id=$1',[memberId]);
      const cycle=await one(`INSERT INTO cycle(club_id,sequence_number,start_date,due_date,status) VALUES($1,$2,$3,$3,'Closed') RETURNING cycle_id`,[clubs[0].club_id,++payoutCycle,todayIso()]);
      const p=await one(`INSERT INTO payout(club_id,member_id,payout_type,status,amount,cycle_id,constitution_version,eligibility_rule_applied,assessment_at_initiation,assessment_at_approval,initiated_by,approved_by,approved_at) VALUES($1,$2,'Rotation','Approved',$3,$4,1,'Fixture','{}','{}',$5,$6,now()) RETURNING payout_id`,[clubs[0].club_id,memberId,String(-Number(amount)),cycle.cycle_id,people[1].user.user_id,people[0].user.user_id]);
      payoutId=p.payout_id;
    }
    const result=await ledger.appendEntry(
      { query: pool.query },
      {
        clubId: clubs[club].club_id,
        memberId: people[club === 0 ? 3 : 5].member.member_id,
        entryType: type,
        amount,
        description: "Reversal integration " + type,
        payoutId,
        postedBy: people[1].user.user_id,
      },
    );
    if(payoutId)await require('../src/modules/ledger/compensation.repo').recordPayout(forClub(clubs[0].club_id),result.entryId,payoutId,[people[3].member.member_id],[people[3].member.member_id]);
    return result;
  }
  const fund = await entry("Adjustment", "1000.00");
  const reverseUrl = (id) => `/api/ledger/${id}/reverse`;
  const decision = (id) => `/api/ledger/reversals/${id}/decision`;
  const post = (id) => `/api/ledger/reversals/${id}/post`;
  await json(
    reverseUrl(fund.entryId),
    0,
    "POST",
    { reason: "Correct error" },
    403,
  );
  await json(
    reverseUrl(fund.entryId),
    3,
    "POST",
    { reason: "Correct error" },
    403,
  );
  await json(reverseUrl(fund.entryId), 1, "POST", { reason: " " }, 400);
  const foreign = await entry("Adjustment", "10.00", 1);
  await json(
    reverseUrl(foreign.entryId),
    1,
    "POST",
    { reason: "Correct error" },
    404,
  );
  await json(
    "/api/ledger/not-an-id/reverse",
    1,
    "POST",
    { reason: "Correct error" },
    400,
  );
  const direct = await json(
    reverseUrl(fund.entryId),
    1,
    "POST",
    { reason: "Correction of duplicate deposit" },
    201,
  );
  assert.equal(direct.status, "Posted");
  const opposing = await one("SELECT * FROM ledger_entry WHERE entry_id=$1", [
    direct.posted_entry_id,
  ]);
  assert.equal(opposing.amount, "-1000.00");
  assert.equal(opposing.reverses_id, fund.entryId);
  assert.equal((await json("/api/ledger/pool", 1)).balance, "0.00");
  await json(
    reverseUrl(fund.entryId),
    1,
    "POST",
    { reason: "Duplicate reversal" },
    422,
  );
  await json(
    reverseUrl(direct.posted_entry_id),
    1,
    "POST",
    { reason: "Reverse a reversal" },
    422,
  );
  const book = await json("/api/ledger", 1);
  assert.equal(
    book.entries.find((e) => e.entryId === fund.entryId).reversedBy,
    direct.posted_entry_id,
  );
  await assert.rejects(
    database.query("UPDATE ledger_entry SET amount=0 WHERE entry_id=$1", [
      fund.entryId,
    ]),
  );
  const payout = await entry("Payout", "-250.00");
  const pending = await json(
    reverseUrl(payout.entryId),
    1,
    "POST",
    { reason: "Bank rejected the payout" },
    201,
  );
  assert.equal(pending.status, "Pending");
  await json(post(pending.request_id), 1, "POST", {}, 422);
  await json(
    decision(pending.request_id),
    1,
    "POST",
    { decision: "approve" },
    403,
  );
  await json(
    decision(pending.request_id),
    5,
    "POST",
    { decision: "approve" },
    404,
  );
  await json(
    decision(pending.request_id),
    0,
    "POST",
    { decision: "reject", reason: "" },
    400,
  );
  await json(decision(pending.request_id), 0, "POST", { decision: "approve" });
  assert.equal((await json("/api/ledger/pool", 1)).balance, "-250.00");
  await json(post(pending.request_id), 0, "POST", {}, 403);
  const done = await json(post(pending.request_id), 1, "POST", {});
  assert.equal(done.status, "Posted");
  assert.equal((await json("/api/ledger/pool", 1)).balance, "0.00");
  await json(post(pending.request_id), 1, "POST", {}, 422);
  // Rejection/retry is shared; the full burial claim lifecycle is in source-compensation.js.
  const claim = await entry("Payout", "-30.00");
  const rejected = await json(
    reverseUrl(claim.entryId),
    1,
    "POST",
    { reason: "Check claim correction" },
    201,
  );
  await json(decision(rejected.request_id), 0, "POST", {
    decision: "reject",
    reason: "Supporting bank evidence missing",
  });
  await json(post(rejected.request_id), 1, "POST", {}, 422);
  const retry = await json(
    reverseUrl(claim.entryId),
    1,
    "POST",
    { reason: "New supporting bank evidence" },
    201,
  );
  assert.notEqual(retry.request_id, rejected.request_id);
  await assert.rejects(
    ledger.appendEntry(
      { query: pool.query },
      {
        clubId: clubs[0].club_id,
        memberId: people[3].member.member_id,
        entryType: "Reversal",
        amount: "30.00",
        reversesId: claim.entryId,
        reason: retry.reason,
        description: "Bypass approval",
        postedBy: people[1].user.user_id,
      },
    ),
    /approval/,
  );
  await assert.rejects(
    database.query(
      "UPDATE ledger_reversal_request SET reason='tamper' WHERE request_id=$1",
      [retry.request_id],
    ),
    /cannot be edited/,
  );
  await assert.rejects(
    database.query("DELETE FROM ledger_reversal_request WHERE request_id=$1", [
      retry.request_id,
    ]),
    /cannot be deleted/,
  );
  const adjustment = await entry("Adjustment", "20.00");
  const ctx = {
    actor: { role: "Treasurer", userId: people[1].user.user_id },
    audit: async () => {},
  };
  const realPosted = reversalRepo.posted;
  reversalRepo.posted = async () => {
    throw new Error("forced rollback");
  };
  await assert.rejects(
    reversalService.reverse(
      forClub(clubs[0].club_id),
      adjustment.entryId,
      { reason: "Rollback check" },
      ctx,
    ),
    /forced rollback/,
  );
  reversalRepo.posted = realPosted;
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM ledger_entry WHERE reverses_id=$1",
        [adjustment.entryId],
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM ledger_reversal_request WHERE entry_id=$1",
        [adjustment.entryId],
      )
    ).n,
    0,
  );
  const badOriginal = await entry("Adjustment", "12.00");
  await assert.rejects(
    ledger.appendEntry(
      { query: pool.query },
      {
        clubId: clubs[0].club_id,
        memberId: people[3].member.member_id,
        entryType: "Reversal",
        amount: "-11.00",
        reversesId: badOriginal.entryId,
        reason: "Wrong amount",
        description: "Invalid reversal",
        postedBy: people[1].user.user_id,
      },
    ),
    /exactly oppose/,
  );
  await assert.rejects(
    ledger.appendEntry(
      { query: pool.query },
      {
        clubId: clubs[1].club_id,
        memberId: people[5].member.member_id,
        entryType: "Reversal",
        amount: "-12.00",
        reversesId: badOriginal.entryId,
        reason: "Wrong tenant",
        description: "Invalid reversal",
        postedBy: people[1].user.user_id,
      },
    ),
    /exactly oppose/,
  );
  const penalty = await entry("Penalty", "5.00");
  await json(
    reverseUrl(penalty.entryId),
    1,
    "POST",
    { reason: "Use dedicated waiver" },
    422,
  );
  assert.equal((await json("/api/ledger/reversals", 5)).requests.length, 0);
  await json("/api/ledger/reversals", 3, "GET", undefined, 403);
  const audits = await one(
    "SELECT count(*)::int AS n FROM audit_log WHERE club_id=$1 AND action LIKE 'ledger.reverse%'",
    [clubs[0].club_id],
  );
  assert.ok(audits.n >= 10);
  console.log(
    "PASS: Treasurer-only reversal; payout approval before posting; equal/opposite, immutable history, duplicate/tenant refusals, rejection/retry, database guards and atomic rollback",
  );
  // Date handling: exact DATE wire strings, SA midnight and invalid input refusals.
  assert.equal(
    require("pg").types.getTypeParser(1082)("2026-09-30"),
    "2026-09-30",
  );
  assert.equal(todayIso(new Date("2026-09-29T22:01:00Z")), "2026-09-30");
  await json("/api/cycles", 1, "POST", { startDate: "2026-02-30" }, 400);
  await json(
    "/api/cycles",
    1,
    "POST",
    { startDate: todayIso(), dueDate: addDays(todayIso(), 7) },
    201,
  );
  const current = await json("/api/cycles/current", 1);
  assert.equal(current.cycle.startDate, todayIso());
  const member = await json(
    `/api/ledger/statement/${people[3].member.member_id}`,
    0,
  );
  assert.match(member.member.joinDate, /^\d{4}-\d{2}-\d{2}$/);
  console.log(
    "PASS: date parser, SA midnight, invalid calendar dates and date-only API values",
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
