"use client";

/**
 * The only place in the web application that calls the API.
 *
 * Everything goes through here so that three things are guaranteed in one
 * place rather than remembered in fifty:
 *
 *   credentials: "include"   The session is an httpOnly cookie on a different
 *                            origin. Without this, fetch silently omits it and
 *                            every request comes back 401.
 *
 *   error shape              The server always answers a failure with
 *                            { error: { code, message, detail } }. This turns
 *                            that into a thrown ApiError carrying the same
 *                            fields, so a screen can show the server's own
 *                            sentence rather than inventing one.
 *
 *   no token handling        There is nothing to attach. The token is in a
 *                            cookie the browser sends on its own, and
 *                            JavaScript cannot read it — which is the point.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  /** True when the session has ended and the person should sign in again. */
  get isUnauthorised() {
    return this.status === 401;
  }

  /** True when the role does not permit the operation (REQ-8). */
  get isForbidden() {
    return this.status === 403;
  }
}

async function request(
  path,
  { method = "GET", body, signal, responseType } = {},
) {
  let response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers:
        body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : undefined,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    // The server is not answering at all. Say so plainly: a member seeing
    // "Failed to fetch" learns nothing they can act on.
    throw new ApiError(
      0,
      "OFFLINE",
      "Cannot reach the system. Check your connection and try again.",
    );
  }

  if (response.status === 204) return null;
  if (response.ok && responseType === "blob") return response.blob();

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const e = payload?.error || {};
    throw new ApiError(
      response.status,
      e.code || "UNKNOWN",
      e.message || "Something went wrong.",
      e.detail,
    );
  }

  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: "GET" }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  patch: (path, body, opts) =>
    request(path, { ...opts, method: "PATCH", body }),
  put: (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
  delete: (path, opts) => request(path, { ...opts, method: "DELETE" }),
};

// --- Club and members ------------------------------------------------------
export const clubs = {
  /** Everything the dashboard needs, in one request. */
  summary: (opts) => api.get("/api/club", opts),
  constitution: () => api.get("/api/club/constitution"),
};

export const members = {
  list: (opts) => api.get("/api/members", opts),
  get: (memberId) => api.get(`/api/members/${memberId}`),
  /** REQ-41: validate and compute the catch-up WITHOUT writing anything. */
  preview: (details) => api.post("/api/members/preview", details),
  register: (details) => api.post("/api/members", details),
  assignRole: (memberId, role) =>
    api.patch(`/api/members/${memberId}/role`, { role }),
};

export const cycles = {
  list: () => api.get("/api/cycles"),
  current: (opts) => api.get("/api/cycles/current", opts),
  get: (cycleId) => api.get(`/api/cycles/${cycleId}`),
  /** openCycle() + generateExpectedContributions(), one operation. */
  open: (dates) => api.post("/api/cycles", dates || {}),
  close: (cycleId) => api.post(`/api/cycles/${cycleId}/close`, {}),
};

export const contributions = {
  penalties: (status = "all", offset = 0, opts) =>
    api.get(
      `/api/contributions/penalties?status=${encodeURIComponent(status)}&offset=${offset}`,
      opts,
    ),
  waive: (id, reason) =>
    api.post(`/api/contributions/penalties/${id}/waive`, { reason }),
  proof: (id, opts) => api.get(`/api/contributions/${id}/proof`, opts),
  proofFile: (id, opts) =>
    request(`/api/contributions/${id}/proof/file`, {
      ...opts,
      responseType: "blob",
    }),
  uploadProof: (id, file) => {
    const body = new FormData();
    body.append("file", file);
    return api.post(`/api/contributions/${id}/proof`, body);
  },
  removeProof: (id) => api.post(`/api/contributions/${id}/proof/delete`),
  capture: (contributionId, payment) =>
    api.post(`/api/contributions/${contributionId}/capture`, payment),
};

export const ledger = {
  reversals: (opts) => api.get("/api/ledger/reversals", opts),
  reverse: (id, reason) => api.post(`/api/ledger/${id}/reverse`, { reason }),
  decideReversal: (id, decision, reason) =>
    api.post(`/api/ledger/reversals/${id}/decision`, { decision, reason }),
  postReversal: (id) => api.post(`/api/ledger/reversals/${id}/post`),
  list: (limit = 100, opts) => api.get(`/api/ledger?limit=${limit}`, opts),
  pool: (opts) => api.get("/api/ledger/pool", opts),
  /** REQ-94. Omit memberId for your own. */
  statement: (memberId, opts) =>
    api.get(
      memberId ? `/api/ledger/statement/${memberId}` : "/api/ledger/statement",
      opts,
    ),
};

