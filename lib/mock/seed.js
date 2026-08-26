/**
 * Mock data layer. PROTOTYPE ONLY.
 *
 * Every record in the application originates here. Nothing is hardcoded inside a
 * component. Dates are generated as offsets from today so the demo never goes stale.
 *
 * Edge cases are seeded deliberately so the demonstration can reach them without
 * setup: a member in arrears inside the queue, a partial payment, a late payment
 * with an automatic penalty, a waived penalty with its visible reversal pair, a
 * non-zero reconciliation difference, a mid-cycle joiner with a catch-up
 * obligation, an exited member retained for audit, a burial claim awaiting
 * assessment, and an empty club for genuine empty states.
 */

import { addDays, addMonths, startOfMonth } from "@/lib/format";

const TODAY = new Date();
const uid = (p, n) => `${p}-${String(n).padStart(3, "0")}`;

// --- Users -------------------------------------------------------------------
// Nomsa deliberately holds two different roles in two different clubs (REQ-10).
const users = [
  { id: "u-nomsa", fullName: "Nomsa Maluleke", email: "nomsa.maluleke@gmail.com", phone: "082 441 7788", idNumber: "8703125072083" },
  { id: "u-thabo", fullName: "Thabo Mokoena", email: "tmokoena@webmail.co.za", phone: "073 902 1145", idNumber: "7811045811082" },
  { id: "u-refilwe", fullName: "Refilwe Mahlangu", email: "refilwe.m@outlook.com", phone: "071 334 9026", idNumber: "9202180644085" },
  { id: "u-mpho", fullName: "Mpho Sekhukhune", email: "mpho.sek@gmail.com", phone: "060 778 3312", idNumber: "9508235019087" },
  { id: "u-admin", fullName: "Kabelo Netshiozwi", email: "admin@stokvelsys.co.za", phone: "084 210 6690", idNumber: "8401115540081", isPlatformAdmin: true }
];

const NAMES_ROTATING = [
  "Nomsa Maluleke", "Thabo Mokoena", "Refilwe Mahlangu", "Kagiso Sithole",
  "Lerato Ndlovu", "Tshepo Ramaphakela", "Naledi Mabaso", "Sipho Nkuna",
  "Dineo Rakgoale", "Katlego Mabunda", "Zanele Chauke", "Mpho Sekhukhune"
];

const NAMES_ACCUM = [
  "Grace Baloyi", "Nomsa Maluleke", "Portia Mkhwanazi", "Elias Rammutla",
  "Johanna Shikwambana", "Sarah Mothiba", "Petunia Mnisi", "Lindiwe Mahlaule",
  "Aletta Mogale", "Rebecca Nkuna", "Salphina Ntsoane", "Maria Ledwaba",
  "Hlengiwe Ngobeni", "Constance Mabotja", "Emily Maswanganyi", "Doris Malatji",
  "Anna Rikhotso", "Selina Mokgehle"
];

const NAMES_BURIAL = [
  "Solomon Mabunda", "Gladys Maluleke", "Frans Sebola", "Joyce Mokwena",
  "Wilson Nkosi", "Betty Nyathi", "Amos Ramoshaba", "Christina Nkuna",
  "Phillip Malungani", "Sannie Mathebula", "Jacob Mashaba", "Lucia Baloyi",
  "Simon Ngoveni", "Martha Chabalala", "Piet Makhubele", "Agnes Hlungwani",
  "Daniel Rikhotso", "Nelly Shirinda", "Ephraim Mnisi", "Rosina Novela",
  "Jackson Mabasa", "Thandi Khoza", "Andries Maake", "Miriam Sithole"
];

function makePhone(i) {
  const prefixes = ["082", "073", "071", "060", "078", "064", "083", "076"];
  return `${prefixes[i % prefixes.length]} ${String(200 + i * 37).slice(0, 3)} ${String(1000 + i * 461).slice(0, 4)}`;
}
function makeId(i) {
  const y = 65 + ((i * 7) % 35);
  const m = String(1 + (i % 12)).padStart(2, "0");
  const d = String(1 + ((i * 3) % 27)).padStart(2, "0");
  return `${y}${m}${d}${String(5000 + i * 131).slice(0, 4)}08${i % 10}`;
}
function emailFor(name, i) {
  const [first, last] = name.toLowerCase().split(" ");
  const hosts = ["gmail.com", "webmail.co.za", "outlook.com", "yahoo.com"];
  return `${first}.${last}${i % 3 === 0 ? "" : i}@${hosts[i % hosts.length]}`;
}

