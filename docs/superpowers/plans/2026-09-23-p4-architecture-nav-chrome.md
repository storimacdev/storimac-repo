# P4 Story Architecture Nav Chrome & Jump-to-Latest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `ArchitectureInterview.tsx` (P4 Story Architecture, `/story-architecture`) in line with the other three interview screens' shared header/scroll conventions, per BA-reported gap, issue #176.

**Architecture:** No new components or patterns — this is a pure application of an existing, already-3x-proven convention (`useScrollToLatest()` hook, `Link` + `UserMenu` header chrome) that every other interview screen (`ChatInterview.tsx`, `CharacterInterview.tsx`, `WorldInterview.tsx`) already uses. `ArchitectureInterview.tsx` was built without either, apparently because P4 was built across many small separate issues that never revisited the shared chrome.

**Tech Stack:** Next.js App Router, React, existing `useScrollToLatest` hook (`web/src/lib/useScrollToLatest.ts`), existing `UserMenu` component (`web/src/components/UserMenu.tsx`).

## Global Constraints

- The existing status cluster (Routing / Active Step / Units / Validation / Compile button) and every existing compile-gate banner (placement flag, validation-failed, pending-conflict, cascade-review, structural-vector-options, scene-density, thematic-anchor/pre-compilation audit, compiled-success) must remain functionally and textually unchanged — this plan only adds navigation chrome and scroll behavior around them.
- `Link` destination is `/dashboard`, matching `CharacterInterview.tsx` and `WorldInterview.tsx` (not `ChatInterview.tsx`'s older `/` - `/dashboard` is the current convention, confirmed as the 2-of-3 majority and as `ProjectDashboard.tsx`'s actual route).
- Reuse `useScrollToLatest()` exactly as the other three screens call it — do not write new scroll-tracking logic.
- Do not restructure the existing header's status cluster or Compile button into a different layout beyond what's specified in Task 1 below.

---

### Task 1: Add header nav chrome and scroll-to-latest behavior to ArchitectureInterview.tsx

**Files:**
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Consumes: `useScrollToLatest()` from `@/lib/useScrollToLatest` (already exists, used identically by `WorldInterview.tsx`/`CharacterInterview.tsx`/`ChatInterview.tsx` - returns `{ containerRef, endRef, isNearBottom, handleScroll, scrollToLatest }`). `UserMenu` default export from `@/components/UserMenu`. `Link` from `next/link`.
- Produces: nothing new consumed by other files - this is a self-contained UI change to one component.

- [ ] **Step 1: Add imports**

At the top of `web/src/components/ArchitectureInterview.tsx`, alongside the existing imports (currently lines 1-7):

```typescript
import Link from "next/link";
import UserMenu from "@/components/UserMenu";
import { useScrollToLatest } from "@/lib/useScrollToLatest";
```

- [ ] **Step 2: Call the hook**

Inside `export default function ArchitectureInterview()`, immediately after the existing `const { setLastProject } = useUser();` line (currently line 48), add:

```typescript
  const { containerRef, endRef, isNearBottom, handleScroll, scrollToLatest } = useScrollToLatest();
```

- [ ] **Step 3: Auto-scroll to latest on initial resume load**

In the resume-load `useEffect` (currently lines 93-137), inside the `try` block, immediately before the existing `} catch {` (i.e., as the last statement of the `try`, right after the existing `setSceneDensity(...)` line), add:

```typescript
        requestAnimationFrame(() => scrollToLatest("auto"));
```

Then add `scrollToLatest` to that effect's dependency array — change:
```typescript
  }, [workspaceId, canvasId]);
```
to:
```typescript
  }, [workspaceId, canvasId, scrollToLatest]);
```