// --- Use Case 3, rotating clubs --------------------------------------------
export const payouts = {
  list: (opts) => api.get("/api/payouts", opts),
  next: (opts) => api.get("/api/payouts/next", opts),
  get: (payoutId, opts) => api.get(`/api/payouts/${payoutId}`, opts),
  initiate: (memberId) =>
    api.post("/api/payouts", memberId ? { memberId } : {}),
  approve: (payoutId) => api.post(`/api/payouts/${payoutId}/approve`),
  cancel: (payoutId, reason) =>
    api.post(`/api/payouts/${payoutId}/cancel`, { reason }),
};

export const queue = {
  get: (opts) => api.get("/api/queue", opts),
  mine: (opts) => api.get("/api/queue/me", opts),
  establish: (order) =>
    api.post("/api/queue/establish", order ? { order } : {}),
  requestSwap: (withMemberId) => api.post("/api/queue/swaps", { withMemberId }),
  consentToSwap: (swapId, consent) =>
    api.post(`/api/queue/swaps/${swapId}/consent`, { consent }),
  approveSwap: (swapId) => api.post(`/api/queue/swaps/${swapId}/approve`),
  rejectSwap: (swapId, reason) =>
    api.post(`/api/queue/swaps/${swapId}/reject`, { reason }),
  cancelSwap: (swapId) => api.post(`/api/queue/swaps/${swapId}/cancel`),
  resolveArrears: (memberId, decision, reason) =>
    api.post("/api/queue/arrears-ruling", { memberId, decision, reason }),
};

// --- Use Case 3, accumulating clubs -----------------------------------------
export const distributions = {
  list: (opts) => api.get("/api/distributions", opts),
  next: (opts) => api.get("/api/distributions/next", opts),
  get: (distributionId, opts) =>
    api.get(`/api/distributions/${distributionId}`, opts),
  initiate: () => api.post("/api/distributions", {}),
  approve: (distributionId) =>
    api.post(`/api/distributions/${distributionId}/approve`),
  cancel: (distributionId, reason) =>
    api.post(`/api/distributions/${distributionId}/cancel`, { reason }),
  recordInterest: (amount, description) =>
    api.post("/api/distributions/interest", { amount, description }),
  recordExpense: (amount, description) =>
    api.post("/api/distributions/expense", { amount, description }),
};

// --- Use Case 4, burial societies -------------------------------------------
export const claims = {
  list: (opts) => api.get("/api/claims", opts),
  mine: (opts) => api.get("/api/claims/mine", opts),
  get: (claimId, opts) => api.get(`/api/claims/${claimId}`, opts),
  lodge: (details) => api.post("/api/claims", details),
  initiate: (claimId) => api.post(`/api/claims/${claimId}/initiate`),
  approve: (claimId) => api.post(`/api/claims/${claimId}/approve`),
  cancel: (claimId, reason) =>
    api.post(`/api/claims/${claimId}/cancel`, { reason }),
  myDependants: (opts) => api.get("/api/claims/dependants/mine", opts),
  registerDependant: (details) => api.post("/api/claims/dependants", details),
  removeDependant: (dependantId) =>
    api.post(`/api/claims/dependants/${dependantId}/remove`),
};

export const notifications = {
  list: (opts) => api.get("/api/notifications", opts),
  send: (details) => api.post("/api/notifications", details)
};

export const reconciliation = {
  list: (opts) => api.get("/api/reconciliation", opts),
  record: (details) => api.post("/api/reconciliation", details)
};

export const platform = {
  overview: (opts) => api.get("/api/platform", opts),
  createClub: (details) => api.post("/api/platform/clubs", details),
  suspend: (clubId, reason) =>
    api.patch(`/api/platform/clubs/${clubId}`, { status: "Suspended", reason }),
  reinstate: (clubId) =>
    api.patch(`/api/platform/clubs/${clubId}`, { status: "Active" }),
};

// --- Use Case 1 ------------------------------------------------------------
export const auth = {
  login: (identifier, password) =>
    api.post("/api/auth/login", { identifier, password }),
  logout: () => api.post("/api/auth/logout"),
  me: (opts) => api.get("/api/auth/me", opts),
  clubs: () => api.get("/api/auth/clubs"),
  selectClub: (clubId) => api.post("/api/auth/club", { clubId }),
  leaveClub: () => api.delete("/api/auth/club"),
};
// Use Case 7: meetings and resolutions.
export const governance = {
  annualReport: (year) =>
    api.get("/api/governance/annual-report?year=" + encodeURIComponent(year)),
  settings: () => api.get("/api/governance/settings"),
  recordPolicy: (data) => api.post("/api/governance/settings", data),
  proposals: () => api.get("/api/governance/proposals"),
  propose: (data) => api.post("/api/governance/proposals", data),
  list: () => api.get("/api/governance"),
  get: (id) => api.get(`/api/governance/${id}`),
  candidates: (date) =>
    api.get(`/api/governance/candidates?date=${encodeURIComponent(date)}`),
  recordMeeting: (data) => api.post("/api/governance", data),
  recordResolution: (id, data) =>
    api.post(`/api/governance/${id}/resolutions`, data),
  apply: (id) => api.post(`/api/governance/resolutions/${id}/apply`),
};
