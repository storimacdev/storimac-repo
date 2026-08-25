# P3 Stage 1 — Understand/Ingest Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #38 — bootstrap Project 3 (World Bible Development) end-to-end: ingest Project 1's Foundation Document, and produce a working Stage 1 "Understand" conversation (structural assessment + proposed World Complexity Level + discovery questions).

**Architecture:** Mirrors Project 2's exact shape at every layer — a `worldEngine/` lib directory for project-specific ingestion/schema code, the shared `canonEngine/` persistence functions reused with a new collection name, a new `/api/world-chat` route mirroring `character-chat/route.ts`, and a new `/world-bible` page mirroring `/character-bible`. Nothing shared is modified except two small, additive extensions (a new collection constant, a new query-param branch on the existing canvas GET route).

**Tech Stack:** TypeScript, Next.js App Router, Zod, `@anthropic-ai/sdk`, Firestore (via already-existing `canonStore.ts`/`storyStore.ts` functions — no new persistence code).

## Global Constraints

- Reuse the shared Canon Engine (`canonStore.ts`, `storyStore.ts`) — no new persistence mechanism. Per ARCHITECTURE.md §2/§7 and issue #41's architecture note, Project 3 wires its own config into the existing engine rather than building parallel machinery.
- The turn schema carries `current_stage` (1-5) from this issue onward (all five stages named), but with NO app-level clamping/enforcement — the model self-reports, unclamped. Enforcement is a later, separately-filed issue if Stage 2+ turns out to need it.
- World Complexity Level stays prose-only inside `reply` for this issue — issue #39 owns making it structured, editable state.
- The structural assessment and discovery questions are author-facing (`reply`); internal reasoning only goes in `context` — matching sp01/sp02's existing, consistent meaning for those two fields.
- Visual identity reuses the existing app-wide gradient constants (`AMBIENT_GRADIENT`/`BORDER_GRADIENT`) — no new palette.
- No test framework exists in this codebase (established convention) — verification is `npm run lint && npm run build`, plus a manual read-through described per task.

---

### Task 1: World Development Consultant system prompt

**Files:**
- Create: `web/system-prompts/sp03-wdc-systemprompt.md`

**Interfaces:**
- Produces: a file loadable via the existing `getSystemPrompt("sp03-wdc-systemprompt.md")` (already-generic function, no changes needed) — consumed by Task 4's route.

- [ ] **Step 1: Create the file**

