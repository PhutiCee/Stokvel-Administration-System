"use strict";
async function lockClub(db) {
    return db.one("SELECT club_type FROM club WHERE club_id=$1 FOR UPDATE", [
        db.clubId,
    ]);
}
async function membersOn(db, date) {
    return db.many(
        `SELECT m.member_id, u.full_name, m.role, m.standing FROM member m JOIN user_account u ON u.user_id=m.user_id
        WHERE m.club_id=$1 AND m.join_date <= $2::date AND (m.exit_date IS NULL OR m.exit_date > $2::date)
        AND (m.exit_date IS NOT NULL OR m.standing NOT IN ('Exited','Expelled')) ORDER BY u.full_name`,
        [db.clubId, date],
    );
}
async function listMeetings(db) {
    return db.many(
        `SELECT meeting_id, meeting_date::text, agenda, eligible_count, attendance_count, required_count, quorate
        FROM meeting WHERE club_id=$1 ORDER BY meeting_date DESC, created_at DESC`,
        [db.clubId],
    );
}
async function getMeeting(db, id) {
    return db.one(
        "SELECT *, meeting_date::text FROM meeting WHERE club_id=$1 AND meeting_id=$2",
        [db.clubId, id],
    );
}
async function attendance(db, id) {
    return db.many(
        `SELECT a.member_id, u.full_name FROM meeting_attendance a JOIN member m ON m.club_id=a.club_id AND m.member_id=a.member_id
        JOIN user_account u ON u.user_id=m.user_id WHERE a.club_id=$1 AND a.meeting_id=$2 ORDER BY u.full_name`,
        [db.clubId, id],
    );
}
async function resolutions(db, id) {
    return db.many(
        `SELECT r.*, u.full_name AS subject_name FROM resolution r LEFT JOIN member m ON m.club_id=r.club_id AND m.member_id::text=r.payload->>'memberId' LEFT JOIN user_account u ON u.user_id=m.user_id WHERE r.club_id=$1 AND r.meeting_id=$2 ORDER BY r.created_at`,
        [db.clubId, id],
    );
}
async function insertMeeting(db, m, c, userId) {
    const row = await db.one(
        `INSERT INTO meeting(club_id,meeting_date,agenda,minutes,constitution_id,eligible_count,attendance_count,required_count,quorate,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *, meeting_date::text`,
        [
            db.clubId,
            m.date,
            m.agenda,
            m.minutes,
            c.constitutionId,
            m.eligible,
            m.attendance.length,
            m.required,
            m.quorate,
            userId,
        ],
    );
    for (const id of m.attendance)
        await db.query(
            "INSERT INTO meeting_attendance(club_id,meeting_id,member_id) VALUES($1,$2,$3)",
            [db.clubId, row.meeting_id, id],
        );
    return row;
}
async function insertResolution(db, meetingId, input, check, payload, userId) {
    return db.one(
        `INSERT INTO resolution(club_id,meeting_id,kind,text,votes_for,votes_against,abstentions,required_votes,outcome,payload,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
            db.clubId,
            meetingId,
            input.kind,
            check.text,
            input.votesFor,
            input.votesAgainst,
            input.abstentions,
            check.required,
            check.outcome,
            JSON.stringify(payload),
            userId,
        ],
    );
}
async function getResolution(db, id) {
    return db.one(
        "SELECT * FROM resolution WHERE club_id=$1 AND resolution_id=$2 FOR UPDATE",
        [db.clubId, id],
    );
}
async function markApplied(db, id, userId, versionId) {
    return db.one(
        `UPDATE resolution SET applied_by=$3,applied_at=now(),resulting_constitution_id=$4
    WHERE club_id=$1 AND resolution_id=$2 AND applied_at IS NULL RETURNING *`,
        [db.clubId, id, userId, versionId],
    );
}
async function member(db, id) {
    return db.one(
        "SELECT * FROM member WHERE club_id=$1 AND member_id=$2 FOR UPDATE",
        [db.clubId, id],
    );
}
async function activeRoleCount(db, role) {
    const r = await db.one(
        `SELECT count(*)::int AS n FROM member WHERE club_id=$1 AND role=$2 AND standing NOT IN ('Exited','Expelled')`,
        [db.clubId, role],
    );
    return r.n;
}
async function expel(db, id, date) {
    await db.query(
        `UPDATE member SET standing='Expelled',exit_date=$3,updated_at=now() WHERE club_id=$1 AND member_id=$2`,
        [db.clubId, id, date],
    );
}
module.exports = {
    lockClub,
    membersOn,
    listMeetings,
    getMeeting,
    attendance,
    resolutions,
    insertMeeting,
    insertResolution,
    getResolution,
    markApplied,
    member,
    activeRoleCount,
    expel,
};