// --- Constitutions -----------------------------------------------------------
const constitutions = [
  {
    id: "con-mmakau-2", clubId: "club-mmakau", version: 2,
    effectiveDate: addMonths(startOfMonth(TODAY), -8),
    contributionAmount: 500, cycleFrequency: "Monthly",
    cycleStartDate: addMonths(startOfMonth(TODAY), -11),
    penaltyAmount: 50, gracePeriodDays: 5, quorumPercentage: 60,
    exitNoticeDays: 30, payoutOrderMethod: "Random draw",
    forfeitureRule: "A member exiting before completing one full rotation forfeits accrued penalties and 10% of contributions.",
    benefitSchedule: [], waitingPeriodDays: 0,
    amendmentNote: "Penalty increased from R30 to R50 by resolution of the meeting of "
  },
  {
    id: "con-mmakau-1", clubId: "club-mmakau", version: 1,
    effectiveDate: addMonths(startOfMonth(TODAY), -11),
    contributionAmount: 500, cycleFrequency: "Monthly",
    cycleStartDate: addMonths(startOfMonth(TODAY), -11),
    penaltyAmount: 30, gracePeriodDays: 5, quorumPercentage: 60,
    exitNoticeDays: 30, payoutOrderMethod: "Random draw",
    forfeitureRule: "A member exiting before completing one full rotation forfeits accrued penalties.",
    benefitSchedule: [], waitingPeriodDays: 0, superseded: true
  },
  {
    id: "con-bokamoso-1", clubId: "club-bokamoso", version: 1,
    effectiveDate: addMonths(startOfMonth(TODAY), -10),
    contributionAmount: 350, cycleFrequency: "Monthly",
    cycleStartDate: addMonths(startOfMonth(TODAY), -10),
    penaltyAmount: 40, gracePeriodDays: 7, quorumPercentage: 50,
    exitNoticeDays: 60, payoutOrderMethod: "Negotiated",
    forfeitureRule: "A member exiting before year-end receives contributions less penalties and a proportionate share of costs.",
    benefitSchedule: [], waitingPeriodDays: 0
  },
  {
    id: "con-lehumo-1", clubId: "club-lehumo", version: 1,
    effectiveDate: addMonths(startOfMonth(TODAY), -22),
    contributionAmount: 150, cycleFrequency: "Monthly",
    cycleStartDate: addMonths(startOfMonth(TODAY), -22),
    penaltyAmount: 25, gracePeriodDays: 10, quorumPercentage: 50,
    exitNoticeDays: 30, payoutOrderMethod: "Seniority",
    forfeitureRule: "No refund of contributions on exit. Cover ceases on the date of exit.",
    waitingPeriodDays: 180,
    benefitSchedule: [
      { category: "Principal member", amount: 10000 },
      { category: "Spouse", amount: 8000 },
      { category: "Child under 21", amount: 5000 },
      { category: "Extended family", amount: 3000 }
    ]
  },
  {
    id: "con-tshedza-1", clubId: "club-tshedza", version: 1,
    effectiveDate: addDays(TODAY, -6),
    contributionAmount: 750, cycleFrequency: "Monthly",
    cycleStartDate: addDays(startOfMonth(addMonths(TODAY, 1)), 0),
    penaltyAmount: 75, gracePeriodDays: 5, quorumPercentage: 66,
    exitNoticeDays: 30, payoutOrderMethod: "Seniority",
    forfeitureRule: "Standard forfeiture of penalties on exit.",
    benefitSchedule: [], waitingPeriodDays: 0
  }
];

