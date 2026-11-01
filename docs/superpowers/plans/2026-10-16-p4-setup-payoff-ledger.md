# P4 Setup & Payoff Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #173 — a real data model for planted setups and their payoffs,
replacing `compileArchitectureDocument.ts`'s Section 6 `NOT_TRACKED_LEDGER` placeholder with real
tracked data, and surfacing the same tracking during development (not just at compile time).

**Architecture:** A new pure module (`setupPayoffLedger.ts`, mirrors `sceneDensity.ts`'s shape)
parses `[SETUP: name]`/`[PAYOFF: name]` tags directly out of `StructuralUnit.content` — the same
"tag in content, no new storage" convention issue #66's `[CRITICAL BEAT: X]` already established
— and builds a name-keyed ledger. The compiler wires it into Section 6, cross-referenced from the
already-built Section 4 Scene Register (same invariant Section 5 already has). The per-turn chat
route and canvas resume route surface a derived advisory (dangling setups / orphaned payoffs),
mirroring `sceneDensity.ts`'s own wiring, with no new gating and no dismissal state.

**Tech Stack:** Plain TypeScript pure functions, Zod-free (no LLM schema change), one Firestore
JSON-shape change (not a new field), two API route edits, one React/TSX banner edit.

## Global Constraints

- No new Firestore field and no new LLM turn-schema field — the ledger is always *derived* from
  `StructuralUnit.content`, never independently persisted (see design spec §2).
- Never hard-gates a status transition or blocks compile — advisory only (see design spec §1, §3).
- Section 6 at compile time is built from the Confirmed-only `parsedEntries`/`sceneRegister`
  arrays `compileArchitectureDocument.ts` already builds for Sections 4/5 — never an independent
  re-scan of `units` — so Section 6 can never name a scene Section 4 doesn't contain (mirrors the
  existing Section 4/5 invariant exactly).
- Name matching is case-insensitive and trimmed; first-seen casing is kept for display; "first
  occurrence wins" for duplicate plants/payoffs of the same name (disclosed limitation, not a
  crash) — see design spec §5.
- Design spec: `docs/superpowers/specs/2026-10-16-p4-setup-payoff-ledger-design.md`.
- Verification throughout: `npm run lint`, `npm run build`, `npm run test` (vitest) from `web/`,
  plus new unit tests following `compileArchitectureDocument.test.ts`'s and
  `preCompilationAudit.test.ts`'s own style.

---

### Task 1: `setupPayoffLedger.ts` — tag parsing, ledger builder, advisory summarizer

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/setupPayoffLedger.ts`
- Create: `web/src/lib/storyArchitectureEngine/setupPayoffLedger.test.ts`

**Interfaces produced** (consumed by Tasks 2 and 3):
```ts
export const SETUP_TAG_PATTERN: RegExp;   // /\[SETUP:\s*([^\]]+)\]/gi
export const PAYOFF_TAG_PATTERN: RegExp;  // /\[PAYOFF:\s*([^\]]+)\]/gi

export interface ParsedSetupPayoffTags { setupNames: string[]; payoffNames: string[]; }
export function parseSetupPayoffTags(content: string): ParsedSetupPayoffTags;

export interface SetupPayoffLedgerLocation {
  unitId: string;
  sceneNumber: number | null;
  slugline: string | null;
}
export interface SetupPayoffLedgerEntry {
  name: string;
  planted: SetupPayoffLedgerLocation | null;
  paidOff: SetupPayoffLedgerLocation | null;
}
export interface SetupPayoffSourceEntry {
  unitId: string;
  content: string;
  sceneNumber?: number | null;
  slugline?: string | null;
}
export function buildSetupPayoffLedger(entries: SetupPayoffSourceEntry[]): SetupPayoffLedgerEntry[];

