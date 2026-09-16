"use strict";

/**
 * Membership service.
 *
 * Implements Member from SRS 4.4.3:
 *
 *     registerMember()   REQ-34..REQ-43
 *     assignRole()       REQ-7, REQ-43, REQ-49
 *     updateMember()     REQ-43
 *
 * computeCatchUpObligation(), computeExitSettlement() and getStanding() are
 * scheduled for the next sprint. The catch-up figure is PREVIEWED here, because
 * REQ-41 requires it to be presented before membership is confirmed, but the
 * full rules-engine version replaces this one.
 */

const repo = require("./members.repo");
const { withClubTransaction } = require("../../db/tx");
const { hashPassword } = require("../../lib/password");
const { temporaryPassword } = require("../../lib/tempPassword");
const { normalisePhone } = require("../auth/auth.repo");
const { toCents, toNumeric, format } = require("../../lib/money");
const { BadRequest, Conflict, NotFound, RuleRefusal } = require("../../lib/errors");

const ROLES = ["Chairperson", "Treasurer", "Secretary", "Member"];
const OFFICER_ROLES_REQUIRED = ["Chairperson", "Treasurer"]; // REQ-49

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * A South African identity number carries its own check digit (Luhn), so a
 * typed-in number can be checked without asking anybody. The birth date is
 * embedded in the first six digits and is checked too — a number that decodes
 * to 31 February was mistyped.
 *
 * Returns null when valid, or a sentence explaining the problem.
 *
 * REQ-34 allows "an equivalent identifier", so a value that is plainly not a
 * 13-digit SA number is accepted as-is rather than rejected: a member may hold
 * a passport or a refugee permit.
 */
function checkIdNumber(idNumber) {
    if (!idNumber) return "An identity number or equivalent identifier is required.";
    const value = String(idNumber).trim();

    // Not in SA identity-number shape — treat as an equivalent identifier.
    if (!/^\d{13}$/.test(value)) {
        if (value.length < 5) return "That identifier is too short to be valid.";
        return null;
    }

    const yy = +value.slice(0, 2);
    const mm = +value.slice(2, 4);
    const dd = +value.slice(4, 6);
    if (mm < 1 || mm > 12) return "That identity number contains an impossible month.";

    // Two-digit year: assume nobody registering is over 100.
    const nowYY = new Date().getFullYear() % 100;
    const century = yy <= nowYY ? 2000 : 1900;
    const date = new Date(century + yy, mm - 1, dd);
    if (date.getMonth() !== mm - 1 || date.getDate() !== dd) {
        return "That identity number contains an impossible date of birth.";
    }

    // Luhn check digit.
    let sum = 0;
    for (let i = 0; i < 13; i++) {
        let digit = +value[i];
        if ((12 - i) % 2 === 1) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
    }
    if (sum % 10 !== 0) {
        return "That identity number is not valid. Check it against the member's document.";
    }
    return null;
}

/** REQ-34: a name, an identifier, a phone, and at least one of email or postal. */
function validateRegistration(input) {
    const errors = {};

    if (!input.fullName || input.fullName.trim().length < 3) {
        errors.fullName = "Enter the member's full name.";
    }

    const idError = checkIdNumber(input.idNumber);
    if (idError) errors.idNumber = idError;

    const phone = normalisePhone(input.phone);
    if (!phone || !/^0\d{9}$/.test(phone)) {
        errors.phone = "Enter a ten-digit phone number, for example 082 441 7788.";
    }

    const hasEmail = input.email && input.email.trim();
    const hasPostal = input.postalAddress && input.postalAddress.trim();
    if (!hasEmail && !hasPostal) {
        errors.email = "Record either an email address or a postal address.";
    }
    if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
        errors.email = "That email address does not look right.";
    }

    // REQ-35: next of kin is not optional.
    if (!input.nextOfKin?.name || !input.nextOfKin?.phone) {
        errors.nextOfKin = "Record a next of kin: a name, a relationship and a phone number.";
    }

    if (input.role && !ROLES.includes(input.role)) {
        errors.role = "Choose a role from the club's constitution.";
    }

    return { errors, phone, valid: Object.keys(errors).length === 0 };
}

// ---------------------------------------------------------------------------
// REQ-41 — the catch-up obligation, previewed before confirmation
// ---------------------------------------------------------------------------