// --- Clubs -------------------------------------------------------------------
const clubs = [
  {
    id: "club-mmakau", name: "Mmakau Rotating Savings Club", shortName: "Mmakau",
    type: "Rotating", status: "Active", town: "Seshego, Limpopo",
    registrationDate: addMonths(TODAY, -11), constitutionId: "con-mmakau-2",
    bankBalance: null, bankBalanceDate: null
  },
  {
    id: "club-bokamoso", name: "Bokamoso Grocery Stokvel", shortName: "Bokamoso",
    type: "Accumulating", status: "Active", town: "Mankweng, Limpopo",
    registrationDate: addMonths(TODAY, -10), constitutionId: "con-bokamoso-1"
  },
  {
    id: "club-lehumo", name: "Lehumo Burial Society", shortName: "Lehumo",
    type: "Burial", status: "Active", town: "Polokwane, Limpopo",
    registrationDate: addMonths(TODAY, -22), constitutionId: "con-lehumo-1"
  },
  {
    id: "club-tshedza", name: "Tshedza Savings Club", shortName: "Tshedza",
    type: "Rotating", status: "Active", town: "Tzaneen, Limpopo",
    registrationDate: addDays(TODAY, -6), constitutionId: "con-tshedza-1"
  }
];

// --- Members -----------------------------------------------------------------
let mSeq = 0;
function buildMembers(clubId, names, opts = {}) {
  const officerFor = opts.officers || {};
  return names.map((fullName, i) => {
    mSeq += 1;
    const knownUser = users.find((u) => u.fullName === fullName);
    const role = officerFor[fullName] || "Member";
    return {
      id: uid(`mem-${clubId.replace("club-", "")}`, i + 1),
      clubId,
      userId: knownUser ? knownUser.id : `u-gen-${clubId}-${i}`,
      fullName,
      idNumber: knownUser ? knownUser.idNumber : makeId(mSeq),
      phone: knownUser ? knownUser.phone : makePhone(mSeq),
      email: knownUser ? knownUser.email : emailFor(fullName, mSeq),
      role,
      standing: "Good standing",
      joinDate: opts.joinDate ? opts.joinDate(i) : addMonths(TODAY, -(opts.tenure || 11)),
      exitDate: null,
      queuePosition: opts.queue ? i + 1 : null,
      nextOfKin: { name: NAMES_BURIAL[(mSeq * 3) % NAMES_BURIAL.length], relationship: i % 2 ? "Sister" : "Brother", phone: makePhone(mSeq + 40) },
      beneficiaries: [],
      dependants: []
    };
  });
}

const mmakauMembers = buildMembers("club-mmakau", NAMES_ROTATING, {
  officers: { "Nomsa Maluleke": "Treasurer", "Thabo Mokoena": "Chairperson", "Refilwe Mahlangu": "Secretary" },
  queue: true, tenure: 11
});

// Edge cases in Mmakau -------------------------------------------------------
// Queue has already rotated five times: the first five recipients moved to the back.
mmakauMembers.forEach((m, i) => { m.queuePosition = i < 5 ? 8 + i : i - 4; });
// Lerato Ndlovu is in arrears and sits at position 2, so the fork in REQ-77 is
// visible in the queue without blocking the happy path at the head.
const lerato = mmakauMembers.find((m) => m.fullName === "Lerato Ndlovu");
lerato.standing = "In arrears";
// Zanele joined mid-cycle three months ago and carries a catch-up obligation.
const zanele = mmakauMembers.find((m) => m.fullName === "Zanele Chauke");
zanele.joinDate = addDays(addMonths(startOfMonth(TODAY), -3), 12);
zanele.catchUp = 500;
// One exited member retained for audit (REQ-48, BR-18).
mmakauMembers.push({
  id: "mem-mmakau-013", clubId: "club-mmakau", userId: "u-gen-exited",
  fullName: "Rhulani Baloyi", idNumber: makeId(99), phone: makePhone(99),
  email: "rhulani.baloyi@gmail.com", role: "Member", standing: "Exited",
  joinDate: addMonths(TODAY, -11), exitDate: addMonths(TODAY, -2),
  queuePosition: null, nextOfKin: { name: "Tintswalo Baloyi", relationship: "Spouse", phone: makePhone(101) },
  beneficiaries: [], dependants: []
});

const bokamosoMembers = buildMembers("club-bokamoso", NAMES_ACCUM, {
  officers: { "Grace Baloyi": "Chairperson", "Portia Mkhwanazi": "Treasurer", "Sarah Mothiba": "Secretary" },
  tenure: 10
});
bokamosoMembers.find((m) => m.fullName === "Elias Rammutla").standing = "In arrears";

