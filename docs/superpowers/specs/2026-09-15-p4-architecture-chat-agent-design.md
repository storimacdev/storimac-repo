# P4 Live Architecture Chat Agent — Design Spec

**Status:** Approved for planning
**Date:** 2026-09-15

## Problem

GitHub issue #111. Six pure backend logic modules for Project 4 (Story Architecture Engine) are already built and merged (`web/src/lib/storyArchitectureEngine/`: `ingestCanon.ts` #55, `structuralFramework.ts` #58, `stateLedger.ts` #62, `onboardingGate.ts` #57, `developmentLoop.ts` #59/#61, `compileArchitectureDocument.ts` #60) — but none of them are wired into anything a user can talk to. There is no `/api/architecture-chat` route, no system prompt, no P4 chat UI, no P4 state on `Story`, no P4 message collection. This issue builds all of that, following the exact `/api/world-chat` (P3) / `/api/character-chat` (P2) pattern already established twice in this codebase.

The issue's own body names four open design questions and explicitly says this "needs its own dedicated brainstorm" rather than being bundled into the six backend-logic issues. Its sibling issue #112 additionally confirms there is no "P4 Prompt v3.0" reference document anywhere — sp02/sp03's own precedent (a system prompt authored directly against a cited PRD section) doesn't have a single source document to cite for P4; sp04 has to be reconciled from the actual PRD and the Framework v3.0 refdoc directly, the same way issues #57/#60 already had to reconcile discrepancies between those two documents for their own narrower scopes.

## Decisions

