// REQ-8 / REQ-43 / REQ-92 / BR-10. Role-to-operation map.
// In the prototype this drives navigation and disabled states. In production the
// same map is enforced server-side; the client copy is convenience only.

const MATRIX = {
  Member:      ["view.dashboard","view.ownStatement","view.queue","view.constitution","view.pool","claim.lodge","assistant.ask"],
  Treasurer:   ["view.dashboard","view.ownStatement","view.queue","view.constitution","view.pool","view.ledger","view.members","view.reconciliation","contribution.capture","payout.initiate","payout.cancel","ledger.reverse","reconciliation.record","claim.lodge","assistant.ask"],
  Secretary:   ["view.dashboard","view.ownStatement","view.queue","view.constitution","view.pool","view.members","view.ledger","member.register","member.amend","member.revealId","governance.record","assistant.ask"],
  Chairperson: ["view.dashboard","view.ownStatement","view.queue","view.constitution","view.pool","view.ledger","view.members","view.reconciliation","payout.approve","payout.assess","penalty.waive","member.exitApprove","governance.record","constitution.propose","assistant.ask"],
  PlatformAdmin: ["platform.view","platform.provision","platform.suspend"]
};

export function can(role, action) {
  return (MATRIX[role] || []).includes(action);
}

export function refusalReason(role, action) {
  if (role === "PlatformAdmin")
    return "The Platform Administrator is a custodian of the platform, not of the money. This role has no access to club-level financial records (BR-10).";
  return `Your role in this club is ${role}. This action is reserved for another officer.`;
}