const lehumoMembers = buildMembers("club-lehumo", NAMES_BURIAL, {
  officers: { "Solomon Mabunda": "Chairperson", "Gladys Maluleke": "Treasurer", "Joyce Mokwena": "Secretary" },
  tenure: 22
});
// Thabo also belongs to Lehumo, as an ordinary member.
lehumoMembers.push({
  id: "mem-lehumo-025", clubId: "club-lehumo", userId: "u-thabo",
  fullName: "Thabo Mokoena", idNumber: users[1].idNumber, phone: users[1].phone,
  email: users[1].email, role: "Member", standing: "Good standing",
  joinDate: addMonths(TODAY, -14), exitDate: null, queuePosition: null,
  nextOfKin: { name: "Palesa Mokoena", relationship: "Spouse", phone: makePhone(77) },
  beneficiaries: [], dependants: []
});
// Nomsa is an ordinary member of Bokamoso — the same account, a different role.
bokamosoMembers.find((m) => m.fullName === "Nomsa Maluleke").role = "Member";

// Dependants for the burial society (REQ-37).
const DEP_CATEGORIES = ["Spouse", "Child under 21", "Extended family"];
lehumoMembers.forEach((m, i) => {
  m.dependants = [
    { id: `dep-${i}-1`, memberId: m.id, name: `${NAMES_BURIAL[(i + 5) % NAMES_BURIAL.length].split(" ")[0]} ${m.fullName.split(" ")[1]}`, category: "Spouse", dateOfBirth: addMonths(TODAY, -(420 + i * 3)) },
    { id: `dep-${i}-2`, memberId: m.id, name: `${NAMES_ACCUM[(i + 2) % NAMES_ACCUM.length].split(" ")[0]} ${m.fullName.split(" ")[1]}`, category: DEP_CATEGORIES[(i + 1) % 3], dateOfBirth: addMonths(TODAY, -(160 + i * 5)) }
  ];
  m.beneficiaries = [{ id: `ben-${i}`, name: m.dependants[0].name, relationship: "Spouse", share: 100 }];
});
// A recently admitted member, still inside the 180-day waiting period (REQ-87).
const waiting = lehumoMembers[lehumoMembers.length - 2];
waiting.joinDate = addDays(TODAY, -95);

const members = [...mmakauMembers, ...bokamosoMembers, ...lehumoMembers];

// --- Cycles ------------------------------------------------------------------
function buildCycles(clubId, count, dueDay = 7) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addMonths(startOfMonth(TODAY), -i);
    out.push({
      id: uid(`cyc-${clubId.replace("club-", "")}`, count - i),
      clubId, sequenceNumber: count - i, startDate: start,
      dueDate: addDays(start, dueDay),
      status: i === 0 ? "Open" : "Closed"
    });
  }
  return out;
}
const cycles = [
  ...buildCycles("club-mmakau", 12),
  ...buildCycles("club-bokamoso", 10),
  ...buildCycles("club-lehumo", 12)
];

// --- Contributions, penalties and the ledger ---------------------------------
const contributions = [];
const ledger = [];
let ledgerSeq = 0;

function post(clubId, entry) {
  ledgerSeq += 1;
  ledger.push({
    id: uid("led", ledgerSeq), clubId,
    memberId: entry.memberId || null, type: entry.type,
    amount: entry.amount, postedAt: entry.postedAt,
    postedBy: entry.postedBy, description: entry.description,
    reversesId: entry.reversesId || null, reason: entry.reason || null,
    resultingBalance: 0
  });
  return ledger[ledger.length - 1];
}

