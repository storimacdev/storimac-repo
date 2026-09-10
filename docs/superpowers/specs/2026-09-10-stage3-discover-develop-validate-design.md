# Stage 3 Discover/Develop/Validate Cycle (Issue #43) — Design

## Problem

PRD §6 Stage 3 requires a repeatable per-pillar cycle — Discover (elicit
author intent), Develop (draft a structured entry via the Universal
World Entry Model), Validate (author reviews/edits/sets canon state) —
continuing pillar by pillar until all prioritized pillars are addressed
or explicitly deferred.

Issue #54's platform decision already settled the session-scoping
question: **one continuous World Bible thread, with an `activePillar`
lock field on `Story.p3`, mirroring `P2State.activeCharacterId`
exactly** — not separate per-pillar sessions. This design implements
that decision.

## Architecture

Follows Project 2's own proven shape (`characterFsm.ts` +
`character-chat/route.ts`): the model proposes state via new turn-schema
fields every turn; the app is authoritative — it always writes the
final persisted state via already-validated store functions, never
trusting the model's claim blindly.

### 1. Refactor first: extract a service module from issue #42's route

`web/src/app/api/world-chat/entries/route.ts` (issue #42, since
extended by its own final review with a Character Bible gate and a
Confirmed-value guard) currently does its create/update logic inline in
the route handlers. This issue's chat-turn handler needs to call that
exact same logic, INCLUDING those two guards — importing functions out
of a route-handler file is awkward and not a pattern used elsewhere in
this codebase. Extract the core logic into a new
`web/src/lib/worldEngine/worldEntryStore.ts`, preserving both guards
inside the extracted functions (not just in the route wrappers), so a
chat-turn call gets the same protections a direct API call does:

```ts
export interface CreateWorldEntryInput {
  name: string;
  category: string;
  narrativeRole: string;
  importance: EntryImportance;
  depth: EntryDepth;
  functionalDescription: string;
  governingRules: string;
  outstandingQuestions?: OutstandingQuestion[];
  dependsOn?: string[];
}

export async function createWorldEntry(
  storyId: string,
  input: CreateWorldEntryInput
): Promise<{ element: CanonElement; warning: ImportanceDepthCheck }>;

export interface UpdateWorldEntryInput {
  /* same fields as CreateWorldEntryInput, all optional, plus */
  status?: "Exploring" | "Working" | "Confirmed" | "Deferred";
}

export type UpdateWorldEntryResult =
  | { ok: true; element: CanonElement; warning: ImportanceDepthCheck }
  | { ok: false; error: string };

export async function updateWorldEntry(
  storyId: string,
  entryId: string,
  input: UpdateWorldEntryInput
): Promise<UpdateWorldEntryResult>;
```

`updateWorldEntry`'s `{ ok: false, error }` branch is what carries both
guards' rejections (entry not found, Confirmed-value-edit blocked,
invalid status transition) — the SAME three failure modes
`entries/route.ts`'s `PATCH` already has, just returned as data instead
of thrown as an HTTP response, so both the route and the chat-turn
handler can translate the same result shape into whatever response
their own caller needs (an HTTP 400, or a graceful in-conversation
fallback — see Edge Cases below).

The Character Bible gate is NOT moved into these two functions — it
depends on `story.p2` (already available to `world-chat/route.ts`'s
caller before this point in its own turn handler) and stays a
route/turn-handler-level concern, called once per request/turn before
`createWorldEntry`/`updateWorldEntry` are ever reached, exactly where
`entries/route.ts` already calls it today.

`entries/route.ts`'s `POST`/`PATCH` become thin request-parsing wrappers
around these two functions (validate body → call the store function →
translate its result to an HTTP response) — no behavior change, same
manual-trace scenarios from issue #42's plan still hold. `GET` is
untouched (it was already a thin `listElements` wrapper).

### 2. `Story.p3` gains `activePillar`

`storyStore.ts`:

```ts
export interface P3State {
  proposedWorldComplexityLevel: 1 | 2 | 3 | 4 | null;
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  proposedPillars: string[] | null;
  pillars: string[] | null;
  activePillar: string | null; // issue #43 - mirrors P2State.activeCharacterId
}

export async function setP3ActivePillar(storyId: string, pillar: string | null): Promise<void>;
```

`normalizeP3` gains `activePillar: null` in its defaults, same pattern
as every other P3 sub-field.

