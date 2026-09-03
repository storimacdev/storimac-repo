# Auto-Scroll to Latest Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every interview screen (Story Foundation, Character Bible, World Bible) opens already scrolled to the latest message, and shows a "Jump to latest" button whenever the author has manually scrolled up into history.

**Architecture:** A single shared hook (`useScrollToLatest`) captures the scroll-position tracking, the instant-vs-smooth scroll action, and the "near bottom" state; all three interview components consume it identically, replacing their existing bare `listEndRef` pattern.

**Tech Stack:** React (client components). No new dependencies.

## Global Constraints

- Chat order stays chronological (oldest at top, newest at bottom) — this fix is about scroll position on load, not message order.
- The initial scroll-to-latest on load is instant (`behavior: "auto"`, no animation); the existing post-send scroll and the new button's scroll both stay smooth-animated (`behavior: "smooth"`), matching today's existing post-send behavior exactly.
- "Near bottom" uses a 100px distance threshold, not exact equality.
- No automated test framework exists in this repo. Verification for every task is `npm run lint` and `npm run build`, both run from the `web/` directory, plus a manual read-through (and, for the UI tasks, a manual dev-server check).
- All three interview components (`ChatInterview.tsx`, `CharacterInterview.tsx`, `WorldInterview.tsx`) currently import `useRef` from `"react"` ONLY for their `listEndRef` declaration (confirmed: no other `useRef` usage exists in any of the three files) — removing `listEndRef` means removing `useRef` from each file's import line too, or `npm run lint` will flag it as unused.

---

### Task 1: Create the shared scroll hook

**Files:**
- Create: `web/src/lib/useScrollToLatest.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function useScrollToLatest(): { containerRef: RefObject<HTMLDivElement | null>; endRef: RefObject<HTMLDivElement | null>; isNearBottom: boolean; handleScroll: () => void; scrollToLatest: (behavior?: ScrollBehavior) => void }`. Tasks 2, 3, and 4 all consume this exact shape.

- [ ] **Step 1: Create the hook file**

```ts
"use client";

import { useRef, useState } from "react";

/** Shared scroll-position tracking for a chat-style message list - used
 * identically by all three interview screens (Story Foundation, Character
 * Bible, World Bible), which otherwise duplicate the same scrollable-
 * panel structure. `containerRef` goes on the scrollable messages `<div>`
 * (with `onScroll={handleScroll}`); `endRef` goes on the empty marker
 * `<div>` at the bottom of the message list; `scrollToLatest` scrolls to
 * that marker. */
export function useScrollToLatest() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    setIsNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    endRef.current?.scrollIntoView({ behavior });
  }

  return { containerRef, endRef, isNearBottom, handleScroll, scrollToLatest };
}
```

- [ ] **Step 2: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/useScrollToLatest.ts
git commit -m "feat: add shared useScrollToLatest hook"
```

---

### Task 2: Wire the hook into ChatInterview.tsx (Story Foundation)

**Files:**
- Modify: `web/src/components/ChatInterview.tsx`

**Interfaces:**
- Consumes: `useScrollToLatest` (Task 1).
- Produces: nothing consumed by a later task.

This file currently has (relevant excerpts only):

```tsx
import { useEffect, useRef, useState } from "react";
```

and, among the component's state declarations:

```tsx
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

and, at the end of the resume `useEffect`'s success path (immediately before its `catch`):

```tsx
        if (Array.isArray(data.elements)) setElements(data.elements);
        if (Array.isArray(data.guardrailFlags)) setGuardrailFlags(data.guardrailFlags);
        if (data.story?.pendingConflict) setConflict(data.story.pendingConflict);
      } catch {
```