/**
 * Interim implementation. A member joining after a cycle has opened owes that
 * cycle's contribution in full, because the pool for the cycle is already
 * committed and every other member has been billed for it.
 *
 * The constitution has no field expressing a different rule, so there is
 * nothing else to honour yet. When the rules engine lands next sprint it reads
 * the rule from the constitution and this function goes away.
 */
async function previewCatchUp(db, joinDate) {
    const [constitution, cycle] = await Promise.all([
        repo.currentConstitution(db),
        repo.openCycle(db)
    ]);

    if (!constitution) {
        throw new RuleRefusal("This club has no constitution on record, so contributions cannot be calculated.");
    }
    if (!cycle) {
        return { amount: "0.00", cycle: null, explanation: null };
    }

    const joined = new Date(joinDate);
    const cycleStart = new Date(cycle.start_date);
    if (joined <= cycleStart) {
        return { amount: "0.00", cycle: null, explanation: null };
    }

    const amountCents = toCents(constitution.contribution_amount);

    // pg returns DATE as a JavaScript Date. Rendered as-is it produces
    // "Tue Sep 01 2026 00:00:00 GMT+0000", which is not a sentence to read to a
    // new member across a table.
    const asDate = (d) => new Date(d).toISOString().slice(0, 10);

    return {
        amount: toNumeric(amountCents),
        cycle: {
            sequenceNumber: cycle.sequence_number,
            startDate: asDate(cycle.start_date),
            dueDate: asDate(cycle.due_date)
        },
        explanation:
            `Cycle ${cycle.sequence_number} opened on ${asDate(cycle.start_date)} and is still open. ` +
            `A member joining after a cycle has opened owes that cycle in full, so ` +
            `${format(amountCents)} is added to their first obligation.`
    };
}

// ---------------------------------------------------------------------------
// registerMember()
// ---------------------------------------------------------------------------

/**
 * Two-step by design, to satisfy REQ-41.
 *
 *   preview: true   validate, resolve the account, compute the catch-up, and
 *                   return all of it WITHOUT writing anything
 *   preview: false  do it
 *
 * The interface shows the preview to the Secretary, who reads the catch-up
 * figure to the new member, and only then confirms. A member should not
 * discover an obligation after they have joined.
 */
async function registerMember(db, input, { actor, audit, preview = false }) {
    const { errors, phone, valid } = validateRegistration(input);
    if (!valid) {
        throw new BadRequest("Some details need correcting.", { fields: errors });
    }

    const joinDate = input.joinDate || new Date().toISOString().slice(0, 10);
    const role = input.role || "Member";
    const club = await repo.clubType(db);

    // REQ-39: reuse the existing account if this person is already on the
    // system through another club.
    const existing = await repo.findAccountByIdOrPhone(input.idNumber, phone);

    if (existing) {
        // REQ-38.
        const already = await repo.isActiveMemberOfClub(db.clubId, existing.user_id);
        if (already) {
            throw new Conflict(
                `${existing.full_name} is already an active member of this club.`,
                { memberId: already.member_id }
            );
        }
    }

    const catchUp = await previewCatchUp(db, joinDate);

    // REQ-42: rotating clubs place a new member at the end of the queue.
    const queuePosition = club.club_type === "Rotating" ? await repo.nextQueuePosition(db) : null;

    if (preview) {
        return {
            preview: true,
            existingAccount: existing
                ? { fullName: existing.full_name, phone: existing.phone, reused: true }
                : null,
            catchUp,
            queuePosition,
            role,
            joinDate
        };
    }

    // --- write ---------------------------------------------------------
    // One transaction: the account, the membership and the audit entry either
    // all persist or none do.
    const result = await withClubTransaction(db.clubId, async (tx, client) => {
        let userId = existing?.user_id;
        let tempPassword = null;

        if (!existing) {
            tempPassword = temporaryPassword();
            const account = await repo.createAccount(client, {
                fullName: input.fullName.trim(),
                idNumber: String(input.idNumber).trim(),
                phone,
                email: input.email?.trim() || null,
                postalAddress: input.postalAddress?.trim() || null,
                passwordHash: await hashPassword(tempPassword)
            });
            userId = account.user_id;
        } else {
            // The person exists. Fill in any contact detail the other club did
            // not have, but never overwrite one that is already recorded.
            await repo.updateAccountContact(client, userId, {
                phone: null,
                email: input.email?.trim() || null,
                postalAddress: input.postalAddress?.trim() || null
            });
        }

        const member = await repo.createMembership(tx, {
            userId,
            role,
            joinDate,
            queuePosition,
            catchUpAmount: catchUp.amount,
            nextOfKin: input.nextOfKin,
            registeredBy: actor.userId
        });

        return { member, tempPassword, reusedAccount: !!existing };
    });

    await audit("member.register", "Success", {
        detail:
            `${actor.fullName} registered ${input.fullName} as ${role}` +
            (result.reusedAccount ? " (existing account reused)" : " (new account created)") +
            (queuePosition ? `, queue position ${queuePosition}` : ""),
        targetType: "member",
        targetId: result.member.member_id
    });

    return {
        preview: false,
        memberId: result.member.member_id,
        role,
        joinDate,
        queuePosition,
        catchUp,
        reusedAccount: result.reusedAccount,
        // Shown once, to the officer doing the registering, and never stored in
        // recoverable form. If they lose it, it is reset, not retrieved.
        temporaryPassword: result.tempPassword
    };
}

