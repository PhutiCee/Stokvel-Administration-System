"use client";

/**
 * Session state for the whole application.
 *
 * The session itself lives on the server, in the session table, keyed by an
 * httpOnly cookie. This context is only a cached view of it — what /api/auth/me
 * last said. It is never the authority on anything.
 *
 * That distinction matters for `can()` below. It answers from a permissions
 * array the server sent, and it is used to decide what to RENDER: which
 * navigation items appear, which buttons are shown. It is not a security
 * boundary. Every request is authorised again on the server against the role
 * held in the active club (REQ-8). If this file were deleted and every button
 * rendered for everybody, nothing unauthorised would succeed — it would just be
 * a worse interface.
 */

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { auth, ApiError } from "@/lib/api";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({
    status: "loading", // loading | signedIn | signedOut
    user: null,
    club: null,
    membership: null,
    role: null,
    permissions: []
  });

  const refresh = useCallback(async (signal) => {
    try {
      const me = await auth.me({ signal });
      setState({
        status: "signedIn",
        user: me.user,
        club: me.club,
        membership: me.membership,
        role: me.role,
        permissions: me.permissions || []
      });
      return me;
    } catch (err) {
      if (err.name === "AbortError") return null;
      if (err instanceof ApiError && err.isUnauthorised) {
        setState({
          status: "signedOut",
          user: null,
          club: null,
          membership: null,
          role: null,
          permissions: []
        });
        return null;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal).catch(() => {
      setState((s) => ({ ...s, status: "signedOut" }));
    });
    return () => controller.abort();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setState({
        status: "signedOut",
        user: null,
        club: null,
        membership: null,
        role: null,
        permissions: []
      });
    }
  }, []);

  const value = {
    ...state,
    refresh,
    signOut,
    isPlatformAdmin: !!state.user?.isPlatformAdmin,
    /** Render-time convenience only. See the note at the top of this file. */
    can: (action) => state.permissions.includes(action)
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider.");
  return ctx;
}