"use strict";
const repo = require("./beneficiaries.repo");
const { withClubTransaction } = require("../../db/tx");
const { validate } = require("../../rules/beneficiaries");
async function save(db, input, { actor, audit }) {
  try {
    const rows = validate(input.beneficiaries);
    const result = await withClubTransaction(db.clubId, async (tx) => {
      await tx.one("SELECT club_id FROM club WHERE club_id=$1 FOR UPDATE", [
        db.clubId,
      ]);
      return repo.replace(tx, actor.memberId, rows);
    });
    await audit("beneficiary.nominate", "Success", {
      targetType: "member",
      targetId: actor.memberId,
      detail: `Recorded ${rows.length} beneficiaries totalling 100%.`,
    });
    return result;
  } catch (e) {
    if (e.status)
      await audit("beneficiary.nominate", "Refused", { detail: e.message });
    throw e;
  }
}
module.exports = { list: repo.list, save, validate };
