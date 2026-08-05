# jumpToStage stage7Audit Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `jumpToStage()`'s docstring in `web/src/lib/canonEngine/stageFsm.ts` with an explicit warning about a `story.stage7Audit` invariant a future caller must maintain, so the requirement is visible before this currently-unused function is ever wired up.

**Architecture:** Single-file, comment-only change. No behavior change, no new code path.

**Tech Stack:** TypeScript.

## Global Constraints

- Comment-only change — no behavior, signature, or logic change to `jumpToStage` or any other function.
- Replacement text must be used verbatim — this is a transcription task, not a paraphrase task.

---

### Task 1: Extend jumpToStage's docstring

**Files:**
- Modify: `web/src/lib/canonEngine/stageFsm.ts:99-107` (the docstring immediately above `export function jumpToStage`)

**Interfaces:**
- None — comment-only change, no signature or exported-symbol change.

- [ ] **Step 1: Add the warning paragraph**

Find this exact text (the docstring immediately above `export function jumpToStage(targetStage: number): number {`):
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
```
If this doesn't match exactly what's in the file, stop and report the discrepancy rather than guessing which version is current.

Replace with:
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
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (comment-only change, but this project's convention runs both after every change touching `web/`).

- [ ] **Step 3: Verify no other reference needs updating**

Run: `grep -rn "jumpToStage" web/src` (or equivalent search). Expected: exactly one match, the function definition itself in `stageFsm.ts` — confirming this function still has zero call sites and no other file needs a matching update.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/canonEngine/stageFsm.ts
git commit -m "docs: warn jumpToStage callers to clear stage7Audit on stage-revisit"
```