export interface SetupPayoffAdvisory { danglingSetups: string[]; orphanedPayoffs: string[]; }
export function summarizeSetupPayoffAdvisory(ledger: SetupPayoffLedgerEntry[]): SetupPayoffAdvisory;
```

- [ ] **Step 1: Write `setupPayoffLedger.ts`**

  ```ts
  import type { StructuralUnit } from "./stateLedger";

  /**
   * P4's Setup & Payoff Ledger - GitHub issue #173. Mirrors
   * developmentLoop.ts's [CRITICAL BEAT: X] tag convention (issue #66)
   * for the TAGGING mechanism only - [SETUP: name]/[PAYOFF: name] live
   * in the same StructuralUnit.content strings, parsed by regex, no new
   * storage. Unlike Critical Beats, setup/payoff names have no fixed
   * catalog to validate against (free text, author-invented per story),
   * so this module never hard-gates a transition - see
   * docs/superpowers/specs/2026-10-16-p4-setup-payoff-ledger-design.md
   * §1 for why. Standalone module (not developmentLoop.ts, which is
   * scoped to turn-level checks; not compileArchitectureDocument.ts,
   * which is scoped to the final document) - same "single-concern pure
   * module over StructuralUnit[]" shape as sceneDensity.ts.
   */

  export const SETUP_TAG_PATTERN = /\[SETUP:\s*([^\]]+)\]/gi;
  export const PAYOFF_TAG_PATTERN = /\[PAYOFF:\s*([^\]]+)\]/gi;

  export interface ParsedSetupPayoffTags {
    setupNames: string[];
    payoffNames: string[];
  }

  function extractTagNames(content: string, pattern: RegExp): string[] {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    const names: string[] = [];
    for (const match of content.matchAll(global)) {
      const name = match[1].trim();
      if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
        names.push(name);
      }
    }
    return names;
  }

  /** Extracts every [SETUP: name]/[PAYOFF: name] tag from one unit's
   * content, trimmed, original casing preserved, de-duplicated
   * case-insensitively within this single unit. Never throws - absence
   * of either tag type is the normal case for most scenes. */
  export function parseSetupPayoffTags(content: string): ParsedSetupPayoffTags {
    return {
      setupNames: extractTagNames(content, SETUP_TAG_PATTERN),
      payoffNames: extractTagNames(content, PAYOFF_TAG_PATTERN),
    };
  }

  export interface SetupPayoffLedgerLocation {
    unitId: string;
    sceneNumber: number | null;
    slugline: string | null;
  }

  export interface SetupPayoffLedgerEntry {
    name: string;
    planted: SetupPayoffLedgerLocation | null;
    paidOff: SetupPayoffLedgerLocation | null;
  }

  export interface SetupPayoffSourceEntry {
    unitId: string;
    content: string;
    sceneNumber?: number | null;
    slugline?: string | null;
  }

  /** Builds the ledger from an ORDERED list of entries - ledger order
   * is the caller's own concept of order (Section 4's Confirmed-only
   * Scene Register order at compile time; plain units[] order during
   * development, where no Scene Register ordering exists yet).
   * Groups by case-insensitive, trimmed name. For each distinct name,
   * `planted` is the FIRST entry carrying a [SETUP: name] tag and
   * `paidOff` is the FIRST entry carrying a [PAYOFF: name] tag for
   * that same name - "first occurrence wins" is a disclosed
   * simplification (see design spec §5), not a silent wrong answer.
   * Entries are returned in order of each name's first appearance
   * (whichever tag type appears first). */
  export function buildSetupPayoffLedger(entries: SetupPayoffSourceEntry[]): SetupPayoffLedgerEntry[] {
    const byKey = new Map<string, SetupPayoffLedgerEntry>();
    const order: string[] = [];

    function locationOf(entry: SetupPayoffSourceEntry): SetupPayoffLedgerLocation {
      return {
        unitId: entry.unitId,
        sceneNumber: entry.sceneNumber ?? null,
        slugline: entry.slugline ?? null,
      };
    }

    function ensureEntry(name: string): SetupPayoffLedgerEntry {
      const key = name.toLowerCase();
      const existing = byKey.get(key);
      if (existing) return existing;
      const created: SetupPayoffLedgerEntry = { name, planted: null, paidOff: null };
      byKey.set(key, created);
      order.push(key);
      return created;
    }

    for (const entry of entries) {
      const { setupNames, payoffNames } = parseSetupPayoffTags(entry.content);
      for (const name of setupNames) {
        const ledgerEntry = ensureEntry(name);
        if (!ledgerEntry.planted) ledgerEntry.planted = locationOf(entry);
      }
      for (const name of payoffNames) {
        const ledgerEntry = ensureEntry(name);
        if (!ledgerEntry.paidOff) ledgerEntry.paidOff = locationOf(entry);
      }
    }

    return order.map((key) => byKey.get(key)!);
  }

  export interface SetupPayoffAdvisory {
    danglingSetups: string[];
    orphanedPayoffs: string[];
  }

  /** Pure derived summary for development-time surfacing (design spec
   * §3) - strictly advisory, computed fresh every call, nothing here
   * is persisted or dismissible: a dangling setup is normal
   * mid-development state, not an alert the author needs to
   * acknowledge once and never see again. */
  export function summarizeSetupPayoffAdvisory(ledger: SetupPayoffLedgerEntry[]): SetupPayoffAdvisory {
    return {
      danglingSetups: ledger.filter((e) => e.planted && !e.paidOff).map((e) => e.name),
      orphanedPayoffs: ledger.filter((e) => !e.planted && e.paidOff).map((e) => e.name),
    };
  }

  /** Convenience wrapper for development-time callers (architecture-chat/route.ts,
   * the canvas resume route) - builds source entries directly from a
   * StructuralUnit[] with no scene-number concept (none exists
   * pre-compile), scanning Working+Confirmed units only, matching
   * sceneDensity.ts's own "counted" set exactly. */
  export function computeSetupPayoffAdvisory(units: StructuralUnit[]): SetupPayoffAdvisory {
    const relevant = units.filter((u) => u.status === "Working" || u.status === "Confirmed");
    const entries: SetupPayoffSourceEntry[] = relevant.map((u) => ({
      unitId: u.unitId,
      content: typeof u.content === "string" ? u.content : "",
    }));
    return summarizeSetupPayoffAdvisory(buildSetupPayoffLedger(entries));
  }
  ```

- [ ] **Step 2: Write `setupPayoffLedger.test.ts`**

  Cover, at minimum (mirroring `preCompilationAudit.test.ts`'s and
  `compileArchitectureDocument.test.ts`'s own directness):
  - `parseSetupPayoffTags`: a content string with one `[SETUP: ...]` and one `[PAYOFF: ...]`
    extracts both correctly, trimmed; a string with neither returns two empty arrays; a string
    with two distinctly-named `[SETUP: ...]` tags returns both; two tags differing only in casing
    (`[SETUP: The Gun]` / `[SETUP: the gun]`) in the SAME unit de-duplicate to one name (first
    casing wins).
  - `buildSetupPayoffLedger`: a setup planted in entry 1 and paid off in entry 3 (by matching,
    case-different name) produces one entry with both `planted`/`paidOff` populated, correct
    `unitId`/`sceneNumber`/`slugline`; a setup with no payoff anywhere produces `paidOff: null`;
    a payoff with no matching setup anywhere produces `planted: null`; two separate `[SETUP: ...]`
    tags for the same name across two different entries - the FIRST entry's location wins for
    `planted` (regression-pin the "first occurrence wins" rule, same spirit as the existing
    `criticalBeatTag` singular-vs-plural regression test); entries are returned in first-appearance
    order, verified against a 3-plus-name fixture.
  - `summarizeSetupPayoffAdvisory`: a ledger with one dangling (`planted`, no `paidOff`) and one
    orphaned (`paidOff`, no `planted`) and one fully-resolved entry classifies exactly the first
    two, by name, into the right list.
  - `computeSetupPayoffAdvisory`: an `Exploring` unit's tags are excluded (matching
    `sceneDensity.ts`'s own `counted` set); a `Working` unit's tags ARE included (dangling setup
    surfaces before Confirmed, per design spec §3).

- [ ] **Step 3: Verify**

  From `web/`: `npx vitest run src/lib/storyArchitectureEngine/setupPayoffLedger.test.ts`, then
  `npm run lint`.

- [ ] **Step 4: Commit**
  ```bash
  git add web/src/lib/storyArchitectureEngine/setupPayoffLedger.ts web/src/lib/storyArchitectureEngine/setupPayoffLedger.test.ts
  git commit -m "feat: add P4 Setup & Payoff Ledger parsing/pairing module (issue #173)"
  ```

---

### Task 2: Wire Section 6 of the compiled document to real data

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts` (`ScreenplayArchitectureDocument["6_setup_payoff_ledger"]`
  type)
