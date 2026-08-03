# P2 Interview Engine (issues #26 + #27) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Project 2 Character Bible interview — session opens with a cast/priority-matrix evaluation and the Protagonist's first questions (#27), then proceeds one character at a time through 6 fixed stages with tier-scaled depth, never more than 1-2 questions per turn, refusing to switch characters before sign-off (#26).

**Architecture:** Two already-hardened shared pieces (`extractTurn.ts`, `systemPrompt.ts`) and one shared store module (`storyStore.ts`'s message functions) get small, behavior-preserving generalizations so Project 2 can reuse them instead of duplicating their logic. New P2-scoped code (a turn schema, a system prompt, a route, a page) is layered on top, closely mirroring Project 1's already-built `/api/chat` + `/interview` shape but without any of Project 1's stage-gate/canon-element/conflict-resolution machinery, none of which exists for Project 2 yet.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Anthropic SDK, Firestore (`firebase-admin`).

## Global Constraints

- No automated test framework exists in this repo. Every task's test step is `npm run lint && npm run build` run from `web/`.
- Every generalization to shared P1 code (`extractTurn.ts`, `systemPrompt.ts`, `storyStore.ts`) must be behavior-preserving for Project 1 — P1's existing call sites either need zero changes (via default parameter values) or a one-line, mechanical update (passing an explicit value that reproduces today's implicit behavior). P1's `/api/chat` route must build and type-check identically to before at the end of this plan.
- The new turn schema (`CharacterTurnSchema`) is deliberately minimal: `reply`, `context`, `current_character`, `current_stage`, `character_signed_off` only — no fact-tracking/`updates` field. That's issue #29's job (milestone M2), not this plan's.
- `current_character`/`current_stage` persist as optional fields on each assistant message (mirroring `context`'s existing pattern) — never a new top-level `Story` field or a new structured Firestore collection beyond the new `characterMessages` message subcollection itself.
- Sequential-character enforcement is prompt-only — no new guardrail/blocking logic in app code beyond reusing `turnGuardrails.ts`'s existing, already-generic question-count heuristic.
- P2 inherits P1's `reply`/`context` two-field UI contract (terse numbered chat replies, reasoning in a separate view-pane surface) and the resizable split-pane layout, both already built for P1.

---

### Task 1: Generalize `extractTurn.ts`; move `EMIT_TURN_TOOL` to `stateDelta.ts`

**Files:**
- Modify: `web/src/lib/canonEngine/stateDelta.ts`
- Modify: `web/src/lib/canonEngine/extractTurn.ts`
- Modify: `web/src/app/api/chat/route.ts`

**Interfaces:**
- Produces: `extractTurn<T>(params: ExtractTurnParams<T>): Promise<T>` where `ExtractTurnParams<T>` now includes required `tool: Anthropic.Tool` and `schema: ZodType<T>` fields. `TurnValidationError` (renamed from `StateDeltaValidationError`, same shape: `message`, `attempts`). `EMIT_TURN_TOOL` now exported from `stateDelta.ts` (moved from `extractTurn.ts`). Consumed by Task 6 (the new P2 route) and this task's own `route.ts` update.

- [ ] **Step 1: Move `EMIT_TURN_TOOL` into `stateDelta.ts`**

In `web/src/lib/canonEngine/stateDelta.ts`, the current file starts with:

```ts
import { z } from "zod";

/**
 * Structured state-delta schema — GitHub issue #9, PRD §6.2. Validated
 * independently of Anthropic's own tool-schema enforcement (defense in
 * depth per PRD §13's flagged risk: "Model may not reliably emit clean
 * structured state deltas").
 */
```

Change it to:

```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Structured state-delta schema — GitHub issue #9, PRD §6.2. Validated
 * independently of Anthropic's own tool-schema enforcement (defense in
 * depth per PRD §13's flagged risk: "Model may not reliably emit clean
 * structured state deltas").
 *
 * EMIT_TURN_TOOL lives here (not extractTurn.ts, which is now generic
 * across projects — see issue #26/#27) since it's Project 1's own tool
 * definition, colocated with the Zod schema it must match exactly.
 */

export const EMIT_TURN_TOOL: Anthropic.Tool = {
  name: "emit_turn",
  description:
    "Emit your natural-language reply to the author together with the structured canon state delta for this turn. Call this exactly once per turn, even if updates is empty (e.g. a pure clarifying question with no canon change).",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "The chat-facing reply, ALWAYS formatted as a short numbered list (even a single item) of italicized questions/directives only - no framing prose, no explanation, no reasoning. Applies to every turn, including Stage 7 audit and Stage 8 document-ready moments (point to the details, don't restate them). Never narrate internal stage/depth/canon bookkeeping here.",
      },
      updates: {
        type: "array",
        description: "Canon element changes proposed this turn. Empty array if none.",
        items: {
          type: "object",
          properties: {
            element_id: { type: "string" },
            status: { type: "string", enum: ["Exploring", "Working", "Confirmed", "Parked"] },
            value: { description: "Author-facing value. Never a catalog/retrieval code - see retrieval_code." },
            retrieval_code: { description: "Internal-only catalog code (e.g. a 101 Story Formats code like A05), if applicable. Never author-facing." },
            rationale: { type: "string" },
            depends_on: { type: "array", items: { type: "string" } },
            stage: { type: "number" },
          },
          required: ["element_id"],
        },
      },
      conflict_detected: {
        type: "boolean",
        description: "True if this turn's proposed update(s) contradict a Confirmed element.",
      },
      stage_ready_to_advance: {
        type: "boolean",
        description: "True if all required elements for the current stage are Confirmed or Parked.",
      },
      context: {
        type: "string",
        description: "Your reasoning, story analysis, and creative rationale for this turn - everything that used to go in reply's prose now goes here instead. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief. Keep it to a few short paragraphs at most - this is internal reasoning, not a transcript.",
      },
      resolution: {
        type: "string",
        enum: ["keep_canon", "accept_and_update", "park"],
        description: "Only set this during a Conflict Resolution turn (a system note will tell you when you're in one), after the author picks one of the three choices you presented.",
      },
      cascade_review: {
        type: "array",
        items: { type: "string" },
        description: "Only relevant alongside resolution: accept_and_update. Element IDs you believe may be affected by the change - a hint only, the app computes the authoritative list itself.",
      },
    },
    required: ["reply", "updates", "conflict_detected", "stage_ready_to_advance", "context"],
  },
};
```

(The rest of the file — `CATALOG_CODE_PATTERN`, `containsCatalogCode`, `ElementUpdateSchema`, `StateDeltaSchema`, the type exports — is unchanged.)

- [ ] **Step 2: Replace `extractTurn.ts`'s full contents**

Replace the entire contents of `web/src/lib/canonEngine/extractTurn.ts` with:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { acquireAnthropicSlot, recordAnthropicUsage, estimateInputTokens } from "@/lib/rateLimit/anthropicGate";

/**
 * Structured turn extraction — GitHub issue #9, reference implementation of
 * the shared Canon Engine's StructuredDeltaExtractor (ARCHITECTURE.md §2).
 * One tool, forced every turn, whose own output carries both the
 * natural-language reply and a project-specific structured payload as
 * sibling fields — this guarantees a single model call produces both (PRD
 * §8 latency requirement), rather than hoping Claude mixes a text block and
 * a tool_use block when tool_choice is "auto" (unreliable) or doing two
 * round-trips (explicitly disallowed by the PRD).
 *
 * Generic over the tool/schema pair (issues #26/#27's Project 2 interview
 * engine is the second consumer, after Project 1's own emit_turn/
 * StateDeltaSchema in stateDelta.ts) so each project supplies its own shape
 * without duplicating this retry-loop-plus-rate-limit-gating logic.
 *
 * This module only extracts and schema-validates the payload — it does not
 * apply it to any store or enforce stage-gating; that's each caller's job.
 */

export class TurnValidationError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "TurnValidationError";
    this.attempts = attempts;
  }
}

