"use strict";
// Isolated PostgreSQL + real authenticated HTTP requests. No external database.
process.env.DATABASE_URL =
  "postgresql://unused:unused@127.0.0.1/isolated_reversals";
process.env.DATABASE_SSL = "false";
process.env.WEB_ORIGIN = "http://localhost:3100";
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pool } = require("../src/db/pool");
const { todayIso, addDays } = require("../src/lib/dates");
const database = new PGlite({ extensions: { pgcrypto } });
const realEnd = pool.end.bind(pool);
pool.query = (sql, args) => database.query(sql, args);
pool.connect = async () => ({ query: pool.query, release() {} });
const one = async (sql, args) => (await database.query(sql, args)).rows[0];
let server, browser, web;
async function main() {
  for (const f of fs
    .readdirSync(path.join(__dirname, "../src/db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await database.exec(
      fs.readFileSync(path.join(__dirname, "../src/db/migrations", f), "utf8"),
    );
  const clubs = [];
  for (let i = 0; i < 2; i++) {
    clubs.push(
      await one(
        "INSERT INTO club(name,short_name,club_type) VALUES($1,$2,'Rotating') RETURNING *",
        [`Screen club ${i}`, `SC${i}`],
      ),
    );
    await one(
      `INSERT INTO constitution(club_id,version,effective_date,contribution_amount,cycle_start_date,payout_order_method)
      VALUES($1,1,$2,100,$2,'Negotiated') RETURNING *`,
      [clubs[i].club_id, addDays(todayIso(), -30)],
    );
  }
  const people = [];
  for (let i = 0; i < 6; i++) {
    const user = await one(
      "INSERT INTO user_account(phone,full_name,password_hash,postal_address) VALUES($1,$2,'test','Test town') RETURNING *",
      [`083000000${i}`, `Screen user ${i}`],
    );
    const member = await one(
      "INSERT INTO member(club_id,user_id,role,join_date) VALUES($1,$2,$3,$4) RETURNING *",
      [
        clubs[i === 5 ? 1 : 0].club_id,
        user.user_id,
        [
          "Chairperson",
          "Treasurer",
          "Secretary",
          "Member",
          "Member",
          "Chairperson",
        ][i],
        addDays(todayIso(), -20),
      ],
    );
    const token = crypto.randomBytes(32).toString("hex");
    await database.query(
      "INSERT INTO session(user_id,active_club_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [
        user.user_id,
        member.club_id,
        crypto.createHash("sha256").update(token).digest("hex"),
      ],
    );
    people.push({ user, member, token });
  }
  server = require("../src/app").createApp().listen(4000, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function req(url, who = 0, method = "GET", body) {
    const multipart = body instanceof FormData;
    return fetch(origin + url, {
      method,
      headers: {
        Cookie: `sas_session=${people[who].token}`,
        ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
      },
      body: multipart ? body : body ? JSON.stringify(body) : undefined,
    });
  }
  async function json(url, who, method, body, status = 200) {
    const r = await req(url, who, method, body);
    const d = await r.json();
    assert.equal(r.status, status, JSON.stringify(d));
    return d;
  }

  // Real API permission and tenant checks for the merged teammate modules.
  await json(
    "/api/notifications",
    3,
    "POST",
    { title: "No", message: "Forbidden" },
    403,
  );
  await json(
    "/api/notifications",
    2,
    "POST",
    { title: "Fixture notice", message: "Isolated test only" },
    201,
  );
  assert.equal((await json("/api/notifications", 3)).notifications.length, 1);
  assert.equal((await json("/api/notifications", 5)).notifications.length, 0);
  await json("/api/reconciliation", 3, "POST", { bankBalance: "0.00" }, 403);
  await json(
    "/api/reconciliation",
    1,
    "POST",
    { bankBalance: "0.00", asAtDate: "2026-02-30" },
    400,
  );
  await json("/api/reconciliation", 1, "POST", { bankBalance: "5.00" }, 400);
  await json(
    "/api/reconciliation",
    1,
    "POST",
    { bankBalance: "0.00", asAtDate: todayIso() },
    201,
  );
  assert.equal(
    (await json("/api/reconciliation", 5)).reconciliations.length,
    0,
  );
  const cycle = await one(
    "INSERT INTO cycle(club_id,sequence_number,start_date,due_date,status) VALUES($1,1,$2,$3,'Open') RETURNING *",
    [clubs[0].club_id, addDays(todayIso(), -10), addDays(todayIso(), -1)],
  );
  const bill = await one(
    "INSERT INTO contribution(club_id,cycle_id,member_id,expected_amount) VALUES($1,$2,$3,100) RETURNING *",
    [clubs[0].club_id, cycle.cycle_id, people[3].member.member_id],
  );
  await database.query(
    "UPDATE member SET queue_position=CASE WHEN member_id=$2 THEN 1 WHEN member_id=$3 THEN 2 ELSE NULL END WHERE club_id=$1",
    [clubs[0].club_id, people[3].member.member_id, people[4].member.member_id],
  );
  const { spawn } = require("node:child_process");
  web = spawn(
    process.execPath,
    [
      path.resolve(__dirname, "../../node_modules/next/dist/bin/next"),
      "start",
      "--port",
      "3100",
      "--hostname",
      "127.0.0.1",
    ],
    { cwd: path.resolve(__dirname, "../../web"), stdio: "inherit" },
  );
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch("http://localhost:3100/login")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  const errors = [];
  async function pageFor(who, width = 1440) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    await context.addCookies([
      {
        name: "sas_session",
        value: people[who].token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    return page;
  }
  async function visit(page, url) {
    await page.goto("http://localhost:3100" + url);
    await page.getByRole("heading", { level: 1 }).waitFor();
  }
  async function confirm(page, label = "Confirm") {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  const treasurer = await pageFor(1),
    chair = await pageFor(0),
    member = await pageFor(3, 390);
  await visit(treasurer, "/contributions");
  await treasurer
    .getByRole("button", { name: "Capture", exact: true })
    .first()
    .click();
  await treasurer.getByRole("button", { name: /^Capture R/ }).click();
  assert.equal(
    (
      await one(
        "SELECT captured_amount FROM contribution WHERE contribution_id=$1",
        [bill.contribution_id],
      )
    ).captured_amount,
    "0.00",
  );
  await treasurer.keyboard.press("Escape");
  await treasurer.getByRole("dialog").waitFor({ state: "hidden" });
  await treasurer.getByRole("button", { name: /^Capture R/ }).click();
  await confirm(treasurer, "Record receipt");
  assert.equal(
    (
      await one(
        "SELECT captured_amount FROM contribution WHERE contribution_id=$1",
        [bill.contribution_id],
      )
    ).captured_amount,
    "100.00",
  );
  await visit(treasurer, "/ledger");
  await treasurer
    .getByRole("button", { name: "Reverse", exact: true })
    .first()
    .click();
  await treasurer
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Incorrect receipt test");
  await confirm(treasurer, "Post reversal");
  assert.equal(
    (
      await one(
        "SELECT captured_amount FROM contribution WHERE contribution_id=$1",
        [bill.contribution_id],
      )
    ).captured_amount,
    "0.00",
  );
  await visit(treasurer, "/contributions");
  await treasurer
    .getByRole("button", { name: "Capture", exact: true })
    .first()
    .click();
  await treasurer.getByRole("button", { name: /^Capture R/ }).click();
  await confirm(treasurer, "Record receipt");
  await visit(treasurer, "/contributions");
  await treasurer
    .getByRole("button", { name: "Close cycle", exact: true })
    .click();
  await treasurer
    .getByRole("dialog")
    .getByText(/Unpaid debts remain due/)
    .waitFor();
  await confirm(treasurer, "Close cycle");
  await treasurer.getByText("No cycle is open", { exact: true }).waitFor();
  await visit(treasurer, "/payouts");
  await treasurer.getByRole("button", { name: /^Initiate payout of/ }).click();
  await confirm(treasurer);
  await visit(chair, "/payouts");
  await chair.getByRole("button", { name: /^Approve/ }).click();
  await confirm(chair);
  assert.equal(
    (
      await one("SELECT queue_position FROM member WHERE member_id=$1", [
        people[3].member.member_id,
      ])
    ).queue_position,
    2,
  );
  await visit(treasurer, "/ledger");
  await treasurer
    .getByRole("button", { name: "Request reversal", exact: true })
    .first()
    .click();
  await treasurer
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Bank rejected transfer");
  await confirm(treasurer, "Request approval");
  await visit(chair, "/ledger");
  await chair
    .getByRole("button", { name: "Approve reversal", exact: true })
    .click();
  await confirm(chair);
  await treasurer.reload();
  await treasurer
    .getByRole("button", { name: "Post approved reversal", exact: true })
    .click();
  await confirm(treasurer);
  assert.equal(
    (
      await one("SELECT queue_position FROM member WHERE member_id=$1", [
        people[3].member.member_id,
      ])
    ).queue_position,
    1,
  );
  await visit(member, "/dashboard");
  await member.getByRole("button", { name: "Menu", exact: true }).click();
  await member
    .getByRole("navigation", { name: "Club sections" })
    .waitFor({ state: "visible" });
  await member
    .getByRole("link", { name: "Notifications", exact: true })
    .click();
  await member.getByText("Fixture notice", { exact: true }).waitFor();
  assert.equal(
    await member.getByRole("navigation", { name: "Club sections" }).isVisible(),
    false,
  );
  assert.equal(
    await member.getByRole("button", { name: /Send notification/ }).count(),
    0,
  );
  assert(
    await member.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await visit(treasurer, "/reconciliation");
  await treasurer
    .getByRole("heading", { name: "Reconciliation", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real browser capture confirmation, receipt reversal and recapture, payout initiation/approval, reversal request/approval/post, mobile navigation, member permissions; merged routes validate dates and isolate clubs.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (web) web.kill();
    if (server) await new Promise((r) => server.close(r));
    await database.close();
    await realEnd();
  });
