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

async function request(path, { method = "GET", body, signal } = {}) {
  let response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    // The server is not answering at all. Say so plainly: a member seeing
    // "Failed to fetch" learns nothing they can act on.
    throw new ApiError(
      0,
      "OFFLINE",
      "Cannot reach the system. Check your connection and try again."
    );
  }

  if (response.status === 204) return null;

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
      e.detail
    );
  }

  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: "GET" }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
  delete: (path, opts) => request(path, { ...opts, method: "DELETE" })
};

// --- Use Case 1 ------------------------------------------------------------
export const auth = {
  login: (identifier, password) => api.post("/api/auth/login", { identifier, password }),
  logout: () => api.post("/api/auth/logout"),
  me: (opts) => api.get("/api/auth/me", opts),
  clubs: () => api.get("/api/auth/clubs"),
  selectClub: (clubId) => api.post("/api/auth/club", { clubId }),
  leaveClub: () => api.delete("/api/auth/club")
};