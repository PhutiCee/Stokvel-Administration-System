"use strict";

const crypto = require("node:crypto");
const { pool } = require("../../db/pool");
const { env } = require("../../config/env");
const { hashPassword } = require("../../lib/password");
const { normalisePhone } = require("./auth.repo");
const { BadRequest, Conflict, ServiceUnavailable } = require("../../lib/errors");

const GENERIC_MESSAGE = "If an account has that phone number and a registered email, we’ll send a password reset link. Otherwise, contact your club secretary.";
const RESET_TTL_MINUTES = 30;

function assertMailConfigured() {
  if (!env.BREVO_API_KEY || !env.MAIL_FROM) {
    throw new ServiceUnavailable("Password recovery is not configured yet. Contact your club secretary.");
  }
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.MAIL_FROM)) {
    throw new ServiceUnavailable("MAIL_FROM must be the plain email address verified as a sender in Brevo.");
  }
  let origin;
  try { origin = new URL(env.WEB_ORIGIN); } catch { /* handled below */ }
  if (!origin || !["http:", "https:"].includes(origin.protocol) ||
      origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname !== "/" || (env.isProduction && origin.protocol !== "https:")) {
    throw new ServiceUnavailable("Password recovery has an invalid web address configuration. Contact your administrator.");
  }
}

async function deliverResetEmail(email, fullName, token) {
  const url = `${env.WEB_ORIGIN.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
      to: [{ email }],
      subject: "Reset your Stokvel Ledger password",
      textContent: `Hello ${fullName},\n\nUse this one-time link to reset your password. It expires in ${RESET_TTL_MINUTES} minutes.\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
      htmlContent: `<p>Hello ${escapeHtml(fullName)},</p><p>Use the link below to reset your password. It expires in ${RESET_TTL_MINUTES} minutes and can only be used once.</p><p><a href="${url}">Reset my password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    // Do not log provider bodies, which can contain recipient details.
    console.error("[password recovery] Email provider refused the message:", response.status);
    throw new Error("The recovery email could not be delivered.");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

async function requestPasswordReset(identifier, { ipAddress = null } = {}) {
  assertMailConfigured();
  if (typeof identifier !== "string" || !identifier.trim() || identifier.length > 32) {
    throw new BadRequest("Enter the phone number used to sign in.");
  }
  const phone = normalisePhone(identifier);
  if (!phone || !/^0\d{9}$/.test(phone)) return { message: GENERIC_MESSAGE };

  const client = await pool.connect();
  let token = null, account = null, resetId = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT user_id, full_name, email FROM user_account
        WHERE phone=$1 AND NOT is_system FOR UPDATE`, [phone]);
    account = rows[0];
    if (!account?.email) {
      await client.query("COMMIT");
      return { message: GENERIC_MESSAGE };
    }
    const recent = await client.query(
      `SELECT count(*)::int AS count FROM password_reset_token
        WHERE user_id=$1 AND requested_at > now() - interval '1 hour'`, [account.user_id]);
    if (recent.rows[0].count >= 5) {
      await client.query("COMMIT");
      // Keep the same response for known and unknown accounts.
      return { message: GENERIC_MESSAGE };
    }
    token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await client.query("UPDATE password_reset_token SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [account.user_id]);
    const inserted = await client.query(
      `INSERT INTO password_reset_token(user_id, token_hash, expires_at, request_ip)
       VALUES($1,$2,now() + interval '30 minutes',$3) RETURNING reset_id`,
      [account.user_id, tokenHash, ipAddress]);
    resetId = inserted.rows[0].reset_id;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  try {
    await deliverResetEmail(account.email, account.full_name, token);
  } catch (error) {
    await pool.query("UPDATE password_reset_token SET used_at=now() WHERE reset_id=$1 AND used_at IS NULL", [resetId]);
    console.error("[password recovery] Could not deliver a reset email:", error.message);
  }
  return { message: GENERIC_MESSAGE };
}

async function resetPassword(token, newPassword) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw new BadRequest("This reset link is invalid or has expired. Request a new one.");
  }
  if (typeof newPassword !== "string" || newPassword.length < 10 || newPassword.length > 128) {
    throw new BadRequest("Use a password between 10 and 128 characters.");
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT reset_id,user_id FROM password_reset_token WHERE token_hash=$1`, [tokenHash]);
    if (!found.rows[0]) throw new Conflict("This reset link is invalid, expired or already used. Request a new one.");
    const { reset_id: resetId, user_id: userId } = found.rows[0];
    // Use the same lock order as reset requests (account, then token) so a
    // request arriving during a reset cannot deadlock the two transactions.
    await client.query("SELECT user_id FROM user_account WHERE user_id=$1 FOR UPDATE", [userId]);
    const valid = await client.query(
      `SELECT reset_id FROM password_reset_token
        WHERE reset_id=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [resetId]);
    if (!valid.rows[0]) throw new Conflict("This reset link is invalid, expired or already used. Request a new one.");
    const passwordHash = await hashPassword(newPassword);
    const consumed = await client.query("UPDATE password_reset_token SET used_at=now() WHERE reset_id=$1 AND used_at IS NULL RETURNING reset_id", [resetId]);
    if (!consumed.rows[0]) throw new Conflict("This reset link has already been used. Request a new one.");
    await client.query("UPDATE user_account SET password_hash=$2,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=$1", [userId, passwordHash]);
    await client.query("UPDATE session SET terminated_at=COALESCE(terminated_at,now()) WHERE user_id=$1", [userId]);
    await client.query("UPDATE password_reset_token SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true };
}

module.exports = { requestPasswordReset, resetPassword, GENERIC_MESSAGE };
