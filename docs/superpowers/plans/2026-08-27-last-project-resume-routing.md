# Last-Active-Project Resume Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every "resume my last work" redirect in the app (login, onboarding re-entry, the landing page CTA, the user menu, and the interview screen's own no-params fallback) sends the author back to the project screen (Story Foundation / Character Bible / World Bible) they were actually last active in, instead of always defaulting to Project 1.

**Architecture:** Track a new `lastProject` field on the user profile, inferred at the one place that already distinguishes which screen is asking (the shared canvas-resume route, via its existing `includeCharacterMessages`/`includeWorldMessages` flags), threaded through `/api/auth/me` and `UserProvider`'s client state, and consumed by a single small pure mapping function at every redirect site.

**Tech Stack:** Next.js API routes, Firebase Admin/Firestore, React (client components). No new dependencies.

## Global Constraints

- `lastProjectPath` and the `LastProject` type live in a brand-new file, `web/src/lib/lastProject.ts`, with **zero imports** — `userStore.ts` has a top-level `import { getDb } from "@/lib/firebaseAdmin"` (server-only), so anything exported from it is unsafe to import into a client component. Four of the five redirect sites are `"use client"` components.
- `lastProject: null` (or the field being entirely absent, for a pre-existing profile) must always resolve to `/interview` — exactly today's behavior. No data migration, no backfill.
- No automated test framework exists in this repo. Verification for every task is `npm run lint` and `npm run build`, both run from the `web/` directory, plus a manual read-through (and, for the final task, a manual multi-path resume check).
- Do not change what each project screen's own resume fetch requests (`ChatInterview.tsx`, `CharacterInterview.tsx`, `WorldInterview.tsx` keep their existing query params exactly as-is) — only the cross-project redirect destinations change.

---

### Task 1: Add the `lastProject` type/mapping module and extend `UserProfile`

**Files:**
- Create: `web/src/lib/lastProject.ts`
- Modify: `web/src/lib/userStore.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type LastProject = "interview" | "character-bible" | "world-bible"` and `export function lastProjectPath(project: LastProject | null | undefined): string` from `lastProject.ts`. `UserProfile.lastProject: LastProject | null` and the extended `setLastVisited(uid, lastWorkspaceId, lastCanvasId, lastProject)` signature from `userStore.ts`. Tasks 2-4 all depend on these exact names.

`web/src/lib/userStore.ts` currently reads (relevant excerpts):

```ts
import { getDb } from "@/lib/firebaseAdmin";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: string;
  updatedAt: string;
  lastWorkspaceId: string | null;
  lastCanvasId: string | null;
  acceptedTermsAt: string | null;
}
```

and, inside `ensureUserProfile`'s first-session-creation branch:

```ts
      const profile: UserProfile = {
        uid: params.uid,
        email: params.email,
        displayName: params.displayName ?? null,
        photoURL: params.photoURL ?? null,
        createdAt: now,
        updatedAt: now,
        lastWorkspaceId: null,
        lastCanvasId: null,
        acceptedTermsAt: null,
      };
```

and, at the bottom of the file:

```ts
/** Called whenever a canvas is opened or created, so "/" and bare "/interview" can resume it. */
export async function setLastVisited(
  uid: string,
  lastWorkspaceId: string,
  lastCanvasId: string
): Promise<void> {
  await usersCollection().doc(uid).set(
    { lastWorkspaceId, lastCanvasId, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}
```

- [ ] **Step 1: Create `web/src/lib/lastProject.ts`**

```ts
export type LastProject = "interview" | "character-bible" | "world-bible";

/** Maps a tracked last-active project to its route prefix - null/undefined
 * (never tracked, or a pre-this-feature profile) falls back to Project 1's
 * `/interview`, preserving the app's pre-existing behavior exactly. */
export function lastProjectPath(project: LastProject | null | undefined): string {
  if (project === "character-bible") return "/character-bible";
  if (project === "world-bible") return "/world-bible";
  return "/interview";
}
```