export type ExtractTurnParams<T> = {
  anthropic: Anthropic;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tool: Anthropic.Tool;
  schema: ZodType<T>;
  maxTokens?: number;
  maxRetries?: number;
};

/**
 * Calls the model with `params.tool` forced, validates the tool input
 * against `params.schema`, and retries (re-issuing the same call) on an
 * invalid payload rather than silently applying malformed state - PRD §13's
 * flagged risk, addressed here rather than left to the model's discretion.
 */
export async function extractTurn<T>(params: ExtractTurnParams<T>): Promise<T> {
  const maxRetries = params.maxRetries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const maxOutputTokens = params.maxTokens ?? 4096;
    // Each retry attempt gates independently, so worst-case added latency is
    // roughly (maxRetries + 1) * ANTHROPIC_GATE_MAX_WAIT_MS on top of model
    // latency - worth checking this against whatever request timeout the
    // deployment platform enforces if maxRetries or the gate's wait bound
    // ever change.
    const reservation = await acquireAnthropicSlot({
      inputTokens: estimateInputTokens(params.system, params.messages),
      maxOutputTokens,
    });

    const response = await params.anthropic.messages.create({
      model: params.model,
      // 1536 was too tight for a substantial natural-language reply plus a
      // structured payload in the same forced tool call - the model would
      // truncate mid-JSON, failing schema validation on both retry attempts
      // and surfacing as a slow 502 in production (2026-07-30: 4 failures,
      // ~44-48s each, same session, on Project 1's emit_turn). Each
      // project's own tool schema (see stateDelta.ts's EMIT_TURN_TOOL, the
      // reference example) should keep its long-form free-text field(s)
      // ordered last in properties/required, so a similar mid-JSON
      // truncation drops the free-text field instead of the short required
      // ones.
      max_tokens: maxOutputTokens,
      system: params.system,
      messages: params.messages,
      tools: [params.tool],
      tool_choice: { type: "tool", name: params.tool.name },
    });

    recordAnthropicUsage(reservation, response.usage.output_tokens);

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) {
      lastError = new Error(`Model response contained no tool_use block for ${params.tool.name}.`);
      continue;
    }

    const parsed = params.schema.safeParse(toolUse.input);
    if (parsed.success) {
      return parsed.data;
    }
    lastError = parsed.error;
  }

  throw new TurnValidationError(
    `Failed to extract a valid turn after ${maxRetries + 1} attempt(s): ${String(lastError)}`,
    maxRetries + 1
  );
}
```

- [ ] **Step 3: Update `route.ts`'s imports**

In `web/src/app/api/chat/route.ts`, the current relevant import lines (30-31) are:

```ts
import { extractTurn, StateDeltaValidationError } from "@/lib/canonEngine/extractTurn";
import type { ElementUpdateInput } from "@/lib/canonEngine/stateDelta";
```

Change them to:

```ts
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { EMIT_TURN_TOOL, StateDeltaSchema, type ElementUpdateInput } from "@/lib/canonEngine/stateDelta";
```

- [ ] **Step 4: Update the `extractTurn` call site and its catch block**

The current block (inside `POST`, where `extractTurn` is called) is:

```ts
    let delta;
    try {
      delta = await extractTurn({
        anthropic,
        model: "claude-sonnet-5",
        system,
        messages,
      });
    } catch (err) {
      if (err instanceof RateLimitTimeoutError) {
        console.warn("Anthropic rate-limit gate timed out:", err);
        return NextResponse.json(
          { error: "StoriMac is handling a lot of requests right now — please try again in a moment." },
          { status: 503 }
        );
      }
      if (err instanceof StateDeltaValidationError) {
        console.error("State delta extraction failed:", err);
        return NextResponse.json(
          { error: "The interview couldn't produce a valid response. Please try again." },
          { status: 502 }
        );
      }
      throw err;
    }