and, in `sendMessage`'s `finally` block:

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
```

and, in the JSX, the left panel:

```tsx
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
```

and, further down in that same panel (the end of the scrollable area):

```tsx
                {error && (
                  <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div ref={listEndRef} />
              </div>

              <div className="shrink-0 border-t border-red-900/40 p-3">
```

- [ ] **Step 1: Update the import**

Change:

```tsx
import { useEffect, useRef, useState } from "react";
```

to:

```tsx
import { useEffect, useState } from "react";
```

(`useRef` is no longer used directly in this file once `listEndRef` is replaced below.)

- [ ] **Step 2: Add the hook import**

Find this file's other `@/` imports near the top (e.g. `import CanonPanel, ...` or similar) and add, among them:

```tsx
import { useScrollToLatest } from "@/lib/useScrollToLatest";
```

- [ ] **Step 3: Replace the `listEndRef` declaration**

Change:

```tsx
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

to:

```tsx
  const { containerRef, endRef, isNearBottom, handleScroll, scrollToLatest } = useScrollToLatest();
```

- [ ] **Step 4: Scroll to latest once resume succeeds**

Change:

```tsx
        if (Array.isArray(data.elements)) setElements(data.elements);
        if (Array.isArray(data.guardrailFlags)) setGuardrailFlags(data.guardrailFlags);
        if (data.story?.pendingConflict) setConflict(data.story.pendingConflict);
      } catch {
```

to:

```tsx
        if (Array.isArray(data.elements)) setElements(data.elements);
        if (Array.isArray(data.guardrailFlags)) setGuardrailFlags(data.guardrailFlags);
        if (data.story?.pendingConflict) setConflict(data.story.pendingConflict);
        requestAnimationFrame(() => scrollToLatest("auto"));
      } catch {
```

- [ ] **Step 5: Route the post-send scroll through the hook**

Change:

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
```

to:

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
```

- [ ] **Step 6: Attach the container ref/scroll handler, and add the "Jump to latest" button**

Change:

```tsx
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
                {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
```

to:

```tsx
              <div
                ref={containerRef}
                onScroll={handleScroll}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
              >
                {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
```

Change:

```tsx
                {error && (
                  <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div ref={listEndRef} />
              </div>

              <div className="shrink-0 border-t border-red-900/40 p-3">
```

to:

```tsx
                {error && (
                  <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {!isNearBottom && (
                <button
                  onClick={() => scrollToLatest("smooth")}
                  className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-gradient-to-r from-red-600 to-orange-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg hover:from-red-500 hover:to-orange-400"
                >
                  ↓ Jump to latest
                </button>
              )}

              <div className="shrink-0 border-t border-red-900/40 p-3">
```

- [ ] **Step 7: Make the left panel a positioning context for the button**

Find:

```tsx
            <div
              data-testid="left-panel"
              className="flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
```

Change to:

```tsx
            <div
              data-testid="left-panel"
              className="relative flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
```

- [ ] **Step 8: Verify with lint/build**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 9: Manual dev-server verification**

Run from `web/`: `npm run dev`. For a Story Foundation session with existing message history:
1. Load `/interview?workspaceId=...&canvasId=...` — confirm it opens already scrolled to the latest message (no manual scroll needed).
2. Scroll up into history — confirm the "↓ Jump to latest" button appears near the bottom of the left panel.
3. Click it — confirm a smooth scroll to the bottom, and the button disappears.
4. Send a new message — confirm the reply still scrolls the view down smoothly, same as before this change.

- [ ] **Step 10: Commit**

```bash
git add web/src/components/ChatInterview.tsx
git commit -m "feat: auto-scroll to latest message and add jump-to-latest button (Story Foundation)"
```

---

### Task 3: Wire the hook into CharacterInterview.tsx (Character Bible)

**Files:**
- Modify: `web/src/components/CharacterInterview.tsx`

**Interfaces:**
- Consumes: `useScrollToLatest` (Task 1).
- Produces: nothing consumed by a later task.

This file currently has (relevant excerpts only):

```tsx
import { useEffect, useRef, useState } from "react";
```

and:

```tsx
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

and, at the end of the resume `useEffect`'s success path (immediately before its `catch`):

```tsx
        if (!activeProgress && lastAssistant) {
          setCurrentCharacter(lastAssistant.current_character ?? null);
          setCurrentStage(lastAssistant.current_stage ?? null);
        }
      } catch {
```

and, in `sendMessage`'s `finally` block (this file's `sendMessage` has the identical shape as `ChatInterview.tsx`'s and `WorldInterview.tsx`'s — find the exact block by searching for `scrollIntoView` in this file):

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
```

and, in the JSX:

```tsx
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
```

- [ ] **Step 1: Update the import**

Change:

```tsx
import { useEffect, useRef, useState } from "react";
```

to:

```tsx
import { useEffect, useState } from "react";
```

- [ ] **Step 2: Add the hook import**

Add, among this file's other `@/` imports:

```tsx
import { useScrollToLatest } from "@/lib/useScrollToLatest";
```

- [ ] **Step 3: Replace the `listEndRef` declaration**

Change:

```tsx
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

to:

```tsx
  const { containerRef, endRef, isNearBottom, handleScroll, scrollToLatest } = useScrollToLatest();
```

- [ ] **Step 4: Scroll to latest once resume succeeds**

Change:

```tsx
        if (!activeProgress && lastAssistant) {
          setCurrentCharacter(lastAssistant.current_character ?? null);
          setCurrentStage(lastAssistant.current_stage ?? null);
        }
      } catch {
```

to:

```tsx
        if (!activeProgress && lastAssistant) {
          setCurrentCharacter(lastAssistant.current_character ?? null);
          setCurrentStage(lastAssistant.current_stage ?? null);
        }
        requestAnimationFrame(() => scrollToLatest("auto"));
      } catch {
```

- [ ] **Step 5: Route the post-send scroll through the hook**

Change:

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
```

to:

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
```

- [ ] **Step 6: Attach the container ref/scroll handler, and add the "Jump to latest" button**

Change:

```tsx
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
                {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
```

to:

```tsx
              <div
                ref={containerRef}
                onScroll={handleScroll}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
              >
                {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
```

Change:

```tsx
                {error && (
                  <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div ref={listEndRef} />
              </div>
```

to:

```tsx
                {error && (
                  <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {!isNearBottom && (
                <button
                  onClick={() => scrollToLatest("smooth")}
                  className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-gradient-to-r from-red-600 to-orange-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg hover:from-red-500 hover:to-orange-400"
                >
                  ↓ Jump to latest
                </button>
              )}
```

(Leave whatever comes immediately after this block in the actual file - e.g. the input box's wrapping `<div>` - completely unchanged; only the button block is inserted between the scrollable messages `<div>`'s closing tag and whatever follows it.)

- [ ] **Step 7: Make the left panel a positioning context for the button**

Find:

```tsx
            <div
              data-testid="left-panel"
              className="flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
```

Change to:

```tsx
            <div
              data-testid="left-panel"
              className="relative flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
```

- [ ] **Step 8: Verify with lint/build**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 9: Manual dev-server verification**

Same script as Task 2, Step 9, but for `/character-bible?workspaceId=...&canvasId=...` with a character that has existing message history.

- [ ] **Step 10: Commit**

```bash
git add web/src/components/CharacterInterview.tsx
git commit -m "feat: auto-scroll to latest message and add jump-to-latest button (Character Bible)"
```

---

### Task 4: Wire the hook into WorldInterview.tsx (World Bible)

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `useScrollToLatest` (Task 1).
- Produces: nothing consumed by a later task — this is the final task.

This file currently has (relevant excerpts only):

```tsx
import { useEffect, useRef, useState } from "react";
```

and:

```tsx
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

and, at the end of the resume `useEffect`'s success path (immediately before its `catch`):

```tsx
        setWclState((data.story?.p3 as P3State | undefined) ?? null);
        setCharacterBibleGate((data.characterBibleGate as CharacterBibleGateResult | undefined) ?? null);
        const rawElements = (data.worldElements ?? []) as { element_id: string; status: CanonStatus }[];
        setElementStatuses(
          Object.fromEntries(rawElements.map((e) => [e.element_id, toPillarStatus(e.status)]))
        );
      } catch {
```

and, in `sendMessage`'s `finally` block:

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
```

and, in the JSX:

```tsx
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
```

- [ ] **Step 1: Update the import**

Change:

```tsx
import { useEffect, useRef, useState } from "react";
```

to:

```tsx
import { useEffect, useState } from "react";
```

- [ ] **Step 2: Add the hook import**

Add, among this file's other `@/` imports:

```tsx
import { useScrollToLatest } from "@/lib/useScrollToLatest";
```

- [ ] **Step 3: Replace the `listEndRef` declaration**

Change:

```tsx
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

to:

```tsx
  const { containerRef, endRef, isNearBottom, handleScroll, scrollToLatest } = useScrollToLatest();
```

- [ ] **Step 4: Scroll to latest once resume succeeds**

Change:

```tsx
        setWclState((data.story?.p3 as P3State | undefined) ?? null);
        setCharacterBibleGate((data.characterBibleGate as CharacterBibleGateResult | undefined) ?? null);
        const rawElements = (data.worldElements ?? []) as { element_id: string; status: CanonStatus }[];
        setElementStatuses(
          Object.fromEntries(rawElements.map((e) => [e.element_id, toPillarStatus(e.status)]))
        );
      } catch {
```

to:

```tsx
        setWclState((data.story?.p3 as P3State | undefined) ?? null);
        setCharacterBibleGate((data.characterBibleGate as CharacterBibleGateResult | undefined) ?? null);
        const rawElements = (data.worldElements ?? []) as { element_id: string; status: CanonStatus }[];
        setElementStatuses(
          Object.fromEntries(rawElements.map((e) => [e.element_id, toPillarStatus(e.status)]))
        );
        requestAnimationFrame(() => scrollToLatest("auto"));
      } catch {
```

- [ ] **Step 5: Route the post-send scroll through the hook**

Change:

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
```

to:

```tsx
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
```

- [ ] **Step 6: Attach the container ref/scroll handler, and add the "Jump to latest" button**

Change:

```tsx
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
                {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
```

to:

```tsx
              <div
                ref={containerRef}
                onScroll={handleScroll}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
              >
                {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
```

Change:

```tsx
                {error && (
                  <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div ref={listEndRef} />
              </div>
```

to:

```tsx
                {error && (
                  <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {!isNearBottom && (
                <button
                  onClick={() => scrollToLatest("smooth")}
                  className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-gradient-to-r from-red-600 to-orange-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg hover:from-red-500 hover:to-orange-400"
                >
                  ↓ Jump to latest
                </button>
              )}
```

(Leave whatever comes immediately after this block in the actual file completely unchanged; only the button block is inserted between the scrollable messages `<div>`'s closing tag and whatever follows it.)

- [ ] **Step 7: Make the left panel a positioning context for the button**

Find:

```tsx
            <div
              data-testid="left-panel"
              className="flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
```

Change to:

```tsx
            <div
              data-testid="left-panel"
              className="relative flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
```

- [ ] **Step 8: Verify with lint/build**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 9: Manual dev-server verification**

Same script as Task 2, Step 9, but for `/world-bible?workspaceId=...&canvasId=...` with a story whose Character Bible is complete (so the World Bible chat itself is reachable) and has existing message history.

- [ ] **Step 10: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: auto-scroll to latest message and add jump-to-latest button (World Bible)"
```

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (keep chronological order) — no task reorders `messages`, only scroll position changes. Decision 2 ("Jump to latest" button) — Tasks 2-4's Step 6. Decision 3 (shared hook, all three screens) — Task 1 + Tasks 2-4. Decision 4 (instant load-scroll, smooth send/button scroll) — Tasks 2-4's Steps 4/5/6 use `"auto"` for the resume-effect call and `"smooth"` everywhere else. Decision 5 (100px threshold) — Task 1's `handleScroll`.
- **Placeholder scan:** no TBD/TODO; every step has literal code.
- **Type consistency:** `useScrollToLatest`'s return shape (`containerRef`, `endRef`, `isNearBottom`, `handleScroll`, `scrollToLatest`) is destructured identically by name in all three components (Tasks 2-4's Step 3).
- **Unused-import risk caught during planning:** all three files import `useRef` ONLY for the now-removed `listEndRef` — each task's Step 1 removes it from that file's import line, preventing an eslint "unused import" failure that a less careful plan would have hit only at build time.
