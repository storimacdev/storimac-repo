# Multi-Route Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chronological (Option B) and Custom Author Steering
(Option C) routing alongside the existing Blueprint Priority route
(issue #61), plus route-switching, per PRD FR-3.2(B,C)/FR-3.3.

**Architecture:** Extend the existing `web/src/lib/storyArchitectureEngine/developmentLoop.ts`
(issue #59) with a `RoutingChoice` type, a `getRouteOrder` dispatcher
covering all three routes, and a `switchRoute` function whose state
shape holds only the routing choice — never touching `StructuralUnit`
data, so "no penalty or data loss" on switch holds by construction.

**Tech Stack:** TypeScript. No test runner configured — verification is
`npm run lint`, `npm run build`, and manual/code-trace verification.

## Global Constraints

- `getRouteOrder("C")` returns `null` (not `[]`) — `null` means "no
  fixed order, the author steers," which is a different thing from
  "zero steps."
- `RoutingState` holds only `routingChoice` — no unit/ledger data of any
  kind, so `switchRoute` cannot lose data by construction.
- No UI/prompt text changes — issue #57's `onboardingGate.ts` already
  owns the routing-choice prompt text; this plan doesn't touch it.
- No Firestore read/write, no LLM call.

---

### Task 1: `RoutingChoice`, `getRouteOrder`, and `switchRoute`

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts`

**Interfaces:**
- Consumes: `BLUEPRINT_PRIORITY_ORDER` (already in this file, issue #59).
- Produces: `export type RoutingChoice = "A" | "B" | "C";`; `export function getRouteOrder(routingChoice: RoutingChoice): number[] | null`; `export interface RoutingState { routingChoice: RoutingChoice; }`; `export function switchRoute(state: RoutingState, newChoice: RoutingChoice): RoutingState`.

- [ ] **Step 1: Add the routing type, dispatcher, and switch function**

Add at the end of the file, after `attemptStatusTransition`:

```ts
export type RoutingChoice = "A" | "B" | "C";

/**
 * Option A: `BLUEPRINT_PRIORITY_ORDER` (issue #59). Option B: Steps 1-10
 * strict sequential (PRD FR-3.2B). Option C: no fixed order - `null`
 * signals "the author names the next step," not an error or an empty
 * route.
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
 * FR-3.3: switching carries no penalty or data loss. Holds by
 * construction, not by extra preservation logic - `RoutingState` holds
 * only the choice itself, never `StructuralUnit`/ledger data, so there
 * is nothing for this function to lose.
 */
export function switchRoute(state: RoutingState, newChoice: RoutingChoice): RoutingState {
  return { routingChoice: newChoice };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — trace these by hand:

- **`getRouteOrder("A")`** → exactly `BLUEPRINT_PRIORITY_ORDER`
  (`[1, 10, 3, 6, 2, 4, 5, 7, 8, 9]`, from issue #59's existing constant
  — same array reference, not a re-derived copy).
- **`getRouteOrder("B")`** → `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]`.
- **`getRouteOrder("C")`** → `null` (not `[]`, not `undefined`).
- **`switchRoute({ routingChoice: "A" }, "C")`** → `{ routingChoice: "C" }`
  — confirm the ORIGINAL input `state` object is unchanged (still reads
  `{ routingChoice: "A" }` after the call).
- **`switchRoute({ routingChoice: "B" }, "B")`** (switching to the same
  choice already active) → `{ routingChoice: "B" }` — a new object, not
  a special-cased early return of the same reference.
- **Confirm `RoutingState` never appears anywhere near a `StructuralUnit`
  or `units[]` reference in the file** — a plain read of the added code
  confirms `switchRoute`'s signature and body touch nothing but
  `routingChoice`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/developmentLoop.ts
git commit -m "feat: add Chronological and Custom routing options plus route-switching"
```
