# Guardrail Flags Debug Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the questionnaire-dump guardrail flag (GitHub issue #23's last remaining acceptance criterion) in the existing debug-mode Canon panel, persisted server-side so it survives reload/resume.

**Architecture:** A new Firestore subcollection (`stories/{storyId}/guardrail_flags`) mirrors the existing `outstanding_questions` subcollection pattern in `storyStore.ts`. `/api/chat` persists a flag whenever `turnGuardrails.ts`'s existing `evaluateTurn()` marks a turn as a questionnaire dump, and returns the new flag in its response for live updates. The canvas resume route returns the full persisted list so reopening a canvas shows prior flags too. `CanonPanel.tsx` (already debug-gated via `?debug=1` from issue #11) gains a new summary block; `ChatInterview.tsx` threads the data through.

**Tech Stack:** Next.js App Router (route handlers), TypeScript, Firebase Admin SDK (Firestore). No test framework exists in this repo (`web/package.json` has no test runner) — verification is `npm run lint && npm run build` per task plus a manual walkthrough in the final task.

## Global Constraints

- Scope is the questionnaire-dump flag only (`TurnHeuristics.isQuestionnaireDump` / `questionCount`) — `narrationLeakMatches` and `promptLeakMatches` (also computed by `evaluateTurn`) are explicitly out of scope for this plan.
- The guardrail-flag Firestore write must never fail or block the chat turn itself — wrap it in its own try/catch, separate from the rest of the turn's error handling, matching `turnGuardrails.ts`'s own documented principle ("These never block or alter the reply").
- New client-facing types are defined locally (in `CanonPanel.tsx`, exported for `ChatInterview.tsx` to import) rather than importing the server-side `StoredGuardrailFlag` type from `storyStore.ts` directly — this mirrors the codebase's existing convention (`PanelElement` in `CanonPanel.tsx` already redefines a subset of the server-side `CanonElement` type rather than importing it).
- No test framework exists — do not add one. Verify with `cd web && npm run lint && npm run build` after every task, and with the manual walkthrough in the final task.

---

