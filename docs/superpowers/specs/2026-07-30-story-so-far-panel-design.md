# "Story So Far" View-Pane Design Spec

**Status:** Approved for planning
**Date:** 2026-07-30

## Problem

`ChatInterview.tsx`'s right-hand pane ("preview · Stage N") duplicates the left-hand chat: outside of the Stage 8 document card, it shows either a loading spinner, an empty-state placeholder, or `lastAssistant.content` — the exact same text already visible as the most recent bubble in the chat. The pane carries no information the chat doesn't already show.

## Goal

Repurpose that pane into a live "story so far" view: a compact, always-updating synthesis of what's actually been confirmed in the interview, so the two panes serve different purposes — chat is the conversation, the view pane is the emerging story's current state. The existing Canon tab (`CanonPanel.tsx`, in the left panel's Chat/Canon switcher) is unchanged; it stays the technical inspector (every element, every status, debug depth-mode info). The new pane is the narrative-facing counterpart: only Confirmed elements, rendered as label + value, not id + status.

## Approach

Labeled fact-sheet grouped by stage, built entirely from client state already in hand — no new API calls, no LLM-generated summary. `ChatInterview.tsx` already holds `elements: PanelElement[]` (from `@/components/CanonPanel`), refreshed after every resume and every chat turn; the new component is a second, purely presentational view of that same array, exactly the way `CanonPanel` already is. This was chosen over (a) full prose synthesis via hand-written per-element sentence templates — better reading experience, but ongoing template-maintenance cost as elements are added or reworded — and (b) an LLM-generated summary refreshed each turn — best prose quality, but a new per-turn API call adds cost, latency, and risks the exact truncation/timeout failure mode already fixed once in this app (see `extractTurn.ts`'s `max_tokens` fix, 2026-07-30).

## Component

New file: `web/src/components/StorySoFar.tsx`, presentational, matching `CanonPanel`'s prop shape:

```ts
{ elements: PanelElement[]; currentStage: number }
```

(`PanelElement` is already exported from `@/components/CanonPanel` — import it from there rather than redefining it.)

## Rendering rules

1. Walk `PROJECT1_STAGES` (from `@/lib/canonEngine/stageDefinitions`). Keep only stages where `stage.stage <= currentStage` (past + current, matching `CanonPanel`'s `isPast`/`isCurrent` gating) **and** `stage.requiredElementIds.length > 0` (this skips Stage 7, which has none — `systemRun: true`, gated by the audit instead).
2. Within a kept stage, filter `requiredElementIds` down to those whose corresponding element (looked up by `element_id` in the `elements` array, same `Map`-based lookup pattern `CanonPanel` already uses) has `status === "Confirmed"`. Working/Exploring/Parked elements are not shown here — they stay Canon-tab-only, so this pane always reads as settled fact, never a to-do list.
3. A stage with zero currently-Confirmed elements renders no heading and no content at all — no empty sections, no "nothing confirmed yet in this stage" filler.
4. Per confirmed element, render a label + value line:
   - Label: `element_id` with underscores replaced by spaces and each word capitalized (e.g. `core_dramatic_question` → "Core Dramatic Question"), reusing the same `.replace(/_/g, " ")` convention already used in `CanonPanel.tsx` and the conflict-resolution card, extended with title-casing since this is now primary user-facing copy rather than a debug label.
   - Value: `element.value` rendered as-is if `typeof value === "string"`; otherwise `JSON.stringify(value)` as a defensive fallback (values are documented as "author-facing" by the `emit_turn` tool schema and expected to be strings in practice, but nothing enforces that at the type level — `CanonElement.value` is `unknown`).
5. `retrieval_code` is never rendered. This isn't just a rendering choice to get right — `PanelElement`'s type (`element_id`, `status`, `depth_mode?`, `value?`) has no `retrieval_code` field at all, so there is nothing to leak structurally, matching `ARCHITECTURE.md` §3's "internal catalog codes never cross the export boundary."

## Empty state

Before anything is Confirmed anywhere (freshly started Stage 1), render a short placeholder instead of an empty pane: "Your story is just getting started — confirmed details will appear here as you go."

## Integration with `ChatInterview.tsx`

Two existing, mutually-exclusive JSX blocks are replaced by one:

- Remove: the `{!loading && !doc && lastAssistant && (...)}` block ("Latest from your editor").
- Remove: the `{!loading && !doc && !lastAssistant && !resuming && (...)}` block (the icon + "Your editor's responses will appear here…" empty state).
- Add: `{!loading && !doc && <StorySoFar elements={elements} currentStage={currentStage} />}`, in the same position, so the Stage 8 document card (`currentStage >= 8`) and the loading spinner keep exactly their current precedence and visual behavior — this change touches only what renders in the space between them.
- The `lastAssistant` derived variable (`[...messages].reverse().find(...)`) becomes unused once both blocks referencing it are removed, and is deleted along with them.

## Error handling and testing

No new failure modes: `StorySoFar` is a pure, synchronous, presentational component reading already-validated client state — no fetches, no async, nothing to catch. No automated test framework exists in this repo (established convention, `web/package.json` has no test runner); verification is `npm run lint && npm run build` plus a manual walkthrough: start a fresh interview, confirm the pane stays on the empty-state placeholder until the first element is confirmed, confirm it updates immediately after each subsequent confirmation, confirm no catalog code ever appears (Stage 2's `primary_format`/`supporting_formats`), and confirm the Stage 8 document card still fully takes over once that stage is reached, unchanged.
