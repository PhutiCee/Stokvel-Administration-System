"use strict";
// Isolated PostgreSQL + real authenticated HTTP requests. No external database.
process.env.DATABASE_URL =
  "postgresql://unused:unused@127.0.0.1/isolated_reversals";
process.env.DATABASE_SSL = "false";
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
let server;
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
      `INSERT INTO constitution(club_id,version,effective_date,contribution_amount,cycle_start_date,payout_order_method,penalty_amount,grace_period_days)
      VALUES($1,1,$2,100,$2,'Negotiated',25,0) RETURNING *`,
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
  server = require("../src/app").createApp().listen(0, "127.0.0.1");
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

  const ledger = require("../src/modules/ledger/ledger.service");
  const contribution = require("../src/modules/contributions/contributions.service");
  const reversals = require("../src/modules/ledger/reversals.service");
  const { forClub } = require("../src/db/pool");
  const db = forClub(clubs[0].club_id);
  const ctx = (who) => ({
    actor: {
      userId: people[who].user.user_id,
      memberId: people[who].member.member_id,
      fullName: people[who].user.full_name,
      role: people[who].member.role,
    },
    audit: async () => {},
  });
  const memberId = people[3].member.member_id;
  async function makeCycle(seq, status = "Open") {
    return one(
      `INSERT INTO cycle(club_id,sequence_number,start_date,due_date,status,closed_at) VALUES($1,$2,$3,$4,$5::cycle_status,CASE WHEN $5::text='Closed' THEN now() ELSE NULL END) RETURNING *`,
      [
        db.clubId,
        seq,
        addDays(todayIso(), -10),
        addDays(todayIso(), status === "Closed" ? -1 : 10),
        status,
      ],
    );
  }
  async function bill(cycle, amount = "100.00") {
    return one(
      "INSERT INTO contribution(club_id,cycle_id,member_id,expected_amount) VALUES($1,$2,$3,$4) RETURNING *",
      [db.clubId, cycle.cycle_id, memberId, amount],
    );
  }

  const created = await json('/api/cycles',1,'POST',{startDate:addDays(todayIso(),-10),dueDate:addDays(todayIso(),-1)},201);
  const cycleId=created.cycleId;
  const first=await one('SELECT * FROM contribution WHERE cycle_id=$1 AND member_id=$2',[cycleId,memberId]);
  await json('/api/cycles/'+cycleId+'/close',3,'POST',{},403);
  await json('/api/cycles/'+cycleId+'/close',0,'POST',{},403);
  await json('/api/cycles/not-an-id/close',1,'POST',{},400);
  const foreign=await one("INSERT INTO cycle(club_id,sequence_number,start_date,due_date) VALUES($1,1,$2,$2) RETURNING *",[clubs[1].club_id,todayIso()]);
  await json('/api/cycles/'+foreign.cycle_id+'/close',1,'POST',{},404);
  const receipt=await json('/api/contributions/'+first.contribution_id+'/capture',1,'POST',{amount:'100.00',method:'Cash'});
  assert.equal((await ledger.getPoolBalance(db)).balance,'100.00');
  assert.equal((await ledger.getPoolBalance(db)).recordedBalance,'125.00');
  const answer=await json('/api/assistant',3,'POST',{question:'What do I owe?'});
  assert.match(answer.answer,/25.00/); assert.doesNotMatch(answer.answer,/no outstanding/);
  const poolAnswer=await json('/api/assistant',3,'POST',{question:'What is the pool balance?'});
  assert.match(poolAnswer.answer,/Pool balance.*100.00/); assert.doesNotMatch(poolAnswer.answer,/currently owe/);
  const penalty=await one('SELECT * FROM penalty WHERE member_id=$1',[memberId]);
  await json('/api/contributions/penalties/'+penalty.penalty_id+'/waive',0,'POST',{reason:'Approved exceptional waiver'});
  assert.equal((await ledger.getPoolBalance(db)).balance,'100.00');
  const other=await one('SELECT * FROM contribution WHERE cycle_id=$1 AND member_id=$2',[cycleId,people[4].member.member_id]);
  const excess=await json('/api/contributions/'+other.contribution_id+'/capture',1,'POST',{amount:'125.00',method:'Cash'});
  assert.equal(excess.allocations[0].type,'penalty'); assert.equal(excess.allocations[0].amount,'25.00');
  assert.equal((await one('SELECT credit_amount FROM member WHERE member_id=$1',[people[4].member.member_id])).credit_amount,'0.00');
  assert.equal((await ledger.getPoolBalance(db)).balance,'225.00');
  const repo=require('../src/modules/contributions/contributions.repo');
  const realClose=repo.closeCycle;
  repo.closeCycle=async()=>{throw Error('Injected close failure');};
  await json('/api/cycles/'+cycleId+'/close',1,'POST',{},500);
  repo.closeCycle=realClose;
  assert.equal((await one('SELECT count(*)::int n FROM penalty WHERE club_id=$1',[db.clubId])).n,2);
  assert.equal((await one('SELECT status FROM cycle WHERE cycle_id=$1',[cycleId])).status,'Open');
  const close=await json('/api/cycles/'+cycleId+'/close',1,'POST',{});
  assert.equal(close.penaltiesLevied,3);
  assert.equal((await one('SELECT closed_by FROM cycle WHERE cycle_id=$1',[cycleId])).closed_by,people[1].user.user_id);
  await json('/api/cycles/'+cycleId+'/close',1,'POST',{},409);
  assert.equal((await ledger.getPoolBalance(db)).balance,'225.00');
  await assert.rejects(database.query("UPDATE cycle SET status='Open' WHERE cycle_id=$1",[cycleId]),/closed cycle/);
  await json('/api/contributions/'+first.contribution_id+'/capture',1,'POST',{amount:'1.00',method:'Cash'},422);
  const next=await json('/api/cycles',1,'POST',{},201);
  await json('/api/cycles/'+next.cycleId+'/close',1,'POST',{},422);
  const dashboard=await json('/api/dashboard',1);
  assert.equal(dashboard.poolBalance,'225.00');
  const statement=await ledger.generateMemberStatement(db,memberId);
  assert.equal(statement.summary.netPosition,'100.00');
  assert.equal(statement.lines.at(-1).runningTotal,'100.00');
  const book=await ledger.listEntries(db);
  assert.equal(book[0].resulting_balance,'225.00');
  const currentBalance=await require('../src/modules/reconciliation/reconciliation.repo').ledgerBalance(db,todayIso());
  assert.equal(currentBalance,'225.00');
  const {withClubTransaction}=require('../src/db/tx');
  await withClubTransaction(db.clubId,async tx=>{
    const interest=await ledger.appendEntry(tx,{clubId:db.clubId,entryType:'Interest',amount:'10.00',description:'Interest correction test',postedBy:people[1].user.user_id});
    await ledger.appendEntry(tx,{clubId:db.clubId,entryType:'Reversal',amount:'-10.00',description:'Interest correction',reason:'Bank corrected interest',reversesId:interest.entryId,postedBy:people[1].user.user_id});
  });
  const period=await require('../src/modules/distributions/distributions.repo').periodFinancialTotals(db,{periodStart:addDays(todayIso(),-1),periodEnd:todayIso()});
  assert.equal(period.interest,'0.00');
  assert.equal((await one('SELECT cash_resulting_balance FROM ledger_entry WHERE entry_id=$1',[receipt.ledger.entryId])).cash_resulting_balance,'100.00');
  console.log('PASS: authenticated cycle close/open, roles/tenancy, grace refusal, immutable closure, once-only unpaid penalties and injected rollback.');
  console.log('PASS: assessments and waivers never move cash; excess settles newly assessed penalty; assistant debts/pool intent, dashboard, ledger, statement and reconciliation agree.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await database.close();await realEnd();});