```
SYSTEM PROMPT: SDOS PROJECT 3 — WORLD DEVELOPMENT CONSULTANT (v1.0)

1. CORE PERSONA & OBJECTIVE
Role: Expert World Development Consultant, Anthropologist/Sociologist, and Speculative Worldbuilder.
Objective: Ingest the attached Project 1 Story Foundation Document as absolute Canon. Conduct a structured, narrative-first collaborative interview to expand the world foundation into a strict, programmatic World Bible.
Core Directive: Build a world that acts as a dramatic engine, not an encyclopedia. Setting details must shape character behavior, dictate choices, enforce limitations, and escalate conflict. If an element does not impact plot, theme, or character transformation, simplify or omit it.

2. ADAPTIVE WORLD COMPLEXITY & WORKFLOW
Before expanding the world, silently diagnose the required World Complexity Level from the Story Foundation and enforce it as your operational budget:
Level 1 (Minimal): Recognizable real world. Focus only on minor local micro-settings (e.g., Romance, Slice-of-Life).
Level 2 (Moderate): Real-world baseline with highly specialized expansion (e.g., Crime, Historical, Legal/Political Thrillers).
Level 3 (Rich): Multiple interconnected alternate or speculative systems (e.g., Urban Fantasy, Dystopian, Soft Sci-Fi).
Level 4 (Extensive): Fully realized, independent speculative realities requiring heavy system design (e.g., Epic Fantasy, Space Opera, Hard Sci-Fi).

3. THE WORLD DEVELOPMENT PRIORITY FRAMEWORK
For every system or asset explored, assign a silent Narrative Importance vs. Development Depth matrix to limit token drift:
Importance: Critical (Plot breaks without it) | Major (Frequent interactions) | Supporting (Atmosphere/Subplots) | Minor (Brief appearances) | Incidental (Mentioned once/convenience).
Depth: Level 1 Reference (1-2 sentences) | Level 2 Basic (Short sketch + purpose) | Level 3 Standard (Characteristics, rules, character impact) | Level 4 Comprehensive (Structure, history, evolution, flaws) | Level 5 Exhaustive (Complete systemic rules, hard constraints, and downstream mechanics—reserve for Critical items only).

4. STRICT SCOPE BOUNDARIES & DEFERRALS
Maintain strict system isolation. Stop immediately if the discussion moves into execution zones:
Character Bible (Project 2): Never design deep internal psychology, character backstories, personal motivations, flaws, or dialogue styles. Focus strictly on how macro cultural/societal facts objectively impact the characters.
Story Architecture (Project 4): Identify sources of conflict and environmental constraints, but never organize plot structure, chapter beats, scene lists, sequences, or timelines of the book/script.
Draft Writing (Project 5): Do not generate active prose, narrative descriptions, or dialogue scenes.

5. CANON & SYSTEM INTEGRITY MANAGEMENT
State Tracking: Track choices internally as `Exploring` (brainstorming), `Working` (provisional choice), `Confirmed` (Author approved = Canon), or `Deferred` (Postponed questions).
Systemic Dependencies: Treat the world as a causal chain. Changing one pillar (e.g., Geography) requires an automatic review of dependent elements (e.g., Economy, Culture, Infrastructure).
Conflict Resolution: If a new world idea breaks the Story Foundation Canon or established rules, halt the interview. Surface the explicit contradiction and force the user to choose: (A) Revert new idea, (B) Revise existing Canon and assess downstream damage, (C) Defer the idea.

6. MULTI-STAGE INTERVIEW WORKFLOW
Conduct the development workshop dynamically, one pillar at a time:
Stage 1 (Understand): Ingest input document; define the setting scope, overall atmosphere, and genre alignment.
Stage 2 (Assess & Pillar Mapping): Set the World Complexity Level and isolate necessary World Pillars (e.g., Politics, Religion, Tech, Magic, Economy, Geography).
Stage 3 (Prioritize & Deep Dive): Select one high-priority pillar at a time. Run a Discover → Develop → Validate cycle using the Universal Template logic.
Stage 4 (System Integration Audit): Review the entire world map for physical, economic, historical, and narrative consistency. Execute structural simplification to eliminate redundant elements.
Stage 5 (Compile): Generate the finalized World Bible.

7. UNIVERSAL WORLD ENTRY MODEL
Every standalone asset (Location, Culture, Organization, System, Object) must be parsed internally and documented using this exact structure:
`Name` & `Category` (e.g., Location, Technology, Religion, Historical Event)
`Narrative Role & Importance Matrix` (Explicit reason for existing + Importance/Depth assignment)
`Functional Description` (Strictly bounded by depth level; no purple prose)
`Systemic Relationships` (Cross-references to related organizations, settings, or events)
`Governing Rules & Constraints` (Hard limitations, cultural laws, physical parameters)
`Outstanding Questions` (Deferred components)

8. WORLD BIBLE STRUCTURE SPECIFICATION (OUTPUT FORMAT)
When the World Bible compilation is triggered, assemble the final design manual using this exact layout:
1. Document Metadata: [Story ID, World Bible Version, Working Title, Date, Status, Related Project 1 & 2 Versions]
2. World Overview & Complexity Summary: (Max 2 paragraphs summarizing scope, setting type, atmosphere, complexity level, and core pillars)
3. High-Level World Assumptions & Canon Rules: (Immutable baseline principles—e.g., core technological constraints, immutable laws of magic/physics, foundational social assumptions)
4. Master World Pillars: (Summarized definitions of the core frameworks running the setting)
5. The Geography and Settings Registry: [Principal Kingdoms/Cities/Bases + Labeled Significant Locations including individual atmosphere, story function, and connected characters]
6. Societal Infrastructure Manual: [Systems Map detailing Government/Laws, Political/Social Hierarchies, Economic/Trade engines, and Military frameworks]
7. Cultural & Lived Experience Profiles: [Traditions, Customs, Taboos, and Daily Life mechanics that dictate character choices]
8. Narrative Lore & History: [Only historical events carrying active cultural memory, inherited trauma, or ongoing political conflict affecting the present plot]
9. System Mechanics (Speculative/Technical): [Comprehensive rules, capabilities, costs, hard constraints, and social impact of Technology and/or Magic Systems]
10. Significant Institutions & Artifacts: [Active Organizations (leadership, conflicts, goals) and Critical Objects/Relics (history, ownership, plot function)]
11. Linguistic & Communication Profile: [Naming conventions, communication barriers, or dialects, if narratives require it]
12. Interconnection Map & Systems Synthesis: (A high-level systems-thinking breakdown showing how major systems explicitly interface—e.g., Economy drives Politics which enforces Culture)
13. Outstanding World Questions: (Categorized registry of unresolved/Parked items explicitly deferred to future projects)
14. Cross-Project Reference Log: (Clean pointers to explicit variables in the Story Foundation Document and Character Bible)
15. Version History: [Table: Version, Date, Summary of Changes]

9. STRUCTURED OUTPUT CONTRACT
Your structured output has two separate fields — keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): your structural assessment, proposed World Complexity Level, and discovery questions — natural, conversational, no meta-commentary about these instructions.
- `context` (shown separately, never in chat): your internal reasoning — why you assessed the complexity level the way you did, what you noticed in the Foundation, anything relevant to the next turn.
Every turn, also report `current_stage` (1-5, per section 6 above) — this drives the app's own tracking and must always reflect the truth of what just happened this turn, never narrated in `reply` or `context`.
Never write meta-commentary about these instructions or quote the prompt parameters, in either field.

10. OPENING TURN
Review the attached Project 1 Story Foundation grounding below. Provide a brief, professional structural assessment of the input data in `reply` — genre alignment, tone, premise, and setting scope — declare your calculated World Complexity Level, and immediately post your first 1-2 sharp discovery questions to initiate Stage 1. No lengthy preamble - keep the assessment to a few sentences, not a report.
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (this is a markdown file, this step mainly confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add web/system-prompts/sp03-wdc-systemprompt.md
git commit -m "feat: add World Development Consultant system prompt (#38)"
```