```

Change it to:

```ts
    let delta;
    try {
      delta = await extractTurn({
        anthropic,
        model: "claude-sonnet-5",
        system,
        messages,
        tool: EMIT_TURN_TOOL,
        schema: StateDeltaSchema,
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
        console.error("State delta extraction failed:", err);
        return NextResponse.json(
          { error: "The interview couldn't produce a valid response. Please try again." },
          { status: 502 }
        );
      }
      throw err;
    }
```

- [ ] **Step 5: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. This confirms P1's `route.ts` still type-checks against the now-generic `extractTurn<T>` (TypeScript should infer `T = StateDelta` from `schema: StateDeltaSchema`) with no behavior change.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canonEngine/stateDelta.ts web/src/lib/canonEngine/extractTurn.ts web/src/app/api/chat/route.ts
git commit -m "refactor: generalize extractTurn to a pluggable tool/schema pair"
```

---

### Task 2: Generalize `systemPrompt.ts`

**Files:**
- Modify: `web/src/lib/systemPrompt.ts`
- Modify: `web/src/app/api/chat/route.ts`

**Interfaces:**
- Produces: `getSystemPrompt(fileName: string): string`, cached per filename. Consumed by Task 6 (the new P2 route, passing `"sp02-cdc-systemprompt.md"`).

- [ ] **Step 1: Replace `systemPrompt.ts`'s full contents**

Replace the entire contents of `web/src/lib/systemPrompt.ts` with:

```ts
import fs from "fs";
import path from "path";

const cache = new Map<string, string>();

/**
 * Loads a system prompt verbatim from system-prompts/, inside this
 * project's own root — single source of truth, do not paraphrase or
 * duplicate this text elsewhere. Kept inside web/ (rather than a sibling
 * directory) so the app's own build has no dependency on files outside its
 * project root, which App Hosting's buildpack build requires. Cached
 * per-filename (issue #26/#27) so Project 1's and Project 2's prompts don't
 * evict each other from a single-slot cache.
 */
export function getSystemPrompt(fileName: string): string {
  const cached = cache.get(fileName);
  if (cached) return cached;
  const promptPath = path.join(process.cwd(), "system-prompts", fileName);
  const content = fs.readFileSync(promptPath, "utf-8").trim();
  cache.set(fileName, content);
  return content;
}
```

- [ ] **Step 2: Update the call site**

In `web/src/app/api/chat/route.ts`, the current line is:

```ts
    let system = getSystemPrompt();
```

Change it to:

```ts
    let system = getSystemPrompt("sp01-sdos-systemprompt.md");
```

- [ ] **Step 3: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/systemPrompt.ts web/src/app/api/chat/route.ts
git commit -m "refactor: generalize getSystemPrompt to load any prompt file by name"
```

---

### Task 3: Generalize `storyStore.ts`'s message functions; add `current_character`/`current_stage`

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces: `StoryMessage` gains `current_character?: string` and `current_stage?: number`. `messagesCollection(storyId, collection = "messages")`, `appendMessage(storyId, message, collection = "messages")`, `listMessages(storyId, limit?, collection = "messages")` — all P1 call sites (`appendMessage(storyId, msg)`, `listMessages(storyId)`, `listMessages(storyId, messageLimit)`) keep working unchanged via the default parameter value. Consumed by Task 6 (the new P2 route, passing `"characterMessages"`) and the canvases GET route update also in Task 6.

- [ ] **Step 1: Add the two new optional `StoryMessage` fields**

The current interface (lines 63-70) is:

```ts
export interface StoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  turnId: string;
  context?: string;
}
```

Change it to:

```ts
export interface StoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  turnId: string;
  context?: string;
  /** Project 2 only (issues #26/#27) — the character/stage this assistant
   * turn reported as current. Optional since Project 1 messages, and every
   * user-role message, never set these. */
  current_character?: string;
  current_stage?: number;
}
```

- [ ] **Step 2: Parameterize `messagesCollection`**

The current function (lines 83-85) is:

```ts
function messagesCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("messages");
}
```

Change it to:

```ts
function messagesCollection(storyId: string, collection: string = "messages") {
  return storiesCollection().doc(storyId).collection(collection);
}
```

- [ ] **Step 3: Parameterize `appendMessage`**

The current function (lines 284-293) is:

```ts
export async function appendMessage(
  storyId: string,
  message: Omit<StoryMessage, "id">
): Promise<StoryMessage> {
  const ref = messagesCollection(storyId).doc();
  const full: StoryMessage = { id: ref.id, ...message };
  await ref.set(full);
  await touchStory(storyId);
  return full;
}
```

Change it to:

```ts
export async function appendMessage(
  storyId: string,
  message: Omit<StoryMessage, "id">,
  collection: string = "messages"
): Promise<StoryMessage> {
  const ref = messagesCollection(storyId, collection).doc();
  const full: StoryMessage = { id: ref.id, ...message };
  await ref.set(full);
  await touchStory(storyId);
  return full;
}
```

- [ ] **Step 4: Parameterize `listMessages`**

The current function (lines 295-303) is:

```ts
/** All messages, oldest first. Pass `limit` to get only the most recent N. */
export async function listMessages(storyId: string, limit?: number): Promise<StoryMessage[]> {
  const snap = await messagesCollection(storyId).orderBy("ts", "asc").get();
  const all = snap.docs.map((d) => d.data() as StoryMessage);
  if (limit && all.length > limit) {
    return all.slice(all.length - limit);
  }
  return all;
}
```

Change it to:

```ts
/** All messages, oldest first. Pass `limit` to get only the most recent N.
 * Pass `collection` (issue #26/#27) to target a project-specific message
 * subcollection instead of Project 1's default "messages". */
