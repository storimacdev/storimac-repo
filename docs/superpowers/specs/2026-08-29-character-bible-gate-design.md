# Gate World Bible on Character Bible Completion — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-29

## Problem

Live, BA-reported issue: the dashboard offers "Character Bible" and "World Bible" as two unconditional links with no enforcement, so an author can start (and progress through) World Bible before finishing Character Bible — confirmed in code: `ProjectDashboard.tsx` renders both links unconditionally, and nothing anywhere computes or checks "has every character been signed off" before allowing World Bible access.

Per the P3 PRD's own stated pipeline (`Story Foundation → Character Bible → World Bible → Story Architecture → Draft Writing`) and the user's explicit direction: for now, enforce this strict order — World Bible is inaccessible until every character from the Story Foundation's cast list has completed (signed off) Character Bible. Real-world flexibility to build World Bible first is explicitly out of scope for this fix.

## Decisions (confirmed during brainstorming, 2026-08-29)

1. **"Complete" means literally every cast member is `signed_off`** — not just Critical/Major tier. Every character from the Story Foundation's principal-cast list must reach Character Bible's Stage 6 sign-off. Minor/Supporting-tier characters already go through the same 6-stage interview at a lighter depth (existing, unchanged behavior) — no new "skip the interview" path for them.
2. **The gate is enforced in two layers**, matching this app's existing defense-in-depth convention (e.g. issue #41's canon-status route pre-validating before ever writing):
   - **`POST /api/world-chat`** (the actual turn-processing route) is the authoritative gate: it checks completion before doing any other work and rejects with a 400 if incomplete. This is the layer that matters regardless of how the request arrives.
   - **The shared canvas-resume route** (`GET /api/workspaces/[workspaceId]/canvases/[canvasId]`) also computes and returns the same check, but only when a World Bible screen is asking (gated on the existing `includeWorldMessages`/`includeWorldElements` flags, so Project 1/2's own resume calls pay no extra cost) — so `WorldInterview.tsx` can show a blocking screen immediately on load, before ever attempting an opening turn.
3. **The gate applies retroactively to already-in-progress World Bible sessions**, not just new ones — confirmed with the user directly. A session that's already at Stage 3 becomes inaccessible again the moment this ships, until every character is signed off. No exception for "already started."
4. **`slugifyCharacterName` moves out of `character-chat/route.ts` into a new shared file**, `characterEngine/characterId.ts`, exported as-is (same name, same logic) — the gate check needs the identical name-to-charId mapping `character-chat/route.ts` already uses to key `characterProgress`, and duplicating that logic risks drift between the two call sites.
5. **The gate check reuses `characterEngine/ingestFoundation.ts`'s existing `ingestFoundation()` directly** (a second, independent Foundation-document fetch from `worldEngine/ingestFoundation.ts`'s own call in the same route) rather than teaching `worldEngine/ingestFoundation.ts` to also extract cast data. This mirrors the codebase's existing precedent of each project doing its own complete, independent Foundation ingestion (per both ingestion files' own scope notes) rather than sharing extraction logic across project boundaries — the minor redundant fetch cost is accepted, matching precedent.
6. **A cast with zero principal characters (e.g. an incomplete or malformed Foundation) is treated as trivially "complete"** — nothing to block on. This isn't expected to happen in practice (the Foundation would already need real cast entries to reach Stage 8), but keeps the gate function total and prevents a degenerate empty-cast Foundation from permanently locking World Bible with no way to satisfy the gate.
7. **No dashboard-level visual gating** (e.g. graying out the "World Bible" button) in this fix — confirmed with the user. Computing completion for every project on the dashboard list would require an extra Foundation-fetch-and-ingest per project shown, which isn't justified by this fix's actual goal (stopping premature World Bible progress, which the two enforcement layers above already fully achieve).

## Architecture

### `web/src/lib/characterEngine/characterId.ts` (new)

```ts
/** Deterministic Canon Element id (and P2State.characterProgress key) for
 * a character, derived from its name. Extracted from character-chat/
 * route.ts (issue #26) into its own shared file so the Character Bible
 * completion gate (worldEngine/characterBibleGate.ts) can key
 * characterProgress the exact same way character-chat/route.ts itself
 * does, with no risk of the two derivations drifting apart. */
export function slugifyCharacterName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
```

`character-chat/route.ts` removes its own private copy of this function and imports it from here instead — no behavior change in that file, purely a move.

### `web/src/lib/worldEngine/characterBibleGate.ts` (new)

