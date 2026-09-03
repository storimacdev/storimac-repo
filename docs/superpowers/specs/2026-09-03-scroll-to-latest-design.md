# Auto-Scroll to Latest Message + "Jump to Latest" Button — Design Spec

**Status:** Approved for planning
**Date:** 2026-09-03

## Problem

Live, BA-reported issue: every interview screen's chat panel opens scrolled to the TOP of the conversation (the first message), requiring a manual scroll to the bottom to see the latest turn — every single time the author logs back in or reloads. Confirmed in code: none of the three interview screens (`ChatInterview.tsx`, `CharacterInterview.tsx`, `WorldInterview.tsx`) scrolls the message list after the resume fetch populates it; each only scrolls after `sendMessage` completes (a NEW message), never on initial load of EXISTING history.

## Decisions (confirmed during brainstorming, 2026-09-03)

1. **Keep natural chat order** (oldest message at top, newest at bottom) — do not reverse the transcript. The fix is auto-scrolling to the bottom on load, not changing reading order. Confirmed directly with the user after clarifying that their literal wording ("latest on top") was aiming at "don't make me scroll every time," not an actually-reversed transcript.
2. **Also add a "Jump to latest" button** for when the author has manually scrolled up into history — confirmed directly with the user as an explicit addition beyond the initial auto-scroll-on-load fix.
3. **Build once as a shared hook, applied identically to all three interview screens** (Story Foundation, Character Bible, World Bible) — confirmed with the user. All three screens already share the identical structure (a scrollable message-list `<div>`, an end-of-list marker `<div>`, and a post-send `scrollIntoView` call), so this is one hook consumed three times, not three independent implementations.
4. **The initial scroll-to-latest on load is instant (no animation)**; the existing post-send scroll (after the author sends a new message) and the new "Jump to latest" button's scroll both stay smooth-animated, matching the app's existing post-send behavior exactly. Landing on a session already scrolled to the right place shouldn't visibly animate; deliberately jumping there should.
5. **"Near bottom" is a distance threshold (100px), not exact-equality** — a small render/layout variance shouldn't cause the "Jump to latest" button to flicker in and out near the boundary.

## Architecture

### `web/src/lib/useScrollToLatest.ts` (new)

```ts
import { useRef, useState } from "react";

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

Pure client-side UI state, no imports beyond React itself — safe to use in any client component.

### `web/src/components/ChatInterview.tsx`, `CharacterInterview.tsx`, `WorldInterview.tsx` (each extended identically)

- Replace the existing `const listEndRef = useRef<HTMLDivElement | null>(null);` with `const { containerRef, endRef, isNearBottom, handleScroll, scrollToLatest } = useScrollToLatest();`.
- The scrollable messages `<div>` (currently `className="... overflow-y-auto ..."` with no ref) gains `ref={containerRef}` and `onScroll={handleScroll}`.
- The existing marker `<div ref={listEndRef} />` at the bottom of the messages list becomes `<div ref={endRef} />`.
- The resume `useEffect`'s success path calls `scrollToLatest("auto")` once, after messages are set (instant jump — no animation on load).
- `sendMessage`'s existing `listEndRef.current?.scrollIntoView({ behavior: "smooth" })` call (in its `finally` block) becomes `scrollToLatest("smooth")` — identical visible behavior, routed through the shared hook.
- A new floating button renders inside the scrollable panel (`position: sticky` or `absolute`, bottom-aligned, only when `!isNearBottom`): "↓ Jump to latest", `onClick={() => scrollToLatest("smooth")}`.

## Error Handling

No new error surface — this is pure client-side scroll-position UI state with no network calls. A `containerRef.current` that's momentarily `null` (before mount) is guarded in `handleScroll`.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual pass on each of the three screens:
- Load a session with existing history — confirm it opens already scrolled to the latest message, with no visible scroll animation and no manual scrolling needed.
- Scroll up into history — confirm the "Jump to latest" button appears.
- Click it — confirm a smooth scroll back to the bottom, and the button disappears once there.
- Send a new message — confirm the existing smooth-scroll-to-bottom behavior after a reply is unchanged.
- Scroll away, then send a new message from a scrolled-up position — confirm the reply still scrolls the view down (matching today's existing behavior, unaffected by `isNearBottom`).
