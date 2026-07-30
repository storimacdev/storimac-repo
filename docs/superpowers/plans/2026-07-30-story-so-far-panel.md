# Story So Far View-Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interview screen's redundant "Latest from your editor" / empty-state right pane with a live "story so far" synthesis of Confirmed canon elements, grouped by stage.

**Architecture:** A new presentational component, `StorySoFar.tsx`, reads the same `elements`/`currentStage` state `ChatInterview.tsx` already maintains (no new fetches) and renders only Confirmed elements as label + value, grouped by `PROJECT1_STAGES`. It replaces two existing JSX blocks in `ChatInterview.tsx` one-for-one, in the same conditional slot, so the Stage 8 document card and loading spinner keep their exact current behavior.

**Tech Stack:** Next.js App Router, React (client component), TypeScript, Tailwind CSS. No test framework exists in this repo (`web/package.json` has no test runner) — verification is `npm run lint && npm run build` plus a manual walkthrough, matching the convention used throughout this project.

## Global Constraints

- `retrieval_code` must never render anywhere in this component — `PanelElement`'s type has no such field, so this is structurally enforced, not a runtime check to add.
- Only elements with `status === "Confirmed"` are shown. Working/Exploring/Parked elements never appear here (they stay Canon-tab-only via `CanonPanel.tsx`, which this plan does not modify).
- A stage with zero currently-Confirmed elements renders no heading and no content — no empty sections.
- The Stage 8 document card (`currentStage >= 8`) and the loading spinner in `ChatInterview.tsx`'s right pane must keep their exact current rendering and precedence — this plan only changes what renders in the space between them.

---

### Task 1: `StorySoFar` component and integration

**Files:**
- Create: `web/src/components/StorySoFar.tsx`
- Modify: `web/src/components/ChatInterview.tsx:6-9` (imports), `:225` (remove `lastAssistant`), `:425-459` (replace two blocks with one)

**Interfaces:**
- Consumes: `PanelElement` type (already exported from `@/components/CanonPanel`: `{ element_id: string; status: "Exploring" | "Working" | "Confirmed" | "Parked"; depth_mode?: string; value?: unknown }`); `PROJECT1_STAGES` from `@/lib/canonEngine/stageDefinitions` (`StageDefinition[]`, each `{ stage: number; name: string; requiredElementIds: string[]; systemRun?: boolean }`).
- Produces: `export default function StorySoFar({ elements, currentStage }: { elements: PanelElement[]; currentStage: number })` — a JSX component with no other exports, consumed only by `ChatInterview.tsx`.

- [ ] **Step 1: Create the component**

`web/src/components/StorySoFar.tsx`:

```tsx
"use client";

import { PROJECT1_STAGES } from "@/lib/canonEngine/stageDefinitions";
import type { PanelElement } from "@/components/CanonPanel";

/**
 * "Story so far" synthesis for the interview's right-hand pane - the
 * narrative-facing counterpart to CanonPanel's technical inspector (Canon
 * tab, left panel). Shows only Confirmed elements as label + value, grouped
 * by stage; Working/Exploring/Parked elements stay Canon-tab-only so this
 * always reads as settled fact, never a to-do list.
 */

function humanizeLabel(elementId: string): string {
  return elementId
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default function StorySoFar({
  elements,
  currentStage,
}: {
  elements: PanelElement[];
  currentStage: number;
}) {
  const byId = new Map(elements.map((e) => [e.element_id, e]));

  const stages = PROJECT1_STAGES.filter(
    (stage) => stage.stage <= currentStage && stage.requiredElementIds.length > 0
  )
    .map((stage) => ({
      ...stage,
      confirmed: stage.requiredElementIds.filter((id) => byId.get(id)?.status === "Confirmed"),
    }))
    .filter((stage) => stage.confirmed.length > 0);

  if (stages.length === 0) {
    return (
      <div className="mx-auto max-w-3xl text-center text-sm text-neutral-500">
        Your story is just getting started — confirmed details will appear here as you go.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {stages.map((stage) => (
        <div key={stage.stage}>
          <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">{stage.name}</p>
          <dl className="space-y-2">
            {stage.confirmed.map((id) => {
              const el = byId.get(id)!;
              return (
                <div key={id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {humanizeLabel(id)}
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-neutral-200">{formatValue(el.value)}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `ChatInterview.tsx`**

Add the import. In the existing import block (lines 6-9), insert `StorySoFar` after the `Markdown` import:

```ts
import CanonPanel, { type PanelElement } from "@/components/CanonPanel";
import Markdown from "@/components/Markdown";
import StorySoFar from "@/components/StorySoFar";
import UserMenu from "@/components/UserMenu";
import { useUser } from "@/components/UserProvider";
```

Remove the now-superseded `lastAssistant` line (currently line 225, immediately before the `return (` that starts the main JSX):

```ts
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant") ?? null;
```

Delete that line entirely.

Replace the two blocks currently at lines 425-459 — the `{!loading && !doc && lastAssistant && (...)}` "Latest from your editor" block and the `{!loading && !doc && !lastAssistant && !resuming && (...)}` empty-state block — with:

```tsx
                {!loading && !doc && (
                  <StorySoFar elements={elements} currentStage={currentStage} />
                )}
```

This sits in the exact same position those two blocks occupied, right after the `{loading && (...)}` spinner block and still inside the `currentStage >= 8` document card's sibling scope — so the document card (which has its own separate `{currentStage >= 8 && !loading && (...)}` block earlier) and the loading spinner are both untouched.

- [ ] **Step 3: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. This also confirms `lastAssistant` was fully removed — if any reference to it survived the edit, TypeScript will fail the build with an "undefined variable" error.

- [ ] **Step 4: Manual walkthrough**

Run: `cd web && npm run dev`, then in a browser:

1. Start a fresh interview (new Story Canvas). Confirm the right pane shows the empty-state copy: "Your story is just getting started — confirmed details will appear here as you go."
2. Answer through Stage 1 until at least one element (e.g. `concept`) is Confirmed. Confirm the right pane immediately shows a "Discover the Story" heading with a "Concept" label and its value — no page reload needed, updates on the same turn's response.
3. Continue into Stage 2 (format diagnosis). Confirm no format catalog code (a letter+2-digits pattern like "A05") ever appears anywhere in the right pane, even after `primary_format` is Confirmed.
4. Switch to the "Story Canon" tab (left panel) and confirm it still shows every element with its status badge exactly as before — unaffected by this change.
5. If reasonably reachable in this session, progress to Stage 8 and confirm the document card still fully takes over the right pane exactly as before (unaffected by this change); if not reachable, skip this check and note it.

- [ ] **Step 5: Fix anything that fails, re-run lint + build, commit**

```bash
cd web && npm run lint && npm run build
git add web/src/components/StorySoFar.tsx web/src/components/ChatInterview.tsx
git commit -m "Add Story So Far view pane, replacing the redundant chat echo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