- Modify: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts` (Section 6 build +
  markdown table)
- Modify: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.test.ts` (new tests)

**Interfaces consumed (Task 1):** `buildSetupPayoffLedger`, `type SetupPayoffSourceEntry`.

- [ ] **Step 1: Retype Section 6 in `storyStore.ts`**

  Change:
  ```ts
  "6_setup_payoff_ledger": string;
  ```
  to:
  ```ts
  "6_setup_payoff_ledger": {
    setup_name: string;
    planted: { unit_id: string; scene_number: number; slugline: string } | null;
    paid_off: { unit_id: string; scene_number: number; slugline: string } | null;
  }[];
  ```

- [ ] **Step 2: Build Section 6 from the already-built Section 4 arrays**

  In `compileArchitectureDocument.ts`, remove the `NOT_TRACKED_LEDGER` constant and its import
  site (`NOT_TRACKED_LEDGER` becomes dead). Immediately after the existing `earmarkIndex` block
  (which already walks `parsedEntries`/`sceneRegister`), add:
  ```ts
  const setupPayoffLedger = buildSetupPayoffLedger(
    parsedEntries.map(({ unit, index }) => ({
      unitId: unit.unitId,
      content: typeof unit.content === "string" ? unit.content : "",
      sceneNumber: sceneRegister[index].scene_number,
      slugline: sceneRegister[index].slugline,
    }))
  ).map((entry) => ({
    setup_name: entry.name,
    planted: entry.planted && entry.planted.sceneNumber !== null && entry.planted.slugline !== null
      ? { unit_id: entry.planted.unitId, scene_number: entry.planted.sceneNumber, slugline: entry.planted.slugline }
      : null,
    paid_off: entry.paidOff && entry.paidOff.sceneNumber !== null && entry.paidOff.slugline !== null
      ? { unit_id: entry.paidOff.unitId, scene_number: entry.paidOff.sceneNumber, slugline: entry.paidOff.slugline }
      : null,
  }));
  ```
  Update the return object's `"6_setup_payoff_ledger"` field from `NOT_TRACKED_LEDGER` to
  `setupPayoffLedger`. Add the import: `import { buildSetupPayoffLedger } from "./setupPayoffLedger";`.

  (The `sceneNumber !== null && slugline !== null` narrowing is defensive only - every entry in
  `parsedEntries`/`sceneRegister` for a Confirmed unit always has a real `scene_number`/`slugline`
  by construction; this just satisfies the stricter nullable `SetupPayoffLedgerLocation` type
  without an unsafe cast.)