- [ ] **Step 2: Add the import and extend `UserProfile` in `userStore.ts`**

Change:

```ts
import { getDb } from "@/lib/firebaseAdmin";
```

to:

```ts
import { getDb } from "@/lib/firebaseAdmin";
import type { LastProject } from "@/lib/lastProject";
```

Change:

```ts
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: string;
  updatedAt: string;
  lastWorkspaceId: string | null;
  lastCanvasId: string | null;
  acceptedTermsAt: string | null;
}
```

to:

```ts
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: string;
  updatedAt: string;
  lastWorkspaceId: string | null;
  lastCanvasId: string | null;
  lastProject: LastProject | null;
  acceptedTermsAt: string | null;
}
```

- [ ] **Step 3: Add `lastProject: null` to the profile-creation literal**

Change:

```ts
      const profile: UserProfile = {
        uid: params.uid,
        email: params.email,
        displayName: params.displayName ?? null,
        photoURL: params.photoURL ?? null,
        createdAt: now,
        updatedAt: now,
        lastWorkspaceId: null,
        lastCanvasId: null,
        acceptedTermsAt: null,
      };
```

to:

```ts
      const profile: UserProfile = {
        uid: params.uid,
        email: params.email,
        displayName: params.displayName ?? null,
        photoURL: params.photoURL ?? null,
        createdAt: now,
        updatedAt: now,
        lastWorkspaceId: null,
        lastCanvasId: null,
        lastProject: null,
        acceptedTermsAt: null,
      };
```

Leave the refresh branch (`const refreshed: UserProfile = { ...existing, ... }`) untouched — it already preserves `lastProject` via the `...existing` spread.

- [ ] **Step 4: Extend `setLastVisited`**

Change:

```ts
/** Called whenever a canvas is opened or created, so "/" and bare "/interview" can resume it. */
export async function setLastVisited(
  uid: string,
  lastWorkspaceId: string,
  lastCanvasId: string
): Promise<void> {
  await usersCollection().doc(uid).set(
    { lastWorkspaceId, lastCanvasId, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}
```

to:

```ts
/** Called whenever a canvas is opened or created, so "/" and bare "/interview"
 * (or the equivalent bare route for whichever project was last active) can
 * resume it. */
export async function setLastVisited(
  uid: string,
  lastWorkspaceId: string,
  lastCanvasId: string,
  lastProject: LastProject
): Promise<void> {
  await usersCollection().doc(uid).set(
    { lastWorkspaceId, lastCanvasId, lastProject, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}
```

- [ ] **Step 5: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: the build will show a type error in `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` — its existing `setLastVisited(user.uid, workspaceId, canvasId)` call is now missing the required 4th argument. This is expected; Task 2 fixes it, not this task. Confirm the error is exactly that one call site.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/lastProject.ts web/src/lib/userStore.ts
git commit -m "feat: add LastProject type and extend UserProfile with lastProject"
```

---

### Task 2: Infer and record the active project on every canvas resume

**Files:**
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`

**Interfaces:**
- Consumes: `type LastProject` (Task 1), the extended `setLastVisited` (Task 1).
- Produces: nothing consumed by a later task — this is the one write site; later tasks only read `lastProject` back out via `/api/auth/me`.

This file's `GET` handler currently has this import block and these two lines (already shown in full above; the two lines of interest):

```ts
import { setLastVisited } from "@/lib/userStore";
```

and:

```ts
    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);
```

- [ ] **Step 1: Add the `LastProject` type import**

Change:

```ts
import { setLastVisited } from "@/lib/userStore";
```

to:

```ts
import { setLastVisited } from "@/lib/userStore";
import type { LastProject } from "@/lib/lastProject";
```

- [ ] **Step 2: Infer the project and pass it to `setLastVisited`**

Change:

```ts
    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);
```

to:

