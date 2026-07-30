# Resizable Chat/View Split Pane — Design Spec

**Status:** Approved for planning
**Date:** 2026-07-30

## Problem

The interview screen's left (chat) and right (view) panels have a fixed 380px/flex-remaining split (`web/src/components/ChatInterview.tsx`, the `w-[380px] shrink-0` left panel). Authors have no way to give more room to whichever pane matters more to them at a given moment.

## Approach

A stateful width plus a draggable handle between the two panels — independent of, and unaffected by, the chat/view-pane content-split work (a separate spec). Purely a frontend layout change.

## Design

- The left panel's className changes from a fixed `w-[380px]` to an inline `style={{ width: leftWidth }}`, where `leftWidth` is new component state (`useState<number>(380)`, same default as today's fixed value — no visual change until the author actually drags).
- A thin (a few pixels wide) draggable handle is inserted between the left and right panels, styled with `cursor-col-resize` and a subtle hover/active visual state (matching the existing dark theme — a slightly lighter neutral bar that brightens to the red/orange accent on hover, consistent with the rest of this screen's interactive elements).
- Drag behavior: `onPointerDown` on the handle starts tracking; a `pointermove` listener (attached to `window` for the duration of the drag, removed on `pointerup`) computes the new width from the pointer's horizontal position and updates `leftWidth`, clamped to a sensible range — **280px minimum** (below which the chat input/tab-switcher UI starts clipping) and **800px maximum** (beyond which the right pane would be too cramped to be useful on a typical viewport). `pointerup` (also window-level, so a drag that ends outside the handle still terminates cleanly) stops tracking.
- No persistence: `leftWidth` resets to the 380px default on page reload, matching this screen's existing lack of any other layout-preference persistence (tab selection, scroll position, etc. are all already session-only).

## Data flow

Purely local component state — no new props, no new API calls, no interaction with any other part of this screen's existing state (messages, elements, doc, etc.). The handle's drag handlers only ever write to `leftWidth`.

## Error handling

None needed — this is synchronous DOM/pointer-event handling with no failure modes. The clamp (280–800px) is the only "validation," applied inline when computing the new width from pointer position, not as a separate error path.

## Testing

No automated test framework exists in this repo — verification is `npm run lint && npm run build` plus a manual walkthrough: drag the handle left and right, confirm the panels resize smoothly and respect the min/max clamp, confirm dragging past a panel's edge (or releasing outside the handle) doesn't leave the drag "stuck" active, and confirm neither panel's existing functionality (chat scrolling, view-pane content, tab switching) is disrupted by the new layout mechanism.
