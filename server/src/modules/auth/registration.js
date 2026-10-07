"use strict";
const { pool } = require("../../db/pool");
const { BadRequest, Conflict, TooManyAttempts } = require("../../lib/errors");
const { validateRegistration } = require("../members/members.service");
const { hashPassword } = require("../../lib/password");
// Public registration is bounded per process, before expensive password hashing.
const attempts = new Map();
function limitRegistration(req, res, next) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  const key = req.ip;
  const entry = attempts.get(key) || { count:0, until:now+15*60*1000 };
  attempts.set(key, entry);
  if (++entry.count > 10) return next(new TooManyAttempts("Too many registration attempts. Try again in 15 minutes."));
  next();
}
async function register(input) {
  for (const key of ['fullName','phone','idNumber','email','postalAddress','password'])
    if (input[key] != null && typeof input[key] !== 'string') throw new BadRequest("Enter valid account details.");
  const { errors, phone } = validateRegistration({...input,role:'Member'});
  delete errors.nextOfKin;
  if (input.fullName?.length > 120 || input.email?.length > 160 || input.idNumber?.length > 13) errors.fullName = "Account details exceed the allowed length.";
  if (typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 128)
    errors.password = "Use a password between 10 and 128 characters.";
  if (Object.keys(errors).length) throw new BadRequest("Check your account details.", { fields:errors });
  const email = input.email?.trim().toLowerCase() || null, id = input.idNumber.trim();
  const existing = await pool.query("SELECT 1 FROM user_account WHERE phone=$1 OR id_number=$2 OR ($3::text IS NOT NULL AND lower(email)=$3)", [phone,id,email]);
  if (existing.rows.length) throw new Conflict("An account uses these details. Sign in with your existing account or contact your secretary.");
  await pool.query(`INSERT INTO user_account(full_name,phone,id_number,email,postal_address,password_hash)
    VALUES($1,$2,$3,$4,$5,$6)`, [input.fullName.trim(),phone,id,email,input.postalAddress?.trim() || null,await hashPassword(input.password)]);
  return { ok:true };
}
module.exports = { register, limitRegistration };
