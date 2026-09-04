# P1 (Story Foundation) Completion Lock — Design

## Problem

Once an author generates their Story Foundation Document (Project 1, Stage
8), nothing stops them from continuing to chat in the Project 1 interview
and silently changing Confirmed canon elements — even after Character
Bible (Project 2) and World Bible (Project 3) work has been built on top
of that foundation. The author asked for a completion lock: once P1 is
done, it should read-only by default, with an explicit, deliberate unlock
step required before editing again.

## Data model

Add one field to the `Story` document (`web/src/lib/canonEngine/storyStore.ts`):

```ts
/**
 * Project 1 completion lock. Set true by every successful
 * Story Foundation Document generation (POST .../document); cleared only
 * by the explicit unlock action (POST .../unlock). Optional/nullable since
 * Stories created before this field existed won't have it in Firestore —
 * treat undefined/null the same as false (unlocked) everywhere this is read.
 */
p1Locked?: boolean | null;
```

A small setter alongside the file's existing simple setters (`setPendingConflict`, `setStage7Audit`):

```ts
export async function setP1Locked(storyId: string, locked: boolean): Promise<void> {
  await storiesCollection().doc(storyId).update({ p1Locked: locked, updatedAt: new Date().toISOString() });
}
```

## Lock trigger

`POST /api/workspaces/[workspaceId]/canvases/[canvasId]/document` (the
existing endpoint behind both "Generate document" and "Regenerate")
already requires `currentStage >= 8`. On every successful generation —
first time or any later regeneration after an unlock — it now also calls
`setP1Locked(canvasId, true)` and includes `locked: true` in its JSON
response, so the client updates its local lock state immediately without
a second round-trip.

This single trigger point covers both required behaviors from the design
discussion: the *initial* lock (first generation) and *re-locking* (any
generation after an unlock) are the same code path — no separate
"first-time" branch needed.

## Unlock

New endpoint: `POST /api/workspaces/[workspaceId]/canvases/[canvasId]/unlock`.

- Same authorization as every other canvas action in this route family:
  `requireUser()` + `getMembership(workspaceId, uid)` (any workspace
  member, matching the app's existing all-members-can-edit model — no new
  permission tier).
- Calls `setP1Locked(canvasId, false)`.
- Returns `{ locked: false }`.

No endpoint accepts a client-supplied `locked: true` — locking only ever
happens as a side effect of document generation, never as a direct client
request. This keeps "who can lock" simple: it's a consequence of finishing
the interview, not a permission to manage.

## Server-side enforcement (authoritative)

`POST /api/chat` (`web/src/app/api/chat/route.ts`) is Project 1's only
write path for canon elements — there is no other UI that edits them
(`CanonPanel.tsx` is read-only display). Immediately after the existing
membership check and before `appendMessage`/any Anthropic call:

```ts
if (story.p1Locked) {
  return NextResponse.json(
    { error: "The Story Foundation is locked. Unlock it first to keep editing." },
    { status: 409 }
  );
}
```

This is the real gate — the client-side disabled input is UX, not
security. Bypassing the disabled textarea (e.g. a direct API call) still
hits this check, matching how the Character Bible gate is enforced
server-side in `world-chat/route.ts` rather than relying on the client.

## Client UX (`ChatInterview.tsx`)

- New state `p1Locked`, initialized from the resume GET's `story.p1Locked`
  (already returned in full via `story: { ...story }` in
  `canvases/[canvasId]/route.ts` — no route change needed there beyond the
  new field existing on the type), updated by:
  - `generateDocument()`'s response (`locked: true`)
  - the new unlock call's response (`locked: false`)
- When `p1Locked` is true:
  - The textarea and Send button are disabled, placeholder text changes to
    something like "Story Foundation is locked — unlock to edit."
  - A small banner renders above the input (inside the left panel, not a
    full-screen takeover — message history, the "Generate
    document"/"Regenerate" controls, and the "Continue to Character
    Development / Start World Bible / Back to Dashboard" links all stay
    exactly as they are today, locked or not) with an "Unlock to edit"
    button.
- Clicking "Unlock to edit" shows a `window.confirm(...)` warning —
  reusing the exact pattern already used in `WorldInterview.tsx` for
  "changing this affects downstream work, continue?" moments (World
  Complexity Level changes, un-confirming a Confirmed pillar), so no new
  confirmation-UI pattern is introduced:

  > "Editing your Story Foundation may affect Character Bible and World
  > Bible work already built on it. Unlock anyway?"

  On confirm, `POST .../unlock`, then clear local `p1Locked` state on
  success (re-enabling the input).

## Edge cases

- **Pre-existing stories** (no `p1Locked` field yet): read as `undefined`,
  treated as unlocked everywhere (`story.p1Locked === true` is the only
  check used — never a bare truthy check that could misread `undefined`).
- **Regenerate while already locked**: harmless no-op for the lock itself
  (`setP1Locked(id, true)` when already true) — Regenerate stays available
  while locked exactly as decided, since it recompiles from already-
  Confirmed elements and doesn't require editing.
- **Race between an in-flight generate and a chat send**: the chat
  endpoint reads `story.p1Locked` fresh at request time, so whichever
  write commits first is what the next request sees — acceptable
  eventual consistency, not worth a distributed lock for this.
- **World/Character Bible ingestion** (`ingestFoundation` in
  `worldEngine`/`characterEngine`): read-only consumers of P1's Confirmed
  elements; unaffected by this change either way.

## Out of scope

- No change to Stage 7/8 gating, document versioning, or the PDF export.
- No new permission tier — unlock is available to the same workspace
  members who could already edit P1.
- No auto-lock timer or "lock after N minutes idle" — the lock is purely
  event-driven (generate locks, unlock unlocks).
