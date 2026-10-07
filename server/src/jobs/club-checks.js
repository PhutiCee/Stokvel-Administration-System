"use strict";
const { pool } = require("../db/pool");
const { withClubTransaction } = require("../db/tx");
const contributions = require("../modules/contributions/contributions.service");
const standing = require("../modules/standing/standing.service");
const { todayIso } = require("../lib/dates");
const SYSTEM_USER = "00000000-0000-4000-8000-000000000001";
async function runClubChecks() {
  // Platform enumeration only; each club's actual work uses a scoped transaction.
  const { rows } = await pool.query("SELECT club_id FROM club WHERE status='Active' ORDER BY club_id");
  for (const club of rows) {
    try {
      await withClubTransaction(club.club_id, async tx => {
        const locked = await tx.one("SELECT status FROM club WHERE club_id=$1 FOR UPDATE", [tx.clubId]);
        if (locked.status !== "Active") return;
        await contributions.sweepLateContributions(tx, { userId:SYSTEM_USER });
        await standing.checkInTransaction(tx, { actorUserId:SYSTEM_USER, today:todayIso() });
      });
    } catch (error) { console.error("[club-checks]", club.club_id, error.message); }
  }
}
function startClubChecks() {
  let running = false;
  const run = async () => { if (running) return; running=true; try {await runClubChecks();} catch(e) {console.error("[club-checks]",e.message);} finally {running=false;} };
  void run();
  const timer = setInterval(run, 60_000); timer.unref();
  return () => clearInterval(timer);
}
module.exports = { runClubChecks, startClubChecks, SYSTEM_USER };
