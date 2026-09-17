# P4 Thematic Anchor Audit — Design Spec

GitHub issue: #65 ("[P4] Implement Thematic Anchor Audit")
PRD ref: §7.6 FR-6.5 — "Thematic Anchor Audit: before compilation, verify Steps 2, 5, 6, 7, 8, 9
form an unbroken internal-transformation arc; if a gap exists, surface it explicitly rather than
silently compiling."

## Problem

`compileScreenplayArchitectureDocument` (issue #60) compiles whatever is Confirmed, with no
check at all for whether the 6 steps carrying the protagonist's internal-transformation arc
(Step 2's Thematic Core, Step 5's B Story Intro, Step 6's Midpoint, Step 7's All Is Lost, Step
8's Break Into 3, Step 9's Dig Deep Down) actually have content, let alone whether that content
reads as a coherent arc. An author could compile a screenplay missing its emotional through-line
entirely and never be told.

## Design

### 1. Precedent: mirrors Project 3's Stage 4 System Integration Audit exactly

`worldEngine/stage4Audit.ts` (issue #49) already established the shape this needs: mix
deterministic checks with one model-driven semantic judgment, both returned as a
`findings[]` array with a `pass`/`flag` status per finding. This audit reuses that *pattern*,
not that file's code (P4 has its own data model).

### 2. What the app can deterministically check, and what stays the model's job

**Deterministically checkable — no model call needed:** whether each of Steps 2, 5, 6, 7, 8, 9
has at least one `Confirmed` unit tagged with that `stepNumber` (issue #56's field, now reused
for a second purpose). A step with zero Confirmed content obviously has no internal-
transformation beat to contribute — this is caught for free, cheaply, before spending a model
call on anything.

**Model's job — semantic judgment, only run once coverage is complete:** given the Confirmed
content that exists at all 6 anchor steps, does it read as a genuinely unbroken internal-
transformation arc (the protagonist's Want/Need progression), or are there thematic gaps even
though structural content technically exists? This is the same class of judgment Core-Purpose
validation and Stage 4's consistency check already own — a deterministic function can't honestly
make it (same reasoning `developmentLoop.ts`'s own header comment already gives for Core-Purpose).
**Only runs when coverage is complete** (all 6 steps have Confirmed content) — if any step is
missing entirely, that's already a known gap; asking the model to also judge a still-incomplete
arc wastes a call and can't add information the coverage check hasn't already given.

### 3. New module: `thematicAnchorAudit.ts`

New file `web/src/lib/storyArchitectureEngine/thematicAnchorAudit.ts`, mirroring
`stage4Audit.ts`'s shape:

```ts
export const THEMATIC_ANCHOR_STEPS = [2, 5, 6, 7, 8, 9] as const;

export interface ThematicAnchorFinding {
  id: string;
  status: "pass" | "flag";
  detail: string;
}

export function checkThematicAnchorCoverage(units: StructuralUnit[]): ThematicAnchorFinding[]

export async function runThematicAnchorConsistencyCheck(
  anthropic: Anthropic,
  unitsByStep: Map<number, StructuralUnit[]>
): Promise<ThematicAnchorFinding[]>

export interface ThematicAnchorAuditResult {
  findings: ThematicAnchorFinding[];
  gapFound: boolean;
  generatedAt: string;
}

export async function runThematicAnchorAudit(
  anthropic: Anthropic,
  units: StructuralUnit[]
): Promise<ThematicAnchorAuditResult>

export function formatThematicAnchorAuditSummary(audit: ThematicAnchorAuditResult): string
```

`runThematicAnchorAudit` is the orchestrator: runs `checkThematicAnchorCoverage` first; if it
returns any `"flag"`, returns immediately (`gapFound: true`, no model call). Only when coverage
is fully clean does it call `runThematicAnchorConsistencyCheck` with each anchor step's Confirmed
content (grouped, in step order, with each step's `title`/`corePurpose` from
`STRUCTURAL_STEPS` for context) via one `extractTurn` one-shot call (a single tool-call
extraction, not a conversational turn — exactly `stage4Audit.ts`'s `runConsistencyCheck` shape).

### 4. Not persisted — computed fresh per compile attempt

Unlike P3's `Stage4Audit` (which gates an ongoing multi-turn conversational stage and must
survive across turns/reloads), this audit is triggered synchronously by a single button click
("Compile") and resolved within that same interaction. No new `Story` field, no Firestore write.
The deterministic half is free; the model half costs one Anthropic call only when an author
actually attempts to compile — an infrequent, deliberate action, not a per-turn cost.

### 5. Gating: mirrors the Dependency Review's confirm-then-retry pattern, not Stage 4's chat-approval pattern

P3's Stage 4 audit gates a conversational stage transition, so it needs the author's explicit
approval to arrive via a chat turn. P4's compile has no equivalent conversational surface — it's
a direct button click — so this instead mirrors `world-chat/canon-status/route.ts`'s existing
synchronous confirm-then-retry shape (issue #48):

`POST /api/architecture-chat/document` gains an optional `acknowledged: boolean` body field.
- If the audit finds a gap and the caller hasn't acknowledged: return `409` with
  `{ needsAcknowledgment: true, thematicAnchorAudit }` — no document is compiled.
- If the audit passes clean, OR `acknowledged: true` was passed: compile as before, and include
  `thematicAnchorAudit` in the `200` response too (so the UI can show "audit passed" even on the
  success path, satisfying the issue's "shown before the author can proceed" for the clean case
  as well, not just the gap case).

This is a genuine disclosure-not-prevention gate, matching the issue's own wording ("surface it
explicitly... rather than silently compiling around it") — the author can always compile anyway
once shown the gap, exactly like the Dependency Review's own precedent.

### 6. UI: `ArchitectureInterview.tsx`'s existing Compile flow

`compileDocument()` currently does one `fetch` and sets `compiled`/`compileError`. Extend it:
first call omits `acknowledged`; on a `409` with `needsAcknowledgment`, show the audit findings
in a new banner with a "Compile anyway" button that re-calls with `acknowledged: true`; on `200`,
show the audit result (pass, or "overridden with N gap(s)") alongside the existing download
button.

## What's out of scope

- Persisting the audit or its history (no new `Story` field) — see §4.
- Any change to `sp04-sae-systemprompt.md` — the deterministic half needs no new instruction
  (reuses `stepNumber`), and the model half is a standalone one-shot call, not part of the live
  conversational turn contract.
- Any change to `ArchitectureTurnSchema` — same reasoning.
- Per-step-pair findings from the consistency check (e.g. "the Step 5→6 transition is weak") —
  the PRD asks for one holistic "unbroken arc" judgment, not a decomposed per-transition one;
  adding that structure would be inventing a requirement, not implementing one (YAGNI).
- Live-model verification of the consistency check's actual judgment quality — matches every
  prior P4 issue's own precedent, tracked under the existing bundled follow-up (#167).

## Files touched

- Create: `web/src/lib/storyArchitectureEngine/thematicAnchorAudit.ts`
- Modify: `web/src/app/api/architecture-chat/document/route.ts` (wire the audit + `409`/`acknowledged` gate)
- Modify: `web/src/components/ArchitectureInterview.tsx` (audit banner + "Compile anyway")

## Testing

No test suite exists in this project. Verification is `tsc --noEmit`, `npm run lint`,
`npm run build`, and a direct code trace against representative inputs: zero Confirmed units at
all 6 anchor steps (all 6 flagged, no model call), some steps covered and some not (only the
missing ones flagged, no model call), all 6 covered (one model call, both a clean-pass and a
flagged-gap mocked response traced), and the document route's `409`/`acknowledged: true`/`200`
paths — matching every prior P4 issue's own standard.
