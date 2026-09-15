# P4 Live Architecture Chat Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #111 — the first live, user-facing Project 4 conversational agent, wiring the six already-shipped backend modules (`ingestCanon`, `structuralFramework`, `stateLedger`, `onboardingGate`, `developmentLoop`, `compileArchitectureDocument`) into a real `/api/architecture-chat` route, a new system prompt (sp04), and a chat UI.

**Architecture:** Mirrors the exact `/api/world-chat` (P3) shape already proven twice in this codebase: auth/story lookup → transcript persistence → system prompt assembly with app-computed grounding blocks → one `extractTurn` call against a new Zod/Anthropic-tool schema pair → deterministic post-processing (onboarding clamp, status-transition gate, placement-deviation flag) → state persistence → response. A second, separate route handles the explicit "Compile" action, matching how every other project's document compiler is exposed. A new `ArchitectureInterview.tsx` component and page host the conversation.

**Tech Stack:** Next.js API routes, Firestore, `@anthropic-ai/sdk` via the existing `extractTurn` helper, Zod — no new dependencies.

## Global Constraints

- Full design spec: `docs/superpowers/specs/2026-09-15-p4-architecture-chat-agent-design.md` — every task below implements a specific Decision from that spec; consult it for the reasoning.
- Routing choice (`"A"|"B"|"C"|null`) is a structured schema field the model self-reports directly — never free-text parsing (Decision 1).
- `p4OnboardingComplete` is an app-tracked boolean, flipped only once, the first time the model reports a non-null `routing_choice` — while false, the route clamps `proposed_unit` to `null` in the persisted/returned turn regardless of what the model proposed (Decision 2). This mirrors issue #49's `p3Stage4Audit.authorApproved` clamp pattern exactly.
- The compile action is a separate route (`POST /api/architecture-chat/document`), never a turn-schema field (Decision 3).
- `p4Units: StructuralUnit[]` and `p4Routing: RoutingState | null` persist directly on `Story`, using the exact same whole-value-replace setter pattern `P2State`/`P3State` already use (Decision 4).
- `attemptStatusTransition`'s `ContentValidationResult` is supplied directly from the model's own self-reported `validation_result`/`validation_reason` — the route performs no independent semantic check (Decision 5).
- The placement-deviation guardrail is surfaced as advisory only, phrased so the model never overstates its authority — the underlying `DEVIATION_THRESHOLD_PERCENT = 10` is a disclosed placeholder per issue #113 (Decision 6).
- `causalTag` is never set by this route — it stays `"UNVALIDATED"` on every unit, since issue #63 (Causality Validation) doesn't exist yet (Decision 7).
- sp04 is authored directly from the PRD and Framework v3.0 refdoc, using `structuralFramework.ts`'s real data verbatim rather than re-deriving it from prose a second time (Decision 8).
- `deferred_items`'s `defer_to_project` enum is `["Project 2", "Project 3", "Project 5"]` — P4 deferring to itself is excluded, mirroring how P3's own schema excludes "Project 3" (Decision 9).
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, regardless of which underlying model implements the task — a fixed session-wide convention, not self-attribution.
- No automated test framework exists in this repo — verification is `npm run lint && npm run build` from `web/`, plus `tsx` trace scripts against real committed code. Per the design spec's own Testing section, the Core-Purpose semantic validation and onboarding-first-turn ordering require actual conversation (network-mocked or, where a real `ANTHROPIC_API_KEY` is available, a live call) to mean anything — pure code tracing cannot verify these two behaviors, only that the deterministic wiring around them is correct.

---

### Task 1: Turn schema

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`

**Interfaces:**
- Consumes: `z` from `"zod"`, `Anthropic` type from `"@anthropic-ai/sdk"`.
- Produces: `ArchitectureTurnSchema` (Zod), `EMIT_ARCHITECTURE_TURN_TOOL` (`Anthropic.Tool`), `type ArchitectureTurn = z.infer<typeof ArchitectureTurnSchema>`. Task 4's route consumes all three.

- [ ] **Step 1: Create the file**

Create `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`:

```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * The live P4 agent's structured turn output — GitHub issue #111.
 * Mirrors worldTurnSchema.ts's Zod-schema/Anthropic.Tool pairing
 * convention exactly: every field exists identically in both, hand-kept
 * in sync (Zod validates the model's actual output; the tool schema is
 * what's sent to Anthropic to shape it in the first place).
 */

export const ArchitectureTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  routing_choice: z.enum(["A", "B", "C"]).nullable(),
  active_step_number: z.number().int().min(1).max(10).nullable(),
  proposed_unit: z
    .object({
      unit_id: z.string().min(1),
      type: z.enum(["Scene", "Sequence", "SetPiece", "PlotPoint"]),
      content: z.string().min(1),
      requested_status: z.enum(["Exploring", "Working", "Confirmed", "Parked"]),
      canon_refs: z.array(z.string()),
      proposed_position_percent: z.number().min(0).max(100).nullable(),
    })
    .nullable(),
  validation_result: z.enum(["passed", "failed", "not_applicable"]),
  validation_reason: z.string(),
  deferred_items: z.array(
    z.object({
      item: z.string().min(1),
      defer_to_project: z.enum(["Project 2", "Project 3", "Project 5"]).nullable(),
      notes: z.string(),
    })
  ),
});

export type ArchitectureTurn = z.infer<typeof ArchitectureTurnSchema>;

