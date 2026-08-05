# jumpToStage stage7Audit Warning — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-05

## Problem

The stage-drift-catchup branch's final review (already merged) flagged a latent, currently-unreachable hazard: `jumpToStage()` in `web/src/lib/canonEngine/stageFsm.ts` has zero call sites anywhere in the codebase — it's dead code, exported but unused, presumably reserved for a future "revisit an earlier stage" feature. Its existing docstring already notes it only moves the `currentStage` pointer and does not touch `story.stage7Audit`. If a future caller ever wires this up to let an author rewind past Stage 7 without also clearing `stage7Audit`, a story could end up with `currentStage < 7` while `stage7Audit.authorResponded` stays stale-`true`. The stage-gate catch-up loop in `web/src/app/api/chat/route.ts` derives `blockedByStage7` from that flag — a stale `true` would let one later turn cross into and past Stage 7 in a single shot, skipping the human-in-the-loop pause Stage 7 exists to enforce.

Not reachable today (zero call sites) — there's no live bug. This is a documentation fix: leave a clear warning at the exact spot a future implementer will read, so they see the requirement before shipping it rather than rediscovering it live.

## Decision

Extend `jumpToStage()`'s existing docstring with an explicit caller-responsibility note. No behavior change, no new code path, no call sites added.

## Change to `web/src/lib/canonEngine/stageFsm.ts`

Current docstring:
```
/**
 * Non-linear revision: jump the stage pointer to any valid stage without
 * re-running gate checks. Gating (checkStageGate/advanceStage) only
 * protects *forward* advancement; revisiting an earlier stage to reopen a
 * discussion doesn't need its entry criteria re-validated. Actually
 * changing a Confirmed element once there is canonStore's job (throws
 * CanonConflictError without allowConfirmedOverride) - this function only
 * moves the pointer.
 */
export function jumpToStage(targetStage: number): number {
```

New docstring (adds one paragraph, everything else unchanged):
```
/**
 * Non-linear revision: jump the stage pointer to any valid stage without
 * re-running gate checks. Gating (checkStageGate/advanceStage) only
 * protects *forward* advancement; revisiting an earlier stage to reopen a
 * discussion doesn't need its entry criteria re-validated. Actually
 * changing a Confirmed element once there is canonStore's job (throws
 * CanonConflictError without allowConfirmedOverride) - this function only
 * moves the pointer.
 *
 * Caller responsibility if this is ever wired up: also clear
 * story.stage7Audit (set to null) whenever targetStage <= 7. The
 * stage-gate catch-up loop in chat/route.ts derives blockedByStage7 from
 * story.stage7Audit?.authorResponded - a stale authorResponded:true left
 * over from before the jump would let a single later turn cross into AND
 * past Stage 7 in one shot, skipping the human-in-the-loop pause that
 * stage exists to enforce.
 */
export function jumpToStage(targetStage: number): number {
```

## Error Handling

None needed — this is a comment-only change with no runtime effect.

## Testing

`npm run lint && npm run build` (this project's standard verification for any change touching `web/`, even comment-only ones). No behavior to test since `jumpToStage` is uncalled.
