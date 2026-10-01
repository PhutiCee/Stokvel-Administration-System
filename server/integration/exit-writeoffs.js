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

  const rules = require("../src/rules/governance-policy");
  const simple = {
    basis: "present",
    comparison: "moreThan",
    numerator: 1,
    denominator: 2,
  };
  await json(
    "/api/governance/settings",
    0,
    "POST",
    {
      effectiveDate: todayIso(),
      confirmAdopted: true,
      policy: {
        source: "Fixture adopted voting rules",
        suspendedCanVote: false,
        arrearsCanVote: true,
        general: simple,
        expulsion: simple,
        amendmentClasses: [
          { name: "All", fields: rules.fieldsFor("Rotating"), rule: simple },
        ],
      },
    },
    201,
  );
  const settings = await json("/api/exits/settings", 0);
  await json(
    "/api/exits/settings",
    0,
    "POST",
    {
      constitutionId: settings.constitution.id,
      attest: true,
      policy: {
        period: "membership",
        forfeitPercent: "10",
        deductPayouts: false,
        deductPenalties: true,
        deductCosts: false,
      },
    },
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
  await json("/api/queue/establish", 0, "POST", {
    order: [3, 4, 0, 1, 2].map((i) => people[i].member.member_id),
  });
  const exit = await json("/api/exits", 3, "POST", {}, 201);
  const otherExit = await json("/api/exits", 4, "POST", {}, 201);
  await json("/api/exits/" + exit.notice_id + "/assess", 1, "POST", {});
  await json("/api/exits/writeoff-candidates", 3, "GET", undefined, 403);
  assert.equal(
    (await json("/api/exits/writeoff-candidates", 5)).candidates.length,
    0,
  );
  const candidates = (await json("/api/exits/writeoff-candidates", 0))
    .candidates;
  const snapshot = candidates.find(
    (c) => c.notice_id === exit.notice_id,
  ).snapshot;
  assert.equal(snapshot.amount, "100.00");
  const meeting = await json(
    "/api/governance",
    2,
    "POST",
    {
      date: todayIso(),
      agenda: "Exit debts",
      minutes: "Vote on exactly listed contribution debts.",
      attendance: people.slice(0, 5).map((p) => p.member.member_id),
    },
    201,
  );
  const advisoryMeeting = await json(
    "/api/governance",
    2,
    "POST",
    {
      date: todayIso(),
      agenda: "Nonquorate discussion",
      minutes: "Advisory only.",
      attendance: [people[0].member.member_id],
    },
    201,
  );
  const vote = (
    snap,
    votesFor = 5,
    votesAgainst = 0,
    meetingId = meeting.meeting_id,
  ) =>
    json(
      "/api/governance/" + meetingId + "/resolutions",
      2,
      "POST",
      {
        kind: "General",
        text: "Approved hardship debt relief at exit.",
        exitWriteOff: snap,
        votesFor,
        votesAgainst,
        abstentions: 0,
      },
      201,
    );
  const approve = (resolutionId, status = 200) =>
    json(
      "/api/exits/" + exit.notice_id + "/decision",
      0,
      "POST",
      { decision: "approve", writeoffResolutionId: resolutionId },
      status,
    );
  const advisory = await vote(snapshot, 1, 0, advisoryMeeting.meeting_id);
  assert.equal(advisory.outcome, "Advisory");
  await approve(advisory.resolution_id, 422);
  const rejected = await vote(snapshot, 0, 5);
  assert.equal(rejected.outcome, "Rejected");
  await approve(rejected.resolution_id, 422);
  const wrongMember = await vote(
    candidates.find((c) => c.notice_id === otherExit.notice_id).snapshot,
  );
  await approve(wrongMember.resolution_id, 422);
  const originalVote = await vote(snapshot);
  await json(
    "/api/governance/resolutions/" + originalVote.resolution_id + "/apply",
    0,
    "POST",
    {},
    422,
  );
  await json(
    "/api/contributions/" + contribution.contributionId + "/capture",
    1,
    "POST",
    { amount: 10, receiptDate: todayIso(), method: "Cash" },
  );
  await json("/api/exits/" + exit.notice_id + "/assess", 1, "POST", {});
  await approve(originalVote.resolution_id, 422);
  await json(
    "/api/governance/" + meeting.meeting_id + "/resolutions",
    2,
    "POST",
    {
      kind: "General",
      text: "Stale debt",
      exitWriteOff: snapshot,
      votesFor: 5,
      votesAgainst: 0,
      abstentions: 0,
    },
    422,
  );
  const fresh = (
    await json("/api/exits/writeoff-candidates", 0)
  ).candidates.find((c) => c.notice_id === exit.notice_id).snapshot;
  assert.equal(fresh.amount, "90.00");
  const carried = await vote(fresh);
  const ledger = require("../src/modules/ledger/ledger.service"),
    realAppend = ledger.appendEntry;
  ledger.appendEntry = async (client, entry) => {
    if (entry.description.startsWith("Exit:"))
      throw new Error("Injected failure after debt allocation");
    return realAppend(client, entry);
  };
  try {
    await approve(carried.resolution_id, 500);
  } finally {
    ledger.appendEntry = realAppend;
  }
  assert.equal(
    (
      await one(
        "SELECT written_off_amount::text FROM contribution WHERE contribution_id=$1",
        [contribution.contributionId],
      )
    ).written_off_amount,
    "0.00",
  );
  assert.equal(
    (
      await one("SELECT applied_at FROM resolution WHERE resolution_id=$1", [
        carried.resolution_id,
      ])
    ).applied_at,
    null,
  );
  assert.equal(
    (await one("SELECT count(*)::int AS n FROM contribution_writeoff")).n,
    0,
  );
  const before = (
    await one(
      "SELECT sum(amount)::text AS amount FROM ledger_entry WHERE club_id=$1",
      [clubs[0].club_id],
    )
  ).amount;
  assert.equal(before, "10.00");
  const approved = await approve(carried.resolution_id);
  assert.equal(approved.writeoff_resolution_id, carried.resolution_id);
  const debt = await one(
    "SELECT expected_amount::text,captured_amount::text,written_off_amount::text FROM contribution WHERE contribution_id=$1",
    [contribution.contributionId],
  );
  assert.deepEqual(debt, {
    expected_amount: "100.00",
    captured_amount: "10.00",
    written_off_amount: "90.00",
  });
  assert.equal(
    (
      await one(
        "SELECT sum(amount)::text AS amount FROM ledger_entry WHERE club_id=$1",
        [clubs[0].club_id],
      )
    ).amount,
    "1.00",
  );
  assert.equal(
    (
      await one("SELECT standing FROM member WHERE member_id=$1", [
        people[3].member.member_id,
      ])
    ).standing,
    "Exited",
  );
  await approve(carried.resolution_id, 422);
  const row = (await json("/api/cycles/current", 1)).contributions.find(
    (c) => c.contributionId === contribution.contributionId,
  );
  assert.equal(row.status, "Written off");
  assert.equal(row.writtenOff, "90.00");
  const dashboard = await json("/api/dashboard", 0);
  assert.equal(
    dashboard.indicators.find((m) => m.key === "clubOutstanding").value,
    "400.00",
  );
  await json(
    "/api/contributions/" + contribution.contributionId + "/capture",
    1,
    "POST",
    { amount: 10, receiptDate: todayIso(), method: "Cash" },
    422,
  );
  await assert.rejects(() =>
    database.query(
      "UPDATE contribution SET captured_amount=20 WHERE contribution_id=$1",
      [contribution.contributionId],
    ),
  );
  await assert.rejects(() =>
    database.query(
      "DELETE FROM contribution_writeoff WHERE contribution_id=$1",
      [contribution.contributionId],
    ),
  );
  await assert.rejects(() =>
    database.query(
      "UPDATE contribution SET written_off_amount=100 WHERE member_id=$1",
      [people[4].member.member_id],
    ),
  );
  console.log(
    "PASS: exact debt snapshot, normal constitutional voting rules, advisory/rejected/wrong-member/stale refusals, no standalone effect",
  );
  console.log(
    "PASS: rollback after write-off allocation; atomic debt forgiveness, repayment and exit; original expected/captured amounts retained",
  );
  console.log(
    "PASS: immutable debt allocation, duplicate prevention, new capture refusal, net outstanding dashboard and Written off display",
  );
  console.log("Exit write-off integration passed. No external database used.");
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