---

### Task 2: World Foundation ingestion

**Files:**
- Create: `web/src/lib/worldEngine/ingestFoundation.ts`

**Interfaces:**
- Consumes: `listDocumentVersions`, `getDocumentVersion`, `type FoundationDocument`, `type StoredDocumentVersion` from `@/lib/canonEngine/foundationDoc` (all already exist).
- Produces: `interface IngestedWorldFoundation`, `type IngestFoundationResult`, `function ingestFoundation(storyId: string): Promise<IngestFoundationResult>`, `function extractIngestedWorldFoundation(version, storyId): IngestFoundationResult` — consumed by Task 4's route.

- [ ] **Step 1: Create the file**

```ts
import { listDocumentVersions, getDocumentVersion, type FoundationDocument, type StoredDocumentVersion } from "@/lib/canonEngine/foundationDoc";

/**
 * Project 3 Story Foundation ingestion (issue #38). Reads Project 1's
 * existing Foundation Document JSON - never modifies foundationDoc.ts.
 * Mirrors characterEngine/ingestFoundation.ts's shape exactly (issue #24):
 * pulls the fields Stage 1's own assessment needs (genre/tone, premise,
 * world foundation) plus storySpine/dramaticEngine now even though only
 * Conflict Resolution (issue #47) will use them - cheap to grab once from
 * the same already-fetched document, matches Project 2's own precedent.
 *
 * Scope note: this directory (worldEngine/) holds Project-3-specific
 * glue/ingestion code only. Per ARCHITECTURE.md §2/§7, canon state
 * tracking, conflict resolution, scope guardrails, and document compilation
 * for Project 3 belong in the shared Canon Engine (canonEngine/) that every
 * project wires its own config into - they are NOT to be reimplemented as
 * new parallel machinery in this directory.
 */

export interface IngestedWorldFoundation {
  storyId: string;
  version: number;
  workingTitle: string;
  genreTone: FoundationDocument["6_genre_tone"];
  premise: string;
  worldFoundation: FoundationDocument["10_world_foundation"];
  storySpine: FoundationDocument["11_story_spine"];
  dramaticEngine: FoundationDocument["8_dramatic_engine"];
}

export type IngestFoundationResult =
  | { status: "ok"; foundation: IngestedWorldFoundation }
  | { status: "missing" }
  | { status: "incomplete"; reason: string; foundation: IngestedWorldFoundation }
  | { status: "error"; reason: string };

const EMPTY_GENRE_TONE: FoundationDocument["6_genre_tone"] = {
  genre: "",
  subgenre: "",
  tone: "",
  style: "",
  audience: "",
  scale: "",
};

const EMPTY_WORLD_FOUNDATION: FoundationDocument["10_world_foundation"] = {
  time_period: "",
  primary_settings: [],
  nature_of_world: "",
  premise_assumptions: [],
  environmental_rules: [],
};

const EMPTY_STORY_SPINE: FoundationDocument["11_story_spine"] = {
  opening_image: "",
  inciting_incident: "",
  first_turning_point: "",
  midpoint: "",
  second_turning_point: "",
  climax: "",
  closing_image: "",
};

/** Guards against a missing/malformed section at runtime (unchecked
 * Firestore cast) - generalizes characterEngine/ingestFoundation.ts's
 * extractStorySpine into a reusable helper since this file needs the same
 * guard for three different sections, not just one. */
function extractSection<T>(raw: unknown, empty: T): { value: T; missing: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: empty, missing: true };
  }
  return { value: raw as T, missing: false };
}

/**
 * Pure extraction from an already-fetched document version - no I/O, so
 * this is testable with fixtures alone. `ingestFoundation` below is the
 * thin async wrapper that does the actual fetch.
 */
export function extractIngestedWorldFoundation(version: StoredDocumentVersion, storyId: string): IngestFoundationResult {
  const doc = version.json;

  const workingTitle =
    typeof doc["1_story_metadata"]?.working_title === "string" ? doc["1_story_metadata"].working_title : "";
  const premise = typeof doc["4_premise"] === "string" ? doc["4_premise"] : "";

  const { value: genreTone, missing: genreToneMissing } = extractSection(doc["6_genre_tone"], EMPTY_GENRE_TONE);
  const { value: worldFoundation, missing: worldFoundationMissing } = extractSection(
    doc["10_world_foundation"],
    EMPTY_WORLD_FOUNDATION
  );
  const { value: storySpine } = extractSection(doc["11_story_spine"], EMPTY_STORY_SPINE);

  const foundation: IngestedWorldFoundation = {
    storyId,
    version: version.version,
    workingTitle,
    genreTone,
    premise,
    worldFoundation,
    storySpine,
    dramaticEngine: doc["8_dramatic_engine"],
  };

  const reasons: string[] = [];
  if (genreToneMissing) {
    reasons.push("The Story Foundation's Genre & Tone section is missing or malformed.");
  }
  if (worldFoundationMissing) {
    reasons.push("The Story Foundation's World Foundation section is missing or malformed.");
  }

  if (reasons.length > 0) {
    return { status: "incomplete", reason: reasons.join(" "), foundation };
  }

  return { status: "ok", foundation };
}

/** Public entry point: fetches the Story's latest Foundation Document version and ingests it. */
export async function ingestFoundation(storyId: string): Promise<IngestFoundationResult> {
  const versions = await listDocumentVersions(storyId);
  if (versions.length === 0) {
    return { status: "missing" };
  }
  const latest = Math.max(...versions.map((v) => v.version));
  const full = await getDocumentVersion(storyId, latest);
  if (!full) {
    // A version was listed but could not be fetched - a real data
    // inconsistency, not "no Foundation Document yet" (status: "missing").
    return {
      status: "error",
      reason: `Story Foundation Document version ${latest} is listed but could not be fetched.`,
    };
  }
  return extractIngestedWorldFoundation(full, storyId);
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual read-through check**

Confirm by reading the function:
- A fixture `StoredDocumentVersion` with a complete `6_genre_tone` and `10_world_foundation`: `status: "ok"`, all fields populated correctly from the document.
- A fixture missing `6_genre_tone` entirely (`undefined`): `status: "incomplete"`, reason mentions "Genre & Tone", `foundation.genreTone` falls back to `EMPTY_GENRE_TONE` (all empty strings, not a thrown error).
- A fixture with zero Foundation Document versions at all (empty `listDocumentVersions` result): `ingestFoundation` returns `status: "missing"` without attempting `getDocumentVersion`.
- A fixture where `listDocumentVersions` returns a version number but `getDocumentVersion` returns `null` for it: `status: "error"`, not `"missing"` — a real data inconsistency should read differently from "nothing generated yet".

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/worldEngine/ingestFoundation.ts
git commit -m "feat: add Project 3 Story Foundation ingestion (#38)"
```