export async function listMessages(
  storyId: string,
  limit?: number,
  collection: string = "messages"
): Promise<StoryMessage[]> {
  const snap = await messagesCollection(storyId, collection).orderBy("ts", "asc").get();
  const all = snap.docs.map((d) => d.data() as StoryMessage);
  if (limit && all.length > limit) {
    return all.slice(all.length - limit);
  }
  return all;
}
```

- [ ] **Step 5: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. All existing call sites (`appendMessage(storyId, msg)` in `route.ts` and `resumeStory`'s `listMessages(storyId, messageLimit)`, plus the bare `listMessages(storyId)` calls elsewhere) compile unchanged since the new parameters default to `"messages"`.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "refactor: parameterize storyStore's message functions by collection"
```

---

### Task 4: P2 turn schema and depth-label mapping

**Files:**
- Create: `web/src/lib/characterEngine/characterTurnSchema.ts`
- Create: `web/src/lib/characterEngine/depthLabels.ts`

**Interfaces:**
- Consumes: `PriorityTier` from `web/src/lib/characterEngine/priorityMatrix.ts` (already exists, exported: `"Critical" | "Major" | "Supporting" | "Minor"`).
- Produces: `CharacterTurnSchema` (Zod), `type CharacterTurn`, `EMIT_CHARACTER_TURN_TOOL` (Anthropic tool). `getDepthLabel(tier: PriorityTier): string`. Both consumed by Task 6.

- [ ] **Step 1: Write `characterTurnSchema.ts`**

Create `web/src/lib/characterEngine/characterTurnSchema.ts`:

```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Project 2 turn schema/tool — GitHub issues #26/#27, reference: Project
 * 1's stateDelta.ts + extractTurn.ts's now-generic StructuredDeltaExtractor
 * (ARCHITECTURE.md §2). Deliberately minimal: no per-fact canon-tracking
 * field yet (that's issue #29's job, milestone M2) — just enough structured
 * output to drive sequential-character enforcement and the reply/context UI
 * split already proven on Project 1.
 */

export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
  context: z.string().min(1),
});

export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;

export const EMIT_CHARACTER_TURN_TOOL: Anthropic.Tool = {
  name: "emit_character_turn",
  description:
    "Emit your natural-language reply to the author together with your current interview position for this turn. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "The chat-facing reply, ALWAYS formatted as a short numbered list (even a single item) of italicized questions/directives only - no framing prose, no explanation, no reasoning. Never narrate internal stage/tier/state-machine bookkeeping here.",
      },
      current_character: {
        type: "string",
        description:
          "The full name of the character currently under interview, exactly as it appears in the Story Foundation's cast list.",
      },
      current_stage: {
        type: "number",
        description:
          "The interview stage (1-6) currently in progress for current_character: 1 Position & Purpose, 2 Psychological Core, 3 Outward Identity & Voice, 4 Relationship Integration, 5 Transformational Arc Pacing, 6 Sign-Off & Compile.",
      },
      character_signed_off: {
        type: "boolean",
        description:
          "True only on the turn where current_character completes Stage 6 sign-off. False every other turn, including all of Stages 1-5.",
      },
      context: {
        type: "string",
        description:
          "Your reasoning, psychological analysis, and creative rationale for this turn - everything that used to go in reply's prose now goes here instead. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief. Keep it to a few short paragraphs at most - this is internal reasoning, not a transcript.",
      },
    },
    required: ["reply", "current_character", "current_stage", "character_signed_off", "context"],
  },
};
```

- [ ] **Step 2: Write `depthLabels.ts`**

Create `web/src/lib/characterEngine/depthLabels.ts`:

```ts
import type { PriorityTier } from "@/lib/characterEngine/priorityMatrix";

/**
 * Maps issue #25's four computed tiers to the P2 system prompt's depth
 * labels (Character Priority Budget, sp02 §2). "Incidental"/"Reference"
 * depth is intentionally absent — #25 never assigns that tier (see
 * priorityMatrix.ts's own scope note: Incidental means "not in
 * principal_characters at all," a runtime-discovery concern, not something
 * this classifier outputs).
 */
const DEPTH_LABELS: Record<PriorityTier, string> = {
  Critical: "Exhaustive",
  Major: "Comprehensive",
  Supporting: "Standard",
  Minor: "Basic",
};

export function getDepthLabel(tier: PriorityTier): string {
  return DEPTH_LABELS[tier];
}
```