```ts
import { slugifyCharacterName } from "@/lib/characterEngine/characterId";
import type { CastMember } from "@/lib/characterEngine/ingestFoundation";
import type { P2State } from "@/lib/canonEngine/storyStore";

export interface CharacterBibleGateResult {
  complete: boolean;
  incompleteNames: string[];
}

/** True only when every cast member from the Story Foundation has reached
 * Character Bible's Stage 6 sign-off. A cast with zero entries is
 * trivially complete - nothing to block on (issue: live BA report, World
 * Bible accessible before Character Bible was finished). */
export function checkCharacterBibleComplete(
  cast: CastMember[],
  p2State: P2State | null | undefined
): CharacterBibleGateResult {
  const progress = p2State?.characterProgress ?? {};
  const incompleteNames = cast
    .filter((member) => progress[slugifyCharacterName(member.name)]?.status !== "signed_off")
    .map((member) => member.name);
  return { complete: incompleteNames.length === 0, incompleteNames };
}
```

### `web/src/app/api/character-chat/route.ts` (extended)

Removes its own private `slugifyCharacterName` function definition; imports it from `@/lib/characterEngine/characterId` instead. No other change to this file.

### `web/src/app/api/world-chat/route.ts` (extended)

Immediately after the existing membership check (before the existing `worldEngine/ingestFoundation` call, so a blocked request doesn't pay that fetch cost):

```ts
const characterFoundation = await characterIngestFoundation(storyId);
if (characterFoundation.status === "ok" || characterFoundation.status === "incomplete") {
  const gate = checkCharacterBibleComplete(characterFoundation.foundation.cast, story.p2);
  if (!gate.complete) {
    return NextResponse.json(
      {
        error: `Finish your Character Bible before starting the World Bible. Still in progress: ${gate.incompleteNames.join(", ")}.`,
      },
      { status: 400 }
    );
  }
}
```

(`characterIngestFoundation` is `characterEngine/ingestFoundation.ts`'s `ingestFoundation`, imported under an alias since this file already imports a same-named `ingestFoundation` from `worldEngine/ingestFoundation.ts`.) A `"missing"`/`"error"` character-Foundation status is treated as "nothing to gate on yet" (falls through to the existing `worldEngine/ingestFoundation` call below, which independently handles its own missing/error Foundation cases with the existing, unchanged error responses) — this fix only adds a NEW blocking condition, it doesn't change what already happens when the Foundation itself doesn't exist.

### `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (extended)

When `includeWorldMessages || includeWorldElements` is true, additionally computes the same gate result (via the same `characterIngestFoundation` + `checkCharacterBibleComplete` call) and includes it in the response as `characterBibleGate: CharacterBibleGateResult | null` (`null` when the request isn't a World Bible resume, i.e. the flag is false — no extra Firestore reads for Project 1/2's own resume calls).

### `web/src/components/WorldInterview.tsx` (extended)

New state: `characterBibleGate: CharacterBibleGateResult | null`, populated from the resume response. When it's non-null and `!complete`, render a new blocking screen (mirroring the existing "No Story Canvas selected" full-screen pattern already in this file) instead of the normal chat/preview layout:

- Heading: "Finish your Character Bible first"
- Body: lists `incompleteNames` ("Still in progress: Deva, Sudarshan.")
- A link to `/character-bible?workspaceId=...&canvasId=...`

The existing auto-opening-turn effect is additionally guarded on `!characterBibleGate || characterBibleGate.complete`, so a blocked session never fires an opening turn (avoiding a wasted, guaranteed-to-be-rejected `POST /api/world-chat` call).

## Error Handling

The `POST /api/world-chat` gate returns a clean, actionable 400 (not a generic error) naming exactly which characters remain. The resume-route's computed gate is purely additive — it changes nothing about that route's existing error responses (404/403 for a missing canvas or non-member), and a `characterBibleGate: null` (non-World-Bible request) is indistinguishable from today's response shape for every existing caller.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A story with at least one character not yet signed off shows the blocking screen on World Bible load, names the correct incomplete character(s), and never fires an opening turn.
- Signing off the last remaining character, then reloading World Bible, shows the normal interview instead of the blocking screen.
- A direct `POST /api/world-chat` call (bypassing the UI) for a story with incomplete characters is rejected with the same 400, even if the resume route was never called first.
- A story whose Character Bible was already fully complete before this change continues to load World Bible exactly as before (no regression for the common case).
- `character-chat/route.ts`'s own behavior (charId resolution, tier lookups, etc.) is unchanged after `slugifyCharacterName` moves to the new shared file.