### Task 1: Persist guardrail flags — data layer and `/api/chat` write path

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`
- Modify: `web/src/lib/turnGuardrails.ts`
- Modify: `web/src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `TurnHeuristics` (existing type in `turnGuardrails.ts`: `{ questionCount: number; isQuestionnaireDump: boolean; narrationLeakMatches: string[]; promptLeakMatches: string[] }`); `evaluateTurn(reply: string): TurnHeuristics` (existing, unchanged).
- Produces: `StoredGuardrailFlag = { turnId: string; questionCount: number; ts: string }` (exported from `storyStore.ts`); `appendGuardrailFlag(storyId: string, flag: Omit<StoredGuardrailFlag, "ts">): Promise<StoredGuardrailFlag>` (writes to Firestore, returns the full flag including its server-assigned `ts`); `listGuardrailFlags(storyId: string): Promise<StoredGuardrailFlag[]>` (ordered oldest-first, matching `listOutstandingQuestions`'s convention). `logTurnHeuristics` changes from returning `void` to returning `TurnHeuristics` (its only existing caller, `route.ts`, currently ignores the return value, so this is non-breaking). `/api/chat`'s JSON response gains one new field: `guardrailFlag: StoredGuardrailFlag | null`.

- [ ] **Step 1: Add the `guardrail_flags` subcollection to `storyStore.ts`**

Add this near `outstanding_questions`'s existing functions (after `listOutstandingQuestions`, before `appendAuthorTypeAssessment`, to keep related subcollection helpers grouped):

```ts
export interface StoredGuardrailFlag {
  turnId: string;
  questionCount: number;
  ts: string;
}

function guardrailFlagsCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("guardrail_flags");
}

/** Persists a questionnaire-dump flag for prompt-tuning review (issue #23). Only flagged turns get a doc. */
export async function appendGuardrailFlag(
  storyId: string,
  flag: Omit<StoredGuardrailFlag, "ts">
): Promise<StoredGuardrailFlag> {
  const ts = new Date().toISOString();
  const full: StoredGuardrailFlag = { ...flag, ts };
  await guardrailFlagsCollection(storyId).add(full);
  return full;
}

export async function listGuardrailFlags(storyId: string): Promise<StoredGuardrailFlag[]> {
  const snap = await guardrailFlagsCollection(storyId).orderBy("ts", "asc").get();
  return snap.docs.map((d) => d.data() as StoredGuardrailFlag);
}
```

- [ ] **Step 2: Make `logTurnHeuristics` return the heuristics it already computes**

In `web/src/lib/turnGuardrails.ts`, change the function signature and add a `return h;` at the end — do not change any of its existing logic (the `console.warn` calls stay exactly as they are):

```ts
/** Logs flags for prompt-tuning review. Never throws, never blocks. Returns the computed heuristics so callers can act on them (issue #23). */
export function logTurnHeuristics(reply: string, turnId: string): TurnHeuristics {
  const h = evaluateTurn(reply);

  if (h.isQuestionnaireDump) {
    console.warn(
      `[turn-guardrail] questionnaire-dump turn ${turnId}: ${h.questionCount} question marks`
    );
  }
  if (h.narrationLeakMatches.length > 0) {
    console.warn(
      `[turn-guardrail] internal-narration leak turn ${turnId}: matched ${h.narrationLeakMatches.join(", ")}`
    );
  }
  if (h.promptLeakMatches.length > 0) {
    console.warn(
      `[turn-guardrail] system-prompt leak turn ${turnId}: matched ${h.promptLeakMatches.join(", ")}`
    );
  }

  return h;
}
```

- [ ] **Step 3: Wire the write path into `/api/chat/route.ts`**

Add `appendGuardrailFlag` and `type StoredGuardrailFlag` to the existing `storyStore` import block (currently lines 9-19):

```ts
import {
  getStory,
  appendMessage,
  appendAuthorTypeAssessment,
  appendOutstandingQuestions,
  appendGuardrailFlag,
  listMessages,
  touchStory,
  setPendingConflict,
  setStage7Audit,
  type StoryPendingConflict,
  type StoredGuardrailFlag,
} from "@/lib/canonEngine/storyStore";
```

Replace the existing `logTurnHeuristics(delta.reply, turnId);` line (currently line 322, right after the two `appendMessage` calls and before the `elementsAfter` comment) with:

```ts
    const heuristics = logTurnHeuristics(delta.reply, turnId);
    let guardrailFlag: StoredGuardrailFlag | null = null;
    if (heuristics.isQuestionnaireDump) {
      try {
        guardrailFlag = await appendGuardrailFlag(storyId, { turnId, questionCount: heuristics.questionCount });
      } catch (err) {
        console.error(`[chat] failed to persist guardrail flag for turn ${turnId}:`, err);
      }
    }
```

Add `guardrailFlag` to the response object (currently the `return NextResponse.json({...})` block right after):

```ts
    return NextResponse.json({
      reply: delta.reply,
      auditSummary,
      elements: elementsAfter,
      currentStage,
      currentStageName: getStageDefinition(currentStage).name,
      stageAdvanced: currentStage !== story.currentStage,
      outstandingQuestions,
      conflict: nextPendingConflict,
      guardrailFlag,
    });
```

- [ ] **Step 4: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts web/src/lib/turnGuardrails.ts web/src/app/api/chat/route.ts
git commit -m "Persist questionnaire-dump guardrail flags (#23)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Read path and debug panel rendering

**Files:**
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`
- Modify: `web/src/components/CanonPanel.tsx`
- Modify: `web/src/components/ChatInterview.tsx`

**Interfaces:**
- Consumes: `listGuardrailFlags(storyId): Promise<StoredGuardrailFlag[]>` and the `StoredGuardrailFlag` shape from Task 1; `/api/chat`'s response now includes `guardrailFlag: StoredGuardrailFlag | null` (Task 1).
- Produces: `GET .../canvases/[canvasId]` response gains `guardrailFlags: StoredGuardrailFlag[]`. `CanonPanel.tsx` exports a new type `GuardrailFlag = { turnId: string; questionCount: number; ts: string }` and accepts a new optional prop `guardrailFlags?: GuardrailFlag[]`.

- [ ] **Step 1: Return persisted flags from the resume route**

In `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`, add `listGuardrailFlags` to the existing `storyStore` import (currently `import { getStory, listMessages, renameStory, deleteStory } from "@/lib/canonEngine/storyStore";`):

```ts
import { getStory, listMessages, renameStory, deleteStory, listGuardrailFlags } from "@/lib/canonEngine/storyStore";
```

Change the `GET` handler's parallel fetch (currently):

```ts
    const [elements, messages] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
    ]);
```

to:

```ts
    const [elements, messages, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      listGuardrailFlags(canvasId),
    ]);
```

and add `guardrailFlags` to the response:

```ts
    return NextResponse.json({ story, elements, messages, guardrailFlags });