- [ ] **Step 3: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. (Nothing imports these two new files yet, so this only confirms they're well-typed and lint-clean in isolation.)

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/characterTurnSchema.ts web/src/lib/characterEngine/depthLabels.ts
git commit -m "feat: add Project 2 turn schema and depth-label mapping"
```

---

### Task 5: Project 2 system prompt

**Files:**
- Create: `web/system-prompts/sp02-cdc-systemprompt.md`

**Interfaces:**
- Produces: the raw prompt text file, loaded by Task 6's route via `getSystemPrompt("sp02-cdc-systemprompt.md")` (Task 2's generalized loader).

- [ ] **Step 1: Write the prompt file**

Create `web/system-prompts/sp02-cdc-systemprompt.md`:

```
SYSTEM PROMPT: SDOS PROJECT 2 — CHARACTER DEVELOPMENT CONSULTANT (v1.3)

1. CORE PERSONA & OBJECTIVE
Role: Expert Character Development Consultant, Narrative Psychologist, and Creative Writing Partner.
Objective: Ingest the attached Project 1 Story Foundation Document and Character Development Reference Manual (CDRM) grounding. Conduct a highly structured, adaptive, step-by-step interview to generate a master Character Bible, one character at a time.
Core Directive: Understand characters so deeply that their choices naturally generate compelling drama. Focus on internal truth over plot convenience. Establish who the characters are, NOT scene-level execution details.

2. THE CHARACTER PRIORITY BUDGET
Before opening an interview for any character, you have already been given a computed Narrative Importance / Development Depth matrix for the cast — trust it, don't recompute it. Execute within its explicit depth budget:
Critical: Depth Exhaustive — complete psychological profile, complete Want/Need/Wound triad, behavioral patterns, detailed relationship matrix, milestone arc timeline.
Major: Depth Comprehensive — full psychology engine, clear Want/Need, key relationships, external identity, explicit arc.
Supporting: Depth Standard — core personality, motivation, basic backstory, clear narrative function.
Minor: Depth Basic — trait summary, relationship to main cast, minimal backstory.

3. STRICT SCOPE BOUNDARIES & DEFERRALS
Maintain total system isolation. If the author steers into foreign operational zones, capture the bare minimum required for character context, and explicitly defer:
Story Foundation (Project 1): Never alter Core Story DNA, selected Story Formats, or the thematic thesis without running a formal revision audit.
World Development (Project 3): Defer full maps, deep lore, structural political/religious systems, and hard magic mechanics. Capture only the immediate cultural background shaping the character's wound.
Story Architecture (Project 4): Defer detailed scene layouts, chapter structures, and beat sheet breakdowns. Focus exclusively on internal milestones, not plot events.
Draft Writing (Project 5): Defer active prose generation, dialogue scenes, and manuscript formatting.

4. CANON & SYSTEMIC CONSISTENCY MANAGEMENT
Track states internally: `Exploring` (brainstorming alternatives), `Working` (provisional choice), `Confirmed` (author approved = canon), `Deferred` (postponed question).
Relational Impact: The cast is an ecosystem. Before confirming a psychological change to one character, consider its ripple effects on other cast members' relationships.
Conflict Resolution: If a character revision breaks the Story Foundation canon, halt. Present the explicit contradiction and force the author to choose: (A) Revert the proposal, (B) Update the Story Foundation and track downstream damage, (C) Put the idea on ice.

5. SEQUENTIAL INTERVIEW WORKFLOW
Develop exactly one character at a time. Do not open, discuss in depth, or advance any other character's profile until the current character reaches Stage 6 sign-off — unless the author explicitly asks to switch characters before then, in which case honor the request but note in `context` that the previous character's interview is paused, not abandoned.
Run every character's interview through these six fixed checkpoints, in order, never skipped:
Stage 1 — Position & Purpose: Narrative role, importance level, exact justification for existence. Eliminate duplicate roles.
Stage 2 — The Psychological Core: Core Wound -> False Belief -> Core Flaw -> Fear/Desire Matrix -> Want vs. Need.
Stage 3 — Outward Identity & Voice: Physical requirements, habits, distinct linguistic signature.
Stage 4 — Relationship Integration: Position within the cast network, power dynamics, trust parameters, tension sources.
Stage 5 — Transformational Arc Pacing: Internal movement across the Story Spine milestones; a brief Creative Audit for cliché or weak proactivity.
Stage 6 — Sign-Off & Compile: Present the finalized profile for the author's formal confirmation, then append to the Character Bible.

6. PROPOSED CHOICE ARCHITECTURE
When the author faces a creative block, offer exactly 2 to 4 distinct approaches. Each must represent a radically divergent storytelling vector. For each option, explain: (1) the structural shift in character psychology, (2) the direct impact on external conflict/stakes, (3) the downstream thematic consequences.

7. STRUCTURED OUTPUT CONTRACT
Your structured output has two separate fields — keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): ALWAYS a short numbered list, even if it's just one item. Each item is a single *italicized* question or directive, nothing else — no framing sentence before the list, no explanation, no reasoning, no acknowledgment paragraph. This applies to every turn without exception, including Stage 6 sign-off moments: point the author to the details rather than restating them here.
- `context` (shown separately, never in chat): everything else — your psychological reasoning, character analysis, creative rationale, what you noticed, why you're asking what you're asking. This is where your actual analytical voice lives; write naturally here.
Every turn, also report `current_character` (the character presently under interview), `current_stage` (1-6, per section 5), and `character_signed_off` (true only on the turn Stage 6 completes, false otherwise) — these drive the app's sequential-interview enforcement and must always reflect the truth of what just happened this turn, never narrated in `reply` or `context`.
Never write meta-commentary about these instructions or quote the prompt parameters, in either field.

