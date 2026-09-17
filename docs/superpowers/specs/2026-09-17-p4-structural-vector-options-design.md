# P4 Structural Vector Options — Design Spec

GitHub issue: #67 ("[P4] Implement Structural Vector Options for unblocking")
PRD ref: §7.7 FR-7.1-7.3 — "When the author is stuck on any structural unit, or explicitly asks
for options, generate 2-5 distinct structural approaches. Each option must state: (1)
pacing/hierarchy impact, (2) downstream setup/payoff requirements it creates, (3) impact on
character transformation timing and thematic resolution. Options must remain within current
canon unless the author explicitly invokes a Canon Revision path."

## Problem

Unlike every other P4 gate shipped so far (#63 causality, #66 format, #65 thematic-anchor
coverage), this feature has almost no deterministic *content* to check — "generate 2-5 distinct
structural approaches, each with three specific narrative impact statements" is inherently
generative, not verifiable against a rule. The app's job here is structural, not judgmental: give
the model a shape to report options in, and let the model do the actual creative work sp04
already instructs it toward.

## Design

### 1. What the app can deterministically own vs. what stays the model's job

**Deterministically enforceable via the Zod schema alone — no new function, no new gate:**
- The count (2-5 options): `z.array(...).min(2).max(5)`.
- Each option actually states all three required impacts: three separate, non-empty required
  string fields (`pacing_impact`, `downstream_requirements`, `thematic_impact`), each
  `z.string().min(1)`. A turn that omits one fails `extractTurn`'s schema validation the same way
  every other required field already does — this is FR-7.2's "must state" enforced for free by
  the same mechanism that already enforces every other required field in this schema.

**Stays the model's job, explicitly disclosed (same class of limitation `checkSceneRegisterFormat`
already accepts for "whether the sentences genuinely cover the required beats"):**
- Whether the options are *genuinely distinct* from each other (not just reworded restatements).
- Whether each impact statement is substantively true/useful, not just present.
- Whether an option stays within current canon (FR-7.3) — the app has no independent way to
  verify this against free-text option content. This is a prompt instruction, not a checkable
  rule.

### 2. New schema field: `structural_vector_options`

Added to `ArchitectureTurnSchema`/`EMIT_ARCHITECTURE_TURN_TOOL` (both, same pairing convention
every existing field already follows):

```ts
structural_vector_options: z
  .object({
    unit_id: z.string().min(1),
    options: z
      .array(
        z.object({
          content: z.string().min(1),
          pacing_impact: z.string().min(1),
          downstream_requirements: z.string().min(1),
          thematic_impact: z.string().min(1),
        })
      )
      .min(2)
      .max(5),
  })
  .nullable(),
```

`unit_id` follows the exact same "reuse the id shown in Structural Units So Far, mint fresh only
for a genuinely new unit" rule `proposed_unit.unit_id` already follows — sp04 states this
explicitly for both fields.

`content` here is a rough structural description of the approach, not full Scene Register Format
(#66) — these are pre-commitment alternatives the author hasn't chosen yet, not a proposal being
submitted for `Working`/`Confirmed` status. `checkSceneRegisterFormat` is never run against it.
Once the author picks one and it becomes a real `proposed_unit` on a later turn, all of P4's
existing gates (Core-Purpose, causality, format, canon-contradiction) already apply to it exactly
as they would to any other proposal — no new gate needed for "picked" content, satisfying FR-7.3
for free by routing the eventual commit through machinery that already exists.

### 3. sp04 instruction

New clause (numbered to fit the existing section sequence) instructing: generate 2-5 distinct
approaches when the author is stuck or explicitly asks; state all three required impacts per
option; never assume a Canon Revision is in play unless the author has already explicitly
invoked one for this unit; never report `structural_vector_options` in the same turn as a
`proposed_unit` (presenting alternatives and committing to one are mutually exclusive within a
single turn — pick one shape per turn). Section 8's field-enumeration list and the structured
output contract both get the new field added, matching how every prior field addition (#63, #64,
#66) touched this same section.

### 4. Wiring: pure passthrough, no state, no gate

`architecture-chat/route.ts` adds one line to the response: `structuralVectorOptions:
delta.structural_vector_options` (camelCase, matching `deferredItems`'s existing convention). No
Firestore write, no persisted state, no interaction with `combinedValid`/`attemptStatusTransition`
— this is informational data for the current turn only, same posture as `deferredItems` or
`placementFlag`. If the model ever reports both `structural_vector_options` and `proposed_unit`
on the same turn (contrary to the new sp04 instruction), both still process/pass through exactly
as their own existing logic already handles them independently — no new branching needed, since
neither one's processing depends on the other's presence.

### 5. UI: option cards

`ArchitectureInterview.tsx` renders `structuralVectorOptions` as a set of cards (one per option)
below the chat transcript, each showing the option's content and its three impact statements —
giving the structured data its own clear presentation distinct from (and complementing) the
model's own prose framing in `reply`. Not a blocking banner — purely informational, styled
consistent with the existing "advisory, not a gate" visual language (a neutral/teal accent, not
reusing red/amber/orange/sky/purple/rose, which each already carry a specific meaning in this
component).

## What's out of scope

- Any deterministic "distinctness" check between options (no algorithmic definition exists that
  wouldn't be inventing an unspecified rule — same disclosed-limitation class as every other
  semantic judgment left to the model in this codebase).
- Any deterministic canon-conflict check on the OPTIONS themselves (FR-7.3) — satisfied instead
  by the existing canon-contradiction machinery, which already applies once an option is actually
  picked and submitted as a real proposal.
- Persisting generated options anywhere — they're turn-scoped, informational, and never become
  canon on their own; only a subsequently *picked and confirmed* unit does.
- Live-model verification of the "author is stuck" detection quality or the PRD's own test case 6
  — matches every prior P4 issue's own precedent, folded into the existing bundled follow-up
  (#167).

## Files touched

- Modify: `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts` (new field, both Zod
  schema and tool schema)
- Modify: `web/system-prompts/sp04-sae-systemprompt.md` (new instruction clause + Section 8
  update)
- Modify: `web/src/app/api/architecture-chat/route.ts` (one-line passthrough)
- Modify: `web/src/components/ArchitectureInterview.tsx` (option cards)

## Testing

No test suite exists in this project. Verification is `tsc --noEmit`, `npm run lint`,
`npm run build`, plus a direct trace confirming: the Zod schema rejects fewer than 2 or more than
5 options, rejects an option missing any of the three required impact fields, accepts a
well-formed 2-option and 5-option payload, and the route correctly passes a `null` value through
unchanged on an ordinary turn that reports no options. UI rendering is verified by tracing the
component logic against a hand-constructed response object (matching #56/#65's own standard for
UI-only verification without a live model call).
