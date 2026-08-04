# Stage-Gate Catch-Up & Element-ID Drift Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the model from inventing non-canonical Firestore element IDs (the root cause of a production story getting permanently stuck at Stage 1 while substantively at Stage 4), let the stage pointer catch up in a single turn once the underlying canon supports it, and provide a read-only script to find any other stories already in this state.

**Architecture:** A new canonical element-ID registry becomes the single source of truth for Project 1's fixed vocabulary, consumed by three things: the `emit_turn` tool schema (steers the model away from inventing IDs), a log-only visibility check in the chat route (catches whatever the enum doesn't), and a read-only audit script (retroactively finds already-drifted stories). Separately, the chat route's single-stage `advanceStage` call becomes a loop so one turn can walk the pointer through every stage whose gate already, objectively passes, instead of being capped at one stage per turn.

**Tech Stack:** TypeScript, Next.js API routes, Firestore (via `firebase-admin`), `tsx` (new devDependency, for running the standalone audit script).

## Global Constraints

- No automated test framework exists in this repo — verification is `npm run lint && npm run build` (run from `web/`), plus manual read-throughs, per this project's established convention.
- Unknown element IDs are accepted and logged, never rejected — no new hard-validation failure mode may be introduced (see spec decision 2).
- The registry (`elementRegistry.ts`) must be built as a union of the two *existing* sources (`stageDefinitions.ts`'s `requiredElementIds` and the literal IDs `foundationDoc.ts` reads), not an independently-authored list — so it can never drift from what the app's document compiler and stage gates actually use.
- The catch-up loop must preserve today's exact Stage-7-pause semantics: entering Stage 7 always halts further advancement within the same turn, resuming only on a subsequent turn.

---

### Task 1: Canonical Element Registry

**Files:**
- Create: `web/src/lib/canonEngine/elementRegistry.ts`

**Interfaces:**
- Consumes: `PROJECT1_STAGES` from `./stageDefinitions` (existing, array of `{ stage, name, requiredElementIds: string[], systemRun?: boolean }`).
- Produces: `PROJECT1_ELEMENT_IDS: string[]` and `isKnownElementId(id: string): boolean` — both consumed by Task 2 (`stateDelta.ts`), Task 3 (`chat/route.ts`), and Task 5 (audit script).

- [ ] **Step 1: Create the registry file**

```ts
import { PROJECT1_STAGES } from "./stageDefinitions";

/**
 * Canonical element-ID vocabulary for Project 1 - the single source of
 * truth combining every element ID any part of Project 1 reads or writes.
 * Built as a union of two existing sources so it can never drift from what
 * the app actually uses:
 *   - stage-gated IDs: stageDefinitions.ts's PROJECT1_STAGES[].requiredElementIds
 *   - document-only IDs: read directly by foundationDoc.ts's
 *     compileFoundationDocument but never required by any stage gate
 *
 * Used by stateDelta.ts's EMIT_TURN_TOOL as the element_id enum (steers the
 * model away from inventing non-canonical IDs) and by chat/route.ts and the
 * audit script (web/scripts/audit-stage-drift.ts) to detect any that slip
 * through anyway.
 *
 * Adding a new field to foundationDoc.ts's compileFoundationDocument? Add
 * its element_id here too (to DOCUMENT_ONLY_ELEMENT_IDS if no stage
 * requires it), or the model is never steered toward populating it.
 */

// IDs foundationDoc.ts reads directly but no PROJECT1_STAGES entry requires.
// Kept in sync manually - verified against every str()/arr()/formatEntry()
// call in foundationDoc.ts's compileFoundationDocument as of 2026-08-04.
const DOCUMENT_ONLY_ELEMENT_IDS: string[] = [
  "medium",
  "target_length",
  "core_story_promise",
  "story_identity",
  "narrative_priorities",
  "always_emphasize",
  "never_become",
  "comparable_works",
  "supporting_formats",
  "premise",
  "logline",
  "external_theme",
  "internal_theme",
  "narrative_purpose",
  "emotional_journey",
  "principal_characters",
  "nature_of_world",
];

const STAGE_GATED_ELEMENT_IDS: string[] = PROJECT1_STAGES.flatMap((s) => s.requiredElementIds);

export const PROJECT1_ELEMENT_IDS: string[] = Array.from(
  new Set([...STAGE_GATED_ELEMENT_IDS, ...DOCUMENT_ONLY_ELEMENT_IDS])
);

export function isKnownElementId(id: string): boolean {
  return PROJECT1_ELEMENT_IDS.includes(id);
}
```

- [ ] **Step 2: Sanity-check the registry size**

`STAGE_GATED_ELEMENT_IDS` should total 29 (4+1+8+5+4+7 across Stages 1-6; Stages 7-8 contribute 0). Combined with the 17 `DOCUMENT_ONLY_ELEMENT_IDS`, `PROJECT1_ELEMENT_IDS.length` should be exactly 46 with zero overlap (every ID in `DOCUMENT_ONLY_ELEMENT_IDS` was cross-checked against `stageDefinitions.ts` while writing this plan to confirm none of them are already stage-gated). Confirm this by temporarily adding `console.log(PROJECT1_ELEMENT_IDS.length, new Set(PROJECT1_ELEMENT_IDS).size)` at the bottom of the file, running `cd web && npx tsx -e "import('./src/lib/canonEngine/elementRegistry.ts').then(m => console.log(m.PROJECT1_ELEMENT_IDS.length))"` (this will fail until Task 5 adds `tsx` as a devDependency - if `tsx` isn't installed yet, instead temporarily add the console.log to the file, run `cd web && npm run build` and check the build output isn't broken, then verify the count by counting `DOCUMENT_ONLY_ELEMENT_IDS` entries by eye and cross-referencing `stageDefinitions.ts`'s `requiredElementIds` arrays), then remove the temporary log before committing. Both numbers must be 46 (if `new Set(...).size` is smaller than `.length`, an ID was duplicated between the two source lists - find and remove the duplicate from `DOCUMENT_ONLY_ELEMENT_IDS`).

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass with no errors (this file isn't imported anywhere yet, so it just needs to compile cleanly on its own).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/canonEngine/elementRegistry.ts
git commit -m "feat: add canonical element-ID registry for Project 1"
```

---

### Task 2: Steer the model away from inventing element IDs

**Files:**
- Modify: `web/src/lib/canonEngine/stateDelta.ts:1-2` (imports), `:32` (the `element_id` property)

**Interfaces:**
- Consumes: `PROJECT1_ELEMENT_IDS` from `./elementRegistry` (Task 1).

- [ ] **Step 1: Add the import**

In `web/src/lib/canonEngine/stateDelta.ts`, the file currently starts:
```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
```
Add a third import line immediately after:
```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { PROJECT1_ELEMENT_IDS } from "./elementRegistry";
```

- [ ] **Step 2: Add the enum + description to `element_id`**

Find this exact line (currently line 32):
```ts
            element_id: { type: "string" },
```
Replace with:
```ts
            element_id: {
              type: "string",
              enum: PROJECT1_ELEMENT_IDS,
              description:
                "The canonical element ID this update is for - always pick the closest match from the enum. Never invent a new key; every fact captured during the interview belongs in one of these fixed slots.",
            },
```

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. If TypeScript complains about the `enum` property's type, check that the sibling `status` property a few lines below (`status: { type: "string", enum: ["Exploring", "Working", "Confirmed", "Parked"] }`) still compiles unchanged - `element_id`'s new `enum` uses the exact same shape (a `string[]` on a `{ type: "string" }` property), just with the array coming from an imported constant instead of an inline literal.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/canonEngine/stateDelta.ts
git commit -m "feat: constrain emit_turn's element_id to the canonical registry"
```

---

### Task 3: Log-only visibility for element IDs outside the registry

**Files:**
- Modify: `web/src/app/api/chat/route.ts:9-33` (imports), `:261` (right after `updates` is built)

**Interfaces:**
- Consumes: `isKnownElementId` from `@/lib/canonEngine/elementRegistry` (Task 1).

This is defense in depth for Task 2: the tool schema's `enum` is best-effort steering, not a guarantee. Anything that still slips through gets logged, never rejected, matching this codebase's existing `turnGuardrails.ts` log-only philosophy.

- [ ] **Step 1: Add the import**

In `web/src/app/api/chat/route.ts`, find this existing import line:
```ts
import { EMIT_TURN_TOOL, StateDeltaSchema, type ElementUpdateInput } from "@/lib/canonEngine/stateDelta";
```
Add a new import line immediately after it:
```ts
import { EMIT_TURN_TOOL, StateDeltaSchema, type ElementUpdateInput } from "@/lib/canonEngine/stateDelta";
import { isKnownElementId } from "@/lib/canonEngine/elementRegistry";
```

- [ ] **Step 2: Add the log-only check**

Find this exact line (currently line 261):
```ts
    const updates = delta.updates.map(toElementUpdate);
```
Immediately after it, insert:
```ts
    const updates = delta.updates.map(toElementUpdate);
    for (const update of updates) {
      if (!isKnownElementId(update.element_id)) {
        console.warn(
          `[chat] unknown element_id "${update.element_id}" on turn ${turnId} - not in the Project 1 canonical registry, writing as-is`
        );
      }
    }
```
This runs once, on the full `updates` array, before it's used by either downstream code path (the Conflict-Resolution branch's `remainingUpdates` is a filtered subset of this same `updates` array, so a single check here covers both without duplicating it at each `applyStateDelta` call site).

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/chat/route.ts
git commit -m "feat: log element_id writes that fall outside the canonical registry"
```

---

### Task 4: Stage-gate catch-up loop

**Files:**
- Modify: `web/src/app/api/chat/route.ts:313-337`

**Interfaces:**
- Consumes: `checkStageGate`, `advanceStage`, `PROJECT1_STAGES` (all already imported in this file from `@/lib/canonEngine/stageFsm`); `OutstandingQuestion` (already imported as a type from the same module); `collectCommonMistakes` (already defined locally in this file at line 80); `runStage7Audit`, `formatAuditSummary`, `setStage7Audit` (already imported).
- Produces: no new exports - this is a behavioral change to an existing block. `currentStage`, `outstandingQuestions`, and `auditSummary` (all already declared `let`/mutable in this scope) end the block with the same meaning they have today: the stage to report back in the response, the outstanding questions generated this turn, and the Stage-7 audit summary if Stage 7 was just entered.

This task is independent of Tasks 1-3 (it doesn't touch the registry or element IDs at all) - it can be done in any order relative to them, but is listed last among the code changes because it's the largest, highest-risk single edit and benefits from its own focused review.

- [ ] **Step 1: Replace the single-advance block with a loop**

Find this exact block (currently lines 313-337):
```ts
    let currentStage = story.currentStage;
    let outstandingQuestions: OutstandingQuestion[] = [];
    let auditSummary: string | null = null;
    const isLastStage = story.currentStage >= PROJECT1_STAGES[PROJECT1_STAGES.length - 1].stage;
    const blockedByStage7 = story.currentStage === 7 && !stage7Responded;
    if (!nextPendingConflict && delta.stage_ready_to_advance && !isLastStage && !blockedByStage7) {
      const freshElements = await listElements(storyId);
      const gate = checkStageGate(story.currentStage, freshElements);
      if (gate.canAdvance) {
        const result = advanceStage(story.currentStage, freshElements);
        currentStage = result.nextStage;
        outstandingQuestions = result.outstandingQuestions;
        await touchStory(storyId, { currentStage });
        // Persist Parked-element questions for the Stage 8 compiler (#18).
        await appendOutstandingQuestions(storyId, outstandingQuestions);

        // Entering Stage 7 triggers the system-run Creative Audit (#17).
        if (currentStage === 7) {
          const commonMistakes = collectCommonMistakes(freshElements);
          const audit = runStage7Audit(freshElements, commonMistakes);
          await setStage7Audit(storyId, audit);
          auditSummary = formatAuditSummary(audit);
        }
      }
    }
```
Replace with:
```ts
    let currentStage = story.currentStage;
    let outstandingQuestions: OutstandingQuestion[] = [];
    let auditSummary: string | null = null;
    if (!nextPendingConflict && delta.stage_ready_to_advance) {
      // No writes happen to elements between iterations below, so one
      // snapshot is valid for every gate check this turn - no re-listing
      // needed. This is what lets one qualifying turn catch the stage
      // pointer up through every stage whose gate already, objectively
      // passes, instead of being capped at one stage per turn.
      const elements = await listElements(storyId);
      const allOutstanding: OutstandingQuestion[] = [];

      while (true) {
        const isLastStage = currentStage >= PROJECT1_STAGES[PROJECT1_STAGES.length - 1].stage;
        const blockedByStage7 = currentStage === 7 && !stage7Responded;
        if (isLastStage || blockedByStage7) break;

        const gate = checkStageGate(currentStage, elements);
        if (!gate.canAdvance) break;

        const result = advanceStage(currentStage, elements);
        currentStage = result.nextStage;
        allOutstanding.push(...result.outstandingQuestions);
        await touchStory(storyId, { currentStage });
        // Persist Parked-element questions for the Stage 8 compiler (#18).
        await appendOutstandingQuestions(storyId, result.outstandingQuestions);

        // Entering Stage 7 triggers the system-run Creative Audit (#17).
        if (currentStage === 7) {
          const commonMistakes = collectCommonMistakes(elements);
          const audit = runStage7Audit(elements, commonMistakes);
          await setStage7Audit(storyId, audit);
          auditSummary = formatAuditSummary(audit);
        }
      }
      outstandingQuestions = allOutstanding;
    }
```

Note what changed and what didn't:
- The top-level `const isLastStage = story.currentStage >= ...` and `const blockedByStage7 = story.currentStage === 7 && !stage7Responded;` declarations are removed entirely - they are recomputed fresh, against the evolving `currentStage`, as `const`s inside the loop instead. Leaving the old top-level ones in place would make them unused (their only use site moved inside the loop) and fail `npm run lint`.
- `freshElements` is renamed `elements` and fetched once, outside the loop, since nothing between iterations writes to elements.
- The variable name `outstandingQuestions` used inside the old block is now `result.outstandingQuestions` per-iteration, accumulated into `allOutstanding`, then assigned to the outer `outstandingQuestions` once after the loop ends - so the response JSON further down the function (which reads `outstandingQuestions`) is unaffected.
- Everything else - the exact side effects, their order, and the Stage-7-entry audit trigger - is identical to today, just repeated per stage crossed instead of running once.

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass, with no unused-variable warnings for `isLastStage`/`blockedByStage7`.

- [ ] **Step 3: Manual read-through check**

Confirm by reading the edited function: a story sitting at Stage 3 whose Stage 3, 4, and 5 required elements are all already `Confirmed` or `Parked` (e.g., because they were captured correctly under canonical IDs across earlier turns, or because Task 1-3's fix let previously-drifted elements get correctly captured this turn), receiving one turn where the model sets `stage_ready_to_advance: true`, should end that turn at `currentStage: 6` (having crossed 3→4→5→6 in the loop), not `currentStage: 4`. Confirm a story sitting at Stage 6 whose Stage 6 elements just became complete, with Stage 7 next, still stops at Stage 7 for that turn (via `blockedByStage7`) and only proceeds to 8 on the following turn, exactly as today.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/chat/route.ts
git commit -m "feat: let stage advancement catch up through multiple stages in one turn"
```

---

### Task 5: Read-only drift-audit script

**Files:**
- Create: `web/scripts/audit-stage-drift.ts`
- Modify: `web/package.json:23-32` (devDependencies)

**Interfaces:**
- Consumes: `getDb` from `../src/lib/firebaseAdmin` (existing), `listElements` from `../src/lib/canonEngine/canonStore` (existing), `isKnownElementId` from `../src/lib/canonEngine/elementRegistry` (Task 1). The element type is derived as `Awaited<ReturnType<typeof listElements>>` rather than importing `CanonElement` directly, to avoid an unused-type-import.

This script is read-only: it never writes to Firestore. It requires the same credentials the running app needs (`GOOGLE_APPLICATION_CREDENTIALS_JSON` in `web/.env.local`, or Application Default Credentials via `gcloud auth application-default login` - see `web/src/lib/firebaseAdmin.ts`'s own header comment). If those aren't configured in whatever environment this runs in, it will fail with whatever error `firebase-admin` raises trying to initialize - that's expected and not a bug in this script.

- [ ] **Step 1: Add `tsx` as a devDependency**

In `web/package.json`, the `devDependencies` object currently is:
```json
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.11",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
```
Add `"tsx": "^4"` (alphabetically, after `"tailwindcss"`):
```json
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.11",
    "tailwindcss": "^4",
    "tsx": "^4",
    "typescript": "^5"
  }
```
Then run `cd web && npm install` to install it and update `package-lock.json`.

- [ ] **Step 2: Write the audit script**

Create `web/scripts/audit-stage-drift.ts`:
```ts
#!/usr/bin/env node
/**
 * Read-only audit for stage-gate drift (2026-08-04) - scans every Project 1
 * story for two independent signals that its currentStage pointer may be
 * stuck behind what the canon substantively supports:
 *
 *   1. Elements whose element_id isn't in the canonical registry (direct
 *      drift evidence - the only signal that can catch already-drifted
 *      data from before this fix; the tool-schema enum and the catch-up
 *      loop only help going forward).
 *   2. A story where the highest `stage` number tagged on any element is
 *      well ahead of the stored currentStage - the model itself asserting
 *      later-stage progress the FSM pointer never caught up to.
 *
 * Makes no writes. Prints a report for human triage - the same kind of
 * judgment call the one-off repair for story NtEdq7hZfyaW33eN2DCE needed
 * (deciding Parked-vs-Confirmed, writing honest rationale for anything with
 * no real captured content) isn't something this script should automate.
 *
 * Usage (from repo root): npx tsx web/scripts/audit-stage-drift.ts
 * Requires the same Firestore credentials the running app needs - see
 * web/src/lib/firebaseAdmin.ts's header comment.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getDb } from "../src/lib/firebaseAdmin";
import { listElements } from "../src/lib/canonEngine/canonStore";
import { isKnownElementId } from "../src/lib/canonEngine/elementRegistry";

// tsx doesn't auto-load .env.local the way `next dev`/`next build` do, so
// load it by hand. This runs before main() below calls getDb() (the only
// place any of the imports above actually read process.env - none of them
// touch it at module-load time), so ordering here is safe despite import
// declarations always being hoisted ahead of this code.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

interface StoryRow {
  id: string;
  currentStage: number;
  currentProject: string;
}

interface FlaggedStory {
  storyId: string;
  currentStage: number;
  maxElementStage: number;
  unknownElementIds: string[];
}

async function listAllStories(): Promise<StoryRow[]> {
  const db = getDb();
  const snap = await db.collection("stories").get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      currentStage: typeof data.currentStage === "number" ? data.currentStage : 1,
      currentProject: typeof data.currentProject === "string" ? data.currentProject : "project1",
    };
  });
}

function auditStory(storyId: string, currentStage: number, elements: Awaited<ReturnType<typeof listElements>>): FlaggedStory | null {
  const unknownElementIds = elements.map((e) => e.element_id).filter((id) => !isKnownElementId(id));
  const maxElementStage = elements.reduce((max, e) => Math.max(max, e.stage ?? 0), 0);
  const stageMismatch = maxElementStage > currentStage + 1;

  if (unknownElementIds.length === 0 && !stageMismatch) return null;
  return { storyId, currentStage, maxElementStage, unknownElementIds };
}

async function main() {
  const stories = (await listAllStories()).filter((s) => s.currentProject === "project1");
  console.log(`Scanning ${stories.length} Project 1 stories for stage-gate drift...\n`);

  const flagged: FlaggedStory[] = [];
  for (const story of stories) {
    const elements = await listElements(story.id);
    const result = auditStory(story.id, story.currentStage, elements);
    if (result) flagged.push(result);
  }

  if (flagged.length === 0) {
    console.log("No drift signals found - no stories flagged.");
    return;
  }

  console.log(`${flagged.length} of ${stories.length} stories flagged:\n`);
  for (const f of flagged) {
    console.log(`Story ${f.storyId}`);
    console.log(`  currentStage: ${f.currentStage}`);
    console.log(`  highest element-tagged stage: ${f.maxElementStage}`);
    if (f.unknownElementIds.length > 0) {
      console.log(`  non-canonical element_ids (${f.unknownElementIds.length}): ${f.unknownElementIds.join(", ")}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. `web/scripts/audit-stage-drift.ts` is covered by the existing `tsconfig.json`'s `include: ["**/*.ts", ...]` (not scoped to `src/` only) and the existing flat `eslint.config.mjs` (no `files` restriction), so both commands already type-check and lint this new file with no extra configuration.

- [ ] **Step 4: Confirm it fails gracefully without credentials**

Run: `cd web && npx tsx scripts/audit-stage-drift.ts`
Expected: since this worktree's `.env.local` has no `GOOGLE_APPLICATION_CREDENTIALS_JSON` set (confirmed while writing this plan), the script should exit with a clear Firebase/Google-Auth error from `firebase-admin` itself (e.g. about missing credentials), not an unrelated crash (a `TypeError` from a bug in this script's own code, a stack trace pointing at `audit-stage-drift.ts` rather than `firebase-admin`). If the failure points into this script's own logic rather than `firebase-admin`'s credential resolution, that's a real bug - fix it before moving on. Getting an actual "N stories flagged" report requires running this against a real Firestore project's credentials, which is a follow-up step for whoever runs it against production, not part of this task's verification.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/scripts/audit-stage-drift.ts
git commit -m "feat: add read-only audit script for stage-gate drift"
```