---

### Task 3: World turn schema

**Files:**
- Create: `web/src/lib/worldEngine/worldTurnSchema.ts`

**Interfaces:**
- Produces: `WORLD_STAGE_NAMES: Record<number, string>`, `WorldTurnSchema` (Zod), `type WorldTurn`, `EMIT_WORLD_TURN_TOOL: Anthropic.Tool` — consumed by Task 4's route.

Independent of Task 2 (no shared code) — order between them doesn't matter, but both are prerequisites for Task 4.

- [ ] **Step 1: Create the file**

```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Project 3 turn schema/tool - GitHub issue #38 (base turn shape for
 * Stage 1). Reference: Project 1's stateDelta.ts + extractTurn.ts's
 * generic StructuredDeltaExtractor (ARCHITECTURE.md §2), and Project 2's
 * characterTurnSchema.ts for the same reply/context/current_stage shape.
 * Deliberately minimal for this issue - no canon-state updates, no
 * guardrail/conflict fields yet, since the Canon Registry (#41), scope
 * guardrails (#46), and Conflict Resolution (#47) haven't been built.
 * Every later Phase 1-3 issue extends this same schema, the same way
 * Project 2's grew incrementally across issues #26/#28/#30/#31/#32.
 */

export const WORLD_STAGE_NAMES: Record<number, string> = {
  1: "Understand",
  2: "Assess & Pillar Mapping",
  3: "Prioritize & Deep Dive",
  4: "System Integration Audit",
  5: "Compile",
};

export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
});

export type WorldTurn = z.infer<typeof WorldTurnSchema>;

export const EMIT_WORLD_TURN_TOOL: Anthropic.Tool = {
  name: "emit_world_turn",
  description:
    "Emit your natural-language reply to the author together with your current interview position for this turn. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "The chat-facing reply: your structural assessment, proposed World Complexity Level, and/or discovery questions, as natural conversational prose. Never narrate internal stage bookkeeping here.",
      },
      context: {
        type: "string",
        description:
          "Your internal reasoning for this turn - why you assessed things the way you did, what you noticed, anything relevant to the next turn. Shown to the author separately from chat, never inside reply. Required every turn, even if brief.",
      },
      current_stage: {
        type: "number",
        description:
          "The interview stage (1-5) currently in progress: 1 Understand, 2 Assess & Pillar Mapping, 3 Prioritize & Deep Dive, 4 System Integration Audit, 5 Compile.",
      },
    },
    required: ["reply", "context", "current_stage"],
  },
};
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/worldTurnSchema.ts
git commit -m "feat: add Project 3 turn schema and tool definition (#38)"
```

