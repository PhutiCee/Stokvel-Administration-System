"use strict";
const { pool } = require("../../db/pool");
const { BadRequest, Conflict, Forbidden } = require("../../lib/errors");
const { normalisePhone } = require("../auth/auth.repo");
const { validateRegistration } = require("../members/members.service");
const { hashPassword } = require("../../lib/password");
const { temporaryPassword } = require("../../lib/tempPassword");
const ROLES = ["Chairperson", "Treasurer", "Secretary", "Member"];

async function prepareRoster(input, actor) {
  if (!ROLES.includes(input.applicantRole)) throw new BadRequest("Choose your role in the new club.");
  if (!Array.isArray(input.foundingMembers) || input.foundingMembers.length < 3 || input.foundingMembers.length > 100)
    throw new BadRequest("Add the remaining officers and at least one ordinary member (maximum 100 additional people).");
  const { rows } = await pool.query("SELECT * FROM user_account WHERE user_id=$1", [actor.userId]);
  const a = rows[0];
  const self = { fullName:a.full_name, phone:a.phone, email:a.email, postalAddress:a.postal_address,
    idNumber:a.id_number, role:input.applicantRole, userId:actor.userId, nextOfKin:input.nextOfKin || null };
  const roster = [self, ...input.foundingMembers];
  const fields = {}, phones = new Set(), ids = new Set(), emails = new Set();
  for (const [i, person] of roster.entries()) {
    if (!person || typeof person !== 'object') throw new BadRequest("Complete each founding member's details.");
    for (const key of ['fullName','phone','email','postalAddress','idNumber']) {
      if (person[key] != null && typeof person[key] !== 'string') throw new BadRequest("Member details must be text.");
    }
    const check = validateRegistration(person);
    // Existing accounts keep their established identity; new registrations collect the full record.
    if (i === 0) { delete check.errors.idNumber; delete check.errors.nextOfKin; }
    for (const [key, message] of Object.entries(check.errors)) fields[`foundingMembers.${i}.${key}`] = message;
    if (!ROLES.includes(person.role)) fields[`foundingMembers.${i}.role`] = "Choose a valid role.";
    if (person.fullName?.length > 120 || person.email?.length > 160 || person.idNumber?.length > 13)
      fields[`foundingMembers.${i}.fullName`] = "Name, email or identity number is too long.";
    const phone = normalisePhone(person.phone);
    const id = person.idNumber?.trim(); const email = person.email?.trim().toLowerCase();
    if (phones.has(phone) || (id && ids.has(id)) || (email && emails.has(email)))
      fields.foundingMembers = "Each position must belong to a different person with separate contact details.";
    phones.add(phone); if (id) ids.add(id); if (email) emails.add(email);
  }
  for (const role of ROLES) {
    const count = roster.filter(p => p.role === role).length;
    if (role === 'Member' ? count < 1 : count !== 1)
      fields.foundingMembers = "Appoint exactly one Chairperson, one Treasurer, one Secretary and at least one ordinary member.";
  }
  if (Object.keys(fields).length) throw new BadRequest("Complete the founding membership before submitting.", { fields });
  return roster;
}

async function insertRoster(client, club, roster, actor) {
  const result = [], seen = new Set();
  for (const [i, person] of roster.entries()) {
    const phone = normalisePhone(person.phone), id = person.idNumber?.trim() || null;
    const email = person.email?.trim().toLowerCase() || null;
    const { rows } = await client.query(`SELECT user_id,phone,id_number,is_platform_admin,is_system FROM user_account
      WHERE phone=$1 OR ($2::text IS NOT NULL AND id_number=$2) OR ($3::text IS NOT NULL AND lower(email)=$3) FOR UPDATE`, [phone,id,email]);
    if (rows.some(u => u.is_platform_admin || u.is_system)) throw new Forbidden("Platform and system accounts cannot be club members.");
    if (rows.length > 1 || (rows[0] && (rows[0].phone !== phone || (id && rows[0].id_number && rows[0].id_number !== id))))
      throw new Conflict("A member's contact details conflict with an existing account. Ask that person to check their details.");
    let userId = rows[0]?.user_id, password = null;
    if (!userId) {
      password = temporaryPassword();
      const { rows: created } = await client.query(`INSERT INTO user_account(full_name,phone,id_number,email,postal_address,password_hash)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING user_id`, [person.fullName.trim(),phone,id,email,person.postalAddress?.trim() || null,await hashPassword(password)]);
      userId = created[0].user_id;
    }
    if (seen.has(userId)) throw new BadRequest("The same person cannot fill more than one founding position.");
    seen.add(userId);
    const { rows: members } = await client.query(`INSERT INTO member(club_id,user_id,role,queue_position,registered_by,next_of_kin)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING member_id`, [club.club_id,userId,person.role,club.club_type === 'Rotating' ? i+1 : null,actor.userId,JSON.stringify(person.nextOfKin || null)]);
    result.push({ memberId:members[0].member_id, fullName:person.fullName, role:person.role, phone, temporaryPassword:password });
  }
  return result;
}
module.exports = { prepareRoster, insertRoster };