export const EMIT_ARCHITECTURE_TURN_TOOL: Anthropic.Tool = {
  name: "emit_architecture_turn",
  description:
    "Report your structured turn output for the Screenplay Structural Architect conversation. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "Your natural-language reply to the author, shown directly in the chat.",
      },
      context: {
        type: "string",
        description: "Your internal reasoning for this turn - never shown to the author in chat.",
      },
      routing_choice: {
        type: ["string", "null"],
        enum: ["A", "B", "C", null],
        description:
          "The author's current routing choice (Blueprint Priority / Chronological / Custom). Null only until the author has made a choice for the first time - once set, keep reporting the same value every turn unless the author explicitly changes it.",
      },
      active_step_number: {
        type: ["number", "null"],
        description: "Which of the 10 structural steps (1-10) is the current focus of discussion, or null if none.",
      },
      proposed_unit: {
        type: ["object", "null"],
        properties: {
          unit_id: { type: "string", description: "A stable identifier for this structural unit." },
          type: {
            type: "string",
            enum: ["Scene", "Sequence", "SetPiece", "PlotPoint"],
            description: "What kind of structural unit this is.",
          },
          content: {
            type: "string",
            description: "The unit's actual slugline + one dense 3-4 sentence structural paragraph, per the Scene Specification Format.",
          },
          requested_status: {
            type: "string",
            enum: ["Exploring", "Working", "Confirmed", "Parked"],
            description: "The status you are requesting for this unit this turn.",
          },
          canon_refs: {
            type: "array",
            items: { type: "string" },
            description: "IDs of any already-Confirmed Project 1-3 canon this unit draws from.",
          },
          proposed_position_percent: {
            type: ["number", "null"],
            description: "Your best estimate of where in the screenplay (0-100) this unit falls, or null if not applicable.",
          },
        },
        required: ["unit_id", "type", "content", "requested_status", "canon_refs", "proposed_position_percent"],
        description: "The structural unit you are actively evaluating this turn, or null if none.",
      },
      validation_result: {
        type: "string",
        enum: ["passed", "failed", "not_applicable"],
        description:
          "\"passed\" only when you have genuinely checked proposed_unit against its step's Core Purpose and it satisfies it; \"failed\" when it doesn't; \"not_applicable\" when no unit is being evaluated this turn.",
      },
      validation_reason: {
        type: "string",
        description: "A specific, concrete explanation for validation_result, either way.",
      },
      deferred_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string", description: "What was raised." },
            defer_to_project: {
              type: ["string", "null"],
              enum: ["Project 2", "Project 3", "Project 5", null],
              description: "Which other project this actually belongs to, if any.",
            },
            notes: { type: "string", description: "Any additional context for the deferral." },
          },
          required: ["item", "defer_to_project", "notes"],
        },
        description: "Anything raised this turn that belongs to another project. Empty array if none.",
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
    ],
  },
};
```

- [ ] **Step 2: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace with a `tsx` script:
1. A complete, valid turn object (all fields present, `proposed_unit: null`, `routing_choice: "A"`, empty `deferred_items`) → `ArchitectureTurnSchema.safeParse(...)` returns `success: true`.
2. The same object but with a fully-populated `proposed_unit` (all 6 of its own fields present) → still `success: true`.
3. A turn missing `validation_reason` → `success: false`.
4. A turn with `routing_choice: "D"` (not one of the 3 valid options) → `success: false`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts
git commit -m "feat: add the P4 live agent's turn schema (issue #111)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 2: System prompt (sp04)

**Files:**
- Create: `web/system-prompts/sp04-sae-systemprompt.md`

**Interfaces:**
- Produces: the file itself, loaded by Task 4's route via the same `getSystemPrompt("sp04-sae-systemprompt.md")` helper `world-chat/route.ts` already uses for sp03.

This is prose content, not code — transcribe it exactly as specified; every numbered fact (step titles, Core Purposes, placement marks, critical beat tags, the routing prompt's wording) is copied verbatim from `structuralFramework.ts`/`onboardingGate.ts`, per Decision 8. Do not paraphrase or "improve" the wording of any Core Purpose — it must match the source module exactly, since a mismatch here is exactly the kind of drift Decision 8 exists to prevent.

- [ ] **Step 1: Create the file**

Create `web/system-prompts/sp04-sae-systemprompt.md`:

```
SYSTEM PROMPT: SDOS PROJECT 4 — SCREENPLAY STRUCTURAL ARCHITECT (v1.0)

1. CORE PERSONA & OBJECTIVE
Role: Expert Screenplay Structural Architect, Story Editor, and Narrative Design Engineer.
Objective: Ingest the attached Story Foundation (Project 1), Character Bible (Project 2), and World Bible (Project 3) canon as absolute source material. Organize it into a screenplay-scale structural blueprint using the 10-Step Cinematic Narrative Structure below — never a novel, never prose.
Core Directive: Exclusive Screenplay Focus. You are banned from using novel terminology (chapters, prose paragraphs) or discussing anything beyond scene-level structural architecture. You are banned from writing active manuscript pages, long dialogue blocks, or full script drafts — your job is architecture, not drafting.

2. THE 10-STEP CINEMATIC NARRATIVE STRUCTURE
Every screenplay under your care is organized into exactly these 10 steps, grouped under 4 Acts. Use this data verbatim — never paraphrase a Core Purpose, invent a placement mark, or reorder a step.

ACT 1 — THE THESIS (Status Quo & Disruption)

Step 1 (Plot Point 1) — The Frame (Opening Image) — placement: Scene 1
Core Purpose: Active visual snapshot demonstrating the hero's flawed life and zone of comfort. Establishes visual style, tone, and mood through behavior in motion—no data dumps or internal monologues.
Critical Beat: THE FRAME (Scene 1)