// ---------------------------------------------------------------------------
// assignRole() — REQ-7, REQ-43, REQ-49
// ---------------------------------------------------------------------------

async function assignRole(db, memberId, newRole, { actor, audit }) {
    if (!ROLES.includes(newRole)) {
        throw new BadRequest(`A role must be one of: ${ROLES.join(", ")}.`);
    }

    const member = await repo.getMember(db, memberId);
    if (!member) throw new NotFound("That member was not found in this club.");

    if (member.standing === "Exited") {
        throw new RuleRefusal("That member has exited the club. Their record is kept for the audit trail and cannot be changed.");
    }

    if (member.role === newRole) {
        return { memberId, role: newRole, unchanged: true };
    }

    // REQ-49: a club must at all times have a Chairperson and a Treasurer.
    // Moving this member OUT of an officer role is refused if they are the last
    // person holding it.
    if (OFFICER_ROLES_REQUIRED.includes(member.role)) {
        const others = await repo.countHoldersOfRole(db, member.role, memberId);
        if (others === 0) {
            await audit("member.assignRole", "Refused", {
                detail: `Refused: would leave ${member.full_name}'s club without a ${member.role} (REQ-49)`,
                targetType: "member",
                targetId: memberId
            });
            throw new RuleRefusal(
                `${member.full_name} is the only ${member.role}. Appoint another ${member.role} first — ` +
                `a club may not be left without one.`,
                { requirement: "REQ-49", role: member.role }
            );
        }
    }

    await repo.updateRole(db, memberId, newRole);

    await audit("member.assignRole", "Success", {
        detail: `${actor.fullName} changed ${member.full_name} from ${member.role} to ${newRole}`,
        targetType: "member",
        targetId: memberId
    });

    return { memberId, role: newRole, previousRole: member.role, unchanged: false };
}

// ---------------------------------------------------------------------------

async function listMembers(db, options) {
    const rows = await repo.listMembers(db, options);
    return rows.map((r) => ({
        memberId: r.member_id,
        userId: r.user_id,
        fullName: r.full_name,
        phone: r.phone,
        email: r.email,
        idNumber: r.id_number,
        role: r.role,
        standing: r.standing,
        joinDate: r.join_date,
        exitDate: r.exit_date,
        queuePosition: r.queue_position,
        catchUpAmount: r.catch_up_amount,
        dependantCount: Number(r.dependant_count),
        outstanding: r.outstanding
    }));
}

async function getMember(db, memberId) {
    const m = await repo.getMember(db, memberId);
    if (!m) throw new NotFound("That member was not found in this club.");
    return {
        memberId: m.member_id,
        userId: m.user_id,
        fullName: m.full_name,
        phone: m.phone,
        email: m.email,
        idNumber: m.id_number,
        postalAddress: m.postal_address,
        role: m.role,
        standing: m.standing,
        joinDate: m.join_date,
        exitDate: m.exit_date,
        queuePosition: m.queue_position,
        catchUpAmount: m.catch_up_amount,
        nextOfKin: m.next_of_kin
    };
}

module.exports = {
    ROLES,
    registerMember,
    assignRole,
    listMembers,
    getMember,
    checkIdNumber,
    validateRegistration
};