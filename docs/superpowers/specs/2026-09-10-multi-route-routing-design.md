# Multi-Route Routing Module (Issue #61) — Design

## Problem

PRD §7.3 FR-3.2(B,C) requires two additional routing options alongside
the existing Blueprint Priority route (issue #59): Option B
(Chronological — Steps 1-10 in strict sequential order) and Option C
(Custom Author Steering — no fixed order, the author names the next
step). The author must be able to switch between all three routes
mid-session without penalty or data loss.

## Decision: a route's "order" is `number[] | null`, not three separate types

Option A/B both have a genuine fixed step-number sequence (already true
of `BLUEPRINT_PRIORITY_ORDER`, issue #59); Option C has no fixed
sequence at all — by definition, the author picks arbitrarily. Modeling
this as `getRouteOrder(choice): number[] | null`, where `null` means
"no fixed order, see Custom Author Steering," lets one function serve
all three routes instead of three parallel, differently-shaped APIs.

## Decision: "no penalty or data loss" holds by construction, not by extra logic

`RoutingState` holds only `routingChoice` — no structural-unit data at
all. `switchRoute` therefore can't discard `units[]` (issue #62's state
ledger) even accidentally, because it never has access to it. This is
simpler and more trustworthy than writing code that explicitly
"preserves" unit data on a switch, since there's no code path capable of
losing it in the first place.

## Architecture

Modify the existing `web/src/lib/storyArchitectureEngine/developmentLoop.ts`
(issue #59), adding a `RoutingChoice` type, a `getRouteOrder` dispatcher
over all three routes, and `switchRoute`.

```ts
export type RoutingChoice = "A" | "B" | "C";

/**
 * Option A: BLUEPRINT_PRIORITY_ORDER (issue #59). Option B: Steps 1-10
 * strict sequential (PRD FR-3.2B). Option C: no fixed order - `null`
 * signals "the author names the next step," not an error.
 */
export function getRouteOrder(routingChoice: RoutingChoice): number[] | null {
  switch (routingChoice) {
    case "A":
      return BLUEPRINT_PRIORITY_ORDER;
    case "B":
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    case "C":
      return null;
  }
}

export interface RoutingState {
  routingChoice: RoutingChoice;
}

/**
 * Switching never touches unit/ledger data - `RoutingState` holds only
 * the choice itself, so "no penalty or data loss" (FR-3.3) holds by
 * construction, not by extra preservation logic.
 */
export function switchRoute(state: RoutingState, newChoice: RoutingChoice): RoutingState {
  return { routingChoice: newChoice };
}
```

## Edge cases

- **Switching to the SAME choice already active** (`switchRoute({routingChoice: "A"}, "A")`):
  still returns a new `{routingChoice: "A"}` object — a no-op in value,
  but not a special-cased branch; consistent with every other
  immutable-update function in this codebase (`stateLedger.ts`) always
  returning a fresh object.
- **`getRouteOrder("C")`**: returns `null`, never an empty array — `null`
  specifically signals "ask the author," while `[]` would incorrectly
  suggest "zero steps to develop."

## Out of scope

- The actual "author names the next step" interaction for Option C —
  that's the future live agent's conversational turn, not this module.
- Any UI or route-selection prompt text — already covered by issue #57's
  `onboardingGate.ts` (`ROUTING_PROMPT`), which this issue doesn't
  modify.
- Causality validation, canon revision, thematic anchor audit — issues
  #63/#64/#65.