```

- [ ] **Step 2: Add the type, prop, and render block to `CanonPanel.tsx`**

Add this new exported type right after the existing `PanelElement` type definition:

```ts
export type GuardrailFlag = { turnId: string; questionCount: number; ts: string };
```

Change the component's props (currently `{ elements, currentStage, debug = false }: { elements: PanelElement[]; currentStage: number; debug?: boolean }`) to:

```ts
export default function CanonPanel({
  elements,
  currentStage,
  debug = false,
  guardrailFlags,
}: {
  elements: PanelElement[];
  currentStage: number;
  debug?: boolean;
  guardrailFlags?: GuardrailFlag[];
}) {
```

Inside the returned `<div className="h-full overflow-y-auto px-3 py-3">`, insert this block immediately before the `{PROJECT1_STAGES.map((stage) => {...})}` call:

```tsx
      {debug && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Questionnaire-dump flags this session: {guardrailFlags?.length ?? 0}
          </p>
          {guardrailFlags && guardrailFlags.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {guardrailFlags.map((f, i) => (
                <li key={`${f.turnId}-${i}`} className="flex items-center justify-between gap-2 text-[10px] text-neutral-400">
                  <span className="truncate font-mono">{f.turnId.slice(0, 8)}</span>
                  <span>{f.questionCount} questions</span>
                  <span>{new Date(f.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
```

- [ ] **Step 3: Wire state through `ChatInterview.tsx`**

Change the `CanonPanel` import (currently `import CanonPanel, { type PanelElement } from "@/components/CanonPanel";`) to:

```ts
import CanonPanel, { type PanelElement, type GuardrailFlag } from "@/components/CanonPanel";
```

Add new state alongside the existing `elements` state declaration (`const [elements, setElements] = useState<PanelElement[]>([]);`):

```ts
  const [guardrailFlags, setGuardrailFlags] = useState<GuardrailFlag[]>([]);
```

In the resume `useEffect` (the one that fetches `` `/api/workspaces/${workspaceId}/canvases/${canvasId}` ``), immediately after the existing `if (Array.isArray(data.elements)) setElements(data.elements);` line, add:

```ts
        if (Array.isArray(data.guardrailFlags)) setGuardrailFlags(data.guardrailFlags);
```

In `sendMessage`'s success path, immediately after the existing `if (Array.isArray(data.elements)) setElements(data.elements);` line, add:

```ts
      if (data.guardrailFlag) setGuardrailFlags((prev) => [...prev, data.guardrailFlag]);
```

Pass the new prop to `CanonPanel` (currently `<CanonPanel elements={elements} currentStage={currentStage} debug={debug} />`):

```tsx
                  <CanonPanel elements={elements} currentStage={currentStage} debug={debug} guardrailFlags={guardrailFlags} />
```

- [ ] **Step 4: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/workspaces/\[workspaceId\]/canvases/\[canvasId\]/route.ts web/src/components/CanonPanel.tsx web/src/components/ChatInterview.tsx
git commit -m "Surface guardrail flags in the debug Canon panel (#23)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Manual end-to-end verification

**Files:** none (verification only; fix-ups amend the relevant file(s) plus a follow-up commit)

- [ ] **Step 1: Start the dev server**

Run in `web/`: `npm run dev`.

- [ ] **Step 2: Verify the flag persists and appears live**

- Open an interview at `/interview?workspaceId=...&canvasId=...&debug=1`, switch to the "Story Canon" tab. Confirm the new block reads "Questionnaire-dump flags this session: 0" with no list.
- Send a message that prompts the model to reply with more than 3 question marks (e.g. ask an open-ended "what should I consider about my story?" type question likely to draw a multi-part clarifying response — if the first attempt doesn't trigger it, try a couple of different prompts, since this depends on the model's actual reply).
- Confirm the count increments and a row appears (shortened turn id, question count, timestamp) without a page reload.

- [ ] **Step 3: Verify persistence across reload**

- Reload the page (or navigate away and back to the same `workspaceId`/`canvasId`). Confirm the same flag(s) are still shown in the debug block — proving the data survived via Firestore, not just React state.

- [ ] **Step 4: Verify the flag is invisible without `?debug=1`**

- Load the same canvas without the `debug=1` query param. Confirm the "Story Canon" tab shows no guardrail-flag block at all (the existing `debug &&` gate applies to the whole block, matching how per-element `depth_mode` badges are already hidden without it).

- [ ] **Step 5: Fix anything that fails, re-run lint + build, commit fixes**

```bash
cd web && npm run lint && npm run build
git add -A
git commit -m "Guardrail flags debug panel verification fixes (#23)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Skip this commit if nothing needed fixing.)