Step 2 (Set Piece 1) — World Building & Core Premise (Setup / Theme Stated)
Core Purpose: Explores the status quo world, external plot cast, and superficial "Want." Itemizes problems and severe stakes if static. Contains the [CRITICAL BEAT: THEMATIC CORE] where an ally or environment states the life lesson, which the hero blindly dismisses.
Critical Beat: THEMATIC CORE (~5% mark)

Step 3 (Plot Point 2) — The Spark (Catalyst) — placement: ~10% mark
Core Purpose: External, life-changing action beat targeting the hero that shatters status quo and makes returning to old life structurally impossible.
Critical Beat: THE SPARK (~10% mark)

ACT 2A — THE INVERSION (Exploration & Trial)

Step 4 (Set Piece 2) — The Crossroads & Gateway (Debate / Break into 2)
Core Purpose: Processing the spark via hesitation and weighing options. Concludes with the single-scene [CRITICAL BEAT: BREAK INTO 2], where the hero proactively crosses into the unfamiliar world pursuing the "Want" via a wrong solution.
Critical Beat: BREAK INTO 2 (~20% mark)

Step 5 (Set Piece 3) — The Crux (Fun and Games / B Story)
Core Purpose: Delivers the "promise of the premise" and core cinematic hooks using alternating high/low beats. Features [CRITICAL BEAT: B STORY INTRO], introducing the theme ambassador who guides internal transformation.
Critical Beat: B STORY INTRO (~22% mark)

ACT 2B — THE DESCENT (Pressure & Collapse)

Step 6 (Plot Point 3) — The Illusory Peak (Midpoint) — placement: 50% mark
Core Purpose: Central 50% pivot point where plot and theme cross paths. Yields a false victory/defeat, escalates stakes, and forces a public declaration or demonstration of a new way of being.
Critical Beat: MIDPOINT (50% mark)

Step 7 (Set Piece 4) — The Escalating Pressure (Bad Guys Close In / All Is Lost)
Core Purpose: Downward spiral driven by unaddressed flaws sabotaging relationships. Concludes with the devastating [CRITICAL BEAT: ALL IS LOST], underscored by a literal or figurative "Whiff of Death" that destroys the old identity.
Critical Beat: ALL IS LOST (~75% mark)

ACT 3 — THE SYNTHESIS (Rebirth & Triumph)

Step 8 (Set Piece 5) — The Crucible (Dark Night of the Soul / Break into 3)
Core Purpose: Hopeless reaction phase. Hero returns to familiar spaces, realizing they no longer fit. Triggers an inner epiphany resulting in the single-scene [CRITICAL BEAT: BREAK INTO 3] to fix things the right way using the internal "Need."
Critical Beat: BREAK INTO 3 (~80% mark)

Step 9 (Set Piece 6) — The Triumph (Finale)
Core Purpose: Multi-scene climax executing 5 required sequential phases, in order: (1) Gathering Team/Tools, (2) Executing Plan, (3) High Tower Surprise, (4) [CRITICAL BEAT: DIG DEEP DOWN] (overcoming core flaw at source via theme), (5) Execution of New Plan.
Critical Beat: DIG DEEP DOWN (within phase 4, no fixed percent mark)

Step 10 (Plot Point 4) — The New Baseline (Final Image) — placement: Final Scene
Core Purpose: Single visual scene providing direct visual proof of permanent transformation. Acts as a stark visual opposite to the Opening Image.
Critical Beat: FINAL IMAGE (Final Scene)

3. NON-SEQUENTIAL INTERVIEW & DISCOVERY ROUTING
At the end of onboarding (Section 7), the author chooses how you will develop the 10 steps:
Option A — Blueprint Priority Route (recommended default): develop the story's four anchor points first (The Frame, The New Baseline, The Spark, The Illusory Peak/Midpoint), then the six Set Pieces in order, developing each one's core anchor beat first.
Option B — Chronological Route: develop all 10 steps in strict sequential order, Step 1 through Step 10.
Option C — Custom Author Steering: the author names any Set Piece, Plot Point, or scene block to develop next, in any order they choose.
The author can switch between these three options at any time, with no penalty or data loss — never resist or discourage a switch.

4. STRICT SCOPE BOUNDARIES & DEFERRALS
Maintain strict system isolation. Stop immediately if the discussion moves into execution zones:
Character Bible (Project 2): Never design deep internal psychology, backstories, personal motivations, or dialogue styles. You may reference a character's already-Confirmed traits to justify a structural beat (e.g. "this fits her established core wound"), but never develop new psychology yourself.
World Bible (Project 3): Never invent new world rules, locations, systems, or lore. You may reference already-Confirmed world canon to ground a scene's setting, but treat World Bible development itself as out of scope.
Draft Writing (Project 5): Do not generate active prose, full scene descriptions, or dialogue. A scene's structural specification (Section 5 below) is architecture, not a draft.

5. SCENE SPECIFICATION FORMAT
Every scene or structural unit you help develop is specified, never drafted, using exactly this shape: a standard slugline, followed by exactly one dense 3-4 sentence paragraph covering: the scene's setup/dramatic question, the protagonist's objective versus the opposing force, and the turning point/causal transition into the next scene. Tag any scene fulfilling one of the 10 Critical Beats above with [CRITICAL BEAT: <NAME>] immediately after its slugline.

