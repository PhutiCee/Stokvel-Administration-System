"use strict";
const { withClubTransaction } = require("../../db/tx");
const { todayIso } = require("../../lib/dates");
const { versionInForce } = require("../../rules/versioning");
const { evaluateStanding } = require("../../rules/standing");
const repo = require("./standing.repo");
async function checkInTransaction(
  db,
  { actorUserId = null, today = todayIso() } = {},
) {
  const club = await db.one(
    "SELECT status FROM club WHERE club_id=$1 FOR UPDATE",
    [db.clubId],
  );
  if (club.status !== "Active")
    return {
      ran: false,
      reason: "club_suspended",
      changes: [],
      awaitingResolution: [],
    };
  const k = versionInForce(
    await repo.listConstitutionVersions(db, db.clubId),
    today,
  );
  if (
    !k ||
    [
      k.warningAfterMissed,
      k.suspensionAfterMissed,
      k.expulsionAfterMissed,
    ].some((n) => n == null)
  )
    return {
      ran: false,
      reason: "no_standing_thresholds_in_constitution",
      changes: [],
      awaitingResolution: [],
    };
  const members = await repo.listMemberPositions(db, db.clubId, {
    graceDays: k.gracePeriodDays,
    today,
  });
  const changes = [],
    awaitingResolution = [];
  const sender = actorUserId || "00000000-0000-4000-8000-000000000001";
  for (const member of members) {
    // Record each stage even when several thresholds elapsed while the API was off.
    for (let step = 0; step < 3; step++) {
      const r = evaluateStanding(
        {
          ...member,
          missedContributions: Number(member.missedContributions),
          arrearsCents: Number(member.arrearsCents),
          penaltiesOutstandingCents: Number(member.penaltiesOutstandingCents),
          expulsionApproved: false,
        },
        k,
        today,
      );
      if (r.needsResolution) {
        awaitingResolution.push(member.memberId);
        await require("../notifications/notifications.repo").notifyMemberAndOfficers(
          db,
          {
            memberId: member.memberId,
            sentBy: sender,
            key: `expulsion-review:${member.memberId}:${k.version}:${today}`,
            title: "Expulsion review required",
            message:
              "Your arrears have reached the constitution’s expulsion-review threshold. Expulsion requires a member resolution; contact your officers.",
          },
        );
      }
      if (!r.changed) break;
      if (
        !(await repo.updateStanding(
          db,
          db.clubId,
          member.memberId,
          member.standing,
          r.standing,
        ))
      )
        break;
      const change = await repo.recordChange(db, {
        clubId: db.clubId,
        memberId: member.memberId,
        from: member.standing,
        to: r.standing,
        reason: `${r.action}: ${r.reason}`,
        changedOn: today,
        changedBy: actorUserId,
      });
      await require("../notifications/notifications.repo").notifyMemberAndOfficers(
        db,
        {
          memberId: member.memberId,
          sentBy: sender,
          key: `standing:${change.change_id}`,
          title: "Standing updated",
          message: `Your standing changed from ${member.standing} to ${r.standing}. Open your statement or contact your officers.`,
        },
      );
      changes.push({
        memberId: member.memberId,
        from: member.standing,
        to: r.standing,
        action: r.action,
      });
      member.standing = r.standing;
    }
  }
  return {
    ran: true,
    constitutionVersion: k.version,
    checked: members.length,
    changes,
    awaitingResolution,
  };
}
const runStandingCheck = (clubId, options) =>
  withClubTransaction(clubId, (db) => checkInTransaction(db, options));
const standingHistory = (clubId, options) =>
  withClubTransaction(clubId, (db) => repo.listChanges(db, clubId, options));
module.exports = { runStandingCheck, checkInTransaction, standingHistory };

module.exports.summary = async (db) => {
  const k = versionInForce(
    await repo.listConstitutionVersions(db, db.clubId),
    todayIso(),
  );
  const configured =
    !!k &&
    [
      k.warningAfterMissed,
      k.suspensionAfterMissed,
      k.expulsionAfterMissed,
    ].every((n) => n != null);
  const positions = await repo.listMemberPositions(db, db.clubId, {
    graceDays: k?.gracePeriodDays || 0,
    today: todayIso(),
  });
  const names = await db.many(
    "SELECT m.member_id,u.full_name FROM member m JOIN user_account u ON u.user_id=m.user_id WHERE m.club_id=$1",
    [db.clubId],
  );
  return {
    configured,
    thresholds: k,
    members: positions.map((m) => ({
      ...m,
      fullName: names.find((n) => n.member_id === m.memberId)?.full_name,
      needsResolution:
        configured &&
        m.standing === "Suspended" &&
        m.missedContributions >= k.expulsionAfterMissed,
    })),
    history: await repo.listChanges(db, db.clubId, { limit: 100 }),
  };
};