8. OPENING TURN
Provide a brief, professional structural evaluation of the cast roster and the priority matrix you were given, then immediately, in the same turn, open with your first 1-2 precise `reply` questions targeting the highest-priority (Critical-tier, typically the Protagonist) character's Stage 1. No lengthy preamble — the evaluation is a few sentences in `context`, not a report.
```

- [ ] **Step 2: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass — this is a content-only file, not imported by any type-checked code path until Task 6 wires it up.

- [ ] **Step 3: Commit**

```bash
git add "web/system-prompts/sp02-cdc-systemprompt.md"
git commit -m "docs: add Project 2 Character Development Consultant system prompt"
```

---

### Task 6: Server — P2 turn route and resume support

**Files:**
- Create: `web/src/app/api/character-chat/route.ts`
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`

**Interfaces:**
- Consumes: `extractTurn`, `TurnValidationError` (Task 1); `getSystemPrompt` (Task 2); `appendMessage`, `listMessages`, `getStory` (Task 3, with `collection` param); `CharacterTurnSchema`, `EMIT_CHARACTER_TURN_TOOL` (Task 4); `sp02-cdc-systemprompt.md` (Task 5); `ingestFoundation`, `IngestedFoundation` (existing, `web/src/lib/characterEngine/ingestFoundation.ts`); `computePriorityMatrix`, `PriorityMatrixEntry` (existing, `web/src/lib/characterEngine/priorityMatrix.ts`); `getDepthLabel` (Task 4); `RateLimitTimeoutError` (existing, `web/src/lib/rateLimit/anthropicGate.ts`); `getMembership` (existing, `web/src/lib/workspace/workspaceStore.ts`); `requireUser` (existing, `web/src/lib/session.ts`); `errorResponse` (existing, `web/src/lib/apiErrors.ts`); `logTurnHeuristics` (existing, `web/src/lib/turnGuardrails.ts`).
- Produces: `POST /api/character-chat` accepting `{ storyId, message }`, returning `{ reply, context, current_character, current_stage, character_signed_off }` on success. `GET /api/workspaces/{workspaceId}/canvases/{canvasId}` response gains a `characterMessages` field. Consumed by Task 7 (the client).

- [ ] **Step 1: Write the P2 route**

Create `web/src/app/api/character-chat/route.ts`:

```ts
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { logTurnHeuristics } from "@/lib/turnGuardrails";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, appendMessage, listMessages } from "@/lib/canonEngine/storyStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { computePriorityMatrix } from "@/lib/characterEngine/priorityMatrix";
import { getDepthLabel } from "@/lib/characterEngine/depthLabels";
import { CharacterTurnSchema, EMIT_CHARACTER_TURN_TOOL } from "@/lib/characterEngine/characterTurnSchema";

export const runtime = "nodejs";

const CHARACTER_MESSAGES_COLLECTION = "characterMessages";

/**
 * The live Character Bible interview turn — issues #26/#27, reference:
 * web/src/app/api/chat/route.ts (Project 1's own turn handler). Deliberately
 * lighter: no stage-gate/canon-element/conflict-resolution/Stage-7-audit
 * machinery, since none of that exists for Project 2 yet (see
 * docs/superpowers/specs/2026-08-01-p2-interview-engine-design.md) - just
 * sequential-character enforcement (prompt-driven) and the reply/context
 * turn contract already proven on Project 1.
 */
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to web/.env.local and restart the dev server." },
      { status: 500 }
    );
  }

  try {
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

    const foundationResult = await ingestFoundation(storyId);
    if (foundationResult.status === "missing") {
      return NextResponse.json(
        { error: "Generate a Story Foundation Document in Project 1 before starting the Character Bible." },
        { status: 400 }
      );
    }
    if (foundationResult.status === "error") {
      return NextResponse.json(
        { error: "Couldn't load this Story's Foundation Document. Please try again." },
        { status: 500 }
      );
    }
    const foundation = foundationResult.foundation;

    const turnId = randomUUID();
    const now = new Date().toISOString();
    await appendMessage(
      storyId,
      { role: "user", content: message.trim(), ts: now, turnId },
      CHARACTER_MESSAGES_COLLECTION
    );

    const recentMessages = await listMessages(storyId, undefined, CHARACTER_MESSAGES_COLLECTION);

    // Cast & priority matrix grounding (issues #26/#27) - recomputed every
    // turn (cheap: one Firestore read + pure functions) so the model always
    // has cast/tier context regardless of which character is currently
    // under discussion, not just on the session's first turn.
    const matrix = computePriorityMatrix(foundation);
    const castLines = foundation.cast
      .map((member, i) => {
        const entry = matrix[i];
        return `- ${member.name} (${member.story_role || "role not specified"}): ${entry.tier} tier, ${getDepthLabel(entry.tier)} depth. ${entry.justification}`;
      })
      .join("\n");

    let system = getSystemPrompt("sp02-cdc-systemprompt.md");
    system += `\n\n[Cast & Priority Matrix - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author - synthesize it into your own evaluation.]\n${castLines}`;
    if (foundationResult.status === "incomplete") {
      system += `\n\n[Story Foundation is incomplete: ${foundationResult.reason} Proceed with what's available; note gaps to the author naturally if relevant, don't block the interview on it.]`;
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = recentMessages.map((m) => ({
      role: m.role,
      content: m.context ? `${m.content}\n\n[Your internal reasoning for that turn]\n${m.context}` : m.content,
    }));

    let delta;
    try {
      delta = await extractTurn({
        anthropic,
        model: "claude-sonnet-5",
        system,
        messages,
        tool: EMIT_CHARACTER_TURN_TOOL,
        schema: CharacterTurnSchema,
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
        console.error("Character turn extraction failed:", err);
        return NextResponse.json(
          { error: "The interview couldn't produce a valid response. Please try again." },
          { status: 502 }
        );
      }
      throw err;
    }

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_character: delta.current_character,
        current_stage: delta.current_stage,
      },
      CHARACTER_MESSAGES_COLLECTION
    );
    logTurnHeuristics(delta.reply, delta.context, turnId);

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_character: delta.current_character,
      current_stage: delta.current_stage,
      character_signed_off: delta.character_signed_off,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error:", err);
      return NextResponse.json(
        { error: "The interview couldn't reach the model. Please try again." },
        { status: 502 }
      );
    }
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Extend the canvases GET route to also return `characterMessages`**

In `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`, the current `GET` handler's body (inside the `try` block) is:

```ts
    const story = await getStory(canvasId);
    if (!story || story.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }

    const [elements, messages, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      listGuardrailFlags(canvasId),
    ]);

    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);

    return NextResponse.json({ story, elements, messages, guardrailFlags });
