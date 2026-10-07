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
      `INSERT INTO constitution(club_id,version,effective_date,contribution_amount,cycle_start_date,payout_order_method,penalty_amount,grace_period_days)
      VALUES($1,1,$2,100,$2,'Negotiated',25,0) RETURNING *`,
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

  const { forClub } = require("../src/db/pool");
  const { withClubTransaction } = require("../src/db/tx");
  const ledger = require("../src/modules/ledger/ledger.service");
  const db = forClub(clubs[0].club_id);
  const ctx = (who) => ({
    actor: {
      userId: people[who].user.user_id,
      memberId: people[who].member.member_id,
      role: people[who].member.role,
      fullName: "Test",
    },
    audit: async () => {},
  });
  // Own statement is public to Member, administrative endpoints remain forbidden.
  await json("/api/ledger/statement", 3);
  await json("/api/ledger", 3, "GET", undefined, 403);
  await json("/api/ledger/reversals", 3, "GET", undefined, 403);
  for (const question of [
    "pool balance",
    "who gets paid next",
    "when is my turn",
    "rules",
    "my contributions",
    "help",
    "perform an unknown operation",
  ]) {
    const answer = await json("/api/assistant", 3, "POST", { question });
    assert.match(
      answer.answer,
      /\[Verify on the source screen\]\(\/(dashboard|queue|governance#constitution|statement)\)/,
    );
  }
  assert.equal(
    (
      await one(
        "SELECT count(*)::int n FROM assistant_query WHERE user_id=$1",
        [people[3].user.user_id],
      )
    ).n,
    7,
  );
  await assert.rejects(database.query("DELETE FROM assistant_query"));
  assert.equal(
    (
      await require("../src/modules/auth/auth.repo").findByIdentifier(
        "000000000000001",
      )
    ).is_system,
    true,
  );
  // Newly adopted threshold values survive repository insert/presentation.
  const constitution = require("../src/modules/constitution/constitution.repo");
  const current = (await constitution.listVersions(db))[0];
  await withClubTransaction(db.clubId, (tx) =>
    constitution.insertVersion(tx, {
      ...current,
      version: 2,
      effectiveDate: addDays(todayIso(), -20),
      adoptedBy: people[0].user.user_id,
      warningAfterMissed: 1,
      suspensionAfterMissed: 2,
      expulsionAfterMissed: 3,
      amendmentNote: "Adopted thresholds test",
    }),
  );
  assert.equal(
    (await constitution.listVersions(db))[1].suspensionAfterMissed,
    2,
  );
  const contribution = require("../src/modules/contributions/contributions.service");
  const bills = [];
  for (let seq = 1; seq <= 3; seq++) {
    const c = await one(
      "INSERT INTO cycle(club_id,sequence_number,start_date,due_date,status,closed_at) VALUES($1,$2,$3,$3,'Closed',now()) RETURNING *",
      [db.clubId, seq, addDays(todayIso(), -10 + seq)],
    );
    bills.push(
      await one(
        "INSERT INTO contribution(club_id,cycle_id,member_id,expected_amount) VALUES($1,$2,$3,100) RETURNING *",
        [db.clubId, c.cycle_id, people[3].member.member_id],
      ),
    );
  }
  const checks = require("../src/jobs/club-checks");
  await checks.runClubChecks();
  await checks.runClubChecks();
  assert.equal(
    (
      await one("SELECT count(*)::int n FROM penalty WHERE club_id=$1", [
        db.clubId,
      ])
    ).n,
    3,
  );
  assert.equal((await ledger.getPoolBalance(db)).balance, "0.00");
  assert.equal(
    (
      await one("SELECT standing FROM member WHERE member_id=$1", [
        people[3].member.member_id,
      ])
    ).standing,
    "Suspended",
  );
  assert.equal(
    (
      await one(
        "SELECT count(*)::int n FROM standing_change WHERE member_id=$1",
        [people[3].member.member_id],
      )
    ).n,
    2,
  );
  const notifications = await json("/api/notifications", 3);
  assert.ok(notifications.notifications.length >= 3);
  assert.equal((await json("/api/notifications", 4)).notifications.length, 0);
  assert.equal((await json("/api/notifications", 5)).notifications.length, 0);
  const num = notifications.notifications.length;
  await checks.runClubChecks();
  assert.equal((await json("/api/notifications", 3)).notifications.length, num);
  const standing = await json("/api/governance/standing", 1);
  assert.ok(
    standing.members.find((m) => m.memberId === people[3].member.member_id)
      .needsResolution,
  );
  await json("/api/governance/standing", 3, "GET", undefined, 403);
  // Payment into a new open cycle applies the excess to all penalties/older arrears.
  const open = await one(
    "INSERT INTO cycle(club_id,sequence_number,start_date,due_date) VALUES($1,4,$2,$3) RETURNING *",
    [db.clubId, todayIso(), addDays(todayIso(), 7)],
  );
  const bill = await one(
    "INSERT INTO contribution(club_id,cycle_id,member_id,expected_amount) VALUES($1,$2,$3,100) RETURNING *",
    [db.clubId, open.cycle_id, people[3].member.member_id],
  );
  await contribution.captureContribution(
    db,
    bill.contribution_id,
    { amount: "475.00", method: "Cash" },
    ctx(1),
  );
  assert.equal(
    (
      await one("SELECT standing FROM member WHERE member_id=$1", [
        people[3].member.member_id,
      ])
    ).standing,
    "Good standing",
  );
  // Reconciliation snapshots contributions, then requires real matching correction evidence.
  const r = (
    await json(
      "/api/reconciliation",
      1,
      "POST",
      {
        bankBalance: "480.00",
        asAtDate: todayIso(),
        note: "Missing bank interest",
      },
      201,
    )
  ).reconciliation;
  assert.equal(r.contributionsCaptured, "475.00");
  assert.equal(r.difference, "5.00");
  const e = await withClubTransaction(db.clubId, (tx) =>
    ledger.appendEntry(tx, {
      clubId: db.clubId,
      entryType: "Interest",
      amount: "5.00",
      description: "Bank interest omitted",
      postedBy: people[1].user.user_id,
    }),
  );
  await json(
    `/api/reconciliation/${r.reconciliationId}/resolve`,
    3,
    "POST",
    { entryIds: [e.entryId], explanation: "Interest correction" },
    403,
  );
  await json(
    `/api/reconciliation/${r.reconciliationId}/resolve`,
    1,
    "POST",
    { entryIds: [], explanation: "No evidence" },
    400,
  );
  await json(`/api/reconciliation/${r.reconciliationId}/resolve`, 1, "POST", {
    entryIds: [e.entryId],
    explanation: "Interest correction",
  });
  await json(
    `/api/reconciliation/${r.reconciliationId}/resolve`,
    1,
    "POST",
    { entryIds: [e.entryId], explanation: "Again" },
    422,
  );
  assert.equal(
    (await json("/api/reconciliation", 1)).reconciliations[0].status,
    "Resolved",
  );
  assert.equal(
    (
      await one(
        "SELECT difference FROM reconciliation WHERE reconciliation_id=$1",
        [r.reconciliationId],
      )
    ).difference,
    "5.00",
  );
  console.log(
    "PASS: Member statement permissions, all local assistant sources/logs, threshold persistence, automatic overdue sweep, once-only penalties, stage history, private notifications, immediate reinstatement and reconciliation evidence.",
  );
  // Whole distribution is one approval and atomic reversal, never one isolated share.
  const ac = await one(
    "INSERT INTO club(name,short_name,club_type,registration_date) VALUES('Accumulation','ACC','Accumulating','2024-01-01') RETURNING *",
  );
  const adb = forClub(ac.club_id);
  await one(
    "INSERT INTO constitution(club_id,version,effective_date,contribution_amount,cycle_start_date,year_end_month,year_end_day) VALUES($1,1,'2024-01-01',100,'2024-01-01',12,31) RETURNING *",
    [ac.club_id],
  );
  const am = [];
  for (let i = 0; i < 3; i++)
    am.push(
      await one(
        "INSERT INTO member(club_id,user_id,role,join_date) VALUES($1,$2,$3,'2024-01-01') RETURNING *",
        [ac.club_id, people[i].user.user_id, people[i].member.role],
      ),
    );
  const cy = await one(
    "INSERT INTO cycle(club_id,sequence_number,start_date,due_date) VALUES($1,1,'2024-02-01','2024-02-28') RETURNING *",
    [ac.club_id],
  );
  for (const m of am) {
    const c = await one(
      "INSERT INTO contribution(club_id,cycle_id,member_id,expected_amount) VALUES($1,$2,$3,100) RETURNING *",
      [ac.club_id, cy.cycle_id, m.member_id],
    );
    await contribution.captureContribution(
      adb,
      c.contribution_id,
      { amount: "100.00", method: "Cash" },
      ctx(1),
    );
  }
  const dist = require("../src/modules/distributions/distributions.service");
  const created = await dist.initiateDistribution(adb, ctx(1));
  await dist.approveDistribution(adb, created.distributionId, ctx(0));
  const payout = await one(
    "SELECT e.* FROM ledger_entry e JOIN payout p ON p.payout_id=e.payout_id WHERE p.distribution_id=$1 LIMIT 1",
    [created.distributionId],
  );
  const reverse = require("../src/modules/ledger/reversals.service");
  const request = await reverse.reverse(
    adb,
    payout.entry_id,
    { reason: "Correct the complete distribution" },
    ctx(1),
  );
  assert.equal(request.scope, "Distribution");
  assert.equal((await reverse.list(adb)).length, 1);
  await assert.rejects(
    reverse.postApproved(adb, request.request_id, ctx(1)),
    /approval/,
  );
  await reverse.decide(
    adb,
    request.request_id,
    { decision: "approve" },
    ctx(0),
  );
  const settlement = require("../src/modules/ledger/settlements.repo"),
    finish = settlement.finish;
  settlement.finish = async () => {
    throw Error("Injected distribution failure");
  };
  await assert.rejects(
    reverse.postApproved(adb, request.request_id, ctx(1)),
    /Injected/,
  );
  settlement.finish = finish;
  assert.equal((await ledger.getPoolBalance(adb)).balance, "0.00");
  assert.equal(
    (
      await one(
        "SELECT count(*)::int n FROM payout WHERE distribution_id=$1 AND reversed_entry_id IS NOT NULL",
        [created.distributionId],
      )
    ).n,
    0,
  );
  await reverse.postApproved(adb, request.request_id, ctx(1));
  assert.equal((await ledger.getPoolBalance(adb)).balance, "300.00");
  assert.equal((await dist.listDistributions(adb))[0].reversed, true);
  const recreated = await dist.initiateDistribution(adb, ctx(1));
  assert.equal(recreated.yearEndDate, created.yearEndDate);
  await assert.rejects(
    reverse.postApproved(adb, request.request_id, ctx(1)),
    /approval/,
  );
  console.log(
    "PASS: complete distribution reversal, grouped approval, single request listing, injected atomic rollback, immutable originals and fresh distribution initiation.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise((r) => server.close(r));
    await database.close();
    await realEnd();
  });