```ts
    // Track last-visited so a bare resume route lands back on whichever
    // project screen was actually active, not always Project 1 (issue #90,
    // extended). includeCharacterMessages/includeWorldMessages already
    // uniquely identify which screen made this request - no new query
    // param needed.
    const lastProject: LastProject = includeCharacterMessages
      ? "character-bible"
      : includeWorldMessages
        ? "world-bible"
        : "interview";
    await setLastVisited(user.uid, workspaceId, canvasId, lastProject);
```

- [ ] **Step 3: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: the error from Task 1's Step 5 is gone; no new errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts
git commit -m "feat: infer and record last-active project on every canvas resume"
```

---

### Task 3: Thread `lastProject` through `/api/auth/me` and `UserProvider`

**Files:**
- Modify: `web/src/app/api/auth/me/route.ts`
- Modify: `web/src/components/UserProvider.tsx`

**Interfaces:**
- Consumes: `UserProfile.lastProject` (Task 1).
- Produces: `UserState`'s `"authed"` variant gains `lastProject: LastProject | null`. Task 4's five redirect sites all read this field.

`web/src/app/api/auth/me/route.ts` currently reads in full:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getUserProfile, ensureUserProfile } from "@/lib/userStore";
import { listWorkspacesForUser } from "@/lib/workspace/workspaceStore";

export const runtime = "nodejs";

/**
 * The client's single source of user state — issue #90. Returns the signed-in
 * user, their workspaces, and the last-visited workspace/canvas so every page
 * can route returning users correctly instead of re-onboarding them.
 * 401 for guests (UserProvider treats that as "guest", not an error).
 */
export async function GET() {
  try {
    const user = await requireUser();
    let profile = await getUserProfile(user.uid);
    if (!profile) {
      // Sessions minted before issue #90 shipped have no profile doc yet.
      profile = await ensureUserProfile({ uid: user.uid, email: user.email });
    }
    const workspaces = await listWorkspacesForUser(user.uid);
    return NextResponse.json({
      user: { uid: user.uid, email: user.email },
      workspaces,
      lastWorkspaceId: profile.lastWorkspaceId,
      lastCanvasId: profile.lastCanvasId,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

`web/src/components/UserProvider.tsx` currently reads in full:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

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
    };

type UserContextValue = {
  state: UserState;
  /** Re-fetches /api/auth/me (e.g. after sign-in on a page that stays mounted). */
  refresh: () => Promise<void>;
  /** Full sign-out: Firebase client + HttpOnly cookie + local state. */
  signOut: () => Promise<void>;
};

const UserContext = createContext<UserContextValue>({
  state: { status: "loading" },
  refresh: async () => {},
  signOut: async () => {},
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
      });
    } catch {
      setState({ status: "guest" });
    }
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

  return <UserContext.Provider value={{ state, refresh, signOut }}>{children}</UserContext.Provider>;
}
```

- [ ] **Step 1: Add `lastProject` to the `/api/auth/me` response**

Change:

```ts
    return NextResponse.json({
      user: { uid: user.uid, email: user.email },
      workspaces,
      lastWorkspaceId: profile.lastWorkspaceId,
      lastCanvasId: profile.lastCanvasId,
    });
```

to:

```ts
    return NextResponse.json({
      user: { uid: user.uid, email: user.email },
      workspaces,
      lastWorkspaceId: profile.lastWorkspaceId,
      lastCanvasId: profile.lastCanvasId,
      lastProject: profile.lastProject,
    });
```

- [ ] **Step 2: Add the `LastProject` import to `UserProvider.tsx`**

Change:

```tsx
import { signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
```

to:

```tsx
import { signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import type { LastProject } from "@/lib/lastProject";
```

- [ ] **Step 3: Add `lastProject` to the `"authed"` state variant**

Change:

```tsx
export type UserState =
  | { status: "loading" }
  | { status: "guest" }
  | {
      status: "authed";
      user: { uid: string; email: string };
      workspaces: WorkspaceSummary[];
      lastWorkspaceId: string | null;
      lastCanvasId: string | null;
    };
```

