# P4 Scene Register Format Enforcement — Design Spec

GitHub issue: #66 ("[P4] Enforce Scene Register format: slugline + Critical Beat earmark + 3-4 dense sentences")
PRD refs: Screenplay Structural Architecture Framework v3.0 §3, P4 Prompt v3.0 §4 (superseding
the original PRD §7.4 FR-4.3, §11 test case 7).

## Problem

sp04 Section 5 already instructs the model to specify every scene as a standard slugline,
followed by exactly one dense 3-4 sentence paragraph, with a `[CRITICAL BEAT: <NAME>]` tag
when the scene fulfills one of the 10 Critical Beats — but nothing app-side ever checks this.
A malformed submission (missing slugline, a 2-sentence paragraph, a fabricated beat tag) is
silently accepted exactly like #63/#111's Core-Purpose and Causality checks were before their
own app-side backstops existed.

## Design

### 1. What the app can deterministically check, and what stays the model's job

Mirrors the exact split Core-Purpose/Causality validation already established: the app owns
the deterministic *consequence*, the model owns the semantic judgment it's already instructed
to make.

**Deterministically checkable, parsed directly from the existing `content` string — no new
schema field needed:**
- A slugline is present, matching the shape `SCENE <label>: INT./EXT. ...` (case-insensitive,
  tolerant of `INT./EXT.` combined).
- If a `[CRITICAL BEAT: <NAME>]` tag is present anywhere in the content, `<NAME>` matches one
  of the 10 real tags in `structuralFramework.ts`'s existing `CRITICAL_BEAT_LOOKUP` — this
  module was already built with exactly this kind of lookup in mind (its own header comment:
  "the 10 tags exposed as a lookup").
- The explanatory paragraph (the content after the slugline line and any beat-tag line) is
  exactly 3-4 sentences, counted via a standard regex sentence-splitter (an approximation —
  same disclosed-limitation class as `checkPlacementDeviation`'s own percent-parsing).

**Deliberately NOT enforced app-side (left to the model, already instructed in sp04 §5):**
- *Whether* a scene should carry a beat tag at all. The app has no way to know "this scene is
  supposed to fulfill Step 6's Midpoint" without either trusting the model's self-report (which
  defeats the point of an app-side check) or inferring it from `active_step_number` in a way
  that would be fragile and easy to get wrong for a step with zero or multiple candidate
  scenes. The app only validates a tag's *value* when one is present, never requires one.
- Whether the paragraph's 3-4 sentences genuinely cover the three required beats (setup/
  dramatic question, objective vs. opposition, turning point) — that's the same class of
  semantic judgment Core-Purpose validation already owns, not something a sentence-counter can
  verify.

### 2. New pure function, same shape as `checkPlacementDeviation`/`evaluateCausalGate`

```ts
export interface SceneFormatCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkSceneRegisterFormat(content: string): SceneFormatCheckResult
```

Lives in `developmentLoop.ts`, alongside the other deterministic checks it already owns for
this same turn-processing pipeline.

### 3. Gating scope: Working AND Confirmed, not Confirmed-only

Unlike Causality (which only blocks `Confirmed`, since a unit can legitimately sit at `Working`
with an unresolved causal read), format is a baseline bar — a `Working` (provisional) entry
should already look like a real, formatted scene, not a rough sketch. This matches Core-Purpose
validation's own scope (`STATUSES_REQUIRING_VALIDATION = ["Working", "Confirmed"]`), not
Causality's narrower one.

### 4. Integration: one more AND into the same combined boolean

`architecture-chat/route.ts` already builds `combinedValid`/`combinedReason` by ANDing
Core-Purpose validation and the causal gate before calling the unchanged
`attemptStatusTransition`. This adds a third AND term:

```ts
const formatCheck = checkSceneRegisterFormat(proposed.content);
const combinedValid = coreValid && causalGate.ok && formatCheck.ok;
const combinedReason = !coreValid ? delta.validation_reason : !causalGate.ok ? causalGate.reason : formatCheck.reason;
```

`attemptStatusTransition` itself stays completely unchanged, same as #63's and #64's own
integration — this issue adds a third independent check to the same pattern, not a new
mechanism.

## What's out of scope

- Live-model verification of the 2-sentence rejection test case (PRD test case 7) — matches
  #111/#63/#64's own precedent, tracked as a follow-up.
- Any change to how the model is instructed (sp04 §5 already states the exact required format
  correctly) — this issue is purely about adding the missing app-side backstop.

## Files touched

- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts` (add
  `checkSceneRegisterFormat`)
- Modify: `web/src/app/api/architecture-chat/route.ts` (fold into the combined gate)

## Testing

No test suite exists in this project. Verification is `tsc --noEmit`, `npm run lint`,
`npm run build`, and a direct code trace against representative inputs (a well-formed 3- and
4-sentence entry, a 2-sentence entry, a missing slugline, a fabricated beat tag, a real beat
tag), matching #63's and #64's own standard.
