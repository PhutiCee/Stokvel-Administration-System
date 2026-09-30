"use strict";

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
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await database.exec(
            fs.readFileSync(
                path.join(__dirname, "../src/db/migrations", file),
                "utf8",
            ),
        );
    console.log(
        "PASS: all 16 migrations apply to an empty PostgreSQL database",
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
        kind: "Amendment",
        text: "Raise contribution",
        votesFor: 5,
        votesAgainst: 0,
        abstentions: 0,
        changes: { contributionAmount: "150", amendmentMajorityPercentage: 67 },
        effectiveDate: date,
    };
    await assert.rejects(
        service.recordResolution(db, meeting.meeting_id, amendment, {
            ...ctx,
            actor: { ...ctx.actor, role: "Secretary" },
        }),
        (e) => e.status === 403,
    );
    const a = await service.recordResolution(
        db,
        meeting.meeting_id,
        amendment,
        ctx,
    );
    const stale = await service.recordResolution(
        db,
        meeting.meeting_id,
        {
            ...amendment,
            text: "Other amendment",
            changes: { penaltyAmount: "10" },
        },
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
    assert.equal(changed.amendment_majority_percentage, 67);
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
    const expelChair = await service.recordResolution(
        db,
        meeting.meeting_id,
        {
            ...input,
            kind: "Expulsion",
            text: "Replace chair",
            memberId: members[0].member_id,
        },
        ctx,
    );
    await assert.rejects(
        service.giveEffect(db, expelChair.resolution_id, ctx),
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