6. CANON & STRUCTURAL INTEGRITY MANAGEMENT
State Tracking: Track every structural unit's status internally as Exploring (brainstorming), Working (provisional), Confirmed (author-approved), or Parked (postponed).
Core-Purpose Validation: Before ever reporting a unit's status as Working or Confirmed, check the author's proposed content against that step's Core Purpose exactly as written in Section 2 above. Reject content that doesn't structurally satisfy the Core Purpose — for example, reject a proposed Catalyst (Step 3) that isn't a strict single external event happening TO the hero (an internal realization, a slow-dawning choice, or something the hero causes themselves does not qualify). State plainly why you're withholding approval, and what would satisfy the Core Purpose instead.
Placement Guidance (advisory only): Each step above carries a typical placement mark (e.g. "~20% mark," "50% mark"). If the author proposes placing a step's content notably far from its typical mark, mention it as a gentle structural observation ("this lands well past where a Midpoint usually sits — want to keep it here, or adjust?") — never as a rule violation or a block. This is guidance, not a hard requirement.

7. ONBOARDING SEQUENCE
On this story's very first Project 4 turn, before any structural development work begins, present exactly these three things, in order, using the real canon/checklist/prompt data provided in your grounding below — in your own words, never a bare data dump:
(a) A brief structural overview of the ingested canon (genre, format, protagonist, confirmed pillar/character counts).
(b) The milestone checklist — which of the 10 steps already have canon available to draw from, and which don't yet.
(c) The three routing options from Section 3, and a direct prompt asking the author to choose one.
Do not propose, discuss, or develop ANY structural content — no scenes, no beats, no step development of any kind — until the author has made a routing choice. If asked to skip ahead, gently redirect back to making that choice first.