function seedClubFinancials(club, clubMembers, constitution, treasurerUserId) {
  const clubCycles = cycles.filter((c) => c.clubId === club.id);
  const active = clubMembers.filter((m) => m.standing !== "Exited");

  clubCycles.forEach((cycle, ci) => {
    const isCurrent = cycle.status === "Open";
    active.forEach((m, mi) => {
      if (new Date(m.joinDate) > new Date(cycle.dueDate)) return;

      let captured = constitution.contributionAmount;
      let status = "Paid";
      let receiptDate = addDays(cycle.startDate, 2 + ((mi * 3) % 5));
      let method = mi % 4 === 0 ? "Cash" : "Electronic funds transfer";

      if (isCurrent) {
        // Deliberate spread of statuses in the open cycle.
        if (m.fullName === "Lerato Ndlovu") { captured = 0; status = "Late"; receiptDate = null; }
        else if (m.fullName === "Naledi Mabaso") { captured = 200; status = "Partial"; receiptDate = addDays(cycle.startDate, 4); }
        else if (m.fullName === "Sipho Nkuna" || m.fullName === "Katlego Mabunda") { captured = 0; status = "Outstanding"; receiptDate = null; }
        else if (m.fullName === "Elias Rammutla") { captured = 0; status = "Late"; receiptDate = null; }
        else if (mi % 7 === 3) { captured = 0; status = "Outstanding"; receiptDate = null; }
      } else if (ci === clubCycles.length - 3 && m.fullName === "Dineo Rakgoale") {
        // Paid late two cycles ago: penalty levied, then waived by the Chairperson.
        status = "Paid";
        receiptDate = addDays(cycle.dueDate, 4);
      }

      contributions.push({
        id: uid("con", contributions.length + 1),
        clubId: club.id, memberId: m.id, cycleId: cycle.id,
        expectedAmount: constitution.contributionAmount,
        capturedAmount: captured, receiptDate, status, method,
        reference: method === "Electronic funds transfer" && captured > 0 ? `EFT${String(48210 + contributions.length)}` : null,
        capturedBy: captured > 0 ? treasurerUserId : null,
        proofOfPayment: captured > 0 && mi % 5 === 0 ? "proof-of-payment.jpg" : null
      });

      if (captured > 0) {
        post(club.id, {
          memberId: m.id, type: "Contribution", amount: captured,
          postedAt: receiptDate, postedBy: treasurerUserId,
          description: `Contribution — cycle ${cycle.sequenceNumber}`
        });
      }
    });

    // Penalty on the late member of the open cycle (REQ-56).
    if (isCurrent) {
      active.filter((m) => contributions.some((c) => c.cycleId === cycle.id && c.memberId === m.id && c.status === "Late"))
        .forEach((m) => {
          post(club.id, {
            memberId: m.id, type: "Penalty", amount: constitution.penaltyAmount,
            postedAt: addDays(cycle.dueDate, constitution.gracePeriodDays),
            postedBy: "system",
            description: `Late-contribution penalty — cycle ${cycle.sequenceNumber} (automatic)`
          });
        });
    }
  });

  // A penalty levied and then waived, leaving a visible reversal pair (BR-3, REQ-63).
  if (club.id === "club-mmakau") {
    const dineo = clubMembers.find((m) => m.fullName === "Dineo Rakgoale");
    const cyc = clubCycles[clubCycles.length - 3];
    const penalty = post(club.id, {
      memberId: dineo.id, type: "Penalty", amount: 50,
      postedAt: addDays(cyc.dueDate, 5), postedBy: "system",
      description: `Late-contribution penalty — cycle ${cyc.sequenceNumber} (automatic)`
    });
    post(club.id, {
      memberId: dineo.id, type: "Reversal", amount: -50,
      postedAt: addDays(cyc.dueDate, 9), postedBy: "u-thabo",
      description: `Reversal of penalty ${penalty.id}`,
      reversesId: penalty.id,
      reason: "Penalty waived by the Chairperson: member produced a bank confirmation showing payment on the due date, delayed in clearing."
    });
  }
}

// Rotating payouts already made (five completed rotations).
function seedRotations() {
  const club = clubs[0];
  const con = constitutions[0];
  const clubCycles = cycles.filter((c) => c.clubId === club.id && c.status === "Closed");
  const recipients = mmakauMembers.slice(0, 5);
  recipients.forEach((m, i) => {
    const cycle = clubCycles[clubCycles.length - 6 + i];
    if (!cycle) return;
    post(club.id, {
      memberId: m.id, type: "Payout", amount: -(con.contributionAmount * 12),
      postedAt: addDays(cycle.dueDate, 3), postedBy: "u-nomsa",
      description: `Rotation payout — cycle ${cycle.sequenceNumber}`
    });
  });
}

seedClubFinancials(clubs[0], mmakauMembers, constitutions[0], "u-nomsa");
seedClubFinancials(clubs[1], bokamosoMembers, constitutions[2], "u-gen-club-bokamoso-2");
seedClubFinancials(clubs[2], lehumoMembers, constitutions[3], "u-gen-club-lehumo-1");
seedRotations();

// Interest credited to the accumulating club, so the year-end share has a source.
post("club-bokamoso", {
  memberId: null, type: "Interest", amount: 1284.5,
  postedAt: addDays(TODAY, -12), postedBy: "u-gen-club-bokamoso-2",
  description: "Interest credited by the bank for the period"
});

