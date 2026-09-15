# P4 Causality Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #63 — every structural unit reaching `Confirmed` status must
report a genuinely causal transition ("Therefore"/"But"); a coincidence-driven ("And Then")
transition is blocked from reaching `Confirmed`, and the author sees why.

**Architecture:** Extends the exact pattern issue #111 already established twice (Core-Purpose
validation, the onboarding clamp): the live model makes the semantic judgment (is this
transition causal or coincidental?) via a new structured-output field pair, and a deterministic
app-side gate — independent of, and combined with, the existing Core-Purpose gate — decides
whether `Confirmed` is actually granted, never trusting the model's self-report alone once the
consequence is persisted canon.

**Tech Stack:** Next.js API route (`architecture-chat/route.ts`), Zod + Anthropic tool schema
(`architectureTurnSchema.ts`), plain TypeScript modules (`stateLedger.ts`, `developmentLoop.ts`),
a Markdown system prompt (`sp04-sae-systemprompt.md`), and a React client component
(`ArchitectureInterview.tsx`).

## Global Constraints

- No test suite exists in this project (`web/package.json` has no `test` script, confirmed
  during issue #111) — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and
  a direct code trace, not automated tests.
- `attemptStatusTransition` (`developmentLoop.ts`) is already reviewed and shipped (issues #62,
  #111) — do not change its signature or internal behavior. Causality is combined into the
  same `valid`/`reason` inputs the caller (`route.ts`) already builds for it, not injected into
  the function itself.
- `CausalTag` (`stateLedger.ts`) keeps its existing three values exactly:
  `"Therefore" | "But" | "UNVALIDATED"`. Never add a fourth value, and never persist the
  model's reported `"And Then"` value anywhere — a rejected report leaves the unit's stored
  `causalTag` exactly as it was before, same convention `attemptStatusTransition` already
  follows for a rejected status transition.
- The causal gate blocks `Confirmed` only, never `Working` — this is narrower than the
  Core-Purpose gate (which blocks both), per issue #63's own acceptance criteria wording. Do
  not widen it to also block `Working`.
- Step 1 (The Frame) is the only unit exempt from reporting a non-null `causal_tag`, and that
  exemption is verified against `active_step_number === 1` server-side, never trusted from the
  model's report alone — the same reasoning issue #111's onboarding clamp already established
  for a different gate.
- Every new/changed field in `architectureTurnSchema.ts` must exist identically in both the
  Zod schema and the `EMIT_ARCHITECTURE_TURN_TOOL` Anthropic tool schema (this file's own
  existing, explicitly documented convention) — check both whenever you touch one.
- Design spec: `docs/superpowers/specs/2026-09-15-p4-causality-validation-design.md`. Read it
  first if anything below is ambiguous — it explains the *why* behind each choice.

---

### Task 1: Causality Validation — schema, gate, prompt, route, UI

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`
- Modify: `web/src/lib/storyArchitectureEngine/stateLedger.ts`
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts`
- Modify: `web/system-prompts/sp04-sae-systemprompt.md`
- Modify: `web/src/app/api/architecture-chat/route.ts`
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Produces: `evaluateCausalGate(targetStatus: CanonStatus, reportedTag: "Therefore" | "But" | "And Then" | null, activeStepNumber: number | null, reason?: string): { ok: boolean; reason?: string }` (`developmentLoop.ts`) — a pure function, no side effects.
- Produces: `setCausalTag(unit: StructuralUnit, causalTag: CausalTag, now?: string): StructuralUnit` (`stateLedger.ts`) — a pure updater, same shape as the existing `setUnitStatus`/`setUnitContent`.
- Consumes: `attemptStatusTransition(unit, targetStatus, validation: { valid: boolean; reason?: string }, now?): StatusTransitionAttempt` (`developmentLoop.ts`, already exists, unchanged) — this task's only integration point into it is what `valid`/`reason` the route computes before calling it.
- Consumes: `ArchitectureTurnSchema`'s `proposed_unit.causal_tag`/`causal_tag_reason` (this task adds them) — every later reader of a turn's `delta.proposed_unit` sees these two new fields.

- [ ] **Step 1: Add `causal_tag`/`causal_tag_reason` to the turn schema**

  In `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`, add two fields to the
  `proposed_unit` object in `ArchitectureTurnSchema` (right after `proposed_position_percent`):

  ```ts
      proposed_position_percent: z.number().min(0).max(100).nullable(),
      causal_tag: z.enum(["Therefore", "But", "And Then"]).nullable(),
      causal_tag_reason: z.string(),
    })
    .nullable(),
  ```

  Add the matching properties to `EMIT_ARCHITECTURE_TURN_TOOL`'s `proposed_unit.properties`
  (right after `proposed_position_percent`), and add both new field names to that same
  object's `required` array (which currently reads
  `["unit_id", "type", "content", "requested_status", "canon_refs", "proposed_position_percent"]`):

  ```ts
          proposed_position_percent: {
            type: ["number", "null"],
            description: "Your best estimate of where in the screenplay (0-100) this unit falls, or null if not applicable.",
          },
          causal_tag: {
            type: ["string", "null"],
            enum: ["Therefore", "But", "And Then", null],
            description:
              "How this unit's content transitions from whatever precedes it: \"Therefore\" (a direct consequence) or \"But\" (a complication) for a genuinely causal link; \"And Then\" for a coincidence-driven, episodic transition you are flagging rather than proposing for Confirmed status. Null only for the screenplay's absolute opening unit (Step 1, The Frame), which has no causal predecessor - every other unit must report one of the three string values, never null.",
          },
          causal_tag_reason: {
            type: "string",
            description: "A specific, concrete explanation for causal_tag, either way.",
          },
        },
        required: ["unit_id", "type", "content", "requested_status", "canon_refs", "proposed_position_percent", "causal_tag", "causal_tag_reason"],
  ```

  Note the `properties`/`required` keys both belong to the `proposed_unit` object - don't
  confuse this `required` array with the top-level turn's own `required` array further down
  the file (that one lists `reply`, `context`, `routing_choice`, etc. and does NOT change in
  this task, since `proposed_unit` itself was already required/nullable at the top level).

- [ ] **Step 2: Add the pure causal gate to `developmentLoop.ts`**

  In `web/src/lib/storyArchitectureEngine/developmentLoop.ts`, add this new exported interface
  and function right after `attemptStatusTransition` (after its closing brace, before
  `export type RoutingChoice`):

  ```ts
  export interface CausalGateResult {
    ok: boolean;
    reason?: string;
  }

  /**
   * FR-6.3: gates Confirmed only - unlike attemptStatusTransition's
   * Core-Purpose gate (which blocks both Working and Confirmed), issue
   * #63's own acceptance criteria only says a unit "cannot reach
   * Confirmed status" while its causal tag is unvalidated/episodic.
   * Step 1 (The Frame) is the screenplay's one unit with no causal
   * predecessor - verified here against activeStepNumber rather than
   * trusted from the model's own report, the same reasoning issue #111's
   * onboarding clamp already established: a wrongly-accepted "no
   * predecessor" claim for any other step would let an episodic
   * transition reach Confirmed with zero causal justification.
   */
  export function evaluateCausalGate(
    targetStatus: CanonStatus,
    reportedTag: "Therefore" | "But" | "And Then" | null,
    activeStepNumber: number | null,
    reason?: string
  ): CausalGateResult {
    if (targetStatus !== "Confirmed") {
      return { ok: true };
    }
    if (reportedTag === "Therefore" || reportedTag === "But") {
      return { ok: true };
    }
    if (reportedTag === null && activeStepNumber === 1) {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        reason ??
        "This transition reads as coincidence-driven (\"And Then\") rather than causal - propose a Therefore/But alternative before confirming.",
    };
  }
  ```

  `CanonStatus` is already imported at the top of this file (used by `attemptStatusTransition`)
  - no new import needed for this step.

- [ ] **Step 3: Add `setCausalTag` to `stateLedger.ts` and update the header comment**

  In `web/src/lib/storyArchitectureEngine/stateLedger.ts`, add this new function right after
  `setUnitContent`:

  ```ts
  export function setCausalTag(unit: StructuralUnit, causalTag: CausalTag, now?: string): StructuralUnit {
    return { ...unit, causalTag, lastUpdated: nowOrDefault(now) };
  }
  ```

  Also update this file's header comment - it currently ends with:
  ```
   * call directly
   * in this file. Issue #111 persists the resulting `StructuralUnit[]` to
   * `Story.p4Units` via storyStore.ts's `setP4Units`; #69 covers anything
   * beyond that whole-array persistence. `causalTag` exists per §9's shape
   * but is never computed or validated here - that's issue #63 (Causality
   * Validation).
   */
  ```
  Replace the last two sentences (from `` `causalTag` exists `` through the end) with:
  ```
   * `causalTag` is computed and validated by issue #63 (Causality
   * Validation) - see developmentLoop.ts's `evaluateCausalGate` for the
   * gating logic; `setCausalTag` below only performs the update once a
   * turn's report has already passed that gate.
   */
  ```

- [ ] **Step 4: Add the Causality Validation clause to sp04**

  In `web/system-prompts/sp04-sae-systemprompt.md`, Section 6 (CANON & STRUCTURAL INTEGRITY
  MANAGEMENT) currently has two clauses: "Core-Purpose Validation:" and "Placement Guidance
  (advisory only):". Insert a new clause between them (after Core-Purpose Validation's
  paragraph, before Placement Guidance's):

  ```
  Causality Validation: Every unit you propose for Working or Confirmed status - except the screenplay's absolute opening unit, Step 1 (The Frame), which has no causal predecessor - must report how its content transitions from whatever precedes it: "Therefore" (a direct consequence of what came before) or "But" (a complication that redirects it). If the transition instead reads as coincidence-driven or episodic ("And Then" rather than "Therefore" or "But"), do not propose Confirmed status for it. Flag the pattern plainly in your reply, halt forward progress on that unit, and offer at least one causal alternative before continuing.
  ```

  In Section 8 (STRUCTURED OUTPUT CONTRACT), the long paragraph enumerating `proposed_unit`'s
  fields currently reads (in relevant part): `` ...and `proposed_position_percent` (your best
  estimate of where in the screenplay this unit falls, 0-100, or null if not applicable);
  `validation_result` (...) ``. Insert a new clause between `proposed_position_percent`'s
  parenthetical and `validation_result`:

  ```
  ; `causal_tag` ("Therefore" or "But" for a genuinely causal transition, "And Then" for a coincidence-driven one you are flagging rather than proposing for Confirmed status, or null only for the screenplay's absolute opening unit) and `causal_tag_reason` (a specific, concrete explanation either way)
  ```

  (i.e. the sentence should read `...or null if not applicable); causal_tag (...) and
  causal_tag_reason (...); validation_result (...)` - insert it as its own clause joined the
  same way the existing clauses already are, don't just paste a stray sentence.)

- [ ] **Step 5: Wire the combined gate and `setCausalTag` into the route**

  In `web/src/app/api/architecture-chat/route.ts`:

  Add `evaluateCausalGate` to the existing `developmentLoop` import (currently
  `attemptStatusTransition, checkPlacementDeviation, switchRoute, type StatusTransitionAttempt`)
  and `setCausalTag` to the existing `stateLedger` import (currently `createUnit, findUnit,
  upsertUnit, setUnitContent, addCanonRefs, type StructuralUnit`).

  Replace this block:
  ```ts
        const attempt = attemptStatusTransition(withContent, proposed.requested_status, {
          valid: delta.validation_result === "passed",
          reason: delta.validation_reason,
        });
        statusAttempt = attempt;

        units = upsertUnit(units, attempt.unit);
        await setP4Units(storyId, units);
        effectiveUnit = attempt.unit;
  ```
  with:
  ```ts
        const causalGate = evaluateCausalGate(
          proposed.requested_status,
          proposed.causal_tag,
          delta.active_step_number,
          proposed.causal_tag_reason
        );
        const coreValid = delta.validation_result === "passed";
        const combinedValid = coreValid && causalGate.ok;
        const combinedReason = !coreValid ? delta.validation_reason : causalGate.reason;

        const attempt = attemptStatusTransition(withContent, proposed.requested_status, {
          valid: combinedValid,
          reason: combinedReason,
        });
        statusAttempt = attempt;

        // Causal tag persists independent of the combined gate's outcome -
        // same "update regardless of status outcome" convention
        // setUnitContent/addCanonRefs above already follow, so a unit
        // sitting at Working still records its current best causal read.
        // "And Then" (or an invalid null) is never persisted - the unit's
        // stored tag is left exactly as it was, same as attemptStatusTransition's
        // own "reject returns the original unit unchanged" convention.
        let finalUnit = attempt.unit;
        if (proposed.causal_tag === "Therefore" || proposed.causal_tag === "But") {
          finalUnit = setCausalTag(finalUnit, proposed.causal_tag);
        }

        units = upsertUnit(units, finalUnit);
        await setP4Units(storyId, units);
        effectiveUnit = finalUnit;
  ```

  Then, in the response object near the bottom of the function, change only the
  `validationReason` line:
  ```ts
      validationReason: delta.validation_reason,
  ```
  to:
  ```ts
      // The combined gate's own reason (whichever check actually rejected
      // this turn's Confirmed attempt) - not always delta.validation_reason,
      // which only ever explains Core-Purpose specifically and would be
      // silently wrong when causality was the actual blocker instead.
      validationReason: statusAttempt?.reason ?? delta.validation_reason,
  ```
  Leave `validationResult` and `statusAccepted` exactly as they already are.

- [ ] **Step 6: Fix the UI's rejection-banner condition**

  In `web/src/components/ArchitectureInterview.tsx`, the existing rejection banner only fires
  when `validationResult === "failed"` - but `validationResult` reflects Core-Purpose
  specifically, and after this task a Confirmed attempt can now also be rejected by the causal
  gate while `validationResult` still says `"passed"`. Under the old condition that rejection
  would be silently invisible - exactly the defect class issue #111's final review flagged as
  finding I2. Replace:
  ```tsx
      {validationResult === "failed" && validationReason && (
        <div className="border-b border-red-500/30 bg-red-950/30 px-6 py-2 text-xs text-red-200">
          Validation failed{statusAccepted === false ? " — status change rejected" : ""}: {validationReason}
        </div>
      )}
  ```
  with:
  ```tsx
      {statusAccepted === false && validationReason && (
        <div className="border-b border-red-500/30 bg-red-950/30 px-6 py-2 text-xs text-red-200">
          Confirmation blocked: {validationReason}
        </div>
      )}
  ```
  This one condition now correctly covers a rejection from either gate - `statusAccepted` is
  already computed from the combined `valid` boolean Step 5 built, so no other state or prop
  needs to change.

- [ ] **Step 7: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace through by hand (or a short throwaway `tsx` script, your
  choice) at least these three scenarios against `evaluateCausalGate` directly:
  - `evaluateCausalGate("Confirmed", "Therefore", 4)` → `{ ok: true }`
  - `evaluateCausalGate("Confirmed", "And Then", 4)` → `{ ok: false, reason: <default message> }`
  - `evaluateCausalGate("Confirmed", null, 1)` → `{ ok: true }` (Step 1 exemption)
  - `evaluateCausalGate("Confirmed", null, 4)` → `{ ok: false, ... }` (null is NOT exempt outside Step 1)
  - `evaluateCausalGate("Working", "And Then", 4)` → `{ ok: true }` (Working is never gated)

- [ ] **Step 8: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts web/src/lib/storyArchitectureEngine/stateLedger.ts web/src/lib/storyArchitectureEngine/developmentLoop.ts web/system-prompts/sp04-sae-systemprompt.md web/src/app/api/architecture-chat/route.ts web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: implement P4 Causality Validation (issue #63)"
  ```
