"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import type { LastProject } from "@/lib/lastProject";

/**
 * Client-side user state — GitHub issue #90. Loads /api/auth/me once per
 * page load and exposes it app-wide, so the landing page, onboarding,
 * login, and interview can all route returning users correctly instead of
 * re-onboarding them (the issue's core bug).
 */

export type WorkspaceSummary = {
  id: string;
  name: string;
  type: string;
  tier: string;
};

export type UserState =
  | { status: "loading" }
  | { status: "guest" }
  | {
      status: "authed";
      user: { uid: string; email: string };
      workspaces: WorkspaceSummary[];
      lastWorkspaceId: string | null;
      lastCanvasId: string | null;
      lastProject: LastProject | null;
    };

type UserContextValue = {
  state: UserState;
  /** Re-fetches /api/auth/me (e.g. after sign-in on a page that stays mounted). */
  refresh: () => Promise<void>;
  /** Full sign-out: Firebase client + HttpOnly cookie + local state. */
  signOut: () => Promise<void>;
  /** Updates only the client's cached lastProject, no network call - the
   * server side was already written by the calling screen's own canvas
   * resume fetch; this just keeps the client in sync immediately instead
   * of waiting for the next full page load to refetch /api/auth/me. */
  setLastProject: (project: LastProject) => void;
};

const UserContext = createContext<UserContextValue>({
  state: { status: "loading" },
  refresh: async () => {},
  signOut: async () => {},
  setLastProject: () => {},
});

export function useUser(): UserContextValue {
  return useContext(UserContext);
}

export default function UserProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UserState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        setState({ status: "guest" });
        return;
      }
      const data = await res.json();
      setState({
        status: "authed",
        user: data.user,
        workspaces: data.workspaces ?? [],
        lastWorkspaceId: data.lastWorkspaceId ?? null,
        lastCanvasId: data.lastCanvasId ?? null,
        lastProject: data.lastProject ?? null,
      });
    } catch {
      setState({ status: "guest" });
    }
  }, []);

  const setLastProject = useCallback((project: LastProject) => {
    setState((prev) => (prev.status === "authed" ? { ...prev, lastProject: project } : prev));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
    } catch {
      // client session may already be gone — cookie deletion still matters
    }
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch {
      // network failure: state still flips to guest; cookie expires server-side
    }
    setState({ status: "guest" });
  }, []);

  useEffect(() => {
    // Syncing with an external system (the session API); all setState here
    // happens after the fetch resolves, never synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <UserContext.Provider value={{ state, refresh, signOut, setLastProject }}>{children}</UserContext.Provider>
  );
}