1. **Routing choice is resolved via structured extraction, not free-text parsing — this fully answers the issue's open question #3, more simply than the issue anticipated.** `developmentLoop.ts`'s own docstring flags that an untrusted string reaching `getRouteOrder` has no runtime validation. But this codebase's `extractTurn`/`StructuredDeltaExtractor` pattern (used by every existing chat route) forces the model to emit its choice through a Zod-validated tool call, not free text — so `routing_choice` is simply a turn-schema field typed `z.enum(["A", "B", "C"]).nullable()`. Zod's `safeParse` (with `extractTurn`'s existing retry-then-`TurnValidationError` behavior) already guarantees only a valid `RoutingChoice` or `null` ever reaches `getRouteOrder`/`switchRoute` — no fuzzy resolver (unlike P2's `resolveCharId`, which exists specifically because character names aren't a closed enum) is needed at all.

2. **The onboarding gate gets a real app-side backstop, not just a system-prompt instruction — reversing `onboardingGate.ts`'s own stated deferral, for the same reason issue #49's Stage 4 audit needed one.** `onboardingGate.ts`'s header comment explicitly frames "no prose before the gate completes" as a system-prompt behavioral rule, not app-layer code. Prompt-only enforcement is this codebase's default for low-stakes behavioral requests (see how loosely P1-P3 treat their own early-stage sequencing) — but this session's own prior work on issue #49 found that a purely-prompted gate with real consequences (there, Stage 4→5 approval; here, structural work happening before the canon overview/milestone checklist/routing prompt are ever shown) is exactly the kind of thing that needs a deterministic clamp, because an LLM can plausibly skip a preamble it judges as redundant once conversation context makes the canon obvious. Resolution: a new `p4OnboardingComplete: boolean` on `Story` (default false), flipped to `true` the first time the model reports a non-null `routing_choice` (matching FR-3.1(d), "explicitly prompt the author to choose a routing option," as the completion criterion) — mirroring exactly how issue #49 tracks `p3Stage4Audit.authorApproved` as an app-side boolean the model's own self-report can only set once, not silently bypass. While `p4OnboardingComplete` is false, the route clamps `proposed_unit` to `null` in the persisted/returned turn regardless of what the model proposed (same "effective" clamp pattern `world-chat/route.ts` already uses for `effectiveStage`) — the model can still write a `reply` however it wants, but no structural unit ever gets created or transitioned before the gate is real, not just requested.

3. **The compile action is a separate route, not a turn-schema field — matching P1/P2/P3's own established convention, not a new pattern.** PRD FR-8.1 says compile fires "on explicit trigger." Every existing project in this codebase implements "explicit trigger" as a dedicated button hitting a dedicated route (`POST /api/workspaces/.../document`, `POST /api/world-chat/document`), never a boolean field inside the conversational turn schema. `compileScreenplayArchitectureDocument(storyId, canon, units)` is already a synchronous pure function with exactly this shape — `POST /api/architecture-chat/document` fetches fresh `ingestCanon(storyId)` and the persisted `p4Units` (Decision 4), calls the compiler, and returns `{ markdown, outstandingCount }`. No turn-schema field, no new pattern.

4. **`p4Units: StructuralUnit[]` and `p4Routing: RoutingState | null` are persisted directly on `Story`, using the exact same scalar/array-field pattern `P2State`/`P3State` already use — this is the minimal persistence #111 actually needs, and is not the same thing issue #69 ("Add persisted session state") is reserving for itself.** `stateLedger.ts`'s header comment says P4 session state is "in-memory only for this phase; persistence is issue #69" — but a live conversational agent cannot function turn-to-turn, let alone support a separate compile request, without *some* persistence of the structural-unit ledger between HTTP requests (every request is stateless). Every other project's chat route already persists its own comparably-shaped state this same way (`P2State`, `P3State`) without waiting for a dedicated "state persistence" issue, because Firestore-document-field storage is this codebase's baseline, not an advanced capability. Issue #69, filed separately and still open, is read here as reserving something *beyond* this baseline (richer versioning, undo/redo, or whatever BA has in mind) — not as blocking the ordinary "a Story's fields hold this project's state" pattern every other project already uses on day one. `p4Units` is written via a whole-array-replace setter (matching `setP3Pillars`'s own "the author's editor is the sole owner, no concurrent-writer case" reasoning) — the model reports the full current unit it's working on each turn; the route reads, updates-or-creates via `upsertUnit`, and writes back the whole array.

5. **`attemptStatusTransition`'s `ContentValidationResult` is supplied directly by the model's own self-report, per `developmentLoop.ts`'s own explicit design intent — the route performs no independent semantic check.** Issue #59's close comment states, verbatim, that the deterministic function "does NOT" and structurally *cannot* honestly perform the semantic Core-Purpose judgment (e.g. "is this Catalyst a strict single external event happening to the hero") — that judgment is declared to belong to "a future live agent's system-prompt-driven turn," which is this issue. So the turn schema carries `validation_result: z.enum(["passed", "failed", "not_applicable"])` and `validation_reason: z.string()`, populated by the model itself after sp04 instructs it to actually perform that judgment against the active step's `corePurpose` (quoted into the grounding block, per Decision 8) before ever reporting `"passed"`. The route passes `{ valid: validation_result === "passed", reason: validation_reason }` straight into `attemptStatusTransition` — no independent verification, matching P4's own explicitly-stated design (unlike P2's `causalChain.ts`, which built a deterministic structural *proxy* for a semantic rule; #59 deliberately declined to build an equivalent proxy for P4, judging the Catalyst rule too genuinely semantic for one). This is a disclosed trust boundary, not an oversight — the issue's own acceptance criteria list "Core-Purpose semantic validation actually rejects/accepts correctly... BA review required" as a thing to verify empirically once built, not something the code can prove.

6. **The placement-deviation guardrail is surfaced to the author honestly as advisory, with its self-disclosed placeholder threshold named as such — never presented as a tuned or authoritative rule.** `checkPlacementDeviation` already returns `{ flagged, message }`, never blocking (issue #59 FR-4.4's own requirement), using `DEVIATION_THRESHOLD_PERCENT = 10`, a value issue #113 confirms is invented, not sourced. sp04's instructions for surfacing this flag must tell the model to phrase it as "this looks further from the step's typical placement than usual — want to keep it here or adjust?" — never "this violates the required placement," since no such requirement exists yet. This keeps the live agent honest about a known, tracked gap rather than manufacturing false authority for a threshold issue #113 hasn't settled.

7. **`causalTag` stays `"UNVALIDATED"` for every unit — issue #63 (Causality Validation) doesn't exist yet, and this issue does not invent a substitute.** `stateLedger.ts`'s `createUnit` already defaults every new unit to `causalTag: "UNVALIDATED"`; nothing in the six shipped modules computes a real value. sp04 does not ask the model to self-report a causal tag, and the route never sets one — `getConfirmedUnits`'s consumers (the compiler) already render `"UNVALIDATED"` as-is (per `compileArchitectureDocument.ts`'s existing per-unit line format), so this requires no new code, just a deliberate absence: this issue does not reach into #63's scope.

8. **sp04 is authored directly from the PRD and the Framework v3.0 refdoc, reconciled against what the six shipped modules actually implement where the two source documents disagree with the code (which happens in at least three places: Complexity Level removed per #56/#58, a 7-section compile per #60/#70 rather than the PRD Appendix B's original 12, and a uniform per-step onboarding gate per #57 rather than a finer one) — resolving issue #112 by confirming no "P4 Prompt v3.0" ever existed to look for.** `structuralFramework.ts`'s own close-comment states plainly that "whichever future issue builds Project 4's own system prompt will quote this module's data verbatim rather than re-typing it" — sp04's Section on the 10-step structure is therefore generated directly from `STRUCTURAL_ACTS`/`STRUCTURAL_STEPS` at prompt-authoring time (copy the real data into the prompt text), not re-derived from the refdoc's prose a second time, so the two can't drift. Every other section (persona, scope boundaries, structured-output contract, opening-turn behavior) follows sp03's established section skeleton (see Architecture), populated from the PRD's FR sections and the refdoc's §1-§3/§5 content, explicitly noting the §2/§6 gaps (Scene Density Monitor, Pre-Compilation Audit — issues #56/#91, neither built yet) as out of scope for this prompt rather than silently promising behavior no module backs.
9. **`architectureTurnSchema.ts`'s `deferred_items` reuses the exact enum convention already established by P3's own schema** (`defer_to_project: z.enum(["Project 2", "Project 3", "Project 5"]).nullable()` — P4 deferring to itself is not a valid choice, so "Project 4" is excluded, mirroring how P3's own schema excludes "Project 3").

## Architecture

### `web/system-prompts/sp04-sae-systemprompt.md` (new)

Follows sp03's section skeleton exactly: `1. CORE PERSONA & OBJECTIVE` (Screenplay Structural Architect persona, per PRD §5 Users & refdoc §1's "Exclusive Screenplay Focus"/"Narrative Design Bounding") → `2. THE 10-STEP CINEMATIC NARRATIVE STRUCTURE` (the real `STRUCTURAL_ACTS`/`STRUCTURAL_STEPS` data, copied verbatim per Decision 8 — every step's `corePurpose`, `placementMark`, `criticalBeats`) → `3. NON-SEQUENTIAL INTERVIEW & DISCOVERY ROUTING` (the three options, matching `ROUTING_PROMPT`'s exact wording) → `4. STRICT SCOPE BOUNDARIES & DEFERRALS` (screenplay-only per refdoc §1; deferring character psychology to P2, world lore to P3, prose/dialogue drafting to P5) → `5. CANON & STRUCTURAL INTEGRITY MANAGEMENT` (Exploring/Working/Confirmed/Parked vocabulary; the Core-Purpose validation instruction from Decision 5, explicit and concrete — "before reporting `validation_result: passed`, check the proposed content against the active step's Core Purpose exactly as written in Section 2 above"; the placement-deviation advisory phrasing from Decision 6) → `6. ONBOARDING SEQUENCE` (the exact three-part first-turn output from `buildOnboardingOutput` — structural overview, milestone checklist, routing prompt — with the instruction that no structural work of any kind happens before a routing choice is reported) → `7. STRUCTURED OUTPUT CONTRACT` (defines every `ArchitectureTurnSchema` field, the reply/context split, the same "never name/quote/describe bracketed grounding sections or internal issue/framework terminology" rule issue #110 established for every project) → `8. OPENING TURN` (present the onboarding grounding block's content in the author's own words, verbatim data, first turn only).

### New module `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`

Mirrors `worldTurnSchema.ts`'s Zod-schema/`Anthropic.Tool` pairing convention:

```ts
export const ArchitectureTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  routing_choice: z.enum(["A", "B", "C"]).nullable(),
  active_step_number: z.number().int().min(1).max(10).nullable(),
  proposed_unit: z.object({
    unit_id: z.string().min(1),
    type: z.enum(["Scene", "Sequence", "SetPiece", "PlotPoint"]),
    content: z.string().min(1),
    requested_status: z.enum(["Exploring", "Working", "Confirmed", "Parked"]),
    canon_refs: z.array(z.string()),
    proposed_position_percent: z.number().min(0).max(100).nullable(),
  }).nullable(),
  validation_result: z.enum(["passed", "failed", "not_applicable"]),
  validation_reason: z.string(),
  deferred_items: z.array(z.object({
    item: z.string().min(1),
    defer_to_project: z.enum(["Project 2", "Project 3", "Project 5"]).nullable(),
    notes: z.string(),
  })),
});
```
`EMIT_ARCHITECTURE_TURN_TOOL: Anthropic.Tool` mirrors every field/name/order identically (this codebase's established hand-synced-pair discipline).

### `web/src/lib/canonEngine/storyStore.ts` (extended)

```ts
export interface P4State {
  onboardingComplete: boolean;
  routing: RoutingState | null; // from developmentLoop.ts
}
export function normalizeP4(p4: P4State | null | undefined): P4State { ... } // mirrors normalizeP3
```
On `Story`: `p4?: P4State | null`, `p4Units?: StructuralUnit[] | null`. New setters `setP4OnboardingComplete`, `setP4Routing`, `setP4Units` (whole-array-replace, per Decision 4). New collection constant `ARCHITECTURE_MESSAGES_COLLECTION = "architectureMessages"`, matching `WORLD_MESSAGES_COLLECTION`'s exact precedent.

### `web/src/app/api/architecture-chat/route.ts` (new)

Same 10-step shape as `world-chat/route.ts` (Architecture §2 of the research): auth/story lookup → transcript append+fetch → system prompt assembly (sp04 + grounding blocks: canon overview from `ingestCanon`, onboarding-pending block per Decision 2, active-step Core Purpose block when `active_step_number` is set, final-reminder block) → `extractTurn` with `ArchitectureTurnSchema`/`EMIT_ARCHITECTURE_TURN_TOOL` → the onboarding clamp (Decision 2) → `attemptStatusTransition` call (Decision 5) → `checkPlacementDeviation` surfaced as a non-blocking flag in the response (Decision 6) → persist assistant message + `p4Units`/`p4` state → response `{ reply, context, routing_choice, active_step_number, unit, placementFlag, deferredItems }`.

### `web/src/app/api/architecture-chat/document/route.ts` (new)

Per Decision 3 — `POST` only (no versioning/storage in this issue; matches `compileArchitectureDocument.ts`'s own current on-demand, non-persisted shape). Fetches `ingestCanon(storyId)` + `story.p4Units`, calls `compileScreenplayArchitectureDocument`, returns `{ markdown, outstandingCount }`.

### `web/src/components/ArchitectureInterview.tsx` (new)

Mirrors `WorldInterview.tsx`'s established shape: message list, input box, a right-panel showing the milestone checklist/routing state, and a "Compile" button calling the new document route and offering a Markdown download (matching `WorldInterview.tsx`'s `downloadText` convention from issue #50).

## Error Handling

Matches `world-chat/route.ts` exactly: `RateLimitTimeoutError` → 503, `TurnValidationError` → 502, every state-write (unit upsert, routing switch, message append) wrapped in its own try/catch degrading to `console.warn` once the assistant message itself is already persisted — never a hard 500 after the model has already replied.

## Testing

No automated test framework exists in this repo. Verification is `npm run lint && npm run build`, plus:
- A `tsx` trace of the onboarding clamp: a turn with `p4OnboardingComplete: false` and a non-null `proposed_unit` must return a response with `unit: null` regardless of what was proposed; a turn with `routing_choice` newly non-null must flip `p4OnboardingComplete` to `true` in the same turn's persisted state.
- A trace of `attemptStatusTransition` wiring: `validation_result: "failed"` must never result in a persisted status transition even when `requested_status` is `"Confirmed"`.
- A trace of the compile route against a constructed `p4Units` array with a mix of `Confirmed`/non-`Confirmed` units, confirming the returned markdown's Section 4/Section 7 split matches `compileArchitectureDocument.ts`'s own existing logic.
- Per the issue's own acceptance criteria, empirical verification of the Core-Purpose semantic validation (Decision 5) and the onboarding-first-turn ordering requires an actual conversation, not just a trace — flagged in the plan as requiring real interaction (via a network-mocked or, where a real API key is available, a live-model conversation) rather than pure code tracing, matching how issue #49/#50's own audit/synthesis verification needed a real model call to mean anything.