to:

```tsx
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
```

- [ ] **Step 4: Populate it in `refresh()`**

Change:

```tsx
      setState({
        status: "authed",
        user: data.user,
        workspaces: data.workspaces ?? [],
        lastWorkspaceId: data.lastWorkspaceId ?? null,
        lastCanvasId: data.lastCanvasId ?? null,
      });
```

to:

```tsx
      setState({
        status: "authed",
        user: data.user,
        workspaces: data.workspaces ?? [],
        lastWorkspaceId: data.lastWorkspaceId ?? null,
        lastCanvasId: data.lastCanvasId ?? null,
        lastProject: data.lastProject ?? null,
      });
```

- [ ] **Step 5: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/auth/me/route.ts web/src/components/UserProvider.tsx
git commit -m "feat: thread lastProject through /api/auth/me and UserProvider"
```

---

### Task 4: Route every "resume my work" redirect through `lastProjectPath`

**Files:**
- Modify: `web/src/app/login/page.tsx`
- Modify: `web/src/components/OnboardingFlow.tsx`
- Modify: `web/src/components/LandingCta.tsx`
- Modify: `web/src/components/UserMenu.tsx`
- Modify: `web/src/components/ChatInterview.tsx`

**Interfaces:**
- Consumes: `lastProjectPath` and `state.lastProject`/`userState.lastProject` (Tasks 1 and 3).
- Produces: nothing consumed by a later task — this is the final task.

Each file currently reads (only the relevant excerpt shown per file):

`web/src/app/login/page.tsx`:

```tsx
import { useUser } from "@/components/UserProvider";
import { useAuth } from "@/lib/useAuth";
```

and:

```tsx
  useEffect(() => {
    if (state.status !== "authed") return;
    if (state.lastWorkspaceId && state.lastCanvasId) {
      router.replace(`/interview?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`);
    } else {
      router.replace("/onboarding");
    }
  }, [state, router]);
```

`web/src/components/OnboardingFlow.tsx` (only the relevant block; do not touch anything else in this file):

```tsx
    if (userState.lastWorkspaceId && userState.lastCanvasId) {
      router.replace(
        `/interview?workspaceId=${userState.lastWorkspaceId}&canvasId=${userState.lastCanvasId}`
      );
      return;
    }
```

`web/src/components/LandingCta.tsx` in full:

```tsx
"use client";

import Link from "next/link";
import { useUser } from "@/components/UserProvider";

/**
 * State-aware landing CTA — issue #90. Returning users with a canvas get
 * "Continue your story" straight into it; everyone else gets onboarding
 * (which itself skips signup for authed users).
 */