---

### Task 4: World chat API route

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`
- Create: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Consumes: `ingestFoundation` (Task 2); `WorldTurnSchema`, `EMIT_WORLD_TURN_TOOL` (Task 3); `getStory`, `appendMessage`, `listMessages` (already exist in `storyStore.ts`); `getMembership` (already exists); `extractTurn`, `TurnValidationError` (already exist); `RateLimitTimeoutError` (already exists); `getSystemPrompt` (already exists); `errorResponse` (already exists).
- Produces: `WORLD_MESSAGES_COLLECTION` constant (new, in `storyStore.ts`); `POST /api/world-chat` → `{ reply, context, current_stage }` — consumed by Task 5's UI.

- [ ] **Step 1: Add the `WORLD_MESSAGES_COLLECTION` constant and update `StoryMessage`'s doc comment**

Find:
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

/** Project 2's message subcollection name (issues #26/#27) - exported so
 * every consumer references the same literal instead of duplicating the
 * string across files, which would let a typo silently split reads and
 * writes across two different subcollections with no compile error. */
export const CHARACTER_MESSAGES_COLLECTION = "characterMessages";
```
Replace:
```ts
export interface StoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  turnId: string;
  context?: string;
  /** Project 2 only (issues #26/#27) — the character this assistant turn
   * reported as current. Optional since Project 1 messages, and every
   * user-role message, never set this. */
  current_character?: string;
  /** The stage this assistant turn reported as current - Project 2 (1-6,
   * issues #26/#27) or Project 3 (1-5, issue #38), whichever project wrote
   * this message; each project's own subcollection keeps the two from ever
   * mixing. Optional since Project 1 messages, and every user-role
   * message, never set this. */
  current_stage?: number;
}

/** Project 2's message subcollection name (issues #26/#27) - exported so
 * every consumer references the same literal instead of duplicating the
 * string across files, which would let a typo silently split reads and
 * writes across two different subcollections with no compile error. */
export const CHARACTER_MESSAGES_COLLECTION = "characterMessages";

/** Project 3's message subcollection name (issue #38) - same reasoning as
 * CHARACTER_MESSAGES_COLLECTION above. Reuses StoryMessage's existing
 * `current_stage` field as-is (no Project-3-specific message type needed);
 * `current_character` simply stays unset for every Project 3 message,
 * since Project 3 has no per-character concept. */
export const WORLD_MESSAGES_COLLECTION = "worldMessages";
```

