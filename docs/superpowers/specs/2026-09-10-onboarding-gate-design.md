# Onboarding Gate Module (Issue #57) — Design

## Problem

PRD §7.3 FR-3.1-3.3 and Framework v3.0 §5 require a P4 session's first
substantive output to present, in order: a brief canon overview, a
milestone checklist of which of the 10 structural steps are addressable
given canon, and an explicit routing-choice prompt (Option A/B/C) — with
no prose/scene content produced before this gate completes.

Issue #57 explicitly supersedes the original PRD §7.3 numbering: the old
FR-3.1's clause (b), "state the diagnosed Complexity Level," is dropped
entirely (issue #56 replaces upfront Complexity Level diagnosis with a
silent, continuous Dynamic Scene Density & Pacing Monitor instead) — this
design's `OnboardingOutput` correctly has no Complexity Level field, and
this isn't an accidental omission.

## Scope boundary

Same reasoning as issues #55 and #58: this issue produces the
**app-computed structured data** a future live P4 agent's system prompt
would weave into its actual first turn — not the live turn itself. "No
prose/scene content before the gate completes" is a behavioral rule on
the live agent (enforced by its future system prompt, the same way
sp01-sp03 enforce their own behavioral rules), not something a pure data
function can enforce — this module supplies the data; wiring it into an
actual conversational turn is a follow-up integration issue (see the
"Out of scope" section).

Issue #61 (the actual multi-route switching logic — computing each
route's step ORDER, and switching mid-session) is a separate concern
from this issue's job, which is only to *present* the three routing
options as a first-turn choice. This module's routing text is therefore
static description only; #61's module owns the runtime step-ordering
logic.

## Decision: reuse `ingestCanon`'s own `structuralOverview`, don't recompute it

Issue #55's `ingestCanon(storyId)` already returns a `structuralOverview`
field built exactly for this purpose (FR-1.4: "used in the onboarding
message"). This module reuses that field directly rather than
re-deriving a second summary of the same canon.

## Decision: "addressable given canon" is gated on Project 1 existing, not a finer per-step rule

Neither the Framework doc, the PRD, nor any filed issue defines a
per-step canon-requirement mapping (e.g. "Step 5 needs at least one
signed-off P2 character") finer than "canon exists." Inventing such a
mapping would be fabricating a requirement no source document states.
This module's `addressable` flag is therefore `canon.p1 !== null` for
every one of the 10 steps — the same baseline gate `ingestCanon` itself
already applies before anything else is usable. If BA later supplies a
finer per-step canon-requirement rule, this is the function to extend.

## Architecture

New file: `web/src/lib/storyArchitectureEngine/onboardingGate.ts`.

### Types

```ts
import type { IngestedCanon } from "./ingestCanon";
import { STRUCTURAL_STEPS } from "./structuralFramework";

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
```

### Functions

```ts
export function buildMilestoneChecklist(canon: IngestedCanon): MilestoneChecklistItem[];
export function buildOnboardingOutput(canon: IngestedCanon): OnboardingOutput;
```

`buildMilestoneChecklist` maps every entry in `STRUCTURAL_STEPS` (#58)
to a checklist item, `addressable` per the decision above, with a
human-readable `reason` string for both the addressable and
not-yet-addressable cases.

`ROUTING_PROMPT` is a static, framework-grounded exported constant (not
a function — it never varies by input), describing all three options
per PRD FR-3.2 / Framework v3.0 §5, so the future live agent's first
turn can present them verbatim without re-deriving their wording:

```ts
export const ROUTING_PROMPT =
  "Option A — Blueprint Priority Route (recommended default): develop the story's four anchor points first (The Frame, The New Baseline, The Spark, The Illusory Peak/Midpoint), then the six Set Pieces in order.\n" +
  "Option B — Chronological Route: develop all 10 steps in strict sequential order, Step 1 through Step 10.\n" +
  "Option C — Custom Author Steering: name any Set Piece or Plot Point to develop next, in any order you choose.\n" +
  "Which would you like to use? You can switch at any time without penalty.";
```

`buildOnboardingOutput` composes the three pieces:

```ts
export function buildOnboardingOutput(canon: IngestedCanon): OnboardingOutput {
  return {
    structuralOverview: canon.structuralOverview,
    milestoneChecklist: buildMilestoneChecklist(canon),
    routingPrompt: ROUTING_PROMPT,
  };
}
```

## Edge cases

- **`canon.p1` is `null`** (Story Foundation not yet generated): every
  checklist item's `addressable` is `false`, with a `reason` stating the
  Foundation isn't ready yet — the future live agent's system prompt is
  expected to lead with that gap rather than presenting a routing choice
  that has nothing to route against yet (an integration-issue concern,
  not something this pure function decides).
- **`canon.p1` is populated but has P2/P3 gaps** (e.g. no signed-off
  characters yet): every step is still `addressable: true` per this
  module's baseline rule — those gaps surface separately via
  `canon.gaps` (already computed by `ingestCanon`), not duplicated here.

## Out of scope

- The live P4 chat route, system prompt, and the actual first-turn LLM
  call that presents this data conversationally — a follow-up
  integration issue, not part of this module.
- Route-switching logic and per-route step ordering — issue #61's
  module.
- Enforcing "no prose/scene content before the gate completes" — a live
  agent's system-prompt behavioral rule, not app-layer code.
