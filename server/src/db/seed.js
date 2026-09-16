"use strict";

/**
 * Seed data.
 *
 *     npm run seed
 *
 * Wipes and reloads the club-level tables, then loads three clubs of the three
 * different types, their constitutions, their members, and enough contribution
 * and ledger history for the dashboard to have something to show.
 *
 * Edge cases are seeded DELIBERATELY, so that the demonstration can reach them
 * without setup:
 *
 *   · Nomsa is Treasurer of one club and an ordinary Member of another, on one
 *     account. This is the tenancy model made visible (REQ-10, REQ-15).
 *   · Lerato is in arrears and sits at queue position 2, so the payout refusal
 *     is reachable without blocking the happy path at the head of the queue.
 *   · Zanele joined mid-cycle and carries a catch-up obligation (REQ-41).
 *   · Rhulani has exited but his rows remain, because ledger history must keep
 *     resolving to a name (REQ-48, BR-18).
 *   · One member of the burial society is still inside the 180-day waiting
 *     period, so a claim refusal is available on demand (REQ-87).
 *
 * Every account gets the same password, from SEED_PASSWORD in .env. That is
 * acceptable for seeded demonstration data and for nothing else.
 */

const { pool } = require("./pool");
const { env } = require("../config/env");
const { hashPassword } = require("../lib/password");
const { toNumeric, toCents } = require("../lib/money");

const TODAY = new Date();
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const addMonths = (d, n) => { const c = new Date(d); c.setMonth(c.getMonth() + n); return c; };
const startOfMonth = (d) => new Date(new Date(d).getFullYear(), new Date(d).getMonth(), 1);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
// REQ-34 requires at least one of an email address or a postal address. Most
// of these members have no email, which is the realistic case — so they get a
// postal address, and migration 008's constraint is satisfied the way it is
// meant to be rather than by giving everybody a fictional inbox.
const TOWNS = [
    "Seshego", "Mankweng", "Polokwane", "Lebowakgomo", "Mokopane",
    "Tzaneen", "Giyani", "Thohoyandou", "Jane Furse", "Burgersfort"
];

/**
 * A South African identity number carries a Luhn check digit in position 13.
 * The numbers in PEOPLE below are invented, so their final digit is rewritten
 * here to whatever Luhn requires. Without this the seeded members would all
 * fail the validation that registerMember() applies to every new member — the
 * demonstration data would not survive the system's own rules, which is the
 * one thing seed data must never do.
 */
function withCheckDigit(id) {
    const first12 = String(id).slice(0, 12);
    // Same parity as checkIdNumber() in members.service.js: a digit is doubled
    // when (12 - i) is odd. Position 12, the check digit itself, is never
    // doubled, so it can be solved for directly.
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        let d = +first12[i];
        if ((12 - i) % 2 === 1) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
    }
    return first12 + String((10 - (sum % 10)) % 10);
}

function postalFor(index) {
    return `P.O. Box ${1200 + index * 37}, ${TOWNS[index % TOWNS.length]}, 0700`;
}

