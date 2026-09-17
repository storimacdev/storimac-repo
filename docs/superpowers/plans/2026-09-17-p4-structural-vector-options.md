# P4 Structural Vector Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #67 — when the author is stuck on a structural unit, or asks
for options, the model generates 2-5 distinct structural approaches, each stating its
pacing/hierarchy impact, downstream setup/payoff requirements, and impact on character
transformation timing and thematic resolution.

**Architecture:** A new nullable, self-reported schema field (`structural_vector_options`),
identically paired between the Zod schema and the Anthropic tool schema per this file's existing
convention. Count (2-5) and per-option field presence are enforced for free by the schema itself
— no new deterministic-check function is needed, unlike every prior P4 gate. The route passes
the field through unchanged (no state, no persistence, no gating); the UI renders it as a set of
option cards.

**Tech Stack:** Zod schema additions, a Markdown system-prompt edit, a one-line API route
passthrough, and React/TSX cards.

## Global Constraints

- No test suite exists in this project — verification is `npx tsc --noEmit -p .`, `npm run
  lint`, `npm run build` (all from `web/`), plus a direct code trace.
- Exactly 2-5 options, each with all three impact fields present and non-empty — enforced via
  `z.array(...).min(2).max(5)` and `.min(1)` on each string field. No hand-written validation
  function; this is intentional (see the design spec's §1 for why nothing here is deterministically
  checkable beyond shape/count).
