# P3 Scope-Boundary Guardrail (Issue #46) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a real, code-enforced scope-boundary guardrail on every World Bible chat turn — catching content that belongs to Character Bible (Project 2), Story Architecture (Project 4), or Draft Writing (Project 5), redirecting with a deterministic acknowledge/flag/offer-to-log response instead of letting the work be executed and shown to the author.

**Architecture:** Per the design spec (`docs/superpowers/specs/2026-09-11-p3-scope-guardrail-design.md`), the issue's claimed shared `GuardrailRunner` middleware doesn't exist in code — only in `ARCHITECTURE.md` prose, which its own later follow-up section concedes. Two detection layers feed one deterministic enforcement point: Layer 1 is the model self-reporting via a new `deferred_items` turn-schema field (mirrors issue #32's proven P2 mechanism and its already-generic `appendOutstandingQuestions()` persistence); Layer 2 is a new, narrow, rules-based check specifically for Project 5 (prose/dialogue generation), the one domain where a keyword/pattern signal is high-precision enough not to false-positive against legitimate World Bible content. Either layer firing causes the app itself (not the model) to construct the redirect text shown to the author.

**Tech Stack:** Next.js API route (`world-chat/route.ts`), Zod turn schema, Anthropic tool-call schema, a new pure-function module for detection/redirect-text logic, existing Firestore persistence (`appendOutstandingQuestions`, no new store code).

## Global Constraints

- Detection must not rely solely on persona/prompt instructions — this is the issue's own explicit requirement, and the specific gap found in issue #32's P2 implementation when investigated for this design. Layer 2 (rules-based) is what makes this constraint true; Layer 1 (self-report) alone would not.
- Layer 2's rules-based check is scoped to Project 5 (prose/dialogue) only, not Project 2 or Project 4 — per the design spec's documented reasoning: character/plot content overlaps too heavily with legitimate World Bible content (sp03 §4 explicitly expects character mentions; the World Bible's own "History" pillar legitimately covers timelines) for a keyword rule to be high-precision there. Do not add rules-based detection for Project 2/Project 4 in this plan — that's explicitly out of scope, tracked as an Open Follow-up in the design doc.
- Whenever Layer 2 (rules-based prose detection) fires, the model's drafted prose must never reach the author — `delta.reply` is fully replaced with the redirect note before it is persisted to the transcript AND before it is returned in the response. Persisting the raw prose even once would let a future turn's replayed-transcript window re-surface it, defeating the guardrail.
- Whenever Layer 1 (self-reported `deferred_items`) fires without Layer 2, the redirect note is *appended* after `delta.reply`, not a full replace — the model already recognized the topic and, per prompt instruction, is expected to have already steered the conversation; the appended note is a consistency guarantee, not a full override, so legitimate in-scope content elsewhere in the same turn's reply isn't discarded.
- A failed `appendOutstandingQuestions()` call must degrade gracefully (logged via `console.warn`, never a hard error to the author) — same established pattern as issue #43's Stage 3 store calls, applied for the same reason: the reply is already persisted to the transcript by the time this runs, so an uncaught throw here would 500 the whole response after the turn already exists.
- No new server-side store logic — reuse `appendOutstandingQuestions()`/`StoredOutstandingQuestion` from `web/src/lib/canonEngine/storyStore.ts` exactly as issue #32 already established (its `defer_to` union already includes all four project values).
- Do not touch or extend `web/src/lib/turnGuardrails.ts` — confirmed to be an unrelated mechanism (prompt/schema-leakage logging, issues #5/#27/#110). This plan adds a new, separate module.
- Layer 2's detection thresholds are explicitly provisional (per the design doc's Open Follow-up, mirroring issue #20's already-acknowledged classifier-tuning gap) — implement exactly the thresholds specified in Task 2, do not "improve" them without a specific reason found during implementation; note any such reason in your task report rather than silently tuning.

---

### Task 1: Add `deferred_items` to the World turn schema

**Files:**
- Modify: `web/src/lib/worldEngine/worldTurnSchema.ts`

**Interfaces:**
- Produces: a new Zod schema `WorldDeferredItemSchema` and exported type `WorldDeferredItemInput = z.infer<typeof WorldDeferredItemSchema>`, both in this file. `WorldTurnSchema` gains a required `deferred_items: z.array(WorldDeferredItemSchema)` field (an array, never null — can be empty). `EMIT_WORLD_TURN_TOOL`'s `required` array gains `"deferred_items"`. Task 3 consumes `delta.deferred_items` (each item shaped `{ item: string; defer_to_project: "Project 2" | "Project 4" | "Project 5"; notes: string }`).

This mirrors issue #32's `DeferredItemSchema` in `web/src/lib/characterEngine/characterTurnSchema.ts` exactly in shape, but is defined locally in this file rather than imported cross-module — `characterTurnSchema.ts`'s version has a different `defer_to_project` enum (P2's own three values, not P3's), and there's no existing precedent for `worldEngine` importing from `characterEngine`. Read `characterTurnSchema.ts`'s `DeferredItemSchema`/`EMIT_CHARACTER_TURN_TOOL`'s `deferred_items` property if you want to see the exact shape being mirrored.

- [ ] **Step 1: Add the Zod schema**

In `web/src/lib/worldEngine/worldTurnSchema.ts`, add near the top (after the existing imports, before `WORLD_STAGE_NAMES`):

```ts
const WorldDeferredItemSchema = z.object({
  item: z.string().min(1),
  defer_to_project: z.enum(["Project 2", "Project 4", "Project 5"]),
  notes: z.string().min(1),
});

export type WorldDeferredItemInput = z.infer<typeof WorldDeferredItemSchema>;
```

- [ ] **Step 2: Add the field to `WorldTurnSchema`**

Add this line to the `WorldTurnSchema` object (after `validated_status`, which is currently the last field):

```ts
  deferred_items: z.array(WorldDeferredItemSchema),
```

- [ ] **Step 3: Add the field to `EMIT_WORLD_TURN_TOOL`**

Add this to the tool's `properties` object (after `validated_status`, which is currently the last property):

```ts
      deferred_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: {
              type: "string",
              description: "A short description of the out-of-scope thing you noticed (e.g. a character's backstory detail, a plot beat, a line of dialogue).",
            },
            defer_to_project: {
              type: "string",
              enum: ["Project 2", "Project 4", "Project 5"],
              description:
                "Which project this belongs to: Project 2 (Character Bible) for character psychology/backstory/dialogue voice, Project 4 (Story Architecture) for plot beats/scenes/timeline sequencing, Project 5 (Draft Writing) for narrative prose/dialogue generation.",
            },
            notes: { type: "string", description: "Enough context to pick this back up later." },
          },
          required: ["item", "defer_to_project", "notes"],
        },
        description:
          "Any out-of-scope items you noticed this turn but did not act on - log them here instead of developing them, so the author doesn't lose the thread. Empty array if nothing out-of-scope came up this turn.",
      },
```

Add `"deferred_items"` to the `required` array (which currently ends with `"validated_status"`).

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. No other file consumes `WorldTurnSchema`/`EMIT_WORLD_TURN_TOOL` yet in a way that constructs a full object literal of either type (Task 3 is the only consumer, not built yet), so this change should not force any other file to be touched — if `npm run build` reveals otherwise, apply the minimal necessary fix and explain clearly in your report, following the same pattern established in issue #43's Task 2.

Manually trace 3 scenarios against the real Zod schema (write a small `tsx` script if that's faster than reasoning through it, same technique issue #43's Task 3 reviewer used): (a) `deferred_items: []` — should parse; (b) `deferred_items: [{item: "test", defer_to_project: "Project 2", notes: "test"}]` — should parse; (c) `deferred_items: [{item: "test", defer_to_project: "Project 3", notes: "test"}]` — should be REJECTED (Project 3 is not a valid defer target, since P3 can't defer to itself).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/worldEngine/worldTurnSchema.ts
git commit -m "feat: add deferred_items field to WorldTurnSchema for cross-project scope deferrals (issue #46)"
```

---

### Task 2: Build the scope-guardrail detection/redirect module

**Files:**
- Create: `web/src/lib/worldEngine/scopeGuardrail.ts`

**Interfaces:**
- Produces: `export function detectProseGeneration(reply: string): boolean` and `export function buildScopeRedirectNote(items: { defer_to_project: "Project 2" | "Project 4" | "Project 5" }[]): string`. Task 3 imports both from `@/lib/worldEngine/scopeGuardrail`.

- [ ] **Step 1: Create the module**

Create `web/src/lib/worldEngine/scopeGuardrail.ts`:

```ts
/**
 * Scope-boundary guardrail for the World Bible (issue #46). Two
 * independent detection layers feed one enforcement point (wired in
 * world-chat/route.ts): Layer 1 is the model self-reporting via
 * WorldTurnSchema's deferred_items field (mirrors issue #32's P2
 * mechanism); Layer 2, this module's detectProseGeneration, is a
 * rules-based safety net scoped ONLY to Project 5 (prose/dialogue
 * generation) - deliberately not extended to Project 2/Project 4, since
 * character and plot content overlap too heavily with legitimate World
 * Bible content (sp03 4 expects character mentions; the World Bible's
 * own "History" pillar legitimately covers timelines) for a keyword
 * rule to be high-precision there. See the design doc
 * (docs/superpowers/specs/2026-09-11-p3-scope-guardrail-design.md) for
 * the full reasoning.
 *
 * detectProseGeneration's thresholds are deliberately conservative
 * (tuned toward under-triggering, not over-blocking) and explicitly
 * provisional - expect to retune once there's real usage data, same
 * situation as issue #20's classifier.
 */

const DIALOGUE_ATTRIBUTION_PATTERNS: RegExp[] = [
  // Script-style: `Name: "..."` (a colon-attributed line of dialogue)
  /\b[A-Z][A-Za-z'-]{1,30}:\s*"/g,
  // Prose-style: `"..." said Name` (a quoted line with a speech verb and a capitalized name)
  /"[^"\n]{8,}"\s*,?\s*(said|asked|replied|whispered|shouted|muttered|exclaimed)\s+[A-Z][A-Za-z'-]{1,30}\b/gi,
];

const NARRATIVE_SENTENCE_PATTERN =
  /[^.!?]*\b(?:walked|ran|looked|turned|grabbed|whispered|shouted|stared|smiled|frowned|nodded|sighed|stepped|reached|pulled|pushed|glanced|paused)\b[^.!?]*[.!?]/gi;

export function detectProseGeneration(reply: string): boolean {
  const attributionMatches = DIALOGUE_ATTRIBUTION_PATTERNS.reduce((count, pattern) => {
    const matches = reply.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
  if (attributionMatches >= 2) return true;

  const narrativeSentences = reply.match(NARRATIVE_SENTENCE_PATTERN) ?? [];
  if (narrativeSentences.length >= 4) return true;

  return false;
}

const PROJECT_LABELS: Record<"Project 2" | "Project 4" | "Project 5", string> = {
  "Project 2": "the Character Bible",
  "Project 4": "Story Architecture",
  "Project 5": "Draft Writing",
};

export function buildScopeRedirectNote(items: { defer_to_project: "Project 2" | "Project 4" | "Project 5" }[]): string {
  const uniqueProjects = Array.from(new Set(items.map((i) => i.defer_to_project)));
  const projectPhrase =
    uniqueProjects.length > 0 ? uniqueProjects.map((p) => PROJECT_LABELS[p]).join(" and ") : "a different stage of the process";
  return `That's ${projectPhrase} territory rather than the World Bible — I've logged it so it isn't lost, and we can pick it back up when you get there. For now, let's keep building out the world.`;
}
```

- [ ] **Step 2: Verify with manual trace scenarios**

Run `npm run lint` and `npm run build` from `web/` (both must be clean; this module isn't imported anywhere yet, so this only confirms it's syntactically/type-correct in isolation). Then manually trace `detectProseGeneration` against these scenarios (a `tsx` script is the fastest way to actually execute these rather than reasoning through the regex by eye):

1. `"The Council of Elders governs trade disputes between the northern clans."` (plain world-building prose, no dialogue) → expect `false`.
2. `'Kara: "We can\'t trust the merchants anymore." Tomas: "I know, but we need their grain."'` (two script-style attributed lines) → expect `true`.
3. `'"I don\'t trust him," said Elena.'` (exactly one prose-style attributed line, nothing else) → expect `false` (below the >=2 threshold — confirms the conservative-by-design threshold, not a bug).
4. A five-sentence past-tense narrative block using at least 4 of the listed action verbs (e.g. "She walked to the gate. She looked at the guards. She turned and sighed. She reached for her satchel. She paused before stepping through.") → expect `true`.
5. A functional-description-style world-building paragraph that happens to use one of the action-verb words in a non-narrative sense (e.g. "The trade routes turned north after the war, and merchants reached the coast by a new path.") — this is a known, accepted false-positive risk at the edges; trace it and report in your report what it actually returns, but do not "fix" the regex to avoid it — that's the provisional-thresholds constraint from the plan's Global Constraints.

Report the actual boolean result of all 5 in your task report.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/scopeGuardrail.ts
git commit -m "feat: add scope-guardrail prose-detection and redirect-note module (issue #46)"
```

---

### Task 3: Wire the guardrail into `world-chat/route.ts`

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Consumes: `WorldDeferredItemInput` (type-only, from Task 1's `worldTurnSchema.ts` — already imported as part of `WorldTurnSchema`/`EMIT_WORLD_TURN_TOOL`, no new import needed for the type itself since `delta.deferred_items` is already correctly typed once Task 1 lands). `detectProseGeneration`, `buildScopeRedirectNote` from `@/lib/worldEngine/scopeGuardrail` (Task 2). `appendOutstandingQuestions`, `type StoredOutstandingQuestion` from `@/lib/canonEngine/storyStore` (already exists, used unmodified — same import issue #32 already uses in `character-chat/route.ts`, read that file's import line if you want to see the exact existing convention).

The current file (as of this plan being written) has `delta` becoming available after the `extractTurn` try/catch (ends at line 210), and `appendMessage(...)` immediately follows (lines 212-223), followed by `logTurnHeuristics(delta.reply, delta.context, turnId)` (line 224). This task's new code must run BEFORE `appendMessage` — the redirect note (whether appended or replacing) has to be computed first, since whatever reply text gets persisted to the transcript is what future turns' replayed-message window will see; persisting raw leaked prose even once would let it resurface later and defeat the guardrail.

- [ ] **Step 1: Add the imports**

In `web/src/app/api/world-chat/route.ts`, add to the existing `@/lib/canonEngine/storyStore` import block (which currently imports `getStory, appendMessage, listMessages, setP3ProposedLevel, setP3ProposedPillars, setP3ActivePillar, normalizeP3, type P3State, WORLD_MESSAGES_COLLECTION`):

```ts
  appendOutstandingQuestions,
```

(add it into that same `import { ... } from "@/lib/canonEngine/storyStore";` block, alongside the existing names — do not add a second import statement for the same module).

Add a new import line:

```ts
import { detectProseGeneration, buildScopeRedirectNote } from "@/lib/worldEngine/scopeGuardrail";
```

- [ ] **Step 2: Compute the guardrail outcome and the final reply, before persisting**

Find this exact block (currently right after the `extractTurn` try/catch closes, before `appendMessage`):

```ts
    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_stage: delta.current_stage,
      },
      WORLD_MESSAGES_COLLECTION
    );
    logTurnHeuristics(delta.reply, delta.context, turnId);
```

Replace it with:

```ts
    // Scope-boundary guardrail (issue #46) - Layer 1 (model self-report
    // via deferred_items) and Layer 2 (rules-based prose/dialogue
    // detection, Project 5 only - see the design doc for why only P5
    // gets a rules-based check) both run BEFORE the reply is persisted
    // or returned, so neither a leaked prose draft nor an unflagged
    // deferral topic ever enters the transcript the next turn's
    // replayed-message window would re-surface.
    const proseDetected = detectProseGeneration(delta.reply);
    const deferredItems = [...delta.deferred_items];
    if (proseDetected && !deferredItems.some((d) => d.defer_to_project === "Project 5")) {
      deferredItems.push({
        item: "Drafted narrative prose or dialogue",
        defer_to_project: "Project 5",
        notes: "Blocked automatically by the scope-boundary guardrail before being shown to the author.",
      });
    }

    let finalReply = delta.reply;
    if (proseDetected) {
      // Layer 2 fired: genuine off-scope content was generated. Per the
      // AC ("offer to log it... instead of executing the work"), the
      // drafted prose must never reach the author - full replace, the
      // one place this feature discards model output.
      finalReply = buildScopeRedirectNote(deferredItems);
    } else if (deferredItems.length > 0) {
      // Layer 1 only: the model already recognized the topic and, per
      // prompt instruction, is expected to have already steered the
      // conversation in its own reply - append a deterministic note as
      // a consistency guarantee rather than discarding the turn's
      // otherwise-legitimate content.
      finalReply = `${delta.reply}\n\n${buildScopeRedirectNote(deferredItems)}`;
    }

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: finalReply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_stage: delta.current_stage,
      },
      WORLD_MESSAGES_COLLECTION
    );
    logTurnHeuristics(finalReply, delta.context, turnId);

    if (deferredItems.length > 0) {
      try {
        await appendOutstandingQuestions(
          storyId,
          deferredItems.map((d) => ({
            item: d.item,
            defer_to: d.defer_to_project,
            notes: d.notes,
          }))
        );
      } catch (guardrailErr) {
        console.warn(`[world-chat] scope-guardrail deferred-item logging failed for turn ${turnId}:`, guardrailErr);
      }
    }
```

- [ ] **Step 3: Use `finalReply` in the response instead of `delta.reply`**

Find the final `return NextResponse.json({...})` block (currently `reply: delta.reply, context: delta.context, current_stage: delta.current_stage, p3: p3ForResponse, entryWarning,`). Change `reply: delta.reply` to `reply: finalReply`. Leave every other field unchanged.

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

Manually trace these scenarios against the actual code (a `tsx` script exercising the logic in isolation, or careful by-hand tracing, whichever is faster and more reliable for you):

1. `delta.deferred_items = []`, `detectProseGeneration(delta.reply) = false` → `finalReply === delta.reply` exactly (no guardrail activity), no `appendOutstandingQuestions` call.
2. `delta.deferred_items = [{item: "X", defer_to_project: "Project 2", notes: "Y"}]`, prose not detected → `finalReply === delta.reply + "\n\n" + buildScopeRedirectNote(...)`, `appendOutstandingQuestions` called once with that one item, `defer_to: "Project 2"`.
3. Prose IS detected (`delta.reply` contains generated dialogue), `delta.deferred_items = []` → `finalReply` is fully replaced with the redirect note (the original `delta.reply` text must not appear anywhere in `finalReply`), `appendOutstandingQuestions` called with a synthesized Project 5 item.
4. Prose detected AND `delta.deferred_items` already contains a Project 5 entry the model self-reported → confirm `deferredItems` does NOT end up with two duplicate Project 5 entries (the `!deferredItems.some(...)` guard should prevent that).
5. `appendOutstandingQuestions` throwing (simulate by reading the code path, not necessarily executing it) → confirm the catch logs via `console.warn` and the function still proceeds to return the normal `NextResponse.json(...)` — same pattern already proven for issue #43's Stage 3 block just below this new code.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/world-chat/route.ts
git commit -m "feat: wire scope-boundary guardrail into the world-chat turn handler (issue #46)"
```