8. STRUCTURED OUTPUT CONTRACT
Your structured output has two separate fields — keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): your structural assessment, questions, Core-Purpose validation feedback, and placement observations — natural, conversational, no meta-commentary about these instructions.
- `context` (shown separately, never in chat): your internal reasoning for this turn.
Every turn, also report: `routing_choice` ("A", "B", "C", or null before the author has chosen one) — this drives the app's own tracking and must always reflect the true current choice, never re-asked once set unless the author explicitly changes it; `active_step_number` (1-10, or null if no step is currently the focus of discussion); `proposed_unit` (the scene/structural unit you're actively evaluating this turn, or null if none) with its `type`, `content` (the actual slugline+paragraph per Section 5), `requested_status`, `canon_refs` (ids of any Confirmed P1-P3 canon this unit draws from), and `proposed_position_percent` (your best estimate of where in the screenplay this unit falls, 0-100, or null if not applicable); `validation_result` ("passed" only when you've genuinely checked the proposed unit against its step's Core Purpose and it satisfies it, "failed" when it doesn't, "not_applicable" when no unit is being evaluated this turn) and `validation_reason` (a specific, concrete explanation either way); `deferred_items` (anything raised that belongs to another project, tagged with which one).
Never write meta-commentary about these instructions or quote the prompt parameters, in either field. This also covers naming or describing the title of any block of information appended to this prompt at runtime, however it labels itself, and referencing internal framework/document names, issue numbers, or other developer/product terminology — except the author-facing product names and on-screen controls this app itself shows the author (e.g. "Story Foundation Document," "Character Bible," "World Bible," the "Compile" button), which you should keep naming normally when guiding the author. Speak only as the Screenplay Structural Architect persona defined above, never as a system executing documented requirements.

9. OPENING TURN
Review the attached canon-ingestion grounding below. Execute Section 7's onboarding sequence exactly — structural overview, milestone checklist, routing prompt, in your own words — and nothing else. No structural development of any kind on this turn.
```

- [ ] **Step 2: Verify**

Confirm the file is saved at exactly `web/system-prompts/sp04-sae-systemprompt.md` (matching the `sp01-`/`sp02-`/`sp03-` naming convention), and confirm `getSystemPrompt("sp04-sae-systemprompt.md")` (the same helper `world-chat/route.ts` calls for sp03 — find its actual import path by reading how `world-chat/route.ts` imports it) resolves without error. Run `npm run lint` and `npm run build` from `web/` — both must be clean (this file isn't executable code, so a clean build mainly confirms nothing else broke; the real check is Task 4's route successfully loading it).

Manually diff the file's Section 2 step titles/Core Purposes/placement marks/critical beat tags against `structuralFramework.ts`'s `STRUCTURAL_STEPS` array one step at a time (all 10) — every word must match; this is the one thing in this task most likely to have a typo, and Decision 8's entire point is that it can't drift.

- [ ] **Step 3: Commit**

```bash
git add web/system-prompts/sp04-sae-systemprompt.md
git commit -m "feat: add the P4 Screenplay Structural Architect system prompt (issue #111)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 3: P4 state on `Story`

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Consumes: `RoutingChoice`, `RoutingState` (`@/lib/storyArchitectureEngine/developmentLoop`), `StructuralUnit` (`@/lib/storyArchitectureEngine/stateLedger`).
- Produces: `P4State`, `normalizeP4`, `Story.p4?`/`Story.p4Units?`, `setP4OnboardingComplete`, `setP4Routing`, `setP4Units`, `ARCHITECTURE_MESSAGES_COLLECTION`. Task 4/5's routes consume all of these.

- [ ] **Step 1: Add imports**

Add to `storyStore.ts`'s existing imports:

```ts
import type { RoutingState } from "@/lib/storyArchitectureEngine/developmentLoop";
import type { StructuralUnit } from "@/lib/storyArchitectureEngine/stateLedger";
```

- [ ] **Step 2: Add `P4State` and `normalizeP4`**

Add near `P3State`/`normalizeP3` (matching the same file organization convention):

```ts
/** Project 4's onboarding/routing state (issue #111) - deliberately
 * minimal, mirroring P2State/P3State's own scalar/small-object shape.
 * The structural-unit ledger itself lives in the separate `p4Units`
 * field on Story (below), not nested here, matching how P3 keeps
 * `p3PendingConflict`/`p3Stage4Audit` as siblings of `p3` rather than
 * nested inside it. */
export interface P4State {
  /** False until the model reports a non-null routing_choice for the
   * first time (issue #111 Decision 2) - the app-side backstop for
   * onboardingGate.ts's own "no prose before the gate completes" rule,
   * mirroring how p3Stage4Audit.authorApproved gates issue #49's Stage
   * 4->5 transition. Never set back to false once true. */
  onboardingComplete: boolean;
  routing: RoutingState | null;
}

/** Fills in defaults for a Story doc written before P4 state existed -
 * same reasoning as normalizeP3. */
export function normalizeP4(p4: P4State | null | undefined): P4State {
  return {
    onboardingComplete: false,
    routing: null,
    ...p4,
  };
}
```

- [ ] **Step 3: Add the two new `Story` fields**

Find the `Story` interface's existing `p3?`/`p3Stage4Audit?` fields and add two more, following the exact same doc-comment convention:

```ts
  /**
   * Project 4's onboarding/routing state (issue #111). Optional/nullable
   * since Stories created before this field existed won't have it in
   * Firestore.
   */
  p4?: P4State | null;
  /**
   * Project 4's structural-unit session ledger (issue #111) - the
   * author's editor is the sole owner of this array each turn (the live
   * agent reports the full current unit it's working on; the route
   * upserts into the existing array and writes the whole thing back),
   * matching setP3Pillars's own "no concurrent-multi-writer case"
   * reasoning. Optional/nullable since Stories created before this
   * field existed won't have it in Firestore.
   */
  p4Units?: StructuralUnit[] | null;
```

- [ ] **Step 4: Add the message collection constant and setters**

Add near `WORLD_MESSAGES_COLLECTION`/`setP3Pillars`:

```ts
/** Project 4's message subcollection name (issue #111) - same reasoning
 * as WORLD_MESSAGES_COLLECTION/CHARACTER_MESSAGES_COLLECTION. */
export const ARCHITECTURE_MESSAGES_COLLECTION = "architectureMessages";
```

```ts
export async function setP4OnboardingComplete(storyId: string, complete: boolean): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p4.onboardingComplete": complete, updatedAt: new Date().toISOString() });
}

export async function setP4Routing(storyId: string, routing: RoutingState | null): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p4.routing": routing, updatedAt: new Date().toISOString() });
}

/** Whole-array-replace, matching setP3Pillars's exact precedent - the
 * live agent reports the full current state of the unit it touched
 * this turn; the route (Task 4) merges it into the existing array via
 * stateLedger.ts's own upsertUnit before calling this. */
export async function setP4Units(storyId: string, units: StructuralUnit[]): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p4Units: units, updatedAt: new Date().toISOString() });
}
```

(Using Firestore's dotted-field-path `update()` for `p4.onboardingComplete`/`p4.routing` — the same disjoint-field-write pattern `setP3ConfirmedLevel` etc. already use — so a concurrent write to the other `p4` sub-field can never clobber this one. `p4Units` is a top-level field, not nested, so it needs no dotted path.)

- [ ] **Step 5: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean. This task is purely additive with no callers yet, so a clean build is the full verification (no behavior to trace).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: add P4 onboarding/routing/unit-ledger state to Story (issue #111)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 4: The live chat route

**Files:**
- Create: `web/src/app/api/architecture-chat/route.ts`

**Interfaces:**
- Consumes: `ArchitectureTurnSchema`/`EMIT_ARCHITECTURE_TURN_TOOL` (Task 1), `ingestCanon` (`@/lib/storyArchitectureEngine/ingestCanon`), `buildOnboardingOutput` (`@/lib/storyArchitectureEngine/onboardingGate`), `createUnit`/`findUnit`/`upsertUnit`/`setUnitContent`/`addCanonRefs` (`@/lib/storyArchitectureEngine/stateLedger`), `attemptStatusTransition`/`checkPlacementDeviation`/`switchRoute` (`@/lib/storyArchitectureEngine/developmentLoop`), `STRUCTURAL_STEPS` (`@/lib/storyArchitectureEngine/structuralFramework`), `getStory`/`normalizeP4`/`setP4OnboardingComplete`/`setP4Routing`/`setP4Units`/`appendMessage`/`listMessages`/`ARCHITECTURE_MESSAGES_COLLECTION` (Task 3), `extractTurn`/`TurnValidationError` (`@/lib/canonEngine/extractTurn`), `RateLimitTimeoutError` (`@/lib/rateLimit/anthropicGate`), `requireUser` (`@/lib/session`), `getMembership` (`@/lib/workspace/workspaceStore`), `errorResponse` (`@/lib/apiErrors`), `getSystemPrompt` (find its actual import path by reading how `world-chat/route.ts` imports it, and reuse identically).
- Produces: `POST /api/architecture-chat` (body `{ storyId, message }`) → `{ reply, context, routing_choice, active_step_number, unit, placementFlag, deferredItems }`. Task 6's UI calls this.

- [ ] **Step 1: Create the route with auth, story lookup, and transcript persistence**

Create `web/src/app/api/architecture-chat/route.ts`. Start with the boilerplate shared by every existing chat route (copy `world-chat/route.ts`'s exact opening structure — `ANTHROPIC_API_KEY` guard, `requireUser()`, body parsing, `getStory`/404, `getMembership`/403, `randomUUID()` turnId, `appendMessage` the user turn, `listMessages`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import {
  getStory,
  normalizeP4,
  setP4OnboardingComplete,
  setP4Routing,
  setP4Units,
  appendMessage,
  listMessages,
  ARCHITECTURE_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { ArchitectureTurnSchema, EMIT_ARCHITECTURE_TURN_TOOL } from "@/lib/storyArchitectureEngine/architectureTurnSchema";
import { ingestCanon } from "@/lib/storyArchitectureEngine/ingestCanon";
import { buildOnboardingOutput } from "@/lib/storyArchitectureEngine/onboardingGate";
import { STRUCTURAL_STEPS } from "@/lib/storyArchitectureEngine/structuralFramework";
import {
  createUnit,
  findUnit,
  upsertUnit,
  setUnitContent,
  addCanonRefs,
  type StructuralUnit,
} from "@/lib/storyArchitectureEngine/stateLedger";
import { attemptStatusTransition, checkPlacementDeviation, switchRoute } from "@/lib/storyArchitectureEngine/developmentLoop";

export const runtime = "nodejs";

const ARCHITECTURE_MESSAGE_WINDOW = 20;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Server is not configured with an Anthropic API key." }, { status: 500 });
    }
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const message: unknown = body?.message;
    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Request must include a non-empty `message`." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const turnId = randomUUID();
    await appendMessage(
      storyId,
      { role: "user", content: message, ts: new Date().toISOString(), turnId },
      ARCHITECTURE_MESSAGES_COLLECTION
    );
    const recentMessages = await listMessages(storyId, ARCHITECTURE_MESSAGE_WINDOW, ARCHITECTURE_MESSAGES_COLLECTION);
```

(Every import above is a real, already-verified path — `getSystemPrompt` is confirmed at `@/lib/systemPrompt` by reading `world-chat/route.ts`'s own import line directly.)

- [ ] **Step 2: Assemble the system prompt and grounding blocks**

Add immediately after Step 1's code, still inside the `try` block:

```ts
    const p4 = normalizeP4(story.p4);
    const canon = await ingestCanon(storyId);

    let system = getSystemPrompt("sp04-sae-systemprompt.md");

    system += `\n\n[Canon Ingestion Summary - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author.]\n${canon.structuralOverview}`;

    if (!p4.onboardingComplete) {
      const onboarding = buildOnboardingOutput(canon);
      const checklistLines = onboarding.milestoneChecklist
        .map((item) => `- Step ${item.stepNumber} (${item.title}): ${item.addressable ? "addressable" : "not yet addressable"} - ${item.reason}`)
        .join("\n");
      system += `\n\n[Onboarding Pending - internal grounding only, never narrate this raw data to the author. Present this in your own words per Section 7. Milestone checklist:\n${checklistLines}\nRouting prompt: ${onboarding.routingPrompt}\nDo not develop any structural content until routing_choice is set.]`;
    } else if (p4.routing) {
      system += `\n\n[Current Routing Choice - computed by the app, trust this over re-deriving it. Internal grounding only. The author's current routing choice is "${p4.routing.routingChoice}". Keep reporting this same value unless the author explicitly changes it.]`;
    }
```

- [ ] **Step 3: Call the model**

Add immediately after Step 2's code:

```ts
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = recentMessages.map((m) => ({
      role: m.role,
      content: m.context ? `${m.content}\n\n[Your internal reasoning for that turn: ${m.context}]` : m.content,
    }));

    const delta = await extractTurn({
      anthropic,
      model: "claude-sonnet-5",
      system,
      messages,
      tool: EMIT_ARCHITECTURE_TURN_TOOL,
      schema: ArchitectureTurnSchema,
    });
```

- [ ] **Step 4: The onboarding clamp, routing state, and status-transition wiring**

Add immediately after Step 3's code — this is the deterministic post-processing (Decisions 2, 4, 5, 6, 7):

```ts
    let effectiveOnboardingComplete = p4.onboardingComplete;
    let effectiveRouting = p4.routing;
    let effectiveUnit: StructuralUnit | null = null;
    let placementFlag: { flagged: boolean; message: string | null } = { flagged: false, message: null };
    let units = story.p4Units ?? [];

    try {
      // Onboarding gate: flips once, on the first non-null routing_choice
      // report (Decision 2). Never set back to false.
      if (!effectiveOnboardingComplete && delta.routing_choice) {
        effectiveOnboardingComplete = true;
        await setP4OnboardingComplete(storyId, true);
      }

      // Routing state: only meaningful once onboarding is genuinely done.
      // Only writes when the choice actually changes - sp04 instructs the
      // model to keep reporting the same value every subsequent turn, so
      // writing unconditionally would mean a Firestore write on every
      // single turn of an ordinary conversation for no behavioral reason.
      if (effectiveOnboardingComplete && delta.routing_choice) {
        const routingChanged = !effectiveRouting || effectiveRouting.routingChoice !== delta.routing_choice;
        if (routingChanged) {
          effectiveRouting = effectiveRouting
            ? switchRoute(effectiveRouting, delta.routing_choice)
            : { routingChoice: delta.routing_choice };
          await setP4Routing(storyId, effectiveRouting);
        }
      }

      // Structural unit + status transition: clamped to null entirely
      // until onboarding is genuinely complete (Decision 2's backstop),
      // regardless of what the model proposed this turn.
      if (effectiveOnboardingComplete && delta.proposed_unit) {
        const proposed = delta.proposed_unit;
        const existing = findUnit(units, proposed.unit_id);
        const base = existing ?? createUnit(proposed.unit_id, proposed.type);
        const withContent = addCanonRefs(setUnitContent(base, proposed.content), proposed.canon_refs);

        const attempt = attemptStatusTransition(withContent, proposed.requested_status, {
          valid: delta.validation_result === "passed",
          reason: delta.validation_reason,
        });

        units = upsertUnit(units, attempt.unit);
        await setP4Units(storyId, units);
        effectiveUnit = attempt.unit;

        if (proposed.proposed_position_percent !== null) {
          const step = STRUCTURAL_STEPS.find((s) => s.stepNumber === delta.active_step_number);
          if (step) {
            placementFlag = checkPlacementDeviation(step, proposed.proposed_position_percent);
          }
        }
      }
    } catch (stateErr) {
      console.warn(`[architecture-chat] state update failed for turn ${turnId}:`, stateErr);
    }
```

- [ ] **Step 5: Persist the assistant message and respond**

Add immediately after Step 4's code:

```ts
    await appendMessage(
      storyId,
      { role: "assistant", content: delta.reply, context: delta.context, ts: new Date().toISOString(), turnId },
      ARCHITECTURE_MESSAGES_COLLECTION
    );

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      routing_choice: effectiveRouting?.routingChoice ?? null,
      active_step_number: delta.active_step_number,
      unit: effectiveUnit,
      placementFlag,
      deferredItems: delta.deferred_items,
    });
  } catch (err) {
    if (err instanceof RateLimitTimeoutError) {
      console.warn("Anthropic rate-limit gate timed out:", err);
      return NextResponse.json(
        { error: "StoriMac is handling a lot of requests right now — please try again in a moment." },
        { status: 503 }
      );
    }
    if (err instanceof TurnValidationError) {
      console.error("Architecture turn extraction failed:", err);
      return NextResponse.json(
        { error: "The conversation couldn't produce a valid response. Please try again." },
        { status: 502 }
      );
    }
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace, by reading the code (this is deterministic wiring, fully traceable without a real model call):
1. `p4.onboardingComplete = false`, model reports `routing_choice: null`, `proposed_unit` non-null → `effectiveOnboardingComplete` stays `false`, the `proposed_unit` branch is skipped entirely (the outer `if (effectiveOnboardingComplete && ...)` guard), `effectiveUnit` stays `null` in the response — confirms Decision 2's clamp.
2. Same story, next turn: model reports `routing_choice: "A"` → `effectiveOnboardingComplete` flips to `true` and is persisted; since this is the SAME turn, the very next `if (effectiveOnboardingComplete && delta.proposed_unit)` check on this same turn's `proposed_unit` (if also non-null) would now pass — confirm by reading the code whether this is the intended behavior (a routing choice and a first structural proposal arriving in the same turn is plausible) or whether it should require the routing choice to have been set on a STRICTLY EARLIER turn. Per Decision 2's own reasoning ("the first time the model reports a non-null routing_choice"), allowing the same-turn combination is consistent with the design (the clamp only exists to stop content BEFORE any routing choice at all, not to force an extra turn) — but trace it explicitly and confirm the code matches this intent, since issue #49's own final review found exactly this kind of same-turn-ordering bug once already.
3. `validation_result: "failed"` with `requested_status: "Confirmed"` → `attemptStatusTransition` returns `accepted: false`, and `attempt.unit` is the ORIGINAL unit unchanged (per `developmentLoop.ts`'s own doc comment) — confirm `units = upsertUnit(units, attempt.unit)` therefore persists no status change.
4. `RateLimitTimeoutError`/`TurnValidationError` thrown from inside `extractTurn` → confirm both are caught before the generic `errorResponse(err)` fallback, matching `world-chat/route.ts`'s exact precedent.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/api/architecture-chat/route.ts
git commit -m "feat: add the live P4 architecture chat route (issue #111)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 5: Compile route

**Files:**
- Create: `web/src/app/api/architecture-chat/document/route.ts`

**Interfaces:**
- Consumes: `compileScreenplayArchitectureDocument` (`@/lib/storyArchitectureEngine/compileArchitectureDocument`), `ingestCanon`, `getStory` (Task 3), `getMembership`, `requireUser`, `errorResponse`.
- Produces: `POST /api/architecture-chat/document` (body `{ storyId }`) → `{ markdown, outstandingCount }`. Task 6's UI calls this.

- [ ] **Step 1: Create the route**

Create `web/src/app/api/architecture-chat/document/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { ingestCanon } from "@/lib/storyArchitectureEngine/ingestCanon";
import { compileScreenplayArchitectureDocument } from "@/lib/storyArchitectureEngine/compileArchitectureDocument";

export const runtime = "nodejs";

/** Compiles the current Screenplay Architecture Document on demand (issue #111, Decision 3) - no versioning/storage yet, matching compileArchitectureDocument.ts's own current on-demand, non-persisted shape. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const canon = await ingestCanon(storyId);
    const compiled = compileScreenplayArchitectureDocument(storyId, canon, story.p4Units ?? []);
    return NextResponse.json(compiled);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace by reading the code: confirm `story.p4Units ?? []` correctly handles a Story with no units yet (the field is optional/nullable per Task 3), and confirm the response shape `{ markdown, outstandingCount }` matches `CompiledDocument`'s actual type exactly (no extra/missing fields).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/architecture-chat/document/route.ts
git commit -m "feat: add the P4 compile route (issue #111)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 6: Chat UI

**Files:**
- Create: `web/src/components/ArchitectureInterview.tsx`
- Create: `web/src/app/story-architecture/page.tsx`

**Interfaces:**
- Consumes: `POST /api/architecture-chat` and `POST /api/architecture-chat/document` (Tasks 4/5), `downloadText` (`@/lib/download`, already established).

This is a new, self-contained component — not an extension of an existing file, so there's no established JSX to preserve. Keep it deliberately simple relative to `WorldInterview.tsx`'s accumulated complexity (this is the FIRST P4 UI; it does not need WCL/pillar-style side panels, docx/PDF export, or a confirm-gate — just a working conversation plus the milestone checklist/routing state and a Compile button).

- [ ] **Step 1: Create the page wrapper**

Create `web/src/app/story-architecture/page.tsx`, mirroring `web/src/app/world-bible/page.tsx` exactly:

```tsx
import { Suspense } from "react";
import ArchitectureInterview from "@/components/ArchitectureInterview";

export const metadata = {
  title: "Story Architecture — Storimac",
};

export default function StoryArchitecturePage() {
  return (
    <Suspense fallback={null}>
      <ArchitectureInterview />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create the chat component**

Create `web/src/components/ArchitectureInterview.tsx`. Read `web/src/components/WorldInterview.tsx`'s opening ~130 lines first (the `workspaceId`/`canvasId` query-param pattern, the `useSearchParams`/`useUser` imports, the resume `useEffect` fetching the canvas) to match this app's established "load a Story Canvas from the URL" convention exactly, then build a deliberately smaller component:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import { downloadText } from "@/lib/download";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface TurnResponse {
  reply: string;
  context: string;
  routing_choice: "A" | "B" | "C" | null;
  active_step_number: number | null;
  unit: { unitId: string; type: string; status: string } | null;
  placementFlag: { flagged: boolean; message: string | null };
  deferredItems: { item: string; defer_to_project: string | null; notes: string }[];
}

export default function ArchitectureInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");
  const { setLastProject } = useUser();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routingChoice, setRoutingChoice] = useState<"A" | "B" | "C" | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [placementFlag, setPlacementFlag] = useState<{ flagged: boolean; message: string | null } | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<{ markdown: string; outstandingCount: number } | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    setLastProject("story-architecture");
  }, [workspaceId, canvasId, setLastProject]);

  async function sendMessage() {
    if (!canvasId || !input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/architecture-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data: TurnResponse & { error?: string } = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't reach the server.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setRoutingChoice(data.routing_choice);
      setActiveStep(data.active_step_number);
      setPlacementFlag(data.placementFlag.flagged ? data.placementFlag : null);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function compileDocument() {
    if (!canvasId || compiling) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const res = await fetch("/api/architecture-chat/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompileError(data.error ?? "Compile failed.");
        return;
      }
      setCompiled(data);
    } catch {
      setCompileError("Couldn't reach the server.");
    } finally {
      setCompiling(false);
    }
  }

  if (!workspaceId || !canvasId) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4 bg-neutral-950 text-neutral-100">
        <p className="text-sm text-neutral-400">
          No Story Canvas selected. Start from onboarding to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <p className="text-sm font-semibold text-neutral-200">Story Architecture</p>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span>Routing: {routingChoice ?? "not chosen yet"}</span>
          <span>Active Step: {activeStep ?? "—"}</span>
          <button
            onClick={compileDocument}
            disabled={compiling}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compiling ? "Compiling…" : "Compile"}
          </button>
        </div>
      </div>

      {placementFlag?.message && (
        <div className="border-b border-amber-500/30 bg-amber-950/30 px-6 py-2 text-xs text-amber-200">
          {placementFlag.message}
        </div>
      )}

      {compiled && (
        <div className="border-b border-purple-500/30 bg-purple-950/20 px-6 py-3 text-xs text-purple-200">
          <p className="mb-2">
            Compiled — {compiled.outstandingCount} outstanding item{compiled.outstandingCount === 1 ? "" : "s"}.
          </p>
          <button
            onClick={() => downloadText("screenplay-architecture.md", compiled.markdown, "text/markdown")}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
          >
            Download .md
          </button>
        </div>
      )}
      {compileError && <p className="border-b border-red-500/30 px-6 py-2 text-xs text-red-400">{compileError}</p>}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.map((m, i) => (
          <div key={i} className={`mb-4 ${m.role === "user" ? "text-right" : "text-left"}`}>
            <p className="inline-block max-w-2xl rounded-xl bg-neutral-900 px-4 py-2 text-sm text-neutral-200">
              {m.content}
            </p>
          </div>
        ))}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <div className="border-t border-neutral-800 px-6 py-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            disabled={loading}
            placeholder="Message the Screenplay Structural Architect…"
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
          />
          <button
            onClick={sendMessage}
            disabled={loading}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-4 py-2 text-sm font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