- `structural_vector_options` is turn-scoped and ephemeral — no new `Story` field, no Firestore
  write, no resume/hydration wiring (matching `placementFlag`/`validationResult`/`deferredItems`'s
  existing precedent, NOT `pendingConflict`/`sceneDensity`'s persisted one).
- The outer response key is camelCased (`structuralVectorOptions`), but the field's own nested
  properties stay in the model's native snake_case (`unit_id`, `pacing_impact`,
  `downstream_requirements`, `thematic_impact`) — matching `deferredItems`'s existing precedent
  exactly (that field's own `defer_to_project` is not camelCased either).
- Never touches `combinedValid`/`combinedReason`/`attemptStatusTransition` — this field carries
  no gating consequence of any kind.
- Design spec: `docs/superpowers/specs/2026-09-17-p4-structural-vector-options-design.md`.

---

### Task 1: Schema, system prompt, and route passthrough

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`
- Modify: `web/system-prompts/sp04-sae-systemprompt.md`
- Modify: `web/src/app/api/architecture-chat/route.ts`

**Interfaces:**
- Produces: `ArchitectureTurnSchema`'s inferred `ArchitectureTurn` type gains
  `structural_vector_options: { unit_id: string; options: { content: string; pacing_impact:
  string; downstream_requirements: string; thematic_impact: string }[] } | null`. The turn
  response JSON gains a top-level `structuralVectorOptions` field of that same shape. Task 2
  consumes both.

- [ ] **Step 1: Add the field to the Zod schema**

  In `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`, the `ArchitectureTurnSchema`
  object currently ends with:
  ```ts
    resolution: z.enum(["revert", "accept_and_update", "park"]).nullable(),
  });
  ```
  Change it to:
  ```ts
    resolution: z.enum(["revert", "accept_and_update", "park"]).nullable(),
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
  });
  ```

- [ ] **Step 2: Add the matching tool schema entries**

  In the same file, `EMIT_ARCHITECTURE_TURN_TOOL`'s `properties` object currently ends with:
  ```ts
        resolution: {
          type: ["string", "null"],
          enum: ["revert", "accept_and_update", "park", null],
          description:
            "Set only on the turn immediately after the author picks one of the three choices presented for an open Canon Revision Path conflict (see your grounding). Null on every other turn.",
        },
      },
      required: [
        "reply",
        "context",
        "routing_choice",
        "active_step_number",
        "proposed_unit",
        "validation_result",
        "validation_reason",
        "deferred_items",
        "resolution",
      ],
    },
  };
  ```
  Change it to:
  ```ts
        resolution: {
          type: ["string", "null"],
          enum: ["revert", "accept_and_update", "park", null],
          description:
            "Set only on the turn immediately after the author picks one of the three choices presented for an open Canon Revision Path conflict (see your grounding). Null on every other turn.",
        },
        structural_vector_options: {
          type: ["object", "null"],
          properties: {
            unit_id: {
              type: "string",
              description: "The structural unit these options are for - reuse its exact id if it already appears in Structural Units So Far, mint a fresh id only for a genuinely new unit.",
            },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  content: { type: "string", description: "A rough structural description of this approach - not full Scene Specification Format, since the author hasn't chosen it yet." },
                  pacing_impact: { type: "string", description: "This option's pacing/hierarchy impact." },
                  downstream_requirements: { type: "string", description: "The downstream setup/payoff requirements this option would create." },
                  thematic_impact: { type: "string", description: "This option's impact on character transformation timing and thematic resolution." },
                },
                required: ["content", "pacing_impact", "downstream_requirements", "thematic_impact"],
              },
              description: "2-5 distinct structural approaches, each stating all three required impacts.",
            },
          },
          required: ["unit_id", "options"],
          description: "Set only when the author seems stuck on a structural unit or explicitly asks for options. Null on every other turn - never set in the same turn as proposed_unit.",
        },
      },
      required: [
        "reply",
        "context",
        "routing_choice",
        "active_step_number",
        "proposed_unit",
        "validation_result",
        "validation_reason",
        "deferred_items",
        "resolution",
        "structural_vector_options",
      ],
    },
  };
  ```

- [ ] **Step 3: Update the system prompt**

  In `web/system-prompts/sp04-sae-systemprompt.md`, insert a new section right before the
  existing Section 10 ("OPENING TURN"), and renumber that section to 11. The file currently reads
  (the transition point, unchanged text shown for anchoring):
  ```
  9. CANON REVISION PATH
  A structural unit that is already Confirmed cannot silently revert to Exploring or Working - the app enforces this regardless of what you propose, so always check the Structural Units So Far grounding before requesting a status change on an existing unit. Separately, if you recognize that a unit's proposed content contradicts an already-locked Project 1, 2, or 3 fact it cites (for example, a proposed scene that requires changing a character's Core Wound), do not silently accept the new idea - report it as a canon_contradiction instead. Either situation opens a Canon Revision Path conflict: while one is open (see your grounding for the current one), present exactly the three choices given there, in your own words, and develop no other structural content until the author picks one and you report their choice as resolution on your next turn.

  10. OPENING TURN
  Review the attached canon-ingestion grounding below. Execute Section 7's onboarding sequence exactly — structural overview, milestone checklist, routing prompt, in your own words — and nothing else. No structural development of any kind on this turn.
  ```
  Replace it with:
  ```
  9. CANON REVISION PATH
  A structural unit that is already Confirmed cannot silently revert to Exploring or Working - the app enforces this regardless of what you propose, so always check the Structural Units So Far grounding before requesting a status change on an existing unit. Separately, if you recognize that a unit's proposed content contradicts an already-locked Project 1, 2, or 3 fact it cites (for example, a proposed scene that requires changing a character's Core Wound), do not silently accept the new idea - report it as a canon_contradiction instead. Either situation opens a Canon Revision Path conflict: while one is open (see your grounding for the current one), present exactly the three choices given there, in your own words, and develop no other structural content until the author picks one and you report their choice as resolution on your next turn.

  10. STRUCTURAL VECTOR OPTIONS
  When the author seems genuinely stuck on any structural unit, or explicitly asks for options, generate 2-5 distinct structural approaches for that unit - staying within current canon unless the author has already explicitly invoked a Canon Revision Path for this specific unit. For each option, state exactly three things: (1) its pacing/hierarchy impact, (2) the downstream setup/payoff requirements it creates, (3) its impact on character transformation timing and thematic resolution. Report these via structural_vector_options, reusing the exact unit id shown in Structural Units So Far when this is an existing unit (mint a fresh id only for a genuinely new one) - the same rule proposed_unit's own unit_id already follows. Present the options to the author in your own words in your reply, alongside the structured data. Never report structural_vector_options in the same turn as proposed_unit - presenting alternatives and committing to one are different turns; pick one shape per turn.

  11. OPENING TURN
  Review the attached canon-ingestion grounding below. Execute Section 7's onboarding sequence exactly — structural overview, milestone checklist, routing prompt, in your own words — and nothing else. No structural development of any kind on this turn.
  ```

  Then, in the same file, Section 8 ("STRUCTURED OUTPUT CONTRACT")'s single long paragraph
  currently ends with:
  ```
  ...`deferred_items` (anything raised that belongs to another project, tagged with which one); resolution ("revert", "accept_and_update", or "park" on the turn immediately after the author picks one of the three choices for an open Canon Revision Path conflict, null on every other turn).
  ```
  Change it to end with:
  ```
  ...`deferred_items` (anything raised that belongs to another project, tagged with which one); resolution ("revert", "accept_and_update", or "park" on the turn immediately after the author picks one of the three choices for an open Canon Revision Path conflict, null on every other turn); `structural_vector_options` (2-5 distinct structural approaches for a unit, each stating pacing_impact/downstream_requirements/thematic_impact, set only when the author seems stuck or asks for options - null on every ordinary turn, and never set in the same turn as proposed_unit).
  ```

- [ ] **Step 4: Pass the field through in the route response**

  In `web/src/app/api/architecture-chat/route.ts`, the final `return NextResponse.json({...})`
  currently ends with:
  ```ts
        pendingConflict: pendingConflictForResponse,
        cascadeReview,
        sceneDensity: sceneDensityForResponse,
      });
  ```
  Change it to:
  ```ts
        pendingConflict: pendingConflictForResponse,
        cascadeReview,
        sceneDensity: sceneDensityForResponse,
        structuralVectorOptions: delta.structural_vector_options,
      });
  ```

- [ ] **Step 5: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand (or a throwaway `tsx` script) against the actual
  committed `ArchitectureTurnSchema`:
  - A payload with `structural_vector_options: null` and every other field valid → schema
    parses successfully.
  - A payload with exactly 2 well-formed options → parses successfully. Exactly 5 → parses
    successfully.
  - A payload with only 1 option → schema validation fails (`.min(2)` violated).
  - A payload with 6 options → schema validation fails (`.max(5)` violated).
  - A payload where one option is missing `thematic_impact` entirely → schema validation fails
    (required field missing).
  - A payload where one option's `pacing_impact` is `""` (empty string) → schema validation
    fails (`.min(1)` violated).

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts web/system-prompts/sp04-sae-systemprompt.md web/src/app/api/architecture-chat/route.ts
  git commit -m "feat: add P4 Structural Vector Options schema field and sp04 instruction (issue #67)"
  ```