const PEOPLE = [
    { key: "nomsa",   name: "Nomsa Maluleke",       phone: "0824417788", email: "nomsa.maluleke@gmail.com",  id: "8703125072083" },
    { key: "thabo",   name: "Thabo Mokoena",        phone: "0739021145", email: "tmokoena@webmail.co.za",    id: "7811045811082" },
    { key: "refilwe", name: "Refilwe Mahlangu",     phone: "0713349026", email: "refilwe.m@outlook.com",     id: "9202180644085" },
    { key: "kagiso",  name: "Kagiso Sithole",       phone: "0605512034", id: "9001154422081" },
    { key: "lerato",  name: "Lerato Ndlovu",        phone: "0782234117", id: "9407230512086" },
    { key: "tshepo",  name: "Tshepo Ramaphakela",   phone: "0647781203", id: "8809095533084" },
    { key: "naledi",  name: "Naledi Mabaso",        phone: "0834419022", id: "9311270998083" },
    { key: "sipho",   name: "Sipho Nkuna",          phone: "0762230114", id: "8502046677081" },
    { key: "dineo",   name: "Dineo Rakgoale",       phone: "0828890321", id: "9605113344087" },
    { key: "katlego", name: "Katlego Mabunda",      phone: "0731120945", id: "9109088812082" },
    { key: "zanele",  name: "Zanele Chauke",        phone: "0714456708", id: "9712240077085" },
    { key: "mpho",    name: "Mpho Sekhukhune",      phone: "0607783312", email: "mpho.sek@gmail.com",        id: "9508235019087" },
    { key: "rhulani", name: "Rhulani Baloyi",       phone: "0781192244", id: "8406175544089" },

    { key: "grace",   name: "Grace Baloyi",         phone: "0822015566", id: "6805120044082" },
    { key: "portia",  name: "Portia Mkhwanazi",     phone: "0734458899", id: "7209301122083" },
    { key: "sarah",   name: "Sarah Mothiba",        phone: "0718823311", id: "7511156677084" },
    { key: "elias",   name: "Elias Rammutla",       phone: "0609934422", id: "7003078899085" },
    { key: "johanna", name: "Johanna Shikwambana",  phone: "0788811223", id: "6912254433086" },
    { key: "petunia", name: "Petunia Mnisi",        phone: "0646672299", id: "8102119988087" },

    { key: "solomon", name: "Solomon Mabunda",      phone: "0825540033", id: "6104115566088" },
    { key: "gladys",  name: "Gladys Maluleke",      phone: "0736619977", id: "6507224411089" },
    { key: "joyce",   name: "Joyce Mokwena",        phone: "0717783322", id: "7012108855080" },
    { key: "wilson",  name: "Wilson Nkosi",         phone: "0602214477", id: "5908063399081" },
    { key: "betty",   name: "Betty Nyathi",         phone: "0784490066", id: "6303177722082" },
    { key: "amos",    name: "Amos Ramoshaba",       phone: "0648812205", id: "6711025566083" },
    { key: "martha",  name: "Martha Chabalala",     phone: "0833307744", id: "7404199911084" },

    { key: "admin",   name: "Kabelo Netshiozwi",    phone: "0842106690", email: "admin@stokvelsys.co.za",    id: "8401115540081", platformAdmin: true }
];

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------
const CLUBS = [
    {
        key: "mmakau", name: "Mmakau Rotating Savings Club", shortName: "Mmakau",
        type: "Rotating", town: "Seshego, Limpopo", monthsOld: 11,
        constitution: {
            contribution: 500, penalty: 50, grace: 5, quorum: 60,
            exitNotice: 30, order: "Random draw",
            forfeiture: "A member exiting before completing one full rotation forfeits accrued penalties and 10% of contributions.",
            waiting: 0, schedule: []
        },
        officers: { nomsa: "Treasurer", thabo: "Chairperson", refilwe: "Secretary" },
        members: ["nomsa", "thabo", "refilwe", "kagiso", "lerato", "tshepo",
                  "naledi", "sipho", "dineo", "katlego", "zanele", "mpho"],
        queue: true
    },
    {
        key: "bokamoso", name: "Bokamoso Grocery Stokvel", shortName: "Bokamoso",
        type: "Accumulating", town: "Mankweng, Limpopo", monthsOld: 10,
        constitution: {
            contribution: 350, penalty: 40, grace: 7, quorum: 50,
            exitNotice: 60, order: "Negotiated",
            forfeiture: "A member exiting before year-end receives contributions less penalties and a proportionate share of costs.",
            waiting: 0, schedule: []
        },
        officers: { grace: "Chairperson", portia: "Treasurer", sarah: "Secretary" },
        members: ["grace", "portia", "sarah", "elias", "johanna", "petunia", "nomsa"],
        queue: false
    },
    {
        key: "lehumo", name: "Lehumo Burial Society", shortName: "Lehumo",
        type: "Burial", town: "Polokwane, Limpopo", monthsOld: 22,
        constitution: {
            contribution: 150, penalty: 25, grace: 10, quorum: 50,
            exitNotice: 30, order: "Seniority",
            forfeiture: "No refund of contributions on exit. Cover ceases on the date of exit.",
            waiting: 180,
            schedule: [
                { category: "Principal member", amount: 10000 },
                { category: "Spouse",           amount: 8000  },
                { category: "Child under 21",   amount: 5000  },
                { category: "Extended family",  amount: 3000  }
            ]
        },
        officers: { solomon: "Chairperson", gladys: "Treasurer", joyce: "Secretary" },
        members: ["solomon", "gladys", "joyce", "wilson", "betty", "amos", "martha", "thabo"],
        queue: false
    }
];

// ---------------------------------------------------------------------------

async function wipe(client) {
    // Order matters: children before parents. ledger_entry and audit_log have
    // append-only triggers on UPDATE and DELETE, so TRUNCATE is used — it does
    // not fire row triggers, which is exactly why it is the right tool here and
    // exactly why nothing in the application layer is allowed to call it.
    await client.query(`
        TRUNCATE reconciliation, ledger_entry, penalty, contribution, cycle,
                 dependant, beneficiary, member, constitution, club,
                 session, audit_log, user_account
        RESTART IDENTITY CASCADE
    `);
}

