# P3 World Complexity Level (WCL) — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-25

## Problem

GitHub issue #39 (P3 Phase 1). Acceptance criteria: World Complexity Level (WCL) is one of Level 1 (Minimal) / 2 (Moderate) / 3 (Rich) / 4 (Extensive), stored once per project; the system proposes a WCL based on the ingested Story Foundation and the author confirms or overrides; changing WCL after it's set shows a warning, not a silent change.

Issue #38's system prompt (`sp03-wdc-systemprompt.md` §10, Opening Turn) already instructs the model to "declare the calculated World Complexity Level" every Stage 1 opening turn — but #38 deliberately kept this prose-only inside `reply` (its own design decision 3), since #39 is explicitly the issue that turns it into real, persisted, actionable state.

## Decisions (confirmed during brainstorming, 2026-08-25)

1. **WCL confirmation uses an explicit UI control, not a chat-mediated confirmation.** PRD §4.3 requires canon-state transitions to be "explicit author actions (button/command), never inferred silently from conversational tone." WCL isn't part of the 4-state (Exploring/Working/Confirmed/Deferred) canon machinery, but the same principle applies to it, and the AC's explicit "shows a warning" language fits a real confirm dialog better than a chat-embedded warning that could be missed. This is genuinely new UI-control territory for this app (no project's interview screen has buttons today) — a deliberate, scoped first instance, not a broader UI pattern change.
2. **The model's proposal and the author's confirmed value are tracked as two separate fields**, not one. `proposedWorldComplexityLevel` updates from any turn where the model states a calculated level; `worldComplexityLevel` only changes via the explicit UI action. This keeps "the app is reflecting what the model said" cleanly separate from "the author decided."
3. **The warning on change is enforced client-side**, not server-side. The new PATCH endpoint just writes whatever level it's told, mirroring the existing `canvases/[canvasId]/route.ts` rename PATCH's shape (a plain REST mutation, no "are you sure" logic in the route itself) — the confirm dialog gating the call is the UI's job.
4. **Once a level is confirmed, later model re-proposals update stored state but never resurface the proposal banner.** The author is the final authority once they've decided, matching the posture already established for Project 2's priority matrix (issue #37's architecture note: "the user is the final authority").
5. **WCL_LABELS/WCL_LEVELS get their own small file** (`worldEngine/wcl.ts`), not folded into `worldTurnSchema.ts` — the turn-schema module imports `@anthropic-ai/sdk` (server-only), and `WorldInterview.tsx` needs the labels for its UI text without pulling that import into the client bundle.
6. **No GET-route change needed to read the confirmed/proposed state on resume** — `story.p3` is already present in the unstripped `story` object the canvases GET route returns (the same reuse `P2State` already relies on), so only the turn response and the new PATCH route are new surface area.

## Architecture

### `web/src/lib/worldEngine/wcl.ts` (new)

```ts
export const WCL_LEVELS = [1, 2, 3, 4] as const;
export type WclLevel = (typeof WCL_LEVELS)[number];

export const WCL_LABELS: Record<WclLevel, string> = {
  1: "Minimal",
  2: "Moderate",
  3: "Rich",
  4: "Extensive",
};
```

### `web/src/lib/worldEngine/worldTurnSchema.ts` (extended)

Adds `proposed_wcl: z.number().int().min(1).max(4).nullable()` to `WorldTurnSchema`, and the matching `proposed_wcl` property (JSON schema `type: ["number", "null"]`) to `EMIT_WORLD_TURN_TOOL`, added to `required`. Description tells the model: report the level it calculated this turn (per sp03 §2's Adaptive World Complexity framework), or `null` if it hasn't assessed one yet this turn.

### `web/src/lib/canonEngine/storyStore.ts` (extended)

```ts
export interface P3State {
  proposedWorldComplexityLevel: 1 | 2 | 3 | 4 | null;
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
}
```

Added to the `Story` interface as `p3?: P3State | null` (mirroring `p2?: P2State | null` exactly). `setP3State(storyId, p3: P3State): Promise<void>` mirrors `setP2State`'s shape (a whole-object replace via `stories/{storyId}` field update).

### `web/src/app/api/world-chat/route.ts` (extended)

After a turn's `delta` is extracted: if `delta.proposed_wcl` is non-null, read the story's current `p3` state (or default both fields to `null`), set `proposedWorldComplexityLevel` to the new value (leaving `worldComplexityLevel` untouched), and `setP3State`. Include `proposed_wcl: delta.proposed_wcl` in the turn's JSON response so the client can update its banner without a second fetch.

### `web/src/app/api/world-chat/wcl/route.ts` (new, `PATCH`)

Same auth pattern as every existing route (`requireUser` → `getStory` 404 → `getMembership` 403). Body: `{ storyId: string, level: 1|2|3|4 }`, validated with a 400 on an out-of-range value. Reads the current `p3` state (defaulting `proposedWorldComplexityLevel` to `null` if absent), sets `worldComplexityLevel` to the given level, calls `setP3State`, returns the updated `P3State`. No warning/confirmation logic here — that's the client's job (Decision 3).

### `web/src/components/WorldInterview.tsx` (extended)

New state: `wclState: P3State | null` (populated from `data.story?.p3` on resume, and from each turn's `proposed_wcl` field — merged into local state, never overwriting a still-relevant `worldComplexityLevel`). Two mutually exclusive UI regions in the header/right-panel area:

- **No confirmed level yet, but a proposal exists** (`worldComplexityLevel === null && proposedWorldComplexityLevel !== null`): a banner — "Proposed World Complexity Level: Level {n} ({label})" with a **Confirm** button (PATCHes that same level) and a **Pick a different level** control (a small inline set of the other 3 levels, or a `<select>`; PATCHes whichever is chosen). No warning dialog on this path — nothing's been set yet.
- **A confirmed level exists** (`worldComplexityLevel !== null`): a small persistent chip — "WCL: Level {n} ({label})" with a **Change** control. Selecting a *different* level triggers `window.confirm("Changing the World Complexity Level after it's set affects downstream depth budgets. Continue?")` before PATCHing; selecting the *same* level currently confirmed is a no-op (button disabled or filtered out of the choice list).

## Error Handling

The new PATCH route follows the exact same domain-error mapping as every other route (`errorResponse` for auth/membership/story-not-found). An out-of-range `level` is a 400 with a clear message, not a 500. If the PATCH call fails client-side, the existing `error` banner pattern in `WorldInterview.tsx` (already used for chat-turn failures) is reused — no new error UI surface invented.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A fresh session's first turn, once the model states a calculated level, shows the proposal banner with the correct label.
- Clicking Confirm PATCHes the proposed level and the banner is replaced by the persistent chip.
- Clicking Change on an already-confirmed level and selecting a different one triggers the `window.confirm` warning before PATCHing; canceling the dialog leaves the confirmed level unchanged.
- A resumed session where `story.p3.worldComplexityLevel` is already set shows the chip immediately, never the proposal banner, even if `proposedWorldComplexityLevel` differs (Decision 4).
- The PATCH route rejects `level: 0`, `level: 5`, and non-numeric values with a 400, not a crash.