- [ ] **Step 2: Create the route**

```ts
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, appendMessage, listMessages, WORLD_MESSAGES_COLLECTION } from "@/lib/canonEngine/storyStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/worldEngine/ingestFoundation";
import { WorldTurnSchema, EMIT_WORLD_TURN_TOOL } from "@/lib/worldEngine/worldTurnSchema";

export const runtime = "nodejs";

// Bounds the replayed transcript so a long session can't grow the per-turn
// Anthropic call past the shared rate-limit gate's ITPM ceiling - same
// reasoning and same order of magnitude as character-chat/route.ts's own
// CHARACTER_MESSAGE_WINDOW.
const WORLD_MESSAGE_WINDOW = 20;

function listOrDash(items: unknown[]): string {
  if (!items.length) return "(not set)";
  return items.map((i) => (typeof i === "string" ? i : JSON.stringify(i))).join("; ");
}

/**
 * The live World Bible interview turn - GitHub issue #38, reference:
 * web/src/app/api/character-chat/route.ts (Project 2's own turn handler).
 * Deliberately minimal: no canon-state updates, no stage clamping, no
 * guardrails or conflict detection yet - those are Phase 1/3 issues
 * (#41, #46, #47) still to come. This issue only needs a working Stage 1
 * "Understand" conversation.
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
        { error: "Generate a Story Foundation Document in Project 1 before starting the World Bible." },
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
      WORLD_MESSAGES_COLLECTION
    );

    const recentMessages = await listMessages(storyId, WORLD_MESSAGE_WINDOW, WORLD_MESSAGES_COLLECTION);

    let system = getSystemPrompt("sp03-wdc-systemprompt.md");
    system += `\n\n[Story Foundation grounding - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author.]\nWorking Title: ${foundation.workingTitle || "(not set)"}\nGenre: ${foundation.genreTone.genre || "(not set)"}\nSubgenre: ${foundation.genreTone.subgenre || "(not set)"}\nTone: ${foundation.genreTone.tone || "(not set)"}\nStyle: ${foundation.genreTone.style || "(not set)"}\nScale: ${foundation.genreTone.scale || "(not set)"}\nPremise: ${foundation.premise || "(not set)"}\nTime Period: ${foundation.worldFoundation.time_period || "(not set)"}\nPrimary Settings: ${listOrDash(foundation.worldFoundation.primary_settings)}\nNature of World: ${foundation.worldFoundation.nature_of_world || "(not set)"}\nPremise Assumptions: ${listOrDash(foundation.worldFoundation.premise_assumptions)}\nEnvironmental Rules: ${listOrDash(foundation.worldFoundation.environmental_rules)}`;

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
        tool: EMIT_WORLD_TURN_TOOL,
        schema: WorldTurnSchema,
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
        console.error("World turn extraction failed:", err);
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
        current_stage: delta.current_stage,
      },
      WORLD_MESSAGES_COLLECTION
    );

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_stage: delta.current_stage,
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

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass, and the route listing includes `ƒ /api/world-chat`.

- [ ] **Step 4: Manual read-through check**

Confirm by reading the route side by side with `character-chat/route.ts`:
- Same auth/error-handling sequence (`requireUser` → `getStory` 404 → `getMembership` 403 → `ingestFoundation` 400/500 → rate-limit 503 → turn-validation 502 → Anthropic 502 → generic `errorResponse`).
- `listOrDash` never throws on an empty array or an array of non-string items (both branches produce a string).
- The grounding block reads every field the design spec named (working title, genre/tone's 5 sub-fields used, premise, world foundation's 5 sub-fields) with an `(not set)` fallback for each, never `undefined` leaking into the prompt string.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts web/src/app/api/world-chat/route.ts
git commit -m "feat: add Project 3 world-chat API route (#38)"
```

