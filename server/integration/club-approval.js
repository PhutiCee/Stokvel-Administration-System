"use strict";
// Real HTTP sessions against an isolated PostgreSQL-compatible database.
process.env.DATABASE_URL =
  "postgresql://unused:unused@127.0.0.1/club_approval_test";
process.env.DATABASE_SSL = "false";
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pool } = require("../src/db/pool");
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
    .sort()) {
    // Match production: each migration commits independently (new enum values).
    await database.exec("BEGIN");
    await database.exec(
      fs.readFileSync(path.join(__dirname, "../src/db/migrations", f), "utf8"),
    );
    await database.exec("COMMIT");
    if (f === "029_reconciliation_evidence.sql") {
      await database.query(
        "INSERT INTO club(name,short_name,club_type) VALUES('Existing club','Old','Rotating')",
      );
      await database.query(
        "INSERT INTO club(name,short_name,club_type,status) VALUES('Previously suspended','Held','Rotating','Suspended')",
      );
    }
  }
  const original = await one("SELECT * FROM club WHERE name='Existing club'");
  assert.equal(original.status, "Active");
  assert.equal(
    (await one("SELECT status FROM club WHERE name='Previously suspended'"))
      .status,
    "Suspended",
  );
  const people = [];
  for (let i = 0; i < 5; i++) {
    const u = await one(
      `INSERT INTO user_account(full_name,phone,password_hash,postal_address,is_platform_admin)
      VALUES($1,$2,'test','Test address',$3) RETURNING *`,
      [`Person ${i}`, `082000000${i}`, i === 4],
    );
    if (i !== 4)
      await database.query(
        "INSERT INTO member(club_id,user_id,role) VALUES($1,$2,$3)",
        [
          original.club_id,
          u.user_id,
          ["Chairperson", "Treasurer", "Secretary", "Member"][i],
        ],
      );
    const token = crypto.randomBytes(32).toString("hex");
    await database.query(
      "INSERT INTO session(user_id,active_club_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [
        u.user_id,
        i === 4 ? null : original.club_id,
        crypto.createHash("sha256").update(token).digest("hex"),
      ],
    );
    people.push({ u, token });
  }
  server = require("../src/app").createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  async function req(url, who = 0, method = "GET", body, expected = 200) {
    const result = await fetch(
      `http://127.0.0.1:${server.address().port}${url}`,
      {
        method,
        headers: {
          ...(who === null
            ? {}
            : { Cookie: `sas_session=${people[who].token}` }),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const data = await result.json();
    assert.equal(
      result.status,
      expected,
      `${method} ${url}: ${JSON.stringify(data)}`,
    );
    return data;
  }
  const details = {
    name: "Chairperson new club",
    shortName: "New",
    clubType: "Rotating",
    town: "Polokwane",
    contributionAmount: "100",
    cycleFrequency: "Monthly",
    cycleStartDate: "2026-10-01",
    penaltyAmount: "10",
    gracePeriodDays: 5,
    quorumPercentage: 50,
    exitNoticeDays: 30,
    payoutOrderMethod: "Negotiated",
    // The creator cannot inject a different founder, an active status or admin identity.
    status: "Active",
    reviewedBy: people[4].u.user_id,
    chairperson: {
      fullName: "Injected founder",
      phone: people[3].u.phone,
      postalAddress: "Anywhere",
    },
  };
  function member(who, role) {
    return {
      fullName: people[who].u.full_name,
      phone: people[who].u.phone,
      idNumber: `PASS${who}123`,
      postalAddress: "Test address",
      role,
      nextOfKin: {
        name: "Next person",
        relationship: "Sibling",
        phone: "0831112222",
      },
    };
  }
  details.applicantRole = "Chairperson";
  details.foundingMembers = [
    member(1, "Treasurer"),
    member(2, "Secretary"),
    member(3, "Member"),
  ];
  for (const who of [0, 1, 2, 3])
    assert.equal(
      (await req("/api/club-applications/eligibility", who)).canCreate,
      true,
    );
  assert.equal(
    (await req("/api/club-applications/eligibility", 4)).canCreate,
    false,
  );
  await req("/api/club-applications", 4, "POST", details, 403);
  await req("/api/club-applications", null, "POST", details, 401);
  for (const missing of ["Treasurer", "Secretary", "Member"]) {
    await req(
      "/api/club-applications",
      0,
      "POST",
      {
        ...details,
        foundingMembers: details.foundingMembers.filter(
          (p) => p.role !== missing,
        ),
      },
      400,
    );
  }
  await req(
    "/api/club-applications",
    0,
    "POST",
    {
      ...details,
      foundingMembers: [
        member(1, "Treasurer"),
        member(1, "Secretary"),
        member(3, "Member"),
      ],
    },
    400,
  );
  assert.equal(
    Number(
      (await one("SELECT count(*) n FROM club WHERE name=$1", [details.name]))
        .n,
    ),
    0,
  );
  const signup = {
    fullName: "New applicant",
    phone: "0845551234",
    idNumber: "NEWPASS1",
    postalAddress: "New town",
    password: "Example-pass-2026",
  };
  await req(
    "/api/auth/register",
    null,
    "POST",
    { ...signup, password: "short" },
    400,
  );
  await req(
    "/api/auth/register",
    null,
    "POST",
    { ...signup, isPlatformAdmin: true },
    201,
  );
  await req("/api/auth/register", null, "POST", signup, 409);
  const registered = await one("SELECT * FROM user_account WHERE phone=$1", [
    signup.phone,
  ]);
  assert.equal(registered.is_platform_admin, false);
  assert.notEqual(registered.password_hash, signup.password);
  await req("/api/auth/login", null, "POST", {
    identifier: signup.phone,
    password: signup.password,
  });
  await req("/api/platform/clubs", 0, "POST", details, 403);
  const application = await req(
    "/api/club-applications",
    0,
    "POST",
    details,
    201,
  );
  const id = application.clubId;
  assert.equal(application.status, "Pending approval");
  const stored = await one("SELECT * FROM club WHERE club_id=$1", [id]);
  assert.equal(stored.requested_by, people[0].u.user_id);
  assert.equal(stored.reviewed_by, null);
  assert.equal(
    (
      await one(
        "SELECT user_id FROM member WHERE club_id=$1 AND role='Chairperson'",
        [id],
      )
    ).user_id,
    people[0].u.user_id,
  );
  await req("/api/auth/club", 0, "POST", { clubId: id });
  assert.equal((await req("/api/auth/me")).club.status, "Pending approval");
  assert.equal(
    (await req("/api/club-applications/current")).status,
    "Pending approval",
  );
  await req("/api/auth/club", 3, "POST", { clubId: original.club_id });
  for (const endpoint of [
    "/api/club",
    "/api/dashboard",
    "/api/ledger",
    "/api/ledger/statement",
    "/api/ledger/reversals",
    "/api/cycles",
    "/api/contributions",
    "/api/constitution",
    "/api/payouts",
    "/api/queue",
    "/api/distributions",
    "/api/claims",
    "/api/governance/standing",
    "/api/notifications",
    "/api/reconciliation",
    "/api/exits",
  ]) {
    await req(endpoint, 0, "GET", undefined, 403);
  }
  for (const endpoint of [
    "/api/cycles",
    "/api/contributions",
    "/api/payouts",
    "/api/distributions",
    "/api/claims",
    "/api/assistant",
    "/api/reconciliation",
    "/api/notifications",
  ]) {
    await req(endpoint, 0, "POST", {}, 403);
  }
  await req(`/api/platform/clubs/${id}`, 4, "PATCH", { status: "Active" }, 409);
  await req(
    `/api/platform/clubs/${id}/review`,
    0,
    "POST",
    { decision: "approve" },
    403,
  );
  // Approval rechecks all roles even for an older/incomplete application.
  await database.query(
    "UPDATE member SET role='Member' WHERE club_id=$1 AND role='Secretary'",
    [id],
  );
  await req(
    `/api/platform/clubs/${id}/review`,
    4,
    "POST",
    { decision: "approve" },
    409,
  );
  await database.query(
    "UPDATE member SET role='Secretary' WHERE club_id=$1 AND user_id=$2",
    [id, people[2].u.user_id],
  );
  for (const who of [1, 2, 3]) {
    await req("/api/auth/club", who, "POST", { clubId: id });
    await req("/api/members", who, "GET", undefined, 403);
    assert.equal(
      (await req("/api/club-applications/current", who)).status,
      "Pending approval",
    );
  }
  const register = await req("/api/members");
  assert.equal(register.members.length, 4);
  assert.equal(
    register.members.every(
      (m) => m.idNumber === null || m.userId === people[0].u.user_id,
    ),
    true,
  );
  await req("/api/members", 0, "POST", member(1, "Treasurer"), 422);
  const ordinary = register.members.find((m) => m.role === "Member");
  await req(`/api/members/${ordinary.memberId}/role`, 0, "PATCH", {
    role: "Member",
  });
  const overview = await req("/api/platform", 4);
  assert.equal(
    overview.clubs.find((c) => c.clubId === id).status,
    "Pending approval",
  );
  assert.equal(JSON.stringify(overview).includes("PASS1123"), false);
  await req(`/api/platform/clubs/${id}/review`, 4, "POST", {
    decision: "approve",
  });
  assert.equal((await req("/api/auth/me", 1)).club.status, "Active");
  await req("/api/club", 3);
  await req("/api/ledger/statement", 3);
  await req("/api/ledger", 3, "GET", undefined, 403);
  await req(
    `/api/platform/clubs/${id}/review`,
    4,
    "POST",
    { decision: "reject", reason: "Stale decision" },
    409,
  );
  assert.equal(
    Number(
      (
        await one(
          "SELECT count(*) n FROM audit_log WHERE club_id=$1 AND action='platform.approveClub'",
          [id],
        )
      ).n,
    ),
    1,
  );
  await req(`/api/platform/clubs/${id}`, 4, "PATCH", {
    status: "Suspended",
    reason: "Test suspension",
  });
  await req("/api/cycles", 1, "POST", {}, 403);
  await req(`/api/platform/clubs/${id}`, 4, "PATCH", { status: "Active" });
  // Rejection is distinct from suspension: reinstatement cannot bypass review.
  const rejected = await req(
    "/api/club-applications",
    0,
    "POST",
    { ...details, name: "Rejected club" },
    201,
  );
  await req(
    `/api/platform/clubs/${rejected.clubId}/review`,
    4,
    "POST",
    { decision: "reject" },
    400,
  );
  await req(`/api/platform/clubs/${rejected.clubId}/review`, 4, "POST", {
    decision: "reject",
    reason: "Registration could not be verified",
  });
  await req(
    `/api/platform/clubs/${rejected.clubId}`,
    4,
    "PATCH",
    { status: "Active" },
    409,
  );
  await req("/api/auth/club", 0, "POST", { clubId: rejected.clubId });
  assert.equal(
    (await req("/api/club-applications/current")).rejectionReason,
    "Registration could not be verified",
  );
  await req("/api/members", 0, "GET", undefined, 403);
  await req("/api/members", 0, "POST", member(1, "Treasurer"), 403);
  // Active admin provisioning is retained, and existing clubs are not reclassified.
  const adminClub = await req(
    "/api/platform/clubs",
    4,
    "POST",
    { ...details, name: "Admin provisioned club" },
    201,
  );
  assert.equal(adminClub.status, "Active");
  assert.equal(
    (await one("SELECT status FROM club WHERE club_id=$1", [original.club_id]))
      .status,
    "Active",
  );
  // Eligibility follows current membership, not cached client role.
  await database.query("UPDATE member SET role='Member' WHERE user_id=$1", [
    people[0].u.user_id,
  ]);
  await req(
    "/api/club-applications",
    0,
    "POST",
    {
      ...details,
      name: "Ordinary member applies",
      applicantRole: "Member",
      foundingMembers: [
        member(1, "Chairperson"),
        member(2, "Treasurer"),
        member(3, "Secretary"),
      ],
    },
    201,
  );
  console.log(
    "Club approval integration passed: migration upgrade, any personal account founder, pending restrictions, role isolation, officers, approval, rejection, audit and existing clubs.",
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