ledger.sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt));

// --- Payouts and claims ------------------------------------------------------
const payouts = [];
const claims = [
  {
    id: "clm-001", clubId: "club-lehumo",
    claimantId: lehumoMembers.find((m) => m.fullName === "Wilson Nkosi").id,
    dependantId: lehumoMembers.find((m) => m.fullName === "Wilson Nkosi").dependants[0].id,
    dateOfDeath: addDays(TODAY, -4), lodgedAt: addDays(TODAY, -2),
    status: "Lodged",
    supportingDocument: "death-certificate-DHA1663.pdf",
    note: "Funeral is set for Saturday. Family has requested the benefit be released before Thursday."
  },
  {
    id: "clm-002", clubId: "club-lehumo",
    claimantId: waiting.id, dependantId: waiting.dependants[1].id,
    dateOfDeath: addDays(TODAY, -9), lodgedAt: addDays(TODAY, -8),
    status: "Lodged", supportingDocument: "death-certificate-DHA1590.pdf",
    note: null
  },
  {
    id: "clm-003", clubId: "club-lehumo",
    claimantId: lehumoMembers.find((m) => m.fullName === "Frans Sebola").id,
    dependantId: lehumoMembers.find((m) => m.fullName === "Frans Sebola").dependants[0].id,
    dateOfDeath: addMonths(TODAY, -3), lodgedAt: addMonths(TODAY, -3),
    status: "Paid", supportingDocument: "death-certificate-DHA1204.pdf", note: null
  }
];

// --- Reconciliation ----------------------------------------------------------
// Mmakau's recorded bank balance differs from the ledger by R450: one member paid
// in cash and it has not yet been banked. The demo resolves this.
const reconciliations = [
  {
    id: "rec-001", clubId: "club-mmakau",
    asAtDate: addDays(TODAY, -33), bankBalance: 0, derivedBalance: 0,
    difference: 0, status: "Clean", recordedBy: "u-nomsa"
  }
];

// --- Notifications -----------------------------------------------------------
const notifications = [
  { id: "ntf-1", clubId: "club-mmakau", memberId: lerato.id, channel: "SMS", event: "Contribution status resolved to Late", despatchedAt: addDays(TODAY, -1), outcome: "Delivered" },
  { id: "ntf-2", clubId: "club-mmakau", memberId: mmakauMembers[7].id, channel: "SMS", event: "Contribution due in three days", despatchedAt: addDays(TODAY, -6), outcome: "Undeliverable", retries: 3 },
  { id: "ntf-3", clubId: "club-mmakau", memberId: mmakauMembers[3].id, channel: "Email", event: "Contribution due in three days", despatchedAt: addDays(TODAY, -6), outcome: "Delivered" }
];

// --- Announcements -----------------------------------------------------------
const announcements = [
  {
    id: "ann-1", clubId: "club-mmakau", authorId: "u-refilwe",
    subject: "October meeting moved to Saturday the 12th",
    body: "The monthly meeting will be held at the community hall on Saturday the 12th at 14:00 instead of Sunday, because the hall is booked for a wedding. Please bring your contribution and your book.",
    publishedAt: addDays(TODAY, -5)
  },
  {
    id: "ann-2", clubId: "club-mmakau", authorId: "u-thabo",
    subject: "Penalty amount increased to R50 from this cycle",
    body: "The resolution passed at the August meeting takes effect from this cycle. The late-contribution penalty is now R50. This applies only to contributions falling due after the effective date; nothing already closed is recomputed.",
    publishedAt: addDays(TODAY, -21)
  }
];

export function buildSeed() {
  return {
    users, clubs, constitutions, members, cycles, contributions,
    ledger: recalcBalances(ledger), payouts, claims, reconciliations,
    notifications, announcements,
    session: { userId: null, clubId: null, actingRole: null },
    meta: { seededAt: new Date().toISOString(), version: 1 }
  };
}

export function recalcBalances(entries) {
  const byClub = {};
  return [...entries]
    .sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt))
    .map((e) => {
      byClub[e.clubId] = (byClub[e.clubId] || 0) + e.amount;
      return { ...e, resultingBalance: Math.round(byClub[e.clubId] * 100) / 100 };
    });
}