(This exactly mirrors `WorldInterview.tsx`'s own resume-load effect, lines 154 and 164.)

- [ ] **Step 4: Auto-scroll to latest after each sent/received message**

In `sendMessage()` (currently starting line 139), immediately after the existing line that appends the assistant's reply to `messages`:

```typescript
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
```

add:

```typescript
      requestAnimationFrame(() => scrollToLatest("smooth"));
```

(Mirrors `WorldInterview.tsx` line 399's placement immediately after its own equivalent `setMessages` call.)

- [ ] **Step 5: Add Back link and UserMenu to the header**

Replace the current header block (currently lines 287-302):

```typescript
      <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <p className="text-sm font-semibold text-neutral-200">Story Architecture</p>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span>Routing: {routingChoice ?? "not chosen yet"}</span>
          <span>Active Step: {activeStep ?? "—"}</span>
          <span>Units: {units.length}</span>
          {validationResult && <span>Validation: {validationResult}</span>}
          <button
            onClick={() => compileDocument(false)}
            disabled={compiling}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compiling ? "Compiling…" : "Compile"}
          </button>
        </div>
      </div>
```

with:

```typescript
      <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
            ← Back
          </Link>
          <p className="text-sm font-semibold text-neutral-200">Story Architecture</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span>Routing: {routingChoice ?? "not chosen yet"}</span>
          <span>Active Step: {activeStep ?? "—"}</span>
          <span>Units: {units.length}</span>
          {validationResult && <span>Validation: {validationResult}</span>}
          <button
            onClick={() => compileDocument(false)}
            disabled={compiling}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compiling ? "Compiling…" : "Compile"}
          </button>
          <UserMenu />
        </div>
      </div>
```

Only the header's internal structure changes (Back link added to the left group, `<UserMenu />` appended to the existing right-hand status cluster) — every existing span/button and its behavior is unchanged. This deliberately keeps the existing two-group `justify-between` layout (rather than forcing WorldInterview's strict three-column layout) because the right-hand group here is already a wide multi-item status cluster; appending `UserMenu` to it reads better than squeezing a third column in between.

- [ ] **Step 6: Wire up the scrollable container, end marker, and Jump-to-latest button**

Replace the current message-list block (currently lines 451-468):

```typescript
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {resuming && (
          <div className="mb-4 text-left">
            <p className="inline-block max-w-2xl rounded-xl bg-neutral-900 px-4 py-2 text-sm text-neutral-400">
              Loading your canvas…
            </p>
          </div>
        )}
        {!resuming &&
          messages.map((m, i) => (
            <div key={i} className={`mb-4 ${m.role === "user" ? "text-right" : "text-left"}`}>
              <p className="inline-block max-w-2xl rounded-xl bg-neutral-900 px-4 py-2 text-sm text-neutral-200">
                {m.content}
              </p>
            </div>
          ))}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
```

with:

```typescript
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6">
        {resuming && (
          <div className="mb-4 text-left">
            <p className="inline-block max-w-2xl rounded-xl bg-neutral-900 px-4 py-2 text-sm text-neutral-400">
              Loading your canvas…
            </p>
          </div>
        )}
        {!resuming &&
          messages.map((m, i) => (
            <div key={i} className={`mb-4 ${m.role === "user" ? "text-right" : "text-left"}`}>
              <p className="inline-block max-w-2xl rounded-xl bg-neutral-900 px-4 py-2 text-sm text-neutral-200">
                {m.content}
              </p>
            </div>
          ))}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div ref={endRef} />
        {!isNearBottom && (
          <button
            onClick={() => scrollToLatest("smooth")}
            className="sticky bottom-3 z-10 self-center rounded-full border border-purple-500/50 bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-purple-200 shadow-lg hover:bg-purple-900/40"
          >
            ↓ Jump to latest
          </button>
        )}
      </div>
```

The button's styling matches this file's own existing purple/neutral idiom (the Compile/Download buttons' `border-purple-500/50 bg-neutral-900 ... text-purple-200 hover:bg-purple-900/40`), rather than copying `WorldInterview.tsx`'s red/orange gradient verbatim — that gradient is specific to World Bible's own red-themed header, not a cross-screen requirement. The button's *behavior* (sticky, shown only when `!isNearBottom`, scrolls to `endRef`) is what must match; the color only needs to fit this screen's existing palette.

- [ ] **Step 7: Verify**

Run from `web/`:
```
npx tsc --noEmit -p .
npm run lint
npm run build
```
All three must be clean.

Manually start the dev server (`npm run dev` from `web/`) and open `/story-architecture?workspaceId=...&canvasId=...` for an existing Story Canvas (or create one via onboarding if none exists locally): confirm the `← Back` link navigates to `/dashboard`, `UserMenu` renders and its dropdown works, scrolling up in the message list reveals the "↓ Jump to latest" button, clicking it scrolls to the bottom, and a fresh page load lands scrolled to the latest message. Confirm the existing Compile button, status cluster, and any active banners still render and behave exactly as before.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ArchitectureInterview.tsx
git commit -m "feat: add nav chrome and jump-to-latest to Story Architecture screen (issue #176)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
