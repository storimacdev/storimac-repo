# P4 Causality Validation — Design Spec

GitHub issue: #63 ("[P4] Implement Causality Validation (Therefore/But vs And Then)")
PRD refs: §7.6 FR-6.3, §11 test case 3.

## Problem

Every `StructuralUnit` already carries a `causalTag: "Therefore" | "But" | "UNVALIDATED"`
field (`stateLedger.ts`), but nothing computes or validates it — the field's own header
comment defers this explicitly to issue #63. The Framework requires every transition into a
confirmed scene/sequence to be causal ("Therefore" — a direct consequence — or "But" — a
complication) rather than episodic ("And Then" — a coincidence-driven, non-consequential
beat). A unit whose transition is episodic must be auto-flagged, and the conversation must
halt and offer causal alternatives before that unit can be marked `Confirmed`.

This is the same shape of problem issue #111 already solved twice: a semantic judgment
("does this scene's transition read as causal or coincidental?") that only the live model can
honestly make, paired with a deterministic app-side gate that doesn't trust the model's
self-report alone once the consequence is persisted, binding canon.

## Design

### 1. Schema: report the tag every time a unit is proposed

Add two fields to `proposed_unit` in `architectureTurnSchema.ts` (both the Zod schema and the
`EMIT_ARCHITECTURE_TURN_TOOL` tool schema, kept in sync per this file's existing convention):

- `causal_tag: z.enum(["Therefore", "But", "And Then"]).nullable()` — the model's assessment
  of how this unit's content transitions from whatever precedes it in the story. Null is
  reserved for the screenplay's absolute opening unit (Step 1, The Frame), which has no causal
  predecessor by the Framework's own definition — every other unit must report one of the
  three enum values, never null.
- `causal_tag_reason: z.string()` — a concrete explanation either way, mirroring
  `validation_reason`'s existing convention (always present, not just on rejection) so the
  author can see the model's causal reasoning even when the tag is accepted.

sp04 (Section 8, Structured Output Contract) gets a matching clause in its `proposed_unit`
field enumeration, and Section 6 (Canon & Structural Integrity Management) gets a new
Causality Validation clause, parallel to the existing Core-Purpose Validation and Placement
Guidance clauses: explain Therefore/But/And Then, instruct the model to halt and offer at
least one causal alternative in `reply` whenever it detects an "And Then" pattern (matching
PRD §11 test case 3 — "author proposes a scene resolved by coincidence → agent flags the
pattern, halts, offers causal alternatives"), and state the Step 1 null exemption explicitly.

### 2. The app-side gate: only Confirmed is blocked, and Step 1's exemption is verified, not trusted

New pure function in `developmentLoop.ts`:

```ts
export interface CausalGateResult {
  ok: boolean;
  reason?: string;
}

/**
 * FR-6.3: gates Confirmed only - AC3 states a unit "cannot reach Confirmed
 * status" while its causal tag is unvalidated/episodic; Working carries no
 * such restriction, unlike attemptStatusTransition's Core-Purpose gate
 * (which blocks both Working and Confirmed). Step 1 (The Frame) is the
 * screenplay's one unit with no causal predecessor - verified here against
 * activeStepNumber rather than trusted from the model's own report, the
 * same reasoning as issue #111's onboarding clamp: a wrongly-accepted
 * "no predecessor" claim for any other step would let an episodic
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

`stateLedger.ts` gets one new pure updater, mirroring `setUnitStatus`/`setUnitContent`:

```ts
export function setCausalTag(unit: StructuralUnit, causalTag: CausalTag, now?: string): StructuralUnit {
  return { ...unit, causalTag, lastUpdated: nowOrDefault(now) };
}
```

No change to `CausalTag`'s existing three values (`"Therefore" | "But" | "UNVALIDATED"`) —
`"And Then"` is never persisted; a rejected report leaves the unit's stored tag exactly as it
was before (same "reject returns the original unit unchanged" convention
`attemptStatusTransition` already follows). No new `"NotApplicable"` value either: Step 1's
exemption is a one-time gate-passing condition, not a tag that needs to be stored and
displayed as if it were a causal relationship — Step 1's unit simply keeps whatever
`causalTag` it already has (starting at `"UNVALIDATED"` from `createUnit`, same as any other
brand-new unit) until/unless a later revision genuinely gives it one.

### 3. Wiring into the route — zero changes to `attemptStatusTransition`

`attemptStatusTransition` already takes a single `ContentValidationResult { valid, reason }`
for its Core-Purpose gate, and that function is already reviewed and shipped (issues #62,
#111). Rather than touch its signature, `architecture-chat/route.ts` computes both judgments
independently and ANDs them into the same `valid` boolean it already builds:

```ts
const coreValid = delta.validation_result === "passed";
const causalGate = evaluateCausalGate(
  proposed.requested_status,
  proposed.causal_tag,
  delta.active_step_number,
  proposed.causal_tag_reason
);
const combinedValid = coreValid && causalGate.ok;
const combinedReason = !coreValid ? delta.validation_reason : causalGate.reason;

const attempt = attemptStatusTransition(withContent, proposed.requested_status, {
  valid: combinedValid,
  reason: combinedReason,
});
```

Independent of that combined gate, whenever `proposed.causal_tag` is `"Therefore"` or
`"But"`, the route calls `setCausalTag(unit, proposed.causal_tag)` unconditionally — same
"update regardless of status outcome" convention `setUnitContent`/`addCanonRefs` already
follow, so a unit sitting at `Working` still records its current best causal read, ready to
be Confirmed later once the author accepts it. When the reported tag is `"And Then"` (or an
invalid null), the unit's stored `causalTag` is left untouched.

### 4. Surfacing the result — not repeating #111's finding I2

#111's final review found that computing a validation result and never returning or rendering
it is a real, recurring defect class (finding I2: a wrong "passed" that persists bad canon was
invisible). This plan surfaces the causal-gate outcome from the start:

- `route.ts`'s response gains `causalTag: attempt.unit.causalTag` (the unit's current stored
  tag, post-turn) and reuses the existing `statusAccepted`/`validationReason`-style fields —
  when `combinedReason` came from the causal gate rather than Core-Purpose, the author sees
  exactly why the Confirmed attempt was rejected, same banner `ArchitectureInterview.tsx`
  already renders for a Core-Purpose rejection (added in #111's fix round 2 for finding I2).
  No new UI element needed — this reuses that existing rejection banner, since from the
  author's point of view "rejected, here's why" reads the same regardless of which of the two
  independent checks caused it.

### 5. What's out of scope

- **Ordering/position tracking.** Determining the model's own sense of "what precedes this
  unit" is left entirely to the model's narrative understanding of the conversation and canon
  — the app does not attempt to compute scene order or a "previous unit" pointer. Adding a
  persisted per-unit story-position (needed for a future compiler to order scenes correctly)
  is issue #70/#71 territory, not this one; #63's job is tagging and gating a transition the
  model itself identifies, not determining which two units are adjacent.
- **Live-model verification of the halt-and-offer-alternatives behavior** (PRD §11 test case
  3). Like #111's finding I3, this is a conversational behavior only a real model call can
  verify. Tracked as a follow-up issue after this ships, matching #111's own #143.

## Files touched

- Modify: `web/src/lib/storyArchitectureEngine/stateLedger.ts` (add `setCausalTag`)
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts` (add `evaluateCausalGate`)
- Modify: `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts` (add
  `causal_tag`/`causal_tag_reason` to `proposed_unit`, both Zod schema and tool schema)
- Modify: `web/system-prompts/sp04-sae-systemprompt.md` (Section 6 + Section 8)
- Modify: `web/src/app/api/architecture-chat/route.ts` (combined gate + `setCausalTag` call +
  response fields)
- Modify: `web/src/components/ArchitectureInterview.tsx` (extend the existing rejection-reason
  rendering to cover the causal gate's reason)

## Testing

No test suite exists in this project (confirmed during #111 — `web/package.json` has no
`test` script). Verification is: `tsc --noEmit`, `npm run lint`, `npm run build`, and a direct
code trace by the task reviewer (same standard #111's tasks were held to) confirming the
combined-gate boolean logic and the Step 1 backstop are wired correctly end-to-end.