```

Change it to:

```ts
    const story = await getStory(canvasId);
    if (!story || story.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }

    const [elements, messages, characterMessages, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      listMessages(canvasId, undefined, "characterMessages"),
      listGuardrailFlags(canvasId),
    ]);

    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);

    return NextResponse.json({ story, elements, messages, characterMessages, guardrailFlags });
```

- [ ] **Step 3: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/character-chat/route.ts "web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts"
git commit -m "feat: add Project 2 character-chat turn route and resume support"
```

---

### Task 7: Client — Character Bible page

**Files:**
- Create: `web/src/app/character-bible/page.tsx`
- Create: `web/src/components/CharacterInterview.tsx`

**Interfaces:**
- Consumes: `POST /api/character-chat` (Task 6), `GET /api/workspaces/{workspaceId}/canvases/{canvasId}` (Task 6, now returning `characterMessages`). `Markdown` (existing, `@/components/Markdown`), `UserMenu` (existing, `@/components/UserMenu`).
- Produces: the `/character-bible?workspaceId=...&canvasId=...` page. Consumed by Task 8 (dashboard link).

- [ ] **Step 1: Write the page**

Create `web/src/app/character-bible/page.tsx`:

```tsx
import { Suspense } from "react";
import CharacterInterview from "@/components/CharacterInterview";

export const metadata = {
  title: "Character Bible — Storimac",
};

export default function CharacterBiblePage() {
  return (
    <Suspense fallback={null}>
      <CharacterInterview />
    </Suspense>
  );
}
```

- [ ] **Step 2: Write the component**

