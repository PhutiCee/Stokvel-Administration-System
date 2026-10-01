"use strict";
const { toCents, toNumeric } = require("../lib/money");
const { BadRequest } = require("../lib/errors");
function validate(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 20)
    throw new BadRequest("Nominate between 1 and 20 beneficiaries.");
  let total = 0;
  const result = rows.map((r) => {
    if (
      !r ||
      typeof r.name !== "string" ||
      !r.name.trim() ||
      r.name.trim().length > 120 ||
      typeof r.relationship !== "string" ||
      !r.relationship.trim() ||
      r.relationship.trim().length > 60 ||
      !/^\d{1,3}(\.\d{1,2})?$/.test(String(r.share))
    )
      throw new BadRequest(
        "Each beneficiary needs a name, relationship and percentage with at most two decimals.",
      );
    const share = toCents(String(r.share));
    if (share <= 0 || share > 10000)
      throw new BadRequest(
        "Each share must be greater than zero and at most 100%.",
      );
    total += share;
    return {
      name: r.name.trim(),
      relationship: r.relationship.trim(),
      share: toNumeric(share),
    };
  });
  if (total !== 10000)
    throw new BadRequest("Beneficiary shares must total exactly 100%.");
  return result;
}
module.exports = { validate };