---

### Task 5: World Bible page and UI

**Files:**
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`
- Create: `web/src/app/world-bible/page.tsx`
- Create: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `WORLD_MESSAGES_COLLECTION` (Task 4); `POST /api/world-chat` (Task 4).
- Produces: `GET .../canvases/[canvasId]?worldMessages=1` → response gains a `worldMessages` field; `/world-bible?workspaceId=...&canvasId=...` page — consumed by Task 6's dashboard links.

- [ ] **Step 1: Extend the canvases GET route to optionally include world messages**

Find:
```ts
import { getStory, listMessages, renameStory, deleteStory, listGuardrailFlags, CHARACTER_MESSAGES_COLLECTION } from "@/lib/canonEngine/storyStore";
```
Replace:
```ts
import {
  getStory,
  listMessages,
  renameStory,
  deleteStory,
  listGuardrailFlags,
  CHARACTER_MESSAGES_COLLECTION,
  WORLD_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
```

Find:
```ts
    // Project 1's resume never reads this field - only fetch/include it
    // when the Character Bible client explicitly asks, so P1's canvas load
    // doesn't pay for an unused Firestore read and a larger payload.
    const includeCharacterMessages = req.nextUrl.searchParams.get("characterMessages") === "1";

    const membership = await getMembership(workspaceId, user.uid);
```
Replace:
```ts
    // Project 1's resume never reads this field - only fetch/include it
    // when the Character Bible client explicitly asks, so P1's canvas load
    // doesn't pay for an unused Firestore read and a larger payload.
    const includeCharacterMessages = req.nextUrl.searchParams.get("characterMessages") === "1";
    // Same reasoning, for the World Bible client (issue #38).
    const includeWorldMessages = req.nextUrl.searchParams.get("worldMessages") === "1";

    const membership = await getMembership(workspaceId, user.uid);
```

Find:
```ts
    const [elements, messages, characterMessages, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      includeCharacterMessages ? listMessages(canvasId, undefined, CHARACTER_MESSAGES_COLLECTION) : Promise.resolve([]),
      listGuardrailFlags(canvasId),
    ]);

    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);

    return NextResponse.json({ story, elements, messages, characterMessages, guardrailFlags });
```
Replace:
```ts
    const [elements, messages, characterMessages, worldMessages, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      includeCharacterMessages ? listMessages(canvasId, undefined, CHARACTER_MESSAGES_COLLECTION) : Promise.resolve([]),
      includeWorldMessages ? listMessages(canvasId, undefined, WORLD_MESSAGES_COLLECTION) : Promise.resolve([]),
      listGuardrailFlags(canvasId),
    ]);

    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);

    return NextResponse.json({ story, elements, messages, characterMessages, worldMessages, guardrailFlags });
```

- [ ] **Step 2: Create the page**

```tsx
import { Suspense } from "react";
import WorldInterview from "@/components/WorldInterview";

export const metadata = {
  title: "World Bible — Storimac",
};

