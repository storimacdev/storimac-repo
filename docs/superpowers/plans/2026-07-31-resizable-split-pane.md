# Resizable Chat/View Split Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the interview screen's author drag a handle to resize the left (chat/canon) panel against the right (view) panel, instead of the current fixed 380px split.

**Architecture:** Replace the left panel's fixed `w-[380px]` Tailwind class with an inline `style={{ width: leftWidth }}` driven by new `leftWidth` component state (default 380, unchanged from today). A new draggable handle between the two panels uses `onPointerDown` to snapshot the drag's starting X and starting width, then attaches `pointermove`/`pointerup` listeners directly to `window` for the duration of the drag (removed on `pointerup`), computing and clamping the new width (280–800px) on each move. Purely local component state — no props, no API calls, no persistence.

**Tech Stack:** Next.js App Router, React (client component), TypeScript, Tailwind CSS.

## Global Constraints

- No automated test framework exists in this repo. Verification is `npm run lint && npm run build` from `web/`, plus a manual walkthrough (deferred to a human — this sandbox cannot run a browser).
- Width clamp range is **280px minimum, 800px maximum** — exact values from the spec.
- No persistence: `leftWidth` resets to 380 (today's fixed value) on every page load — do not add localStorage or any other persistence mechanism.
- This change is purely a frontend layout mechanism — it must not touch or interact with any of the chat/view-pane content-split work (`context`, `auditSummary`, `messages`, etc.) already in this file.

---

### Task 1: Draggable resizable left panel

**Files:**
- Modify: `web/src/components/ChatInterview.tsx`

**Interfaces:**
- Produces: no new exports — this is entirely internal component state and JSX for the existing default-exported `ChatInterview` component.

- [ ] **Step 1: Add `leftWidth` state**

In `web/src/components/ChatInterview.tsx`, the current state block (lines 75-91) ends with:

```tsx
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [leftTab, setLeftTab] = useState<"chat" | "canon">("chat");
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

Change it to:

```tsx
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [leftTab, setLeftTab] = useState<"chat" | "canon">("chat");
  const [leftWidth, setLeftWidth] = useState(380);
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

- [ ] **Step 2: Add the pointer-drag handler function**

In the same file, immediately after the `onKeyDown` function (currently lines 172-177):

```tsx
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
```

Add a new function right after it:

```tsx

  function handleResizeStart(e: React.PointerEvent) {
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
```

(`startWidth` is snapshotted once at drag start, so `handlePointerMove` never needs to read the `leftWidth` state directly — this avoids any stale-closure concern despite the listeners being attached outside React's render cycle.)

- [ ] **Step 3: Switch the left panel to the stateful width**

The current left panel opening tag (lines 253-258) is:

```tsx
          <div className="flex min-h-0 flex-1">
            {/* ---------- Left panel: chat / canon tabs + input ---------- */}
            <div
              data-testid="left-panel"
              className="flex w-[380px] shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
            >
```

Change it to:

```tsx
          <div className="flex min-h-0 flex-1">
            {/* ---------- Left panel: chat / canon tabs + input ---------- */}
            <div
              data-testid="left-panel"
              className="flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
```

- [ ] **Step 4: Insert the draggable handle between the two panels**

The current boundary between the left panel's closing tag and the right panel's opening tag (lines 352-357) is:

```tsx
              </div>
            </div>

            {/* ---------- Right panel: response generation / preview ---------- */}
            <div data-testid="right-panel" className="flex min-w-0 flex-1 flex-col bg-neutral-950">
```

Change it to:

```tsx
              </div>
            </div>

            {/* ---------- Drag handle: resize left panel ---------- */}
            <div
              data-testid="resize-handle"
              onPointerDown={handleResizeStart}
              className="w-1 shrink-0 cursor-col-resize bg-neutral-800 transition hover:bg-gradient-to-b hover:from-red-500 hover:to-orange-500 active:bg-gradient-to-b active:from-red-500 active:to-orange-500"
            />

            {/* ---------- Right panel: response generation / preview ---------- */}
            <div data-testid="right-panel" className="flex min-w-0 flex-1 flex-col bg-neutral-950">
```

- [ ] **Step 5: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass with no new errors.

- [ ] **Step 6: Manual walkthrough** (sandbox has no browser access — this step is for whoever runs it against a real dev server)

Load the interview screen, drag the handle left and right, confirm the panels resize smoothly, confirm the width won't go below 280px or above 800px no matter how far the pointer is dragged past those bounds, confirm releasing the pointer outside the handle (e.g. dragging fast past the window edge) still stops the drag cleanly (no "stuck" resize), and confirm reloading the page resets the split back to 380px. Also confirm none of the existing screen functionality (chat scrolling, tab switching, view-pane content, conflict card, Stage 8 document card) is disrupted by the new layout mechanism.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ChatInterview.tsx
git commit -m "feat: make the chat/view split pane draggable and resizable"
```
