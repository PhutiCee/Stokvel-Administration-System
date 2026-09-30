"use strict";
// Isolated PostgreSQL engine; never connects to or rebuilds a user's database.
process.env.DATABASE_URL =
    "postgresql://unused:unused@127.0.0.1/isolated_governance";
process.env.DATABASE_SSL = "false";
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { todayIso, addDays } = require("../src/lib/dates");
const { pool, forClub } = require("../src/db/pool");
const database = new PGlite({ extensions: { pgcrypto } });
const realEnd = pool.end.bind(pool);
pool.query = (sql, args) => database.query(sql, args);
pool.connect = async () => ({ query: pool.query, release() {} });
const one = async (sql, args) => (await database.query(sql, args)).rows[0];
const service = require("../src/modules/governance/governance.service");
let server;
async function main() {
    for (const file of fs
        .readdirSync(path.join(__dirname, "../src/db/migrations"))
        .filter((f) => f.endsWith(".sql") && !f.startsWith("017_"))
        .sort())
        await database.exec(
            fs.readFileSync(
                path.join(__dirname, "../src/db/migrations", file),
                "utf8",
            ),
        );
    console.log(
        "PASS: original 16 migrations applied; preparing upgrade fixtures",
    );
    const users = [];
    for (let i = 0; i < 6; i++)
        users.push(
            await one(
                `INSERT INTO user_account(phone,full_name,password_hash,postal_address) VALUES($1,$2,'test','Test town') RETURNING *`,
                [`082000000${i}`, `Test member ${i}`],
            ),
        );
    const club = await one(
        `INSERT INTO club(name,short_name,club_type) VALUES('Test governance','TEST','Rotating') RETURNING *`,
    );
    const other = await one(
        `INSERT INTO club(name,short_name,club_type) VALUES('Other club','OTHER','Rotating') RETURNING *`,
    );
    const date = todayIso();
    const con = await one(
        `INSERT INTO constitution(club_id,version,effective_date,contribution_amount,cycle_start_date,quorum_percentage,payout_order_method)
 VALUES($1,1,$2,100,$2,60,'Seniority') RETURNING *`,
        [club.club_id, addDays(date, -100)],
    );
    const members = [];
    for (let i = 0; i < 5; i++)
        members.push(
            await one(
                `INSERT INTO member(club_id,user_id,role,join_date,queue_position) VALUES($1,$2,$3,$4,$5) RETURNING *`,
                [
                    club.club_id,
                    users[i].user_id,
                    [
                        "Chairperson",
                        "Secretary",
                        "Treasurer",
                        "Member",
                        "Member",
                    ][i],
                    addDays(date, -90),
                    i + 1,
                ],
            ),
        );
    const outsider = await one(
        `INSERT INTO member(club_id,user_id,join_date) VALUES($1,$2,$3) RETURNING *`,
        [other.club_id, users[5].user_id, addDays(date, -90)],
    );
    const db = forClub(club.club_id),
        events = [];
    const ctx = {
        actor: {
            userId: users[0].user_id,
            fullName: "Test chair",
            role: "Chairperson",
        },
        audit: async (...args) => events.push(args),
    };
    const base = {
        date,
        agenda: "Decide club matters",
        minutes: "Recorded accurately",
    };
    const legacyMeeting = await one(
        `INSERT INTO meeting(club_id,meeting_date,agenda,minutes,constitution_id,eligible_count,attendance_count,required_count,quorate,recorded_by)
      VALUES($1,$2,'Legacy','Recorded before upgrade',$3,5,5,3,true,$4) RETURNING *`,
        [db.clubId, date, con.constitution_id, users[0].user_id],
    );
    const legacyResolution = await one(
        `INSERT INTO resolution(club_id,meeting_id,kind,text,votes_for,votes_against,abstentions,required_votes,outcome,recorded_by)
      VALUES($1,$2,'General','Legacy assumption',5,0,0,3,'Carried',$3) RETURNING *`,
        [db.clubId, legacyMeeting.meeting_id, users[0].user_id],
    );
    const legacyCycle = await one(
        `INSERT INTO cycle(club_id,sequence_number,start_date,due_date,status) VALUES($1,0,$2,$3,'Closed') RETURNING *`,
        [db.clubId, addDays(date, -7), date],
    );
    await database.exec(
        fs.readFileSync(
            path.join(
                __dirname,
                "../src/db/migrations/017_governance_completion.sql",
            ),
            "utf8",
        ),
    );
    assert.equal(
        (
            await one("SELECT constitution_id FROM cycle WHERE cycle_id=$1", [
                legacyCycle.cycle_id,
            ])
        ).constitution_id,
        con.constitution_id,
    );
    assert.equal(
        (await service.detail(db, legacyMeeting.meeting_id)).resolutions.length,
        1,
    );
    await assert.rejects(
        service.giveEffect(db, legacyResolution.resolution_id, ctx),
        /Legacy resolutions/,
    );
    console.log(
        "PASS: migration 017 preserves legacy records and cycles; unconfirmed old votes cannot be applied",
    );
    const policyRules = require("../src/rules/governance-policy");
    const simple = {
        numerator: 1,
        denominator: 2,
        comparison: "moreThan",
        basis: "present",
    };
    const policy = {
        source: "Test charter clause 8",
        general: simple,
        expulsion: simple,
        suspendedCanVote: false,
        arrearsCanVote: true,
        amendmentClasses: [
            {
                name: "Finance",
                fields: ["contributionAmount", "penaltyAmount"],
                rule: {
                    numerator: 2,
                    denominator: 3,
                    comparison: "atLeast",
                    basis: "present",
                },
            },
            {
                name: "Other rules",
                fields: policyRules
                    .fieldsFor("Rotating")
                    .filter(
                        (f) =>
                            !["contributionAmount", "penaltyAmount"].includes(
                                f,
                            ),
                    ),
                rule: simple,
            },
        ],
    };
    await assert.rejects(
        service.recordMeeting(
            db,
            { ...base, attendance: members.map((m) => m.member_id) },
            ctx,
        ),
        /adopted constitutional voting rules/,
    );
    await service.recordPolicy(
        db,
        { policy, effectiveDate: date, confirmAdopted: true },
        ctx,
    );
    await assert.rejects(
        service.recordPolicy(
            db,
            { policy, effectiveDate: date, confirmAdopted: true },
            ctx,
        ),
        /already recorded/,
    );
    await assert.rejects(
        service.candidates(db, addDays(date, -1)),
        /membership history starts/,
    );
    // Open before the amendment and ensure future rule changes never re-price it.
    const contributions = require("../src/modules/contributions/contributions.service");
    const contributionRepo = require("../src/modules/contributions/contributions.repo");
    const originalCycle = await contributions.openCycle(
        db,
        { startDate: date, dueDate: addDays(date, 6) },
        ctx,
    );
    assert.equal(originalCycle.expectedTotal, "500.00");
    await assert.rejects(
        service.recordMeeting(
            db,
            { ...base, attendance: [outsider.member_id] },
            ctx,
        ),
    );
    const advisory = await service.recordMeeting(
        db,
        { ...base, attendance: [members[0].member_id] },
        ctx,
    );
    const ar = await service.recordResolution(
        db,
        advisory.meeting_id,
        {
            kind: "General",
            text: "Advisory decision",
            votesFor: 1,
            votesAgainst: 0,
            abstentions: 0,
        },
        ctx,
    );
    assert.equal(ar.outcome, "Advisory");
    await assert.rejects(service.giveEffect(db, ar.resolution_id, ctx));
    const meeting = await service.recordMeeting(
        db,
        { ...base, attendance: members.map((m) => m.member_id) },
        ctx,
    );
    await assert.rejects(
        service.detail(forClub(other.club_id), meeting.meeting_id),
        (e) => e.status === 404,
    );
    const input = {
        kind: "General",
        text: "Adopt minutes",
        votesFor: 3,
        votesAgainst: 1,
        abstentions: 1,
    };
    const motion = await service.recordResolution(
        db,
        meeting.meeting_id,
        input,
        ctx,
    );
    assert.equal(motion.outcome, "Carried");
    await service.giveEffect(db, motion.resolution_id, ctx);
    await assert.rejects(service.giveEffect(db, motion.resolution_id, ctx));
    await assert.rejects(
        database.query("UPDATE resolution SET text=$2 WHERE resolution_id=$1", [
            motion.resolution_id,
            "Tampered",
        ]),
    );
    await assert.rejects(
        database.query("DELETE FROM meeting WHERE meeting_id=$1", [
            meeting.meeting_id,
        ]),
    );
    console.log(
        "PASS: tenant isolation, advisory refusal, one-time effect and immutable records",
    );
    const amendment = {
        text: "Raise contribution",
        changes: { contributionAmount: "150" },
        effectiveDate: date,
    };
    await assert.rejects(
        service.proposeAmendment(db, amendment, {
            ...ctx,
            actor: { ...ctx.actor, role: "Secretary" },
        }),
        (e) => e.status === 403,
    );
    const pending = await service.proposeAmendment(db, amendment, ctx);
    assert.equal((await service.proposals(db))[0].status, "Pending");
    assert.equal(
        (
            await one(
                "SELECT count(*)::int AS n FROM constitution WHERE club_id=$1",
                [db.clubId],
            )
        ).n,
        1,
    );
    await assert.rejects(
        service.proposeAmendment(
            db,
            { ...amendment, changes: { unsupported: 1 } },
            ctx,
        ),
    );
    const vote = {
        kind: "Amendment",
        proposalId: pending.proposal_id,
        votesFor: 4,
        votesAgainst: 1,
        abstentions: 0,
    };
    const a = await service.recordResolution(db, meeting.meeting_id, vote, {
        ...ctx,
        actor: { ...ctx.actor, role: "Secretary" },
    });
    assert.equal(a.required_votes, 4);
    await assert.rejects(
        service.recordResolution(db, meeting.meeting_id, vote, ctx),
        /binding decision/,
    );
    const otherPending = await service.proposeAmendment(
        db,
        {
            ...amendment,
            text: "Other amendment",
            changes: { penaltyAmount: "10" },
        },
        ctx,
    );
    const stale = await service.recordResolution(
        db,
        meeting.meeting_id,
        { ...vote, proposalId: otherPending.proposal_id },
        ctx,
    );
    // Force failure after constitution insertion: both the version and applied marker must roll back.
    const repo = require("../src/modules/governance/governance.repo"),
        mark = repo.markApplied;
    repo.markApplied = async () => {
        throw new Error("Injected failure");
    };
    await assert.rejects(
        service.giveEffect(db, a.resolution_id, ctx),
        /Injected failure/,
    );
    repo.markApplied = mark;
    assert.equal(
        (
            await one(
                "SELECT count(*)::int AS n FROM constitution WHERE club_id=$1",
                [club.club_id],
            )
        ).n,
        1,
    );
    const applied = await service.giveEffect(db, a.resolution_id, ctx);
    assert.ok(applied.resulting_constitution_id);
    const changed = await one(
        "SELECT * FROM constitution WHERE constitution_id=$1",
        [applied.resulting_constitution_id],
    );
    assert.equal(changed.contribution_amount, "150.00");
    assert.deepEqual(
        changed.governance_policy,
        policyRules.validatePolicy(policy, "Rotating"),
    );
    assert.equal(
        (await contributionRepo.constitutionForCycle(db, originalCycle.cycleId))
            .version,
        1,
    );
    assert.equal(
        (await contributionRepo.constitutionForStart(db, date)).version,
        1,
    );
    assert.equal(
        (await contributionRepo.constitutionForStart(db, addDays(date, 1)))
            .version,
        2,
    );
    await database.query(
        "UPDATE cycle SET status='Closed' WHERE club_id=$1 AND cycle_id=$2",
        [db.clubId, originalCycle.cycleId],
    );
    await assert.rejects(
        contributions.openCycle(
            db,
            { startDate: addDays(date, 1), dueDate: addDays(date, 7) },
            ctx,
        ),
        /before its commencement/,
    );
    // Advance the service clock only: exercise billing on the next calendar day.
    const dates = require("../src/lib/dates"),
        actualToday = dates.todayIso;
    dates.todayIso = () => addDays(date, 1);
    const servicePath =
            require.resolve("../src/modules/contributions/contributions.service"),
        originalService = require.cache[servicePath];
    delete require.cache[servicePath];
    let later;
    try {
        later = await require(servicePath).openCycle(
            db,
            { startDate: addDays(date, 1), dueDate: addDays(date, 7) },
            ctx,
        );
    } finally {
        dates.todayIso = actualToday;
        require.cache[servicePath] = originalService;
    }
    assert.equal(later.expectedTotal, "750.00");
    await assert.rejects(
        database.query(
            "UPDATE cycle SET constitution_id=$1 WHERE cycle_id=$2",
            [con.constitution_id, later.cycleId],
        ),
    );
    console.log(
        "PASS: cycle commencement boundary, pinned versions and billed amounts",
    );
    await assert.rejects(
        service.giveEffect(db, stale.resolution_id, ctx),
        /changed since this vote/,
    );
    console.log(
        "PASS: constitutional majority, secretary restriction, atomic rollback, stale vote refusal",
    );
    const expel = await service.recordResolution(
        db,
        meeting.meeting_id,
        {
            ...input,
            kind: "Expulsion",
            text: "Expulsion resolution",
            memberId: members[3].member_id,
        },
        ctx,
    );
    await service.giveEffect(db, expel.resolution_id, ctx);
    const expelled = await one(
        "SELECT standing,queue_position,exit_date::text FROM member WHERE member_id=$1",
        [members[3].member_id],
    );
    assert.equal(expelled.standing, "Expelled");
    assert.equal(expelled.queue_position, null);
    assert.equal(expelled.exit_date, date);
    assert.equal(
        (
            await one("SELECT queue_position FROM member WHERE member_id=$1", [
                members[4].member_id,
            ])
        ).queue_position,
        4,
    );
    await assert.rejects(
        service.recordResolution(
            db,
            meeting.meeting_id,
            {
                ...input,
                kind: "Expulsion",
                text: "Replace chair",
                memberId: members[0].member_id,
            },
            ctx,
        ),
        /replacement Chairperson/,
    );
    console.log(
        "PASS: expulsion retains membership history, closes queue gap and protects last officer",
    );
    // Exercise actual HTTP middleware, session authentication, route permissions and audit.
    server = require("../src/app").createApp().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const tokens = [];
    for (let i = 0; i < 5; i++) {
        const token = crypto.randomBytes(32).toString("hex");
        tokens.push(token);
        await database.query(
            "INSERT INTO session(user_id,active_club_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
            [
                users[i].user_id,
                club.club_id,
                crypto.createHash("sha256").update(token).digest("hex"),
            ],
        );
    }
    async function request(url, token, method = "GET", body) {
        return fetch(origin + url, {
            method,
            headers: {
                Cookie: `sas_session=${token}`,
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    }
    assert.equal((await request("/api/governance", tokens[4])).status, 200);
    assert.equal(
        (await request("/api/governance/annual-report", tokens[4])).status,
        403,
    );
    assert.equal(
        (await request("/api/governance/annual-report", tokens[1])).status,
        200,
    );
    assert.equal(
        (await request("/api/governance/annual-report?year=invalid", tokens[1]))
            .status,
        400,
    );
    assert.equal(
        (
            await request("/api/governance", tokens[4], "POST", {
                ...base,
                attendance: [],
            })
        ).status,
        403,
    );
    assert.equal(
        (
            await request(
                `/api/governance/resolutions/${motion.resolution_id}/apply`,
                tokens[1],
                "POST",
            )
        ).status,
        403,
    );
    assert.equal((await request("/api/governance", tokens[3])).status, 403);
    const authRepo = require("../src/modules/auth/auth.repo");
    assert.equal((await authRepo.listMemberships(users[3].user_id)).length, 0);
    const foreign = await request(
        `/api/governance/${crypto.randomUUID()}`,
        tokens[0],
    );
    assert.equal(foreign.status, 404);
    assert.equal(
        (await request("/api/governance/not-a-uuid", tokens[0])).status,
        400,
    );
    const response = await request("/api/governance", tokens[1], "POST", {
        ...base,
        attendance: [
            members[0].member_id,
            members[1].member_id,
            members[2].member_id,
        ],
    });
    assert.equal(response.status, 201, await response.text());
    assert.ok(events.some((e) => e[1] === "Refused"));
    console.log(
        "PASS: authenticated HTTP routes, role restrictions, revoked expelled access, error responses and auditing",
    );
    const succession = await service.recordResolution(
        db,
        meeting.meeting_id,
        {
            ...input,
            kind: "Expulsion",
            text: "Replace chair",
            memberId: members[0].member_id,
            successorMemberId: members[4].member_id,
        },
        ctx,
    );
    const appoint = repo.appoint;
    repo.appoint = async () => {
        throw new Error("Succession failure");
    };
    await assert.rejects(
        service.giveEffect(db, succession.resolution_id, ctx),
        /Succession failure/,
    );
    repo.appoint = appoint;
    assert.equal(
        (
            await one("SELECT standing FROM member WHERE member_id=$1", [
                members[0].member_id,
            ])
        ).standing,
        "Good standing",
    );
    await service.giveEffect(db, succession.resolution_id, ctx);
    assert.equal(
        (
            await one("SELECT role FROM member WHERE member_id=$1", [
                members[4].member_id,
            ])
        ).role,
        "Chairperson",
    );
    assert.equal((await request("/api/governance", tokens[0])).status, 403);
    const history = await one(
        "SELECT count(*)::int AS n FROM governance_member_history WHERE member_id=$1",
        [members[4].member_id],
    );
    assert.ok(history.n >= 2);
    console.log(
        "PASS: voted officer succession is atomic, preserves roles and records eligibility history",
    );
    const year = Number(date.slice(0, 4)),
        ledger = require("../src/modules/ledger/ledger.service"),
        { withClubTransaction } = require("../src/db/tx");
    let oldEntry;
    await withClubTransaction(db.clubId, async (tx, client) => {
        const put = (entryType, amount, extra = {}) =>
            ledger.appendEntry(client, {
                clubId: db.clubId,
                postedBy: users[4].user_id,
                entryType,
                amount,
                description: "Annual report fixture",
                postedAt: `${year}-01-01T00:00:00+02:00`,
                ...extra,
            });
        oldEntry = await put("Contribution", "1000", {
            postedAt: `${year - 1}-12-31T23:59:59+02:00`,
        });
        await put("Contribution", "2000");
        await put("Penalty", "100");
        await put("Payout", "-500");
        await put("Adjustment", "50");
        await put("Reversal", "-1000", {
            reversesId: oldEntry.entryId,
            reason: "Correct prior contribution",
        });
    });
    const report = await service.annualReport(db, year);
    const { toCents } = require("../src/lib/money");
    assert.equal(toCents(report.opening_balance), 100000);
    assert.equal(toCents(report.contributions), 100000);
    assert.equal(toCents(report.penalties), 10000);
    assert.equal(toCents(report.payouts), 50000);
    assert.equal(toCents(report.other_movements), 5000);
    assert.equal(toCents(report.closing_balance), 165000);
    assert.equal(report.membership.closing, 3);
    assert.equal(report.membership.ended, 2);
    assert.equal(report.reconciliation, null);
    await database.query(
        "INSERT INTO reconciliation(club_id,as_at_date,bank_balance,ledger_balance,difference,note,recorded_by) VALUES($1,$2,1600,1650,-50,$3,$4)",
        [db.clubId, date, "Investigate shortfall", users[4].user_id],
    );
    assert.equal(
        toCents(
            (await service.annualReport(db, year)).reconciliation.difference,
        ),
        -5000,
    );
    assert.equal(
        toCents(
            (await service.annualReport(forClub(other.club_id), year))
                .closing_balance,
        ),
        0,
    );
    console.log(
        "PASS: annual report uses SA year boundaries, net reversals, membership movement, reconciliation and tenant isolation",
    );
    console.log(
        "Governance integration checks passed. No external database was used.",
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