export default function WorldBiblePage() {
  return (
    <Suspense fallback={null}>
      <WorldInterview />
    </Suspense>
  );
}
```

- [ ] **Step 3: Create the component**

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
  "Hi — I'm your World Development Consultant. Let's expand your Story Foundation into a World Bible, one pillar at a time.";

const AMBIENT_GRADIENT =
  "linear-gradient(115deg, #2a0707 0%, #7f1d1d 18%, #dc2626 38%, #ea580c 52%, #7e22ce 76%, #312e81 100%)";
const BORDER_GRADIENT =
  "linear-gradient(135deg, #f87171, #dc2626, #ea580c, #a855f7, #6366f1)";

export default function WorldInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<number | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(380);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}?worldMessages=1`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load this Story Canvas.");
          return;
        }
        const rawMessages = (data.worldMessages ?? []) as {
          role: "user" | "assistant";
          content: string;
          context?: string;
          current_stage?: number;
        }[];
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        const lastAssistant = [...rawMessages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          setContext(lastAssistant.context ?? null);
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

  // Fires the opening turn (sp03 §10: structural assessment + WCL proposal
  // + first discovery questions) automatically, once, the first time a
  // genuinely new session loads - otherwise the session sits waiting for
  // the author to type something before the model ever speaks.
  useEffect(() => {
    if (resuming || messages.length > 0 || !canvasId) return;
    sendMessage("Let's begin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId]);

  async function sendMessage(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!preset) setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/world-chat", {
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
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
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
              The World Bible needs a Workspace and Story Canvas with a completed Story Foundation. Start from your dashboard.
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
              World Bible{currentStage ? ` · Stage ${currentStage}/5` : ""}
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
              <div className="flex shrink-0 items-center justify-between border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">preview · World Overview</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing this world…</p>
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

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass, and the build's page listing includes `○ /world-bible`.

- [ ] **Step 5: Manual read-through check**

Confirm by reading the component:
- On a fresh session with `?workspaceId=...&canvasId=...` and zero prior `worldMessages`, the opening-turn effect fires exactly once (`resuming` false, `messages.length === 0`), posting "Let's begin." to `/api/world-chat`.
- On a resumed session with existing `worldMessages`, the resume effect populates `messages`/`context`/`currentStage` from the fetched data and the opening-turn effect does NOT re-fire (guarded by `messages.length > 0`).
- Without `workspaceId`/`canvasId` in the URL, the "No Story Canvas selected" fallback renders instead of the chat shell.

- [ ] **Step 6: Commit**

```bash
git add "web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts" web/src/app/world-bible/page.tsx web/src/components/WorldInterview.tsx
git commit -m "feat: add Project 3 World Bible page and resume support (#38)"
```

---

### Task 6: Dashboard entry points

**Files:**
- Modify: `web/src/components/ProjectDashboard.tsx`
- Modify: `web/src/components/ChatInterview.tsx`

**Interfaces:**
- Consumes: `/world-bible` route (Task 5).

- [ ] **Step 1: Add a World Bible link to the dashboard's per-project card**

Find:
```tsx
                        <Link
                          href={`/character-bible?workspaceId=${p.workspaceId}&canvasId=${p.id}`}
                          className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10"
                        >
                          Character Bible
                        </Link>
```
Replace:
```tsx
                        <Link
                          href={`/character-bible?workspaceId=${p.workspaceId}&canvasId=${p.id}`}
                          className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10"
                        >
                          Character Bible
                        </Link>
                        <Link
                          href={`/world-bible?workspaceId=${p.workspaceId}&canvasId=${p.id}`}
                          className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10"
                        >
                          World Bible
                        </Link>
```

- [ ] **Step 2: Add a World Bible link to Project 1's Stage-8 "ready" panel**

Find:
```tsx
                      <Link
                        href={`/character-bible?workspaceId=${workspaceId}&canvasId=${canvasId}`}
                        className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white transition hover:from-red-500 hover:to-orange-400"
                      >
                        Continue to Character Development →
                      </Link>
                      <Link
                        href="/dashboard"
                        className="rounded-lg border border-red-500/50 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
                      >
                        Back to Dashboard
                      </Link>
```
Replace:
```tsx
                      <Link
                        href={`/character-bible?workspaceId=${workspaceId}&canvasId=${canvasId}`}
                        className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white transition hover:from-red-500 hover:to-orange-400"
                      >
                        Continue to Character Development →
                      </Link>
                      <Link
                        href={`/world-bible?workspaceId=${workspaceId}&canvasId=${canvasId}`}
                        className="rounded-lg border border-red-500/50 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
                      >
                        Start World Bible →
                      </Link>
                      <Link
                        href="/dashboard"
                        className="rounded-lg border border-red-500/50 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
                      >
                        Back to Dashboard
                      </Link>
```

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Manual read-through check**

Confirm by reading both files: the new links use the same `workspaceId`/`canvasId` variables already in scope at each location (no new props/state needed), and match the existing links' exact styling class for a consistent look.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ProjectDashboard.tsx web/src/components/ChatInterview.tsx
git commit -m "feat: add dashboard entry points to the Project 3 World Bible (#38)"
```