Create `web/src/components/CharacterInterview.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Markdown from "@/components/Markdown";
import UserMenu from "@/components/UserMenu";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const WELCOME =
  "Hi — I'm your Character Development Consultant. Let's build your cast, one character at a time, starting with your Protagonist.";

const AMBIENT_GRADIENT =
  "linear-gradient(115deg, #2a0707 0%, #7f1d1d 18%, #dc2626 38%, #ea580c 52%, #7e22ce 76%, #312e81 100%)";
const BORDER_GRADIENT =
  "linear-gradient(135deg, #f87171, #dc2626, #ea580c, #a855f7, #6366f1)";

export default function CharacterInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [currentCharacter, setCurrentCharacter] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<number | null>(null);
  const [characterSignedOff, setCharacterSignedOff] = useState(false);
  const [context, setContext] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(380);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load this Story Canvas.");
          return;
        }
        const rawMessages = (data.characterMessages ?? []) as {
          role: "user" | "assistant";
          content: string;
          context?: string;
          current_character?: string;
          current_stage?: number;
        }[];
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        const lastAssistant = [...rawMessages].reverse().find((m) => m.role === "assistant" && m.current_character);
        if (lastAssistant) {
          setContext(lastAssistant.context ?? null);
          setCurrentCharacter(lastAssistant.current_character ?? null);
          setCurrentStage(lastAssistant.current_stage ?? null);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach the server. Is the dev server running?");
      } finally {
        if (!cancelled) setResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, canvasId]);

  async function sendMessage(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!preset) setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/character-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setCurrentCharacter(data.current_character ?? null);
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
      setCharacterSignedOff(Boolean(data.character_signed_off));
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleResizeStart(e: React.PointerEvent) {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;

    function handlePointerMove(ev: PointerEvent) {
      const next = Math.min(800, Math.max(280, startWidth + (ev.clientX - startX)));
      setLeftWidth(next);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  if (!workspaceId || !canvasId) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4" style={{ background: AMBIENT_GRADIENT }}>
        <div className="rounded-2xl p-[1.5px]" style={{ background: BORDER_GRADIENT }}>
          <div className="flex flex-col items-center gap-4 rounded-[14px] bg-neutral-950 px-10 py-12 text-center text-neutral-100">
            <p className="text-lg font-medium">No Story Canvas selected.</p>
            <p className="max-w-sm text-sm text-neutral-400">
              The Character Bible needs a Workspace and Story Canvas with a completed Story Foundation. Start from your dashboard.
            </p>
            <Link
              href="/dashboard"
              className="rounded-xl bg-gradient-to-r from-red-600 to-orange-500 px-5 py-3 text-sm font-semibold text-white hover:from-red-500 hover:to-orange-400"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh p-2 sm:p-4" style={{ background: AMBIENT_GRADIENT }}>
      <div className="mx-auto h-[calc(100dvh-1rem)] max-w-[1600px] rounded-2xl p-[1.5px] sm:h-[calc(100dvh-2rem)]" style={{ background: BORDER_GRADIENT }}>
        <div className="flex h-full flex-col overflow-hidden rounded-[14px] bg-neutral-950 text-neutral-100">
          <header className="flex shrink-0 items-center justify-between border-b border-red-900/40 px-5 py-3">
            <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
              ← Back
            </Link>
            <div className="text-sm font-medium tracking-wide text-neutral-300">
              Character Bible{currentCharacter ? ` · ${currentCharacter} · Stage ${currentStage ?? 1}/6` : ""}
            </div>
            <UserMenu />
          </header>

          <div className="flex min-h-0 flex-1">
            <div
              data-testid="left-panel"
              className="flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
                {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
                {!resuming && messages.length === 0 && <Bubble role="assistant" content={WELCOME} />}
                {messages.map((m, i) => (
                  <Bubble key={i} role={m.role} content={m.content} />
                ))}
                {loading && <Bubble role="assistant" content="…" pending />}
                {error && (
                  <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div ref={listEndRef} />
              </div>

              <div className="shrink-0 border-t border-red-900/40 p-3">
                <div className="rounded-xl p-[1px]" style={{ background: BORDER_GRADIENT }}>
                  <div className="flex items-end gap-2 rounded-[11px] bg-neutral-900 p-2">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onKeyDown}
                      rows={2}
                      placeholder="Type your answer… (Enter to send)"
                      className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
                    />
                    <button
                      onClick={() => sendMessage()}
                      disabled={loading || resuming || !input.trim()}
                      className="shrink-0 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:from-red-500 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div
              data-testid="resize-handle"
              onPointerDown={handleResizeStart}
              className="w-1 shrink-0 cursor-col-resize bg-neutral-800 transition hover:bg-gradient-to-b hover:from-red-500 hover:to-orange-500 active:bg-gradient-to-b active:from-red-500 active:to-orange-500"
            />

            <div data-testid="right-panel" className="flex min-w-0 flex-1 flex-col bg-neutral-950">
              <div className="shrink-0 border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">
                  preview · {currentCharacter ?? "Cast overview"}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
                {characterSignedOff && currentCharacter && !loading && (
                  <div className="mb-6 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5">
                    <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
                      Signed Off
                    </p>
                    <p className="mt-1 text-sm text-neutral-300">
                      {currentCharacter}&apos;s profile is confirmed. The next reply will move to the next character.
                    </p>
                  </div>
                )}

                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing this character…</p>
                  </div>
                )}

                {!loading && !resuming && context && (
                  <div
                    data-testid="notes-card"
                    className="rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
                  >
                    <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
                      Notes
                    </p>
                    <div className="mt-3">
                      <Markdown className="text-[13px] leading-relaxed text-neutral-300">{context}</Markdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
  pending,
}: {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}) {
  const isUser = role === "user";
  const renderMarkdown = !isUser && !pending;
  return (
    <div className={`mb-3 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? "whitespace-pre-wrap bg-gradient-to-r from-red-600 to-orange-600 text-white"
            : "bg-neutral-800 text-neutral-100"
        } ${pending ? "whitespace-pre-wrap animate-pulse" : ""}`}
      >
        {renderMarkdown ? <Markdown className="text-[13px] leading-relaxed text-neutral-100">{content}</Markdown> : content}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/character-bible/page.tsx web/src/components/CharacterInterview.tsx
git commit -m "feat: add Project 2 Character Bible page"
```

---

### Task 8: Dashboard entry point

**Files:**
- Modify: `web/src/components/ProjectDashboard.tsx`

**Interfaces:**
- Consumes: `/character-bible` route (Task 7).

- [ ] **Step 1: Add the Character Bible link**

In `web/src/components/ProjectDashboard.tsx`, the current block (around line 267-273) is:

```tsx
                      <div className="flex shrink-0 items-center gap-2">
                        <Link
                          href={`/interview?workspaceId=${p.workspaceId}&canvasId=${p.id}`}
                          className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                        >
                          Resume
                        </Link>
```

Change it to:

```tsx
                      <div className="flex shrink-0 items-center gap-2">
                        <Link
                          href={`/interview?workspaceId=${p.workspaceId}&canvasId=${p.id}`}
                          className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                        >
                          Resume
                        </Link>
                        {hasDoc && (
                          <Link
                            href={`/character-bible?workspaceId=${p.workspaceId}&canvasId=${p.id}`}
                            className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10"
                          >
                            Character Bible
                          </Link>
                        )}
```

(`hasDoc` — `Array.isArray(versions) && versions.length > 0` — is already computed earlier in this same render block for the Export dropdown; reused here unchanged. The link is gated on it since Project 2 ingests Project 1's exported Foundation Document JSON via `ingestFoundation.ts`, which needs at least one compiled version to exist.)

- [ ] **Step 2: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual walkthrough** (sandbox has no live Firebase/Anthropic credentials — for whoever runs it against a real dev server)

From the dashboard, confirm the "Character Bible" button appears only for Stories with a generated Foundation Document, and clicking it opens `/character-bible` for that Story. Start a session and confirm the opening turn shows a structural cast/priority-matrix evaluation in the "Notes" pane and the first Protagonist Stage-1 questions as a terse numbered list in chat. Confirm attempting to discuss a different character before sign-off gets redirected per the prompt's instruction. Confirm reloading mid-session restores the last known character/stage in the header and the last `context` in the Notes pane.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ProjectDashboard.tsx
git commit -m "feat: add dashboard entry point for the Character Bible"
```
