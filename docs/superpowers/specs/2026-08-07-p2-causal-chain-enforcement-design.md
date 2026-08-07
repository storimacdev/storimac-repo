# P2 Causal Want/Need/Wound Chain Enforcement — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-07

## Problem

GitHub issue #28 (P2 M2). PRD §5.3 (corrected 2026-07-23) requires the Psychological Engine to causally chain a Critical/Major character's Life Experience through Behavioral Trajectory, and specifically: "a proposed Core Flaw or Fear that isn't traceable to a stated Wound/Belief is rejected."

Issue #28's field-set AC ("extract and hold all four as distinct, separately-confirmable fields: Want, Personality/How, Need, Values") is already fully satisfied — `factRegistry.ts`'s `CHARACTER_FIELD_IDS` (added under issue #29) already lists `want`, `personality_how`, `need`, `values` as four distinct fields, alongside the causal-chain fields. No work needed there.

The remaining gap is real: `CanonElement.depends_on` (added under issue #29, model-populated on confirmed facts) is currently only ever read in reverse — `canonStore.ts`'s `listDependents` powers Project 1's downstream-impact lookups — nothing validates a fact's `depends_on` forward, on write, against what it claims to depend on. A model could confirm a Core Flaw with no stated Wound or False Belief at all, or with a `depends_on` claim that doesn't correspond to anything actually `Confirmed`, and nothing in the app would catch it. sp02 §2/§5 already instructs the model to follow this causal order conversationally — this issue adds the app-side hard guarantee for when it doesn't.

## Decisions (confirmed during brainstorming, 2026-08-07)

1. **Enforcement scope is exactly what the AC names, not the full 7-field conceptual chain.** The Task description's prose ("chains Life Experience through Behavioral Trajectory") is the conceptual picture; the AC's actual testable requirement only calls out Core Flaw and Dominant Fear needing traceability to a Wound or Belief. Enforcing intermediate links (e.g. requiring `false_belief` to itself trace to `life_experience`) isn't stated anywhere as a rejection condition and would be inventing scope. `CHAIN_ENFORCED_FIELDS = ["core_flaw", "dominant_fear"]`, `CHAIN_ROOT_FIELDS = ["core_wound", "false_belief"]`.
2. **Failure mode is a silent downgrade, not a drop or a redirect.** A Confirmed proposal that fails the check is still persisted — as `"Working"` instead of `"Confirmed"` — so nothing the author said is lost, and it can still be revisited/re-confirmed once the real dependency lands. This differs from issue #26's hard-block-and-redirect pattern deliberately: #26 was interrupting a structural transition (which character is being interviewed) where a visible correction made sense; this is a narrower per-fact validation where the model is already instructed (sp02 §2/§5) to follow the right order, so the app's role is a safety net, not a primary enforcement surface the author needs to be interrupted over. Matches the existing unknown-field-logging posture (`character-chat/route.ts`'s `isKnownFieldId` check): log server-side, don't interrupt the turn.
3. **"Traceable" requires both a claim and a verified fact, not just the claim.** `depends_on` is model-populated free-form data (per issue #29's design, `depends_on` is captured but not yet validated). If the app only checked that `depends_on` *mentions* `core_wound`/`false_belief`, a model could claim the dependency without that upstream fact having actually reached `Confirmed` — defeating the guarantee. The check is two-stage: a cheap, I/O-free `claimsTraceability` filters the common case (no claim at all) before any Firestore read; only a genuine claim triggers `isTraceable`'s read to confirm the named root field is actually `Confirmed` in the store.
4. **Tier-scoping reuses the existing live-computed matrix, not a new persisted field.** `computePriorityMatrix(foundation)` is already computed every turn for the system-prompt cast injection, index-aligned with `foundation.cast`. Enforcement looks up the tier for the resolved `charId` from that same array (matching by slugified cast name) rather than persisting tier anywhere — consistent with issue #26's decision to keep tier live-derived, never stored in `P2State`.
5. **An unmatched/unknown tier skips enforcement rather than blocking.** If `charId` doesn't resolve to a cast member the matrix classified (the same rare fallback path `resolveCharId` already logs), the app can't confidently confirm Critical/Major, so it doesn't apply the stricter check — matches the codebase's existing posture of failing open on classification uncertainty (e.g. unknown `field` values are logged, not rejected).

## Architecture

### `web/src/lib/characterEngine/causalChain.ts` (new)

Mirrors `characterFsm.ts`'s split: pure constants/checks, plus the one necessary I/O call, all in a single small file scoped to this one concern.

```ts
export const CHAIN_ENFORCED_FIELDS = ["core_flaw", "dominant_fear"];
export const CHAIN_ROOT_FIELDS = ["core_wound", "false_belief"];
export const ENFORCED_TIERS = ["Critical", "Major"];

export function claimsTraceability(dependsOn: string[] | undefined): boolean {
  return (dependsOn ?? []).some((f) => CHAIN_ROOT_FIELDS.includes(f));
}

export async function isTraceable(
  storyId: string,
  charId: string,
  dependsOn: string[] | undefined
): Promise<boolean> {
  const claimedRoots = (dependsOn ?? []).filter((f) => CHAIN_ROOT_FIELDS.includes(f));
  for (const root of claimedRoots) {
    const element = await getElement(storyId, `${charId}.${root}`, CHARACTER_FACTS_COLLECTION);
    if (element?.status === "Confirmed") return true;
  }
  return false;
}
```

`isTraceable` checks every claimed root (a proposal might name both `core_wound` and `false_belief`) and returns true if *any* is actually Confirmed — matching the AC's "traceable to a stated Wound/Belief" (either one suffices, not both).

### `web/src/app/api/character-chat/route.ts` (extended)

After `charId` is resolved and before `toFactUpdate` mapping, look up the character's tier by matching `charId` against each cast member's own slugified name directly (not by re-calling `resolveCharId`, which is for resolving free-text model output and would just add an indirect, redundant re-derivation of the same comparison — a direct slug match is simpler and can't spuriously log):
```ts
const castIndex = foundation.cast.findIndex((m) => slugifyCharacterName(m.name) === charId);
const tier = castIndex >= 0 ? matrix[castIndex].tier : null;
```
(`matrix` is already computed earlier in the handler for the system-prompt injection — no new computation, just a new read of already-derived data.)

For each `u` in `delta.updates`, before mapping to `ElementUpdate`: if `tier` is in `ENFORCED_TIERS`, `CHAIN_ENFORCED_FIELDS.includes(u.field)`, and `u.state === "Confirmed"`, run the two-stage check. If it fails (`!claimsTraceability(u.depends_on)`, or it claims but `!(await isTraceable(...))`), replace that update's `state` with `"Working"` in a shallow copy (never mutate `delta.updates` itself) and log:
```
[character-chat] ${u.field} for ${charId} not traceable to a Confirmed Wound/Belief on turn ${turnId} - downgraded Confirmed->Working
```
Every other update in the same turn — including ones for other fields, or for this same character at a lower state — proceeds exactly as today, unaffected.

## Error Handling

No new failure modes. `isTraceable`'s `getElement` call can return `null` (no such fact exists yet) — treated the same as "not Confirmed," which is correct (nothing to trace to). No exceptions thrown by either function; a story/character with no prior facts at all simply always downgrades, which is the correct behavior for an author who tried to confirm a Core Flaw before ever discussing a Wound.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A Critical-tier character's `core_flaw` proposed `Confirmed` with `depends_on: []` (or omitted) downgrades to `Working` without any Firestore read (the cheap `claimsTraceability` filter short-circuits).
- The same proposal with `depends_on: ["core_wound"]`, where that character's `core_wound` fact is not yet `Confirmed` (or doesn't exist), downgrades to `Working`.
- The same proposal with `depends_on: ["core_wound"]`, where `core_wound` *is* `Confirmed`, stays `Confirmed`.
- A Supporting/Minor-tier character's `core_flaw` proposed `Confirmed` with no `depends_on` is left untouched (tier not enforced).
- A `personality_how`/`want`/any non-chain field proposed `Confirmed` is never touched by this check regardless of tier.