---

### Task 2: UI — option cards

**Files:**
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Consumes (Task 1): the chat turn response's `structuralVectorOptions: { unit_id: string;
  options: { content: string; pacing_impact: string; downstream_requirements: string;
  thematic_impact: string }[] } | null` field.

- [ ] **Step 1: Add client-side types**

  Add these types right after the existing `ThematicAnchorAudit` type declaration:
  ```ts
  type StructuralVectorOption = {
    content: string;
    pacing_impact: string;
    downstream_requirements: string;
    thematic_impact: string;
  };
  type StructuralVectorOptions = { unit_id: string; options: StructuralVectorOption[] };
  ```

  Add a field to the `TurnResponse` interface, which currently ends with:
  ```ts
    sceneDensity: SceneDensity;
  }
  ```
  Change it to:
  ```ts
    sceneDensity: SceneDensity;
    structuralVectorOptions: StructuralVectorOptions | null;
  }
  ```

- [ ] **Step 2: Add state**

  Right after the existing:
  ```ts
    const [sceneDensity, setSceneDensity] = useState<SceneDensity | null>(null);
  ```
  add:
  ```ts
    const [structuralVectorOptions, setStructuralVectorOptions] = useState<StructuralVectorOptions | null>(null);
  ```

  This is turn-scoped only, deliberately NOT added to the resume/hydration effect (unlike
  `pendingConflict`/`sceneDensity`) - matching `placementFlag`/`validationResult`'s own existing
  precedent of never surviving a page reload, since the app never persists this field anywhere.

- [ ] **Step 3: Update on each chat turn**

  In `sendMessage`, right after this existing line:
  ```ts
        setSceneDensity(data.sceneDensity);
  ```
  add:
  ```ts
        setStructuralVectorOptions(data.structuralVectorOptions);
  ```

- [ ] **Step 4: Add the option cards**

  Add this block right after the existing `cascadeReview` banner block (after its closing `)}`),
  before the `sceneDensity` banner block:
  ```tsx
        {structuralVectorOptions && structuralVectorOptions.options.length > 0 && (
          <div className="border-b border-teal-500/30 bg-teal-950/20 px-6 py-3 text-xs text-teal-200">
            <p className="mb-2 font-semibold">
              Structural options for unit &quot;{structuralVectorOptions.unit_id}&quot;:
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {structuralVectorOptions.options.map((option, i) => (
                <div key={i} className="rounded-lg border border-teal-500/30 bg-neutral-900 p-3">
                  <p className="mb-2 text-teal-100">{option.content}</p>
                  <p className="mb-1">
                    <span className="font-semibold">Pacing:</span> {option.pacing_impact}
                  </p>
                  <p className="mb-1">
                    <span className="font-semibold">Downstream:</span> {option.downstream_requirements}
                  </p>
                  <p>
                    <span className="font-semibold">Thematic:</span> {option.thematic_impact}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
  ```
  This is visually distinct (teal) from every existing banner color (red rejection, amber
  placement guardrail, orange Canon Revision Path/cascade, sky scene-density, purple compile
  success, rose thematic-anchor gap) — purely informational, never blocking, consistent with the
  "advisory, not a gate" visual language every non-red banner in this file already follows.

- [ ] **Step 5: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace the component's render logic by hand against a
  hand-constructed `structuralVectorOptions` object (2 options, then 5 options) to confirm the
  grid renders one card per option with all four fields visible, and confirm the block renders
  nothing at all when `structuralVectorOptions` is `null` (the ordinary-turn case).

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: add P4 Structural Vector Options cards to the UI (issue #67)"
  ```
