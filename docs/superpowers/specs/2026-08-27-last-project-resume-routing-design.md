# Fix: "Resume My Work" Always Redirects to Project 1 — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-27

## Problem

Live, BA-reported bug: after generating the Story Foundation Document and clicking "Continue to Character Development →" into Project 2, a later page refresh (or any other event that re-runs the app's "resume my last work" logic) sends the author back to the Project 1 Story Foundation interview instead of staying on or returning to the Character Bible.

Root cause, confirmed by tracing every redirect site in the codebase: `UserProfile` (`web/src/lib/userStore.ts`) tracks `lastWorkspaceId`/`lastCanvasId` — which *canvas* the author was last working in — but nothing about which *project screen* (Story Foundation / Character Bible / World Bible) was actually active. Five separate call sites read those two fields and build a resume redirect, and all five hardcode `/interview` (Project 1) as the destination:

- `web/src/app/login/page.tsx` — post-login redirect
- `web/src/components/OnboardingFlow.tsx` — resume check before onboarding
- `web/src/components/LandingCta.tsx` — the landing page's "continue" button
- `web/src/components/UserMenu.tsx` — the user menu's "back to my story" link
- `web/src/components/ChatInterview.tsx` — its own no-query-params fallback effect

Any of these firing after the author has moved into Project 2 or 3 sends them back to Project 1, even though the app already has everything it needs to know better: the shared canvas-resume route (`web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`) already receives `includeCharacterMessages`/`includeWorldMessages` query flags that uniquely identify which screen made the request.

## Decisions (confirmed during brainstorming, 2026-08-27)

1. **Track "last active project" as a new field on the user profile**, alongside the existing `lastWorkspaceId`/`lastCanvasId` — not as a property of the Story/Canvas itself. A single canvas is worked on on across all three project screens over its lifetime; "which screen was I just on" is a fact about the *author's session*, not about the canvas.
2. **Infer the project from the existing `includeCharacterMessages`/`includeWorldMessages` flags** already sent by each screen's resume fetch, rather than adding a new query parameter. `CharacterInterview.tsx` already sends `?characterMessages=1`; `WorldInterview.tsx` already sends `?worldMessages=1&worldElements=1`; `ChatInterview.tsx` (Project 1) sends neither. This is a reliable, already-existing signal — no screen needs to change what it requests.
3. **Backward compatible by construction.** Existing `UserProfile` documents have no `lastProject` field; treated identically to an explicit `null` — every redirect site's mapping function returns `/interview` for `null`, exactly matching today's behavior. No data migration needed.
4. **A single small, pure mapping function, in its own new zero-import file** — not duplicated logic at each of the five call sites, and NOT folded into `userStore.ts`. Verified directly: `userStore.ts` has a top-level `import { getDb } from "@/lib/firebaseAdmin"`, a server-only module — importing anything from that file into a client component (four of the five redirect sites are `"use client"` components) would drag server-only code into the client bundle. This is the exact problem `worldEngine/wcl.ts` and `canonEngine/stageDefinitions.ts` were already split out to avoid; `lastProjectPath` and its `LastProject` type get the same treatment, in a new `web/src/lib/lastProject.ts` with no imports at all.
5. **No change to how each project screen itself resumes** (`ChatInterview.tsx`/`CharacterInterview.tsx`/`WorldInterview.tsx`'s own fetch calls are untouched) — only the *cross-project* "where do I land" redirects change. A screen that already has `workspaceId`/`canvasId` in its URL never consults `lastProject` at all (matching `ChatInterview.tsx`'s existing early-return `if (workspaceId && canvasId) return;` before its fallback effect runs).

## Architecture

### `web/src/lib/lastProject.ts` (new, zero imports, safe in client or server code)

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

### `web/src/lib/userStore.ts` (extended)

```ts
import type { LastProject } from "@/lib/lastProject";

export interface UserProfile {
  // ...existing fields unchanged...
  lastProject: LastProject | null;
}
```

`ensureUserProfile`'s first-session-creation branch adds `lastProject: null` alongside the existing `lastWorkspaceId: null, lastCanvasId: null`. Its refresh branch (returning profiles) is untouched — it already preserves every field on `existing` it doesn't explicitly overwrite.

`setLastVisited` gains a fourth parameter:

```ts
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

### `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (extended)

The existing `setLastVisited(user.uid, workspaceId, canvasId)` call becomes (importing `type LastProject` from the new `@/lib/lastProject` module):

```ts
const project: LastProject = includeCharacterMessages
  ? "character-bible"
  : includeWorldMessages
    ? "world-bible"
    : "interview";
await setLastVisited(user.uid, workspaceId, canvasId, project);
```

placed after both flags are already computed, no change to their own definitions.

### `web/src/app/api/auth/me/route.ts` (extended)

Adds `lastProject: profile.lastProject` to its existing JSON response, alongside `lastWorkspaceId`/`lastCanvasId`.

### `web/src/components/UserProvider.tsx` (extended)

Its authed-state shape gains `lastProject: LastProject | null`, populated from the `/api/auth/me` response the same way `lastWorkspaceId`/`lastCanvasId` already are.

### Five redirect call sites (each a small, identical-shape change)

Every site currently does the equivalent of:

```ts
router.replace(`/interview?workspaceId=${lastWorkspaceId}&canvasId=${lastCanvasId}`);
```

(or, for `LandingCta.tsx`, a `<Link href="/interview?...">`). Each becomes:

```ts
router.replace(`${lastProjectPath(lastProject)}?workspaceId=${lastWorkspaceId}&canvasId=${lastCanvasId}`);
```

with `lastProjectPath` imported from the new `@/lib/lastProject` module. `LandingCta.tsx`'s JSX `<Link href="...">` gets the same substitution.

## Error Handling

No new error surface: `lastProjectPath` is a total, pure function with an explicit fallback for every input including `undefined`/`null`/any unrecognized string, so a malformed or stale `lastProject` value degrades to today's exact behavior (`/interview`) rather than producing a broken link.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual pass:
- Visit Character Bible for an existing canvas, then trigger each of the five resume paths (browser reload of a bare `/` or unrelated page that goes through `UserProvider`, the user-menu link, sign-out/sign-in via `/login`, the landing page's CTA, and `OnboardingFlow` re-entry with an already-onboarded profile) — confirm each lands back on `/character-bible`, not `/interview`.
- Repeat for World Bible, confirming `/world-bible`.
- Confirm a canvas whose author has only ever used Project 1 still resumes to `/interview` (both for a pre-existing profile with no `lastProject` field, and for a fresh profile that has only ever visited Project 1).
