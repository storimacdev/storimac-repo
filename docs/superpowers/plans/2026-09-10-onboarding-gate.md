# Onboarding Gate Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Onboarding Gate's app-computed data (issue #57)
— a pure function assembling the canon overview, per-step milestone
checklist, and routing-choice prompt a future P4 agent's first turn
needs, per PRD FR-3.1-3.3.

**Architecture:** One new file, `web/src/lib/storyArchitectureEngine/onboardingGate.ts`,
consuming issue #55's `ingestCanon` output (reusing its own
`structuralOverview` field rather than recomputing one) and issue #58's
`STRUCTURAL_STEPS`.

**Tech Stack:** TypeScript. No test runner configured — verification is
`npm run lint`, `npm run build`, and manual/code-trace verification.

## Global Constraints

- Reuse `IngestedCanon.structuralOverview` (issue #55) directly — never
  recompute a second canon summary.
- `addressable` on every milestone-checklist item is `canon.p1 !== null`
  — no finer per-step canon-requirement rule (none is specified anywhere
  in the source documents).
- `ROUTING_PROMPT` is a static exported constant describing all three
  routing options (A/B/C) verbatim per PRD FR-3.2 — it does not compute
  or depend on route-switching logic (that's issue #61's module).
- No Firestore read/write, no LLM call — pure, synchronous data.

---

### Task 1: Milestone checklist and onboarding output

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/onboardingGate.ts`

**Interfaces:**
- Consumes: `type IngestedCanon` from `./ingestCanon`; `STRUCTURAL_STEPS` from `./structuralFramework`.
- Produces: `export interface MilestoneChecklistItem { stepNumber: number; title: string; addressable: boolean; reason: string; }`; `export interface OnboardingOutput { structuralOverview: string; milestoneChecklist: MilestoneChecklistItem[]; routingPrompt: string; }`; `export const ROUTING_PROMPT: string`; `export function buildMilestoneChecklist(canon: IngestedCanon): MilestoneChecklistItem[]`; `export function buildOnboardingOutput(canon: IngestedCanon): OnboardingOutput`.

- [ ] **Step 1: Create the file**

```ts
import type { IngestedCanon } from "./ingestCanon";
import { STRUCTURAL_STEPS } from "./structuralFramework";

/**
 * The Onboarding Gate's app-computed data — GitHub issue #57, PRD §7.3
 * FR-3.1-3.3, Framework v3.0 §5. Supplies the structured data a future
 * live P4 agent's system prompt weaves into its actual first turn; does
 * not itself enforce "no prose before the gate completes" (a live
 * agent's system-prompt behavioral rule, not app-layer code) and does
 * not implement route-switching (issue #61's module).
 */

export interface MilestoneChecklistItem {
  stepNumber: number;
  title: string;
  addressable: boolean;
  reason: string;
}

export interface OnboardingOutput {
  structuralOverview: string;
  milestoneChecklist: MilestoneChecklistItem[];
  routingPrompt: string;
}

/**
 * "Addressable given canon" (FR-3.1c) is gated on Project 1 existing -
 * no source document defines a finer per-step canon-requirement rule,
 * so inventing one would be fabricating a requirement nobody specified.
 */
export function buildMilestoneChecklist(canon: IngestedCanon): MilestoneChecklistItem[] {
  const addressable = canon.p1 !== null;
  const reason = addressable
    ? "Story Foundation canon is available."
    : "Story Foundation has not been generated yet - no canon available for structural work.";
  return STRUCTURAL_STEPS.map((step) => ({
    stepNumber: step.stepNumber,
    title: step.title,
    addressable,
    reason,
  }));
}

export const ROUTING_PROMPT =
  "Option A — Blueprint Priority Route (recommended default): develop the story's four anchor points first (The Frame, The New Baseline, The Spark, The Illusory Peak/Midpoint), then the six Set Pieces in order.\n" +
  "Option B — Chronological Route: develop all 10 steps in strict sequential order, Step 1 through Step 10.\n" +
  "Option C — Custom Author Steering: name any Set Piece or Plot Point to develop next, in any order you choose.\n" +
  "Which would you like to use? You can switch at any time without penalty.";

export function buildOnboardingOutput(canon: IngestedCanon): OnboardingOutput {
  return {
    structuralOverview: canon.structuralOverview,
    milestoneChecklist: buildMilestoneChecklist(canon),
    routingPrompt: ROUTING_PROMPT,
  };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — trace these by hand:

- **`canon.p1` is `null`** (a fixture `IngestedCanon` with `p1: null`,
  `structuralOverview: "Project 1 (Story Foundation) is not yet
  complete. ..."`): confirm `buildMilestoneChecklist` returns exactly 10
  items (one per `STRUCTURAL_STEPS` entry), every `addressable: false`,
  every `reason` the "has not been generated yet" string.
- **`canon.p1` is populated** (a fixture with `p1` non-null): confirm
  all 10 items have `addressable: true` and the "canon is available"
  reason, regardless of what `canon.gaps` contains for P2/P3.
- **`buildOnboardingOutput`** on either fixture: confirm
  `structuralOverview` is exactly `canon.structuralOverview` (the same
  string reference/value, not re-derived), `milestoneChecklist` matches
  `buildMilestoneChecklist(canon)`, and `routingPrompt` is exactly
  `ROUTING_PROMPT` (mentions all three options, A/B/C, in order).
- **`STRUCTURAL_STEPS.length` is 10** (already established by issue
  #58): confirm `buildMilestoneChecklist(canon).length === 10` for both
  fixtures above — the checklist always covers every step, regardless of
  canon state.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/onboardingGate.ts
git commit -m "feat: add Onboarding Gate module (canon overview, milestone checklist, routing prompt)"
```
