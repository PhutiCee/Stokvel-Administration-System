"use strict";
// Isolated PostgreSQL + real authenticated HTTP requests. No external database.
process.env.DATABASE_URL =
  "postgresql://unused:unused@127.0.0.1/isolated_completion";
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
      `INSERT INTO constitution(club_id,version,effective_date,contribution_amount,cycle_start_date,payout_order_method,exit_notice_days,forfeiture_rule)
      VALUES($1,1,$2,100,$2,'Negotiated',0,'Refund lifetime contributions less unpaid penalties, then forfeit 10 percent.') RETURNING *`,
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
  // Complete replacement, own membership only, exact integer percentages.
  await json(
    "/api/beneficiaries",
    3,
    "PUT",
    {
      beneficiaries: [{ name: "One", relationship: "Sibling", share: "99.99" }],
    },
    400,
  );
  await json("/api/beneficiaries", 3, "PUT", {
    memberId: people[4].member.member_id,
    beneficiaries: [
      { name: "One", relationship: "Sibling", share: "60.00" },
      { name: "Two", relationship: "Parent", share: "40.00" },
    ],
  });
  assert.equal((await json("/api/beneficiaries", 3)).beneficiaries.length, 2);
  assert.equal((await json("/api/beneficiaries", 4)).beneficiaries.length, 0);
  await json("/api/beneficiaries", 3, "PUT", {
    beneficiaries: [{ name: "One", relationship: "Sibling", share: "100" }],
  });
  assert.equal((await json("/api/beneficiaries", 3)).beneficiaries.length, 1);
  console.log("PASS: beneficiary validation, replacement, owner isolation");
  await json(
    "/api/announcements",
    3,
    "POST",
    { subject: "No", body: "No" },
    403,
  );
  const notice = await json(
    "/api/announcements",
    2,
    "POST",
    { subject: "Meeting", body: "Saturday at 10" },
    201,
  );
  await json(
    "/api/announcements",
    5,
    "POST",
    { subject: "Foreign", body: "No", correctsId: notice.announcement_id },
    404,
  );
  const correction = await json(
    "/api/announcements",
    0,
    "POST",
    {
      subject: "New time",
      body: "Saturday at 11",
      correctsId: notice.announcement_id,
    },
    201,
  );
  const feed = await json("/api/announcements", 3);
  assert.equal(
    feed.announcements[0].announcement_id,
    correction.announcement_id,
  );
  assert.equal(
    feed.announcements[0].original.announcement_id,
    notice.announcement_id,
  );
  assert.equal(feed.announcements[1].corrections.length, 1);
  assert.equal((await json("/api/announcements", 5)).announcements.length, 0);
  await assert.rejects(() =>
    database.query(
      "UPDATE announcement SET subject='Edited' WHERE announcement_id=$1",
      [notice.announcement_id],
    ),
  );
  console.log(
    "PASS: announcements roles, tenant isolation, immutable corrections",
  );
  const settings = await json("/api/exits/settings", 0);
  const policy = {
    period: "membership",
    forfeitPercent: "10",
    condition: {
      metric: "membershipDays",
      threshold: 10000,
      evaluateAt: "notice",
      afterPercent: "0",
      definition:
        "Fixture rule: retain ten percent until ten thousand membership days.",
    },
    deductPayouts: false,
    deductPenalties: true,
    deductCosts: false,
  };
  await json(
    "/api/exits/settings",
    1,
    "POST",
    { constitutionId: settings.constitution.id, policy, attest: true },
    403,
  );
  await json(
    "/api/exits/settings",
    0,
    "POST",
    { constitutionId: settings.constitution.id, policy, attest: true },
    201,
  );
  await json(
    "/api/cycles",
    1,
    "POST",
    { startDate: todayIso(), dueDate: addDays(todayIso(), 7) },
    201,
  );
  const cycle = await json("/api/cycles/current", 1);
  const contribution = cycle.contributions.find(
    (c) => c.memberId === people[3].member.member_id,
  );
  await json(
    "/api/contributions/" + contribution.contributionId + "/capture",
    1,
    "POST",
    { amount: 100, receiptDate: todayIso(), method: "Cash" },
  );
  const exit = await json("/api/exits", 3, "POST", {}, 201);
  assert.equal((await json("/api/exits", 4)).notices.length, 0);
  await json("/api/exits", 3, "POST", {}, 422);
  await json("/api/exits/" + exit.notice_id + "/assess", 5, "POST", {}, 403);
  await json(
    "/api/exits/" + exit.notice_id + "/decision",
    0,
    "POST",
    { decision: "approve" },
    422,
  );
  const assessment = await json(
    "/api/exits/" + exit.notice_id + "/assess",
    1,
    "POST",
    {},
  );
  assert.equal(assessment.calculation.repayable, "90.00");
  assert.equal(assessment.calculation.forfeited, "10.00");
  const frozen = await one(
    "SELECT condition_facts FROM exit_notice WHERE notice_id=$1",
    [exit.notice_id],
  );
  assert.equal(
    assessment.calculation.conditionResult.actual,
    frozen.condition_facts.membershipDays,
  );
  assert.equal(
    assessment.calculation.conditionResult.evaluatedOn,
    frozen.condition_facts.evaluatedOn,
  );
  await assert.rejects(
    database.query(
      "UPDATE exit_notice SET condition_facts='{}' WHERE notice_id=$1",
      [exit.notice_id],
    ),
  );
  const memberDash = await json("/api/dashboard", 3);
  assert.equal(
    memberDash.indicators.find((m) => m.key === "paid").value,
    "100.00",
  );
  assert.equal(
    memberDash.indicators.some((m) => m.key === "pool"),
    false,
  );
  assert.ok(
    memberDash.indicators.every((m) =>
      m.records.every(
        (r) => !r.member_id || r.member_id === people[3].member.member_id,
      ),
    ),
  );
  const officerDash = await json("/api/dashboard", 0);
  assert.equal(officerDash.months.length, 12);
  assert.equal(
    officerDash.indicators.find((m) => m.key === "pool").value,
    "100.00",
  );
  // Pool shortfall must leave both membership and ledger settlement untouched.
  const post = async (type, amount, memberId = null) =>
    require("../src/modules/ledger/ledger.service").appendEntry(
      { query: pool.query },
      {
        clubId: clubs[0].club_id,
        memberId,
        entryType: type,
        amount,
        description: "Completion fixture",
        postedBy: people[1].user.user_id,
      },
    );
  await post("Expense", "-95.00");
  await json(
    "/api/exits/" + exit.notice_id + "/decision",
    0,
    "POST",
    { decision: "approve" },
    422,
  );
  assert.equal(
    (
      await one("SELECT count(*)::int AS n FROM payout WHERE member_id=$1", [
        people[3].member.member_id,
      ])
    ).n,
    0,
  );
  assert.notEqual(
    (
      await one("SELECT standing FROM member WHERE member_id=$1", [
        people[3].member.member_id,
      ])
    ).standing,
    "Exited",
  );
  await post("Interest", "95.00");
  // A changed ledger amount invalidates the Treasurer's previous calculation.
  await post("Contribution", "10.00", people[3].member.member_id);
  await json(
    "/api/exits/" + exit.notice_id + "/decision",
    0,
    "POST",
    { decision: "approve" },
    422,
  );
  await json("/api/exits/" + exit.notice_id + "/assess", 1, "POST", {});
  // Last Treasurer and the head with arrears cannot exit.
  const treasurerExit = await json("/api/exits", 1, "POST", {}, 201);
  await json(
    "/api/exits/" + treasurerExit.notice_id + "/assess",
    1,
    "POST",
    {},
  );
  await json(
    "/api/exits/" + treasurerExit.notice_id + "/decision",
    0,
    "POST",
    { decision: "approve" },
    422,
  );
  await database.query(
    "UPDATE member SET queue_position=1 WHERE member_id=$1",
    [people[4].member.member_id],
  );
  const headExit = await json("/api/exits", 4, "POST", {}, 201);
  await json("/api/exits/" + headExit.notice_id + "/assess", 1, "POST", {});
  await json(
    "/api/exits/" + headExit.notice_id + "/decision",
    0,
    "POST",
    { decision: "approve" },
    422,
  );
  await json("/api/exits/" + headExit.notice_id + "/decision", 4, "POST", {
    decision: "cancel",
    reason: "Continuing membership",
  });
  await json("/api/exits/" + treasurerExit.notice_id + "/decision", 1, "POST", {
    decision: "cancel",
    reason: "Continuing duties",
  });
  const approved = await json(
    "/api/exits/" + exit.notice_id + "/decision",
    0,
    "POST",
    { decision: "approve" },
  );
  assert.equal(approved.status, "Approved");
  const m = await one("SELECT * FROM member WHERE member_id=$1", [
    people[3].member.member_id,
  ]);
  assert.equal(m.standing, "Exited");
  assert.equal(
    (
      await one(
        "SELECT sum(amount)::text AS total FROM ledger_entry WHERE club_id=$1",
        [clubs[0].club_id],
      )
    ).total,
    "11.00",
  );
  await json(
    "/api/exits/" + exit.notice_id + "/decision",
    0,
    "POST",
    { decision: "approve" },
    422,
  );
  assert.equal(
    (
      await one("SELECT count(*)::int AS n FROM payout WHERE member_id=$1", [
        m.member_id,
      ])
    ).n,
    1,
  );
  // A deduction settles the corresponding penalty, without another cash receipt.
  const secondContribution = cycle.contributions.find(
    (c) => c.memberId === people[4].member.member_id,
  );
  await json(
    "/api/contributions/" + secondContribution.contributionId + "/capture",
    1,
    "POST",
    { amount: 100, receiptDate: todayIso(), method: "Cash" },
  );
  const penalty = await one(
    "INSERT INTO penalty(club_id,member_id,amount,reason) VALUES($1,$2,5,'Settlement fixture') RETURNING *",
    [clubs[0].club_id, people[4].member.member_id],
  );
  const secondExit = await json("/api/exits", 4, "POST", {}, 201);
  const secondAssessment = await json(
    "/api/exits/" + secondExit.notice_id + "/assess",
    1,
    "POST",
    {},
  );
  assert.equal(secondAssessment.calculation.penaltyDeduction, "5.00");
  assert.equal(secondAssessment.calculation.repayable, "85.50");
  await json("/api/exits/" + secondExit.notice_id + "/decision", 0, "POST", {
    decision: "approve",
  });
  assert.equal(
    (
      await one(
        "SELECT settled_amount::text FROM penalty WHERE penalty_id=$1",
        [penalty.penalty_id],
      )
    ).settled_amount,
    "5.00",
  );
  console.log(
    "PASS: exit rule mapping, assessment, approval, atomic repayment/forfeiture, retained history, duplicate prevention",
  );
  console.log(
    "PASS: insufficient funds rollback, stale assessment, last officer and queue-head safeguards",
  );
  console.log(
    "PASS: member dashboard privacy, officer totals, 12 completed months",
  );
  // Platform drill-through contains aggregated rows, never club/member finances.
  const admin = await one(
    "INSERT INTO user_account(phone,full_name,password_hash,postal_address,is_platform_admin) VALUES('0839999999','Platform fixture','test','Test',true) RETURNING *",
  );
  const adminToken = crypto.randomBytes(32).toString("hex");
  await database.query(
    "INSERT INTO session(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [
      admin.user_id,
      crypto.createHash("sha256").update(adminToken).digest("hex"),
    ],
  );
  people.push({ token: adminToken });
  const overview = await json("/api/platform", people.length - 1);
  assert.equal(overview.stats.clubCount, overview.clubs.length);
  assert.equal(
    overview.stats.memberCount,
    overview.stats.memberBreakdown.reduce((n, r) => n + r.count, 0),
  );
  const { toCents, toNumeric } = require("../src/lib/money");
  assert.equal(
    overview.stats.fundsUnderAdministration,
    toNumeric(
      overview.stats.fundsBreakdown.reduce((n, r) => n + toCents(r.amount), 0),
    ),
  );
  assert.ok(
    overview.stats.fundsBreakdown.every(
      (r) => Object.keys(r).sort().join(",") === "amount,category",
    ),
  );
  assert.ok(
    overview.stats.memberBreakdown.every(
      (r) => Object.keys(r).sort().join(",") === "count,standing",
    ),
  );
  assert.ok(
    overview.clubs.every((c) => !("poolBalance" in c) && !("ledger" in c)),
  );
  await json("/api/platform", 0, "GET", undefined, 403);
  await json("/api/dashboard", people.length - 1, "GET", undefined, 403);
  console.log(
    "PASS: platform totals match aggregate drill-through rows; club roles refused; no member or club financial detail disclosed",
  );

  // Restore the most recent exit as a complete, dual-approved settlement.
  const latestExit = await one("SELECT * FROM exit_notice WHERE notice_id=$1", [
    secondExit.notice_id,
  ]);
  const beforeRestore = await one(
    "SELECT sum(cash_amount)::text AS balance FROM cash_ledger_entry WHERE club_id=$1",
    [clubs[0].club_id],
  );
  const reversal = await json(
    `/api/ledger/${latestExit.forfeiture_entry_id}/reverse`,
    1,
    "POST",
    { reason: "Correct entire exit settlement" },
    201,
  );
  assert.equal(reversal.scope, "Exit settlement");
  await json(
    `/api/ledger/reversals/${reversal.request_id}/post`,
    1,
    "POST",
    {},
    422,
  );
  await json(
    `/api/ledger/reversals/${reversal.request_id}/decision`,
    3,
    "POST",
    { decision: "approve" },
    403,
  );
  await json(
    `/api/ledger/reversals/${reversal.request_id}/decision`,
    0,
    "POST",
    { decision: "approve" },
  );
  const settle = require("../src/modules/ledger/settlements.repo"),
    realFinish = settle.finish;
  settle.finish = async () => {
    throw Error("Injected restoration failure");
  };
  await json(
    `/api/ledger/reversals/${reversal.request_id}/post`,
    1,
    "POST",
    {},
    500,
  );
  settle.finish = realFinish;
  assert.equal(
    (
      await one("SELECT standing FROM member WHERE member_id=$1", [
        people[4].member.member_id,
      ])
    ).standing,
    "Exited",
  );
  assert.equal(
    (
      await one(
        "SELECT sum(cash_amount)::text AS balance FROM cash_ledger_entry WHERE club_id=$1",
        [clubs[0].club_id],
      )
    ).balance,
    beforeRestore.balance,
  );
  await json(
    `/api/ledger/reversals/${reversal.request_id}/post`,
    1,
    "POST",
    {},
  );
  assert.equal(
    (
      await one("SELECT standing FROM member WHERE member_id=$1", [
        people[4].member.member_id,
      ])
    ).standing,
    "Good standing",
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
      await one("SELECT status FROM exit_notice WHERE notice_id=$1", [
        secondExit.notice_id,
      ])
    ).status,
    "Approved",
  );
  assert.equal(
    (
      await one("SELECT queue_position FROM member WHERE member_id=$1", [
        people[4].member.member_id,
      ])
    ).queue_position,
    1,
  );
  assert.equal(
    (await json("/api/exits", 1)).notices.find(
      (n) => n.notice_id === secondExit.notice_id,
    ).reversed,
    true,
  );
  await json(
    `/api/ledger/reversals/${reversal.request_id}/post`,
    1,
    "POST",
    {},
    422,
  );
  console.log(
    "PASS: complete exit reversal, zero-cash anchor, two-person approval, injected atomic rollback, penalty/queue/membership restoration, original decision retained.",
  );
  console.log(
    "Completion integration checks passed. No external database was used.",
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