### 3. `WorldTurnSchema`/`EMIT_WORLD_TURN_TOOL` gain five fields

```ts
active_pillar: z.string().nullable(),
cycle_phase: z.enum(["Discover", "Develop", "Validate"]).nullable(),
proposed_entry: z.object({
  entry_id: z.string().nullable(), // set when updating an existing draft from a prior turn; null when proposing a brand-new entry
  name: z.string(),
  category: z.string(),
  narrative_role: z.string(),
  importance: z.enum(["Critical", "Major", "Supporting", "Minor", "Incidental"]),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  functional_description: z.string(),
  governing_rules: z.string(),
}).nullable(),
validated_status: z.enum(["Working", "Confirmed", "Deferred"]).nullable(),
```

Only present (non-null) on the turns where they're actually relevant —
`active_pillar`/`cycle_phase` are null before Stage 3 starts or between
pillars; `proposed_entry` is null outside Develop/Validate; `validated_status`
is null on every turn except the one where the author has just given a
clear Working/Confirmed/Deferred verdict in their message.

### 4. `world-chat/route.ts` turn handler

After `extractTurn` returns `delta`, in addition to the existing WCL/
pillar-proposal tracking already there:

- If `delta.active_pillar` differs from `story.p3.activePillar`: call
  `setP3ActivePillar(storyId, delta.active_pillar)`.
- If `delta.proposed_entry` is present: call `createWorldEntry` (when
  `entry_id` is null) or `updateWorldEntry` (when set) with status
  `"Exploring"` — this is the Develop phase drafting the entry, never
  the author's own final validation.
- If `delta.validated_status` is present AND `delta.proposed_entry`
  (or its `entry_id`) identifies which entry it applies to: call
  `updateWorldEntry(storyId, entryId, { status: delta.validated_status })`
  — going through the SAME `isValidTransition` check `entries/route.ts`'s
  `PATCH` already enforces, so a malformed model claim (e.g. claiming
  `"Confirmed"` on an entry with no drafted content yet) can't produce
  an invalid transition.
- The Importance/Depth `warning` these calls return is folded into the
  response the same way `entries/route.ts` already does — surfaced to
  the author, never just logged (issue #44's own requirement, satisfied
  here the same way it's satisfied at the direct API layer).

## Edge cases

- **`validated_status` present but no entry to apply it to** (a
  malformed/inconsistent model turn): the update call fails gracefully
  (`{ok: false}`) and is logged, not surfaced as a hard error to the
  author — the conversation continues; this mirrors how this codebase
  already treats other malformed-model-claim cases (clamped, not
  rejected).
- **Model proposes `validated_status: "Confirmed"` while the target
  entry is currently `Confirmed`, and the same turn's `proposed_entry`
  carries changed content**: `updateWorldEntry`'s inherited
  Confirmed-value guard rejects this (`{ok: false}`) exactly like a
  direct API `PATCH` would — the turn handler logs it and does NOT
  silently drop the content change or silently apply it; the
  conversation continues without persisting that particular edit.
- **Model proposes deferring a pillar mid-cycle**: this is the EXISTING
  pillar-status mechanism (`PATCH /api/world-chat/canon-status`,
  issue #41) — setting the pillar's own element status to `Parked`/
  `Deferred` — not something this issue re-implements. The app clears
  `activePillar` to `null` when the model's `active_pillar` for the
  next turn moves to a different pillar or reports `null`.
- **Two entries drafted in the same pillar before either is
  validated**: each has its own `entryId`; the model's `proposed_entry.entry_id`
  disambiguates which one a given turn's Develop/Validate applies to.

## Out of scope

- The scope-boundary guardrail (issue #46) and Conflict Resolution
  Protocol (issue #47) — this issue's turn handler doesn't add either;
  they're separate, later issues. The Confirmed-value guard inherited
  from #42 is a conservative interim block, not #47's actual 3-way
  Revert/Revise/Defer flow.
- Any sp03 prompt-text changes — the new tool fields' own descriptions
  (matching P1/P2's established convention of explaining schema fields
  primarily via their tool-schema descriptions) are sufficient; sp03 §6
  already describes the Discover/Develop/Validate workflow narratively.
- The side-panel UI that would let an author validate via a button
  instead of chat — issue #45.
- Project 4's canon ingestion seeing these entries — a known, separate
  gap already flagged in issue #42's own design doc; not addressed
  here either.