- [ ] **Step 3: Markdown table for Section 6**

  Replace:
  ```ts
  sections.push("## 6. Setup & Payoff Ledger\n" + doc["6_setup_payoff_ledger"]);
  ```
  with a table mirroring Section 5's own markdown table shape exactly:
  ```ts
  const ledger = doc["6_setup_payoff_ledger"];
  sections.push(
    "## 6. Setup & Payoff Ledger\n" +
      (ledger.length > 0
        ? "| Setup Name | Planted | Paid Off |\n|---|---|---|\n" +
          ledger
            .map(
              (e) =>
                `| ${e.setup_name} | ${e.planted ? `Scene ${e.planted.scene_number}: ${e.planted.slugline}` : "— (orphaned - no [SETUP: ...] tag found)"} | ${e.paid_off ? `Scene ${e.paid_off.scene_number}: ${e.paid_off.slugline}` : "— (dangling - not yet paid off)"} |`
            )
            .join("\n")
        : "_No [SETUP: ...]/[PAYOFF: ...] tags found in the Confirmed Scene Register yet._")
  );
  ```

- [ ] **Step 4: Tests in `compileArchitectureDocument.test.ts`**

  Add a describe block mirroring the existing Section 4/5 cross-reference test's own style:
  - A fixture with one Confirmed unit tagging `[SETUP: the music box]` and a later Confirmed unit
    tagging `[PAYOFF: The Music Box]` (different casing) → Section 6 has exactly one entry, name
    is the first-seen casing, `planted`/`paid_off` both populated with `scene_number`/`slugline`
    read off the SAME result object's Section 4 entries for those two units (byte-identical, same
    invariant-proving style as the existing Section 4/5 test) - never hand-recomputed.
  - A Confirmed unit tagging only `[SETUP: a locked door]`, nothing pays it off → Section 6 entry
    has `paid_off: null`.
  - A Confirmed unit tagging only `[PAYOFF: a stray thread]`, nothing planted it → Section 6 entry
    has `planted: null`.
  - No Confirmed unit tags anything → Section 6 is `[]`, and the markdown renders the "no tags
    found yet" disclosed-empty message (not a placeholder string).

