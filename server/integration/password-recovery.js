"use strict";
process.env.DATABASE_URL =
  "postgresql://unused:unused@127.0.0.1/password_recovery_test";
process.env.DATABASE_SSL = "false";
process.env.WEB_ORIGIN = "http://localhost:3000";
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pool } = require("../src/db/pool");
const { env } = require("../src/config/env");
const { hashPassword, verifyPassword } = require("../src/lib/password");
const {
  Conflict,
  BadRequest,
  ServiceUnavailable,
  Unauthorised,
} = require("../src/lib/errors");
const database = new PGlite({ extensions: { pgcrypto } });
const realEnd = pool.end.bind(pool);
pool.query = (sql, args) => database.query(sql, args);
pool.connect = async () => ({ query: pool.query, release() {} });
const one = async (sql, args) => (await database.query(sql, args)).rows[0];

async function main() {
  for (const file of fs
    .readdirSync(path.join(__dirname, "../src/db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await database.exec("BEGIN");
    await database.exec(
      fs.readFileSync(
        path.join(__dirname, "../src/db/migrations", file),
        "utf8",
      ),
    );
    await database.exec("COMMIT");
  }
  env.BREVO_API_KEY = "test-key";
  env.MAIL_FROM = "test@example.invalid";
  env.MAIL_FROM_NAME = "Stokvel Test";
  const originalFetch = global.fetch;
  let sent, server;
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(options.headers["api-key"], "test-key");
    sent = JSON.parse(options.body);
    assert.deepEqual(sent.sender, {
      email: "test@example.invalid",
      name: "Stokvel Test",
    });
    assert.ok(sent.htmlContent.includes("Reset my password"));
    return { ok: true };
  };
  try {
    const password = await hashPassword("Old-password-2026");
    const user = await one(
      `INSERT INTO user_account(full_name,phone,email,password_hash)
      VALUES('Recovery user','0821234567','recovery@example.invalid',$1) RETURNING *`,
      [password],
    );
    await database.query(
      `INSERT INTO session(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')`,
      [
        user.user_id,
        crypto.createHash("sha256").update("session-token").digest("hex"),
      ],
    );
    const recovery = require("../src/modules/auth/password-recovery.service");
    const auth = require("../src/modules/auth/auth.service");
    env.BREVO_API_KEY = null;
    await assert.rejects(
      () => recovery.requestPasswordReset(user.phone),
      ServiceUnavailable,
    );
    env.BREVO_API_KEY = "test-key";
    await assert.rejects(
      () => recovery.requestPasswordReset({ phone: user.phone }),
      BadRequest,
    );
    await assert.rejects(
      () => recovery.resetPassword("bad-token", "New-password-2026"),
      BadRequest,
    );
    const unknown = await recovery.requestPasswordReset("0820000000", {
      ipAddress: "127.0.0.1",
    });
    const requested = await recovery.requestPasswordReset("082 123 4567", {
      ipAddress: "127.0.0.1",
    });
    assert.deepEqual(
      unknown,
      requested,
      "Unknown and known account responses must match",
    );
    assert.equal(sent.to[0].email, "recovery@example.invalid");
    const resetUrl = sent.textContent.match(/http[^\s]+/)[0];
    const token = new URL(resetUrl).searchParams.get("token");
    assert.match(token, /^[a-f0-9]{64}$/);
    const stored = await one(
      "SELECT * FROM password_reset_token WHERE user_id=$1",
      [user.user_id],
    );
    assert.notEqual(
      stored.token_hash,
      token,
      "Database must contain only the token hash",
    );
    assert.ok(new Date(stored.expires_at) > new Date());
    await one(
      `INSERT INTO user_account(full_name,phone,postal_address,password_hash)
      VALUES('No email user','0827654321','Test address',$1) RETURNING *`,
      [password],
    );
    const beforeNoEmail = sent;
    assert.deepEqual(
      await recovery.requestPasswordReset("0827654321"),
      requested,
    );
    assert.equal(
      sent,
      beforeNoEmail,
      "Accounts without email must not receive a reset message",
    );
    await assert.rejects(
      () => recovery.resetPassword(token, "short"),
      BadRequest,
    );
    await assert.rejects(
      () => recovery.resetPassword(token, "x".repeat(129)),
      BadRequest,
    );
    await database.query(
      "UPDATE user_account SET failed_attempts=5,locked_until=now()+interval '15 minutes' WHERE user_id=$1",
      [user.user_id],
    );

    await recovery.resetPassword(token, "New-password-2026");
    const changed = await one(
      "SELECT password_hash,failed_attempts,locked_until FROM user_account WHERE user_id=$1",
      [user.user_id],
    );
    assert.ok(await verifyPassword("New-password-2026", changed.password_hash));
    assert.equal(changed.failed_attempts, 0);
    assert.equal(changed.locked_until, null);
    assert.equal(
      await one("SELECT terminated_at FROM session WHERE user_id=$1", [
        user.user_id,
      ]).then((r) => !!r.terminated_at),
      true,
    );
    await assert.rejects(
      () => recovery.resetPassword(token, "Another-password-2026"),
      Conflict,
    );
    await assert.rejects(
      () =>
        auth.authenticate({
          identifier: user.phone,
          password: "Old-password-2026",
        }),
      Unauthorised,
    );
    // Simulate a login paused after verifying the old password: it cannot mint
    // a session with that stale verification after the reset commits.
    await assert.rejects(
      () =>
        auth.establishSession({
          userId: user.user_id,
          expectedPasswordHash: password,
        }),
      Unauthorised,
    );
    assert.ok(
      (
        await auth.authenticate({
          identifier: user.phone,
          password: "New-password-2026",
        })
      ).token,
    );

    await recovery.requestPasswordReset("0821234567");
    const superseded = new URL(
      sent.textContent.match(/http[^\s]+/)[0],
    ).searchParams.get("token");
    for (let i = 0; i < 3; i++)
      await recovery.requestPasswordReset("0821234567");
    await assert.rejects(
      () => recovery.resetPassword(superseded, "Another-password-2026"),
      Conflict,
    );
    const latestDelivery = sent;
    assert.deepEqual(
      await recovery.requestPasswordReset("0821234567"),
      requested,
    );
    assert.equal(
      sent,
      latestDelivery,
      "Per-account throttling must not reveal account existence",
    );
    const expiredToken = new URL(
      sent.textContent.match(/http[^\s]+/)[0],
    ).searchParams.get("token");
    await database.query(
      "UPDATE password_reset_token SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND used_at IS NULL",
      [user.user_id],
    );
    await assert.rejects(
      () => recovery.resetPassword(expiredToken, "Third-password-2026"),
      Conflict,
    );
    const httpUser = await one(
      `INSERT INTO user_account(full_name,phone,email,password_hash)
      VALUES('HTTP recovery user','0822222222','http@example.invalid',$1) RETURNING *`,
      [password],
    );
    // Provider failures use the same public reply and invalidate that token.
    const sendEmail = global.fetch;
    global.fetch = async () => {
      throw new Error("Simulated provider outage");
    };
    assert.deepEqual(
      await recovery.requestPasswordReset(httpUser.phone),
      requested,
    );
    assert.equal(
      (
        await one(
          "SELECT count(*)::int AS count FROM password_reset_token WHERE user_id=$1 AND used_at IS NULL",
          [httpUser.user_id],
        )
      ).count,
      0,
    );
    global.fetch = sendEmail;

    server = require("../src/app").createApp().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const post = (route, body) =>
      originalFetch(origin + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const login = await post("/api/auth/login", {
      identifier: httpUser.phone,
      password: "Old-password-2026",
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const request = await post("/api/auth/forgot-password", {
      identifier: httpUser.phone,
    });
    assert.equal(request.status, 202);
    assert.equal(request.headers.get("cache-control"), "no-store");
    assert.deepEqual(await request.json(), requested);
    const httpToken = new URL(
      sent.textContent.match(/http[^\s]+/)[0],
    ).searchParams.get("token");
    const reset = await post("/api/auth/reset-password", {
      token: httpToken,
      password: "Changed-via-HTTP-2026",
    });
    assert.equal(reset.status, 200);
    assert.ok(reset.headers.get("set-cookie").includes("sas_session=;"));
    const oldSession = await originalFetch(origin + "/api/auth/me", {
      headers: { Cookie: cookie },
    });
    assert.equal(oldSession.status, 401);
    assert.equal(
      (
        await post("/api/auth/login", {
          identifier: httpUser.phone,
          password: "Old-password-2026",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await post("/api/auth/login", {
          identifier: httpUser.phone,
          password: "Changed-via-HTTP-2026",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/api/auth/reset-password", {
          token: httpToken,
          password: "Reused-password-2026",
        })
      ).status,
      409,
    );
    for (let i = 0; i < 9; i++) {
      assert.equal(
        (await post("/api/auth/forgot-password", { identifier: "0820000000" }))
          .status,
        202,
      );
    }
    const limited = await post("/api/auth/forgot-password", {
      identifier: "0820000000",
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    for (let i = 0; i < 8; i++) {
      assert.equal(
        (
          await post("/api/auth/reset-password", {
            token: "invalid",
            password: "Changed-via-HTTP-2026",
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await post("/api/auth/reset-password", {
          token: "invalid",
          password: "Changed-via-HTTP-2026",
        })
      ).status,
      429,
    );
    console.log(
      "Password recovery passed: validation, generic replies, provider failure, hashed expiring one-use tokens, superseded links, lockout clearing, session revocation, stale-login prevention, HTTP login and request limits. Email delivery was mocked.",
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
    await database.close();
    await realEnd();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