async function seed() {
    const client = await pool.connect();
    const passwordHash = await hashPassword(env.SEED_PASSWORD);

    try {
        await client.query("BEGIN");
        await wipe(client);

        // --- users ---------------------------------------------------------
        const userId = {};
        for (const [index, p] of PEOPLE.entries()) {
            // Anybody without an email gets a postal address, so every row
            // satisfies the contact-channel constraint from migration 008.
            const postal = p.email ? null : postalFor(index);
            const { rows } = await client.query(
                `INSERT INTO user_account
                     (phone, email, full_name, id_number, password_hash,
                      is_platform_admin, postal_address)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING user_id`,
                [p.phone, p.email || null, p.name, withCheckDigit(p.id), passwordHash,
                 !!p.platformAdmin, postal]
            );
            userId[p.key] = rows[0].user_id;
        }
        console.log(`  users            ${PEOPLE.length}`);

        let memberCount = 0, cycleCount = 0, contributionCount = 0, ledgerCount = 0;

        for (const def of CLUBS) {
            // --- club ------------------------------------------------------
            const registered = addMonths(TODAY, -def.monthsOld);
            const { rows: clubRows } = await client.query(
                `INSERT INTO club (name, short_name, club_type, town, registration_date)
                 VALUES ($1, $2, $3, $4, $5) RETURNING club_id`,
                [def.name, def.shortName, def.type, def.town, iso(registered)]
            );
            const clubId = clubRows[0].club_id;

            // --- constitution ----------------------------------------------
            const c = def.constitution;
            await client.query(
                `INSERT INTO constitution
                     (club_id, version, effective_date, contribution_amount,
                      cycle_frequency, cycle_start_date, penalty_amount,
                      grace_period_days, quorum_percentage, exit_notice_days,
                      payout_order_method, forfeiture_rule,
                      waiting_period_days, benefit_schedule)
                 VALUES ($1, 1, $2, $3, 'Monthly', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [clubId, iso(registered), toNumeric(toCents(c.contribution)),
                 iso(registered), toNumeric(toCents(c.penalty)), c.grace, c.quorum,
                 c.exitNotice, c.order, c.forfeiture, c.waiting,
                 JSON.stringify(c.schedule)]
            );

            // --- members ---------------------------------------------------
            const memberId = {};
            let position = 1;
            for (const key of def.members) {
                const role = def.officers[key] || "Member";
                const joinDate = addMonths(TODAY, -def.monthsOld);
                const { rows } = await client.query(
                    `INSERT INTO member
                         (club_id, user_id, role, join_date, queue_position)
                     VALUES ($1, $2, $3, $4, $5) RETURNING member_id`,
                    [clubId, userId[key], role, iso(joinDate),
                     def.queue ? position : null]
                );
                memberId[key] = rows[0].member_id;
                if (def.queue) position += 1;
                memberCount += 1;
            }

            // --- deliberate edge cases -------------------------------------
            if (def.key === "mmakau") {
                // The queue has already rotated five times: the first five
                // recipients have moved to the back.
                const order = def.members;
                for (let i = 0; i < order.length; i++) {
                    const pos = i < 5 ? 8 + i : i - 4;
                    await client.query(
                        `UPDATE member SET queue_position = $1
                          WHERE club_id = $2 AND member_id = $3`,
                        [pos, clubId, memberId[order[i]]]
                    );
                }
                // Lerato is in arrears. She is placed at position 2 by swapping
                // her with whoever the rotation left there, so that the payout
                // refusal (REQ-67) is one row down the queue and reachable in a
                // demonstration, while the happy path at the head still works.
                const { rows: atTwo } = await client.query(
                    `SELECT member_id, queue_position FROM member
                      WHERE club_id = $1 AND queue_position = 2`,
                    [clubId]
                );
                const { rows: leratoRow } = await client.query(
                    `SELECT queue_position FROM member
                      WHERE club_id = $1 AND member_id = $2`,
                    [clubId, memberId.lerato]
                );
                if (atTwo[0] && atTwo[0].member_id !== memberId.lerato) {
                    await client.query(
                        `UPDATE member SET queue_position = $1
                          WHERE club_id = $2 AND member_id = $3`,
                        [leratoRow[0].queue_position, clubId, atTwo[0].member_id]
                    );
                }
                await client.query(
                    `UPDATE member SET standing = 'In arrears', queue_position = 2
                      WHERE club_id = $1 AND member_id = $2`,
                    [clubId, memberId.lerato]
                );
                // Zanele joined mid-cycle three months ago (REQ-41).
                await client.query(
                    `UPDATE member SET join_date = $1, catch_up_amount = $2
                      WHERE club_id = $3 AND member_id = $4`,
                    [iso(addDays(addMonths(startOfMonth(TODAY), -3), 12)),
                     toNumeric(toCents(500)), clubId, memberId.zanele]
                );
                // An exited member, retained for audit (REQ-48, BR-18).
                const { rows: exitedRows } = await client.query(
                    `INSERT INTO member
                         (club_id, user_id, role, standing, join_date, exit_date, queue_position)
                     VALUES ($1, $2, 'Member', 'Exited', $3, $4, NULL)
                     RETURNING member_id`,
                    [clubId, userId.rhulani, iso(addMonths(TODAY, -11)), iso(addMonths(TODAY, -2))]
                );
                memberId.rhulani = exitedRows[0].member_id;
                memberCount += 1;
            }

            if (def.key === "bokamoso") {
                await client.query(
                    `UPDATE member SET standing = 'In arrears'
                      WHERE club_id = $1 AND member_id = $2`,
                    [clubId, memberId.elias]
                );
            }

            if (def.key === "lehumo") {
                // Dependants, so a claim has something to be assessed against.
                const deps = {
                    solomon: [["Sannie Mabunda", "Spouse"], ["Kgaugelo Mabunda", "Child under 21"]],
                    gladys:  [["Frans Maluleke", "Spouse"], ["Tinyiko Maluleke", "Extended family"]],
                    joyce:   [["Piet Mokwena", "Spouse"]],
                    wilson:  [["Agnes Nkosi", "Spouse"], ["Lesego Nkosi", "Child under 21"]],
                    betty:   [["Daniel Nyathi", "Spouse"]],
                    amos:    [["Rosina Ramoshaba", "Spouse"]],
                    martha:  [["Jackson Chabalala", "Spouse"]],
                    thabo:   [["Palesa Mokoena", "Spouse"]]
                };
                for (const [key, list] of Object.entries(deps)) {
                    for (const [name, category] of list) {
                        await client.query(
                            `INSERT INTO dependant (club_id, member_id, name, category)
                             VALUES ($1, $2, $3, $4)`,
                            [clubId, memberId[key], name, category]
                        );
                    }
                }
                // Martha is 95 days in, inside the 180-day waiting period, so a
                // claim refusal is always available to demonstrate (REQ-87).
                await client.query(
                    `UPDATE member SET join_date = $1
                      WHERE club_id = $2 AND member_id = $3`,
                    [iso(addDays(TODAY, -95)), clubId, memberId.martha]
                );
            }

            // --- cycles, contributions, ledger -----------------------------
            const amountCents = toCents(c.contribution);
            const monthsToSeed = Math.min(def.monthsOld, 6);
            // Ledger entries are COLLECTED here and written after the loop, in
            // date order. The running balance must be computed in the order the
            // ledger is read, not the order the seed happens to build it: a
            // resulting_balance that only reconciles in insertion order makes
            // the book look falsified the moment anybody sorts it by date,
            // which is exactly the tamper signal the column exists to give.
            const ledgerQueue = [];
            let balanceCents = 0;

            const activeKeys = def.members;

            for (let i = monthsToSeed - 1; i >= 0; i--) {
                const start = addMonths(startOfMonth(TODAY), -i);
                const due = addDays(start, 7);
                const isOpen = i === 0;
                const seq = monthsToSeed - i;

                const { rows: cycleRows } = await client.query(
                    `INSERT INTO cycle
                         (club_id, sequence_number, start_date, due_date, status, opened_by)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING cycle_id`,
                    [clubId, seq, iso(start), iso(due),
                     isOpen ? "Open" : "Closed", userId[Object.keys(def.officers)[0]]]
                );
                const cycleId = cycleRows[0].cycle_id;
                cycleCount += 1;

                for (let k = 0; k < activeKeys.length; k++) {
                    const key = activeKeys[k];

                    let capturedCents = amountCents;
                    let status = "Paid";
                    let receipt = addDays(start, 2 + ((k * 3) % 5));

                    if (isOpen) {
                        // A deliberate spread of statuses in the open cycle, so
                        // the contributions screen has something to show.
                        if (key === "lerato" || key === "elias") {
                            capturedCents = 0; status = "Late"; receipt = null;
                        } else if (k % 5 === 3) {
                            capturedCents = Math.round(amountCents * 0.4);
                            status = "Partial";
                            receipt = addDays(start, 3);
                        } else if (k % 5 === 4) {
                            capturedCents = 0; status = "Outstanding"; receipt = null;
                        }
                    }

                    await client.query(
                        `INSERT INTO contribution
                             (club_id, cycle_id, member_id, expected_amount,
                              captured_amount, status, receipt_date, method,
                              captured_by, captured_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                        [clubId, cycleId, memberId[key],
                         toNumeric(amountCents), toNumeric(capturedCents), status,
                         receipt ? iso(receipt) : null,
                         capturedCents > 0 ? (k % 4 === 0 ? "Cash" : "Electronic funds transfer") : null,
                         capturedCents > 0 ? userId[Object.keys(def.officers)[0]] : null,
                         capturedCents > 0 && receipt ? new Date(receipt).toISOString() : null]
                    );
                    contributionCount += 1;

                    if (capturedCents > 0) {
                        balanceCents += capturedCents;
                        ledgerQueue.push({
                            memberId: memberId[key],
                            type: "Contribution",
                            amountCents: capturedCents,
                            description: `Contribution, cycle ${seq}`,
                            postedBy: userId[Object.keys(def.officers)[0]],
                            postedAt: new Date(receipt)
                        });
                    }
                }

                // Rotating clubs pay out at the end of each closed cycle.
                if (def.type === "Rotating" && !isOpen) {
                    const payoutCents = amountCents * activeKeys.length;
                    if (balanceCents >= payoutCents) {
                        const recipient = activeKeys[(seq - 1) % activeKeys.length];
                        balanceCents -= payoutCents;
                        ledgerQueue.push({
                            memberId: memberId[recipient],
                            type: "Payout",
                            amountCents: -payoutCents,
                            description: `Rotation payout, cycle ${seq}`,
                            postedBy: userId.thabo,
                            postedAt: addDays(due, 1)
                        });
                    }
                }
            }

            // Write the ledger in date order, so resulting_balance reconciles
            // against a running sum taken in the same order the book is read.
            ledgerQueue.sort((a, b) => a.postedAt - b.postedAt);

            // Give every entry a DISTINCT timestamp. Seeded entries otherwise
            // carry a date with no time, so a dozen of them tie at midnight and
            // any ordering among them is arbitrary — which makes the running
            // balance irreconcilable no matter what order it was written in.
            // Real captures get a genuine now(), so this only affects the seed.
            // Offsets stay well under a day, so no entry moves to another date.
            let running = 0;
            for (const [i, e] of ledgerQueue.entries()) {
                e.postedAt = new Date(e.postedAt.getTime() + 8 * 3600000 + i * 60000);
                running += e.amountCents;
                await client.query(
                    `INSERT INTO ledger_entry
                         (club_id, member_id, entry_type, amount,
                          resulting_balance, description, posted_by, posted_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [clubId, e.memberId, e.type, toNumeric(e.amountCents),
                     toNumeric(running), e.description, e.postedBy,
                     e.postedAt.toISOString()]
                );
                ledgerCount += 1;
            }
            balanceCents = running;

            // A non-zero reconciliation difference, so the exception state on
            // the treasurer's dashboard is reachable (REQ-98).
            if (def.key === "mmakau") {
                const bankCents = balanceCents - toCents(450);
                await client.query(
                    `INSERT INTO reconciliation
                         (club_id, as_at_date, bank_balance, ledger_balance,
                          difference, note, recorded_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [clubId, iso(addDays(TODAY, -2)),
                     toNumeric(bankCents), toNumeric(balanceCents),
                     toNumeric(bankCents - balanceCents),
                     "Bank statement is short against the book. Not yet explained.",
                     userId.nomsa]
                );
            }

            console.log(`  ${def.shortName.padEnd(16)} ${def.members.length} members, pool ${toNumeric(balanceCents)}`);
        }

        await client.query("COMMIT");

        console.log(`\n  members          ${memberCount}`);
        console.log(`  cycles           ${cycleCount}`);
        console.log(`  contributions    ${contributionCount}`);
        console.log(`  ledger entries   ${ledgerCount}`);
        console.log(`\n  Sign in with any phone number above.`);
        console.log(`  Password for every seeded account: ${env.SEED_PASSWORD}`);
        console.log(`\n  Start with  0824417788  (Nomsa Maluleke) — Treasurer of Mmakau,`);
        console.log(`  ordinary Member of Bokamoso, on one account.\n`);

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("\n  Seed failed:", err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

seed().catch((err) => {
    console.error(`\n  Seed failed: ${err.message}`);
    if (err.code) console.error(`  PostgreSQL code: ${err.code}`);
    process.exit(1);
});