- [ ] **Step 5: Verify**

  From `web/`: `npx vitest run src/lib/storyArchitectureEngine/compileArchitectureDocument.test.ts`,
  `npm run lint`, `npm run build`, full `npm run test`.

- [ ] **Step 6: Commit**
  ```bash
  git add web/src/lib/canonEngine/storyStore.ts web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts web/src/lib/storyArchitectureEngine/compileArchitectureDocument.test.ts
  git commit -m "feat: wire Screenplay Architecture Document Section 6 to the Setup & Payoff Ledger (issue #173)"
  ```

---

### Task 3: docx/PDF exports

**Files:**
- Modify: `web/src/lib/docx/screenplayArchitectureDocx.ts`
- Modify: `web/src/lib/pdf/ScreenplayArchitecturePdfDocument.tsx`

- [ ] **Step 1: docx Section 6** - replace the single-paragraph Section 6 block with a `Table`
  shaped exactly like Section 5's own three-column table (`Setup Name | Planted | Paid Off`), one
  row per `doc["6_setup_payoff_ledger"]` entry, using the same `"— (orphaned...)"`/`"— (dangling...)"`
  text as the markdown renderer for the null cases, and a single paragraph ("No [SETUP: ...]/
  [PAYOFF: ...] tags found in the Confirmed Scene Register yet.") when the array is empty.

- [ ] **Step 2: PDF Section 6** - replace the single `<Text>` Section 6 block with a `.map` over
  `doc["6_setup_payoff_ledger"]` producing one `<Text style={styles.li}>` row per entry (mirroring
  Section 5's own `.map` block exactly), same null-case text as above, and the same empty-array
  message when there are no entries.

- [ ] **Step 3: Verify**

  From `web/`: `npm run lint`, `npm run build` (the docx/pdf generators have no dedicated test
  suite - issue #70's own precedent is `tsc`/lint/build plus direct code trace for these two
  files specifically, since they're thin rendering wrappers around already-tested JSON).

- [ ] **Step 4: Commit**
  ```bash
  git add web/src/lib/docx/screenplayArchitectureDocx.ts web/src/lib/pdf/ScreenplayArchitecturePdfDocument.tsx
  git commit -m "feat: render the real Setup & Payoff Ledger in docx/PDF exports (issue #173)"
  ```

---

### Task 4: Development-time surfacing (chat route, resume route, UI banner)

**Files:**
- Modify: `web/src/app/api/architecture-chat/route.ts`
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces consumed (Task 1):** `computeSetupPayoffAdvisory(units): SetupPayoffAdvisory`.

- [ ] **Step 1: `architecture-chat/route.ts`**

  Import `computeSetupPayoffAdvisory` from `./setupPayoffLedger`. Immediately after the existing
  `sceneDensityForResponse` computation (same point in the turn, after `units` reaches its final
  state), add:
  ```ts
  const setupPayoffAdvisory = computeSetupPayoffAdvisory(units);
  ```
  Add `setupPayoffAdvisory` as a new top-level field on the `NextResponse.json({...})` return,
  alongside the existing `sceneDensity` field.

- [ ] **Step 2: Canvas resume route**

  In `workspaces/[workspaceId]/canvases/[canvasId]/route.ts`, import
  `computeSetupPayoffAdvisory` and compute `const setupPayoffAdvisory =
  computeSetupPayoffAdvisory(story.p4Units ?? []);` right next to the existing `sceneDensity`
  computation; add it as a sibling field on the response JSON.

- [ ] **Step 3: UI banner**

  In `ArchitectureInterview.tsx`: add the client-side type
  `type SetupPayoffAdvisory = { danglingSetups: string[]; orphanedPayoffs: string[] };`, add it to
  `TurnResponse`, add `const [setupPayoffAdvisory, setSetupPayoffAdvisory] =
  useState<SetupPayoffAdvisory | null>(null);`, set it from the resume effect
  (`data.setupPayoffAdvisory`) and from `sendMessage` (`data.setupPayoffAdvisory`) at the same
  points `sceneDensity` is already set in both places. Add one new banner, styled like the
  existing `cascadeReview` informational banner (not the red validation-failure style - this never
  blocks anything), rendered when either list is non-empty:
  ```tsx
  {setupPayoffAdvisory && (setupPayoffAdvisory.danglingSetups.length > 0 || setupPayoffAdvisory.orphanedPayoffs.length > 0) && (
    <div className="border-b border-sky-500/30 bg-sky-950/20 px-6 py-2 text-xs text-sky-200">
      {setupPayoffAdvisory.danglingSetups.length > 0 && (
        <p>Planted, not yet paid off: {setupPayoffAdvisory.danglingSetups.join(", ")}</p>
      )}
      {setupPayoffAdvisory.orphanedPayoffs.length > 0 && (
        <p>Paid off, but no matching [SETUP: ...] tag found: {setupPayoffAdvisory.orphanedPayoffs.join(", ")}</p>
      )}
    </div>
  )}
  ```

- [ ] **Step 4: Verify**

  From `web/`: `npm run lint`, `npm run build`, `npm run test`.

- [ ] **Step 5: Commit**
  ```bash
  git add web/src/app/api/architecture-chat/route.ts "web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts" web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: surface the Setup & Payoff Ledger advisory during development, not just at compile time (issue #173)"
  ```

---

### Task 5: Final whole-branch review

- [ ] Re-read every file touched across Tasks 1-4 together (not per-task in isolation) - the
  precedent `docs/superpowers/plans/2026-09-18-p4-full-compiler.md`'s own closing review and
  issue #70's final-review commits (`f9f8521f`, `10b9ae16`) already established for this compile
  pipeline.
- [ ] Confirm the Section 4/6 cross-reference invariant holds by construction (never two separate
  reads of `unit.content`/`units` for the same compiled document).
- [ ] Confirm nothing in Tasks 2-4 accidentally gates a status transition or blocks compile -
  `grep` for any new call site touching `attemptStatusTransition`, `runPreCompilationAudit`, or
  the compile route's `gapFound`/`acknowledged` logic; there should be none.
- [ ] `npm run lint && npm run build && npm run test` clean from `web/`.
- [ ] Open the PR against `main` (not merged by the agent).