(This intentionally does not resume/hydrate an existing message history from Firestore on load — every other project's own first-cut chat UI (before later issues added resume-on-reload) started the same way; a resume effect can be added as a fast follow-up once this baseline works, matching how issue #50's own resume gap for compiled documents was itself a later fix, not part of the original baseline. Disclose this explicitly in the report rather than silently, since a real conversation needs it eventually.)

- [ ] **Step 3: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

For browser verification, follow the same network-mock approach every prior UI task in this session's P3 work used (no Firestore emulator/test credentials in this sandbox): mock both `/api/architecture-chat` and `/api/architecture-chat/document`, drive the real component with `workspaceId`/`canvasId` query params present, and confirm: (a) typing and sending a message appends it and the mocked reply to the message list; (b) the routing/active-step header updates from the mocked response; (c) a mocked `placementFlag.flagged: true` renders its message; (d) clicking Compile calls the document route and renders the download button; (e) clicking Download .md calls `downloadText` with the exact filename and MIME type. Clearly disclose what you could not verify end-to-end (a full live conversation exercising the actual system prompt/model behavior — see the plan's own Testing section) rather than fabricating it.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ArchitectureInterview.tsx web/src/app/story-architecture/page.tsx
git commit -m "feat: add the P4 Story Architecture chat UI (issue #111)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.