export default function LandingCta() {
  const { state } = useUser();

  if (state.status === "authed" && state.lastWorkspaceId && state.lastCanvasId) {
    return (
      <div className="flex items-center gap-4">
        <Link
          href={`/interview?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`}
          className="btn btn-ember"
        >
          Continue your story
        </Link>
        <span className="ob-hint">Pick up right where you left off.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Link href="/onboarding" className="btn btn-ember">
        Get Started
      </Link>
      <span className="ob-hint">Takes under a minute to set up your workspace.</span>
    </div>
  );
}
```

`web/src/components/UserMenu.tsx` (only the relevant excerpt):

```tsx
import { useRouter } from "next/navigation";
import { useUser } from "@/components/UserProvider";
```

and:

```tsx
          {hasCanvas && (
            <button
              onClick={() => {
                setOpen(false);
                router.push(`/interview?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`);
              }}
              className="block w-full px-4 py-2.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
            >
              My Canvas
            </button>
          )}
```

`web/src/components/ChatInterview.tsx` (only the relevant excerpt near the top of the component; do not touch anything else in this large file):

```tsx
  const { state: userState } = useUser();

  // Bare /interview: route signed-in users to their last canvas (issue #90)
  // instead of the dead-end empty state (which stays for guests).
  useEffect(() => {
    if (workspaceId && canvasId) return;
    if (userState.status === "authed" && userState.lastWorkspaceId && userState.lastCanvasId) {
      router.replace(
        `/interview?workspaceId=${userState.lastWorkspaceId}&canvasId=${userState.lastCanvasId}`
      );
    }
  }, [workspaceId, canvasId, userState, router]);
```

- [ ] **Step 1: `web/src/app/login/page.tsx`**

Change the import block:

```tsx
import { useUser } from "@/components/UserProvider";
import { useAuth } from "@/lib/useAuth";
```

to:

```tsx
import { useUser } from "@/components/UserProvider";
import { useAuth } from "@/lib/useAuth";
import { lastProjectPath } from "@/lib/lastProject";
```

Change:

```tsx
  useEffect(() => {
    if (state.status !== "authed") return;
    if (state.lastWorkspaceId && state.lastCanvasId) {
      router.replace(`/interview?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`);
    } else {
      router.replace("/onboarding");
    }
  }, [state, router]);
```

to:

```tsx
  useEffect(() => {
    if (state.status !== "authed") return;
    if (state.lastWorkspaceId && state.lastCanvasId) {
      router.replace(
        `${lastProjectPath(state.lastProject)}?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`
      );
    } else {
      router.replace("/onboarding");
    }
  }, [state, router]);
```

- [ ] **Step 2: `web/src/components/OnboardingFlow.tsx`**

Find this file's existing imports near the top (it already imports `useUser` and other hooks — add the new import alongside them; the exact surrounding import lines vary, so add this line among the existing `@/lib/...` and `@/components/...` imports at the top of the file):

```tsx
import { lastProjectPath } from "@/lib/lastProject";
```

Change:

```tsx
    if (userState.lastWorkspaceId && userState.lastCanvasId) {
      router.replace(
        `/interview?workspaceId=${userState.lastWorkspaceId}&canvasId=${userState.lastCanvasId}`
      );
      return;
    }
```

to:

```tsx
    if (userState.lastWorkspaceId && userState.lastCanvasId) {
      router.replace(
        `${lastProjectPath(userState.lastProject)}?workspaceId=${userState.lastWorkspaceId}&canvasId=${userState.lastCanvasId}`
      );
      return;
    }
```

Do not change anything else in this file.

- [ ] **Step 3: `web/src/components/LandingCta.tsx`**

Replace the file's full content with:

```tsx
"use client";

import Link from "next/link";
import { useUser } from "@/components/UserProvider";
import { lastProjectPath } from "@/lib/lastProject";

/**
 * State-aware landing CTA — issue #90. Returning users with a canvas get
 * "Continue your story" straight into it; everyone else gets onboarding
 * (which itself skips signup for authed users).
 */
export default function LandingCta() {
  const { state } = useUser();

  if (state.status === "authed" && state.lastWorkspaceId && state.lastCanvasId) {
    return (
      <div className="flex items-center gap-4">
        <Link
          href={`${lastProjectPath(state.lastProject)}?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`}
          className="btn btn-ember"
        >
          Continue your story
        </Link>
        <span className="ob-hint">Pick up right where you left off.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Link href="/onboarding" className="btn btn-ember">
        Get Started
      </Link>
      <span className="ob-hint">Takes under a minute to set up your workspace.</span>
    </div>
  );
}
```

- [ ] **Step 4: `web/src/components/UserMenu.tsx`**

Change:

```tsx
import { useRouter } from "next/navigation";
import { useUser } from "@/components/UserProvider";
```

to:

```tsx
import { useRouter } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import { lastProjectPath } from "@/lib/lastProject";
```

Change:

```tsx
          {hasCanvas && (
            <button
              onClick={() => {
                setOpen(false);
                router.push(`/interview?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`);
              }}
              className="block w-full px-4 py-2.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
            >
              My Canvas
            </button>
          )}
```

to:

```tsx
          {hasCanvas && (
            <button
              onClick={() => {
                setOpen(false);
                router.push(
                  `${lastProjectPath(state.lastProject)}?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`
                );
              }}
              className="block w-full px-4 py-2.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
            >
              My Canvas
            </button>
          )}
```

- [ ] **Step 5: `web/src/components/ChatInterview.tsx`**

Find this line among the file's existing imports:

```tsx
import { useUser } from "@/components/UserProvider";
```

Add immediately after it:

```tsx
import { lastProjectPath } from "@/lib/lastProject";
```

Change:

```tsx
  // Bare /interview: route signed-in users to their last canvas (issue #90)
  // instead of the dead-end empty state (which stays for guests).
  useEffect(() => {
    if (workspaceId && canvasId) return;
    if (userState.status === "authed" && userState.lastWorkspaceId && userState.lastCanvasId) {
      router.replace(
        `/interview?workspaceId=${userState.lastWorkspaceId}&canvasId=${userState.lastCanvasId}`
      );
    }
  }, [workspaceId, canvasId, userState, router]);
```

to:

```tsx
  // Bare /interview: route signed-in users to their last-active project
  // screen (issue #90, extended) instead of the dead-end empty state
  // (which stays for guests). Usually this resolves back to /interview
  // itself (a no-op replace) unless the author's last activity was
  // actually in Character Bible or World Bible.
  useEffect(() => {
    if (workspaceId && canvasId) return;
    if (userState.status === "authed" && userState.lastWorkspaceId && userState.lastCanvasId) {
      router.replace(
        `${lastProjectPath(userState.lastProject)}?workspaceId=${userState.lastWorkspaceId}&canvasId=${userState.lastCanvasId}`
      );
    }
  }, [workspaceId, canvasId, userState, router]);
```

Do not change anything else in this file.

- [ ] **Step 6: Verify with lint/build**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 7: Manual dev-server verification**

Run from `web/`: `npm run dev`. Using a Story Canvas that has an existing Character Bible session:
1. Navigate to `/character-bible?workspaceId=...&canvasId=...` and let it load.
2. Open the user menu (top-right) and click "My Canvas" — confirm it lands on `/character-bible?...`, not `/interview?...`.
3. Sign out, then sign back in from `/login` — confirm the post-login redirect lands on `/character-bible?...`.
4. Visit a bare `/interview` URL with no query params while signed in — confirm it redirects to `/character-bible?...` rather than staying on the empty Project 1 state.
5. Repeat steps 1-2 for a Story Canvas whose last activity was in World Bible (`/world-bible?...`) — confirm "My Canvas" and the login redirect both land on `/world-bible?...`.
6. For a Story Canvas that has only ever been used in Project 1 (or for a user profile created before this change), confirm every resume path still lands on `/interview?...` exactly as before.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/login/page.tsx web/src/components/OnboardingFlow.tsx web/src/components/LandingCta.tsx web/src/components/UserMenu.tsx web/src/components/ChatInterview.tsx
git commit -m "feat: route every resume redirect through the author's last-active project"
```

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (new profile field) and Decision 3 (backward compatibility) — Task 1. Decision 2 (infer from existing flags) — Task 2. Decision 4 (zero-import module) — Task 1's new `lastProject.ts` file, verified against `userStore.ts`'s actual `firebaseAdmin` import before writing this plan. Decision 5 (no change to each screen's own resume fetch) — confirmed no task touches `CharacterInterview.tsx`'s or `WorldInterview.tsx`'s own fetch calls, only the five cross-project redirect sites.
- **Placeholder scan:** no TBD/TODO; every step has literal code.
- **Type consistency:** `LastProject` (Task 1) is imported identically (as a type-only import) in `userStore.ts` (Task 1), the canvases route (Task 2), and `UserProvider.tsx` (Task 3); `lastProjectPath` (Task 1) is imported and called identically at all five sites in Task 4. The `UserState`'s `"authed"` variant's `lastProject` field name matches exactly what Task 4's five call sites read (`state.lastProject` / `userState.lastProject`).
