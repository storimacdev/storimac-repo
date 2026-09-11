# P3 Side-Panel UI (Issue #45) — Design

**Issue:** #45, "[P3] Build persistent side-panel UI (Stage, Pillar, Canon Registry, Outstanding Questions)"
**AC:** current Stage + active Pillar visible; Canon Registry list with status badges; Outstanding Questions registry, browsable; Dependency Graph as a simple list (full graph viz is #53, an explicit Phase 5 stretch item).

## Reuse reality check (contradicts the issue's own architecture note)

The issue's architecture-note comment says: "reuse the shared side-panel component built for Project 1 (#11)... badge styling and layout are identical, only the tracked element list differs." That turns out not to hold, and this isn't a fresh finding — `docs/superpowers/specs/2026-08-26-p3-canon-registry-design.md` (decision item 174) already documented the same conclusion when it built the pillars-status UI in `WorldInterview.tsx`:

> "A small status badge shows next to each pillar name... using its own local color mapping... defined directly in `WorldInterview.tsx` — not imported from `CanonPanel.tsx`, which is a P1-specific, read-only component with no exported style map and its own different status-display conventions (it shows the raw "Parked" label, not "Deferred")."

Confirmed independently for this issue: `CanonPanel.tsx` iterates `PROJECT1_STAGES` directly (imported, not a prop) — there's no way to hand it a different stage list, so it can't render P3 content at all without a rewrite. Its only production usage (`ChatInterview.tsx`, `orientation="horizontal"`) also drops per-element badges entirely, the opposite of what a Canon Registry needs. P2 (Character Bible) never built an equivalent panel, so there's no second precedent to draw on either.

**Decision:** build a new, P3-specific panel component rather than importing `CanonPanel`. Reuse what's genuinely shared — the four-status color *convention* (neutral/amber/emerald/sky), `isValidTransition()`, the `Deferred ⟷ Parked` wire-vocabulary translation, and the existing `GET /api/world-chat/entries` read path — rather than the component itself.

**One piece of real, worthwhile consolidation:** the Exploring/Working/Confirmed/Parked-or-Deferred Tailwind color map is currently duplicated verbatim, un-exported, in both `CanonPanel.tsx` and `WorldInterview.tsx`. Extract it once into a new small shared module and have both existing call sites import it. This isn't asked for by #45's AC, but it directly serves the issue's own stated reuse intent (shared badge styling) at near-zero cost, and stops a third copy from appearing.

## What's already usable as-is

- `GET /api/world-chat/entries` (`web/src/app/api/world-chat/entries/route.ts`) already returns every World Entry as `{ entryId, status, value, dependsOn }` via `toApiEntry` — no new read endpoint.
- `isValidTransition()` (`web/src/lib/canonEngine/transitions.ts`) is pure and client-safe — reuse for any status-change control, exactly as `WorldInterview.tsx`'s pillars panel already does.
- `WORLD_STAGE_NAMES` (`web/src/lib/worldEngine/worldTurnSchema.ts`) already maps stage number → name ("Understand", "Assess & Pillar Mapping", etc.) — no new stage-name data needed.
- `P3State.activePillar` (`web/src/lib/canonEngine/storyStore.ts`, from #43) is already returned on every turn response as `p3.activePillar`.
- Outstanding Questions have no dedicated store and don't need one — `docs/superpowers/specs/2026-09-10-world-entry-model-design.md`'s Open Follow-up section pre-resolved this: "#45 aggregates by listing all entries and flattening their own `outstandingQuestions` arrays." Same here: flatten `entries[].value.outstandingQuestions`, tagged with the parent entry's name/id.
- Dependency Graph (simple list, per AC): for each entry with a non-empty `dependsOn`, list it as "`<entry name>` depends on: `<dep name>`, `<dep name>`..." resolving each dependency id to its entry's name via the same fetched list. (Today, nothing in the chat turn handler sets `dependsOn` on create/update, so this list will typically render empty until a future issue populates it — that's a pre-existing data gap, not something #45 needs to fix; the AC only asks for the *view*.)

## New work

1. **`web/src/lib/canonEngine/statusBadge.ts`** (new) — exports the shared color map:
   ```ts
   export type CanonBadgeStatus = "Exploring" | "Working" | "Confirmed" | "Parked" | "Deferred";
   export const CANON_STATUS_BADGE_STYLES: Record<CanonBadgeStatus, string> = {
     Exploring: "bg-neutral-700 text-neutral-300",
     Working: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
     Confirmed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
     Parked: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
     Deferred: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
   };
   ```
   `CanonPanel.tsx` and `WorldInterview.tsx` both switch their local copies to import this instead (their existing status vocabularies differ only in the Parked/Deferred label, both covered above) — a pure refactor, no behavior change for either.

2. **`web/src/components/WorldSidePanel.tsx`** (new) — the actual panel for #45's AC, rendered inside `WorldInterview.tsx`'s existing `right-panel` column, above the existing pillars-panel card (which keeps its current job: drafting/reordering/confirming the master pillar list — a Stage 2 concern, distinct from #45's Stage 3+ registry view).

   Props: `storyId: string`, `currentStage: number | null`, `activePillar: string | null`. Internal state: `entries: ApiWorldEntry[]`, fetched via `GET /api/world-chat/entries?storyId=...` on mount and again every time `refreshToken` (a prop bumped by the parent after each turn response — see below) changes.

   Renders, top to bottom:
   - **Stage & Pillar header**: `Stage {currentStage} · {WORLD_STAGE_NAMES[currentStage] ?? "—"}` and `Active Pillar: {activePillar ?? "(none yet)"}`.
   - **Canon Registry**: one row per entry — name, category, a status badge (via the new shared map, `Deferred` label as returned by `toApiEntry`), importance, depth. Empty state: "No World Entries yet — they'll appear here as you develop each pillar."
   - **Outstanding Questions**: flattened list across all entries, each row showing the parent entry's name + the question's `item`/`notes`. Empty state: "No outstanding questions right now."
   - **Dependency Graph (list view)**: for each entry with `dependsOn.length > 0`, one line resolving dependency ids to names (fall back to the raw id if a dependency's entry isn't in the fetched list, e.g. deleted). Skip the whole section if no entry has any dependencies. Section subtitle notes this is a placeholder for the full graph view (#53).
   - A manual "Refresh" button/icon, since this panel is polling-on-turn rather than live-subscribed (matching the rest of the app — no Firestore listeners anywhere in this codebase) and a story can be edited in the direct entries API (Postman/tests) between turns.

3. **`WorldInterview.tsx`** (modify): render `<WorldSidePanel storyId={canvasId} currentStage={currentStage} activePillar={wclState?.activePillar ?? null} refreshToken={messages.length} />` in the right panel. `messages.length` already changes exactly once per completed turn (one new entry appended per user/assistant message) — it's a free bump signal, no new state needed. `WorldSidePanel` refetches on mount and whenever `refreshToken` changes; no callback needs to be threaded down.

## Error handling

- The entries fetch failing (network error, 403, 404) shows an inline "Couldn't load the Canon Registry — try refreshing." message inside the panel, not a page-level error — this panel is supplementary display, never blocking to the chat itself (matches this app's established "the model's turn always completes even if a side write fails" philosophy from #39/#40/#43).
- No new server-side code, no new Firestore writes — this issue is read-only.

## Out of scope (explicitly, per existing plan)

- Full dependency-graph visualization — #53, Phase 5 stretch.
- Editing entries/questions directly from this panel — the AC only asks for a browsable registry; editing continues to happen through chat (issue #47's Conflict Resolution Protocol will govern edits to Confirmed entries).
- Any change to `dependsOn` population — that's a data gap in the chat turn handler, tracked separately, not this issue's job.
