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
  const contribution = require("../src/modules/contributions/contributions.service");
  const reversals = require("../src/modules/ledger/reversals.service");
  const { forClub } = require("../src/db/pool");
  const db = forClub(clubs[0].club_id);
  const ctx = (who) => ({
    actor: {
      userId: people[who].user.user_id,
      memberId: people[who].member.member_id,
      fullName: people[who].user.full_name,
      role: people[who].member.role,
    },
    audit: async () => {},
  });
  const memberId = people[3].member.member_id;
  async function makeCycle(seq, status = "Open") {
    return one(
      `INSERT INTO cycle(club_id,sequence_number,start_date,due_date,status,closed_at) VALUES($1,$2,$3,$4,$5::cycle_status,CASE WHEN $5::text='Closed' THEN now() ELSE NULL END) RETURNING *`,
      [
        db.clubId,
        seq,
        addDays(todayIso(), -10),
        addDays(todayIso(), status === "Closed" ? -1 : 10),
        status,
      ],
    );
  }
  async function bill(cycle, amount = "100.00") {
    return one(
      "INSERT INTO contribution(club_id,cycle_id,member_id,expected_amount) VALUES($1,$2,$3,$4) RETURNING *",
      [db.clubId, cycle.cycle_id, memberId, amount],
    );
  }
  const old = await makeCycle(1, "Closed"),
    older = await bill(old, "40.00"),
    current = await makeCycle(2),
    c = await bill(current);
  const penalty = await one(
    `INSERT INTO penalty(club_id,member_id,cycle_id,amount,reason) VALUES($1,$2,$3,20,'Earlier late payment') RETURNING *`,
    [db.clubId, memberId, old.cycle_id],
  );
  const receipt = await contribution.captureContribution(
    db,
    c.contribution_id,
    { amount: "200.00", method: "Cash" },
    ctx(1),
  );
  assert.equal(receipt.allocations.length, 3);
  assert.equal(
    (
      await one("SELECT credit_amount FROM member WHERE member_id=$1", [
        memberId,
      ])
    ).credit_amount,
    "40.00",
  );
  await database.query(
    `UPDATE cycle SET status='Closed',closed_at=now() WHERE cycle_id=$1`,
    [current.cycle_id],
  );
  const next = await contribution.openCycle(
    db,
    { startDate: todayIso(), dueDate: addDays(todayIso(), 7) },
    ctx(1),
  );
  const credited = await one(
    "SELECT * FROM contribution WHERE member_id=$1 AND cycle_id=$2",
    [memberId, next.cycleId],
  );
  assert.equal(credited.expected_amount, "60.00");
  // Fault after compensation but before marking the request: all source and ledger effects roll back.
  const rr = require("../src/modules/ledger/reversals.repo"),
    real = rr.posted;
  rr.posted = async () => {
    throw new Error("Injected after compensation");
  };
  await assert.rejects(
    reversals.reverse(
      db,
      receipt.ledger.entryId,
      { reason: "Wrong bank capture" },
      ctx(1),
    ),
    /Injected/,
  );
  rr.posted = real;
  assert.equal(
    (
      await one(
        "SELECT captured_amount FROM contribution WHERE contribution_id=$1",
        [c.contribution_id],
      )
    ).captured_amount,
    "100.00",
  );
  assert.equal(
    (
      await one(
        "SELECT expected_amount FROM contribution WHERE contribution_id=$1",
        [credited.contribution_id],
      )
    ).expected_amount,
    "60.00",
  );
  const reversed = await reversals.reverse(
    db,
    receipt.ledger.entryId,
    { reason: "Wrong bank capture" },
    ctx(1),
  );
  assert.equal(reversed.status, "Posted");
  for (const id of [c.contribution_id, older.contribution_id])
    assert.equal(
      (
        await one(
          "SELECT captured_amount FROM contribution WHERE contribution_id=$1",
          [id],
        )
      ).captured_amount,
      "0.00",
    );
  assert.equal(
    (
      await one("SELECT settled_amount FROM penalty WHERE penalty_id=$1", [
        penalty.penalty_id,
      ])
    ).settled_amount,
    "0.00",
  );
  assert.equal(
    (
      await one(
        "SELECT expected_amount FROM contribution WHERE contribution_id=$1",
        [credited.contribution_id],
      )
    ).expected_amount,
    "100.00",
  );
  assert.equal((await ledger.getPoolBalance(db)).balance, "0.00");
  await assert.rejects(
    reversals.reverse(
      db,
      receipt.ledger.entryId,
      { reason: "Duplicate" },
      ctx(1),
    ),
    /already been reversed/,
  );
  await assert.rejects(
    contribution.captureContribution(
      db,
      c.contribution_id,
      { amount: "80.00", method: "Cash" },
      ctx(1),
    ),
    /closed/,
  );
  const corrected = await contribution.captureContribution(
    db,
    c.contribution_id,
    {
      amount: "80.00",
      method: "Cash",
      correctsEntryId: receipt.ledger.entryId,
    },
    ctx(1),
  );
  assert.equal(corrected.captured, "80.00");
  await assert.rejects(
    contribution.captureContribution(
      db,
      c.contribution_id,
      {
        amount: "80.00",
        method: "Cash",
        correctsEntryId: receipt.ledger.entryId,
      },
      ctx(1),
    ),
    /unused reversed/,
  );
  await assert.rejects(
    database.query("UPDATE receipt_allocation SET amount=1 WHERE entry_id=$1", [
      receipt.ledger.entryId,
    ]),
  );
  console.log(
    "PASS: exact current/arrears/penalty allocations; consumed credit restoration; closed-cycle one-use correction; duplicate prevention; rollback after compensation; immutable history",
  );
  // Available credit is removed without inventing a new receipt.
  const over = await contribution.captureContribution(
    db,
    credited.contribution_id,
    { amount: "300.00", method: "Cash" },
    ctx(1),
  );
  const creditBefore = await one(
    "SELECT credit_amount FROM member WHERE member_id=$1",
    [memberId],
  );
  assert(toNumber(creditBefore.credit_amount) > 0);
  await reversals.reverse(
    db,
    over.ledger.entryId,
    { reason: "Wrong duplicate receipt" },
    ctx(1),
  );
  assert.equal(
    (
      await one("SELECT credit_amount FROM member WHERE member_id=$1", [
        memberId,
      ])
    ).credit_amount,
    "0.00",
  );
  function toNumber(v) {
    return Number(v);
  }
  // Source-linked rotation payout: retain approval, reopen cycle eligibility and restore queue.
  await database.query(
    "UPDATE member SET queue_position=CASE WHEN member_id=$2 THEN 1 WHEN member_id=$3 THEN 2 ELSE NULL END WHERE club_id=$1",
    [db.clubId, memberId, people[4].member.member_id],
  );
  await database.query(
    "UPDATE contribution SET captured_amount=40 WHERE contribution_id=$1",
    [older.contribution_id],
  );
  const payouts = require("../src/modules/payouts/payouts.service");
  const initiated = await payouts.initiatePayout(db, {}, ctx(1));
  const paid = await payouts.approvePayout(db, initiated.payoutId, ctx(0));
  assert.equal(
    (
      await one("SELECT payout_id FROM ledger_entry WHERE entry_id=$1", [
        paid.ledgerEntry.entryId,
      ])
    ).payout_id,
    initiated.payoutId,
  );
  const request = await reversals.reverse(
    db,
    paid.ledgerEntry.entryId,
    { reason: "Transfer rejected by bank" },
    ctx(1),
  );
  await assert.rejects(
    reversals.postApproved(db, request.request_id, ctx(1)),
    /approval/,
  );
  await reversals.decide(
    db,
    request.request_id,
    { decision: "approve" },
    ctx(0),
  );
  // A later queue change makes the old approval unsafe to post.
  await database.query(
    "UPDATE member SET queue_position=3 WHERE member_id=$1",
    [memberId],
  );
  await assert.rejects(
    reversals.postApproved(db, request.request_id, ctx(1)),
    /queue changed/,
  );
  // The failed transaction above is rolled back by the service, so restore the deliberate fixture edit.
  await database.query(
    "UPDATE member SET queue_position=2 WHERE member_id=$1",
    [memberId],
  );
  const done = await reversals.postApproved(db, request.request_id, ctx(1));
  assert.equal(done.status, "Posted");
  assert.equal(
    (
      await one("SELECT queue_position FROM member WHERE member_id=$1", [
        memberId,
      ])
    ).queue_position,
    1,
  );
  const history = await payouts.getPayout(db, initiated.payoutId);
  assert.equal(history.status, "Reversed");
  assert(history.approved);
  assert.equal(
    (await payouts.previewNextPayout(db)).cycle.cycleId,
    old.cycle_id,
  );
  console.log(
    "PASS: payout source linkage; separate request/approval/post; stale queue refusal; queue restoration; approved history retained; cycle payable again",
  );
  // Burial reversal preserves the original payout and returns the same claim to Lodged.
  const burial = await one(
    "INSERT INTO club(name,short_name,club_type) VALUES('Burial test','BT','Burial') RETURNING *",
  );
  await database.query(
    `INSERT INTO constitution(club_id,version,effective_date,contribution_amount,cycle_start_date,benefit_schedule,waiting_period_days) VALUES($1,1,$2,100,$2,'[{"category":"Parent","amount":"50.00"}]',0)`,
    [burial.club_id, addDays(todayIso(), -90)],
  );
  const bdb = forClub(burial.club_id),
    bctx = {};
  for (const who of [0, 1, 3]) {
    const m = await one(
      "INSERT INTO member(club_id,user_id,role,join_date) VALUES($1,$2,$3,$4) RETURNING *",
      [
        burial.club_id,
        people[who].user.user_id,
        people[who].member.role,
        addDays(todayIso(), -60),
      ],
    );
    bctx[who] = {
      ...ctx(who),
      actor: { ...ctx(who).actor, memberId: m.member_id },
    };
  }
  await ledger.appendEntry(
    { query: pool.query },
    {
      clubId: bdb.clubId,
      entryType: "Adjustment",
      amount: "100.00",
      description: "Opening reserve",
      postedBy: people[1].user.user_id,
    },
  );
  const dependent = await one(
    `INSERT INTO dependant(club_id,member_id,name,category,registered_at) VALUES($1,$2,'Parent test','Parent',now()-interval '40 days') RETURNING *`,
    [bdb.clubId, bctx[3].actor.memberId],
  );
  const claims = require("../src/modules/claims/claims.service");
  const claim = await claims.lodgeClaim(
    bdb,
    {
      dependantId: dependent.dependant_id,
      dateOfDeath: addDays(todayIso(), -1),
    },
    bctx[3],
  );
  await claims.initiateClaimPayment(bdb, claim.claimId, bctx[1]);
  await claims.approveClaimPayment(bdb, claim.claimId, bctx[0]);
  const claimEntry = await one(
    `SELECT * FROM ledger_entry WHERE club_id=$1 AND payout_id IS NOT NULL`,
    [bdb.clubId],
  );
  const cr = await reversals.reverse(
    bdb,
    claimEntry.entry_id,
    { reason: "Bank rejected benefit payment" },
    bctx[1],
  );
  await reversals.decide(bdb, cr.request_id, { decision: "approve" }, bctx[0]);
  await reversals.postApproved(bdb, cr.request_id, bctx[1]);
  assert.equal((await claims.getClaim(bdb, claim.claimId)).status, "Lodged");
  assert.equal((await ledger.getPoolBalance(bdb)).balance, "100.00");
  await claims.initiateClaimPayment(bdb, claim.claimId, bctx[1]);
  await assert.rejects(
    claims.approveClaimPayment(bdb, claim.claimId, bctx[1]),
    /initiated/,
  );
  await claims.approveClaimPayment(bdb, claim.claimId, bctx[0]);
  assert.equal((await ledger.getPoolBalance(bdb)).balance, "50.00");
  assert.equal(
    (
      await one("SELECT count(*)::int AS n FROM payout WHERE club_id=$1", [
        bdb.clubId,
      ])
    ).n,
    2,
  );
  console.log(
    "PASS: claim reopens after reversal, retains payout approval evidence and requires fresh two-person approval",
  );
}
main()
  .then(() => console.log("Source compensation integration passed."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise((r) => server.close(r));
    await database.close();
    await realEnd();
  });
