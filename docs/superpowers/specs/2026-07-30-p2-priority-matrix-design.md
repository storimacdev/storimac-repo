# P2 Priority Matrix Classifier — Design Spec

**GitHub issue:** #25 (scoped — see Scope Decisions below)
**Status:** Approved for planning
**Date:** 2026-07-30

## Problem

Project 2 needs to classify every character in a Story's cast into a priority tier (Critical/Major/Supporting/Minor/Incidental) before any interview can begin — the tier drives how much interview depth each character gets. Issue #25 supplies the classification rule table (an engineering-defined heuristic, same pattern as Project 1's author-type classifier — the CDRM has no priority taxonomy of its own).

## Scope Decisions (decided during brainstorming, 2026-07-30)

1. **Major-tier role keywords use the system prompt's 4-role list** (Love Interest, Mentor, Primary Ally, Secondary Antagonist — from `project-docs/storimac-prompts/P2-Prompt2...md`), not the issue AC's narrower literal 3 keywords (deuteragonist/mentor/love-interest). The system prompt is what actually governs the live interview's behavior; a character it treats as Major should classify as Major.
2. **"Incidental" is not computed by this classifier.** It's defined as a character *not* in `principal_characters` at all — conversation-only, discovered during the live interview, never present in the Foundation Document this classifier reads. That's a runtime discovery concern for whatever handles new-name detection during interviews (#26 or #29), not a batch classification this module can perform. This classifier only ever assigns Critical/Major/Supporting/Minor to cast members that actually exist in the ingested data.
3. **"Surface once at session start" and "recompute only on explicit author edit" are session/UI orchestration, deferred to #27** (onboarding flow), matching #24's exact precedent: build the pure classification primitive now, wire it into a real session lifecycle when the first P2 route actually exists.

With these three decisions, #25 is exactly one thing: a pure function that classifies each already-ingested cast member into a tier with a traceable justification.

## Architecture

New file: `web/src/lib/characterEngine/priorityMatrix.ts` — a sibling to `ingestFoundation.ts` in the same P2-specific-glue directory (see that file's own header note on `characterEngine/`'s scope, which this file's header will repeat/reference). Consumes `IngestedFoundation` (#24's output) directly; produces nothing that touches Firestore, React, or any route.

## Data model

```ts
export type PriorityTier = "Critical" | "Major" | "Supporting" | "Minor";

export interface PriorityMatrixEntry {
  character: string;
  tier: PriorityTier;
  justification: string;
}

export function computePriorityMatrix(foundation: IngestedFoundation): PriorityMatrixEntry[]
```

One entry per member of `foundation.cast`, in the same order `cast` already provides. No entry for "Incidental" — per Scope Decision 2, this function's domain is exactly `foundation.cast`, and every element of that array gets classified into one of the four computed tiers.

## Rule chain

Evaluated per cast member, in order, first match wins (Minor is the uncontested fallback, never itself "matched"):

1. **Critical:** the character's name is found (case-insensitive, word-boundary matched — checking both the full name and just the first token, since Story Spine prose often refers to characters informally by first name) inside `foundation.dramaticEngine.protagonist` or `foundation.dramaticEngine.antagonistic_force`; **or** the name is found in ≥3 of the 7 `foundation.storySpine` beats.
2. **Major:** `story_role` case-insensitively contains one of the four system-prompt Major roles (Love Interest, Mentor, Primary Ally, Secondary Antagonist); **or** the name is found in 1–2 Story Spine beats.
3. **Supporting:** `primary_function` is non-empty (trimmed) and the name is found in zero Story Spine beats.
4. **Minor:** anything reaching here — empty `primary_function`, zero Spine presence, no recognized role.

**Name-matching helper:** a shared function checks name presence across all of the above (dramatic engine fields, all 7 spine beats) — written once, not duplicated per rule, since the same case-insensitive/word-boundary/first-name-fallback logic applies everywhere text is searched for a name.

## Justification strings

Each entry's `justification` names the specific rule and evidence that fired, not a generic tier description:
- Critical via dramatic engine: `"Matches dramatic_engine.protagonist"` (or `antagonistic_force`).
- Critical via spine: `"Appears in 3 of 7 Story Spine beats"` (exact count, not just "≥3").
- Major via role: `"story_role 'Mentor' matches a Major role"` (the actual matched role string, not a generic label).
- Major via spine: `"Appears in 1 of 7 Story Spine beats"` (exact count).
- Supporting: `"No Story Spine presence; functional role only"`.
- Minor: `"No Story Spine presence, recognized role, or functional description"`.

This directly satisfies the AC's "each classification includes a brief justification traceable to the source documents (which rule fired and why)" — the justification is generated at the exact point the rule fires, not reconstructed afterward.

## Error handling

None needed beyond what's already true of the input: `foundation` is always a well-formed `IngestedFoundation` by the time this function receives it (its own construction, in `ingestFoundation.ts`, already handles the malformed/missing-data cases via the `ok`/`incomplete`/`missing`/`error` result type). This function has no I/O and cannot itself fail — it's a total function over its input.

## Testing

Same convention as #24: no automated test framework exists in this repo — verification is `npm run lint && npm run build` plus a throwaway fixture script (written, run, then deleted, never committed) exercising each of the four rules plus the fallback with a constructed `IngestedFoundation`, since there's still no UI route to click through and no live Firestore access in this sandbox.
