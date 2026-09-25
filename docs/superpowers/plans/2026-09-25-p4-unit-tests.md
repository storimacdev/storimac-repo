# P4 Unit Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a real unit test suite (this repo currently has zero test infrastructure) and write unit tests for the deterministic P4 logic that was implemented and fixed across issues #56, #65, #67, #70, #91 this session, so future changes to this logic are caught by an automated gate rather than relying solely on manual/subagent review.

**Architecture:** Vitest (fast, native ESM/TS, no Babel config needed, first-class Vite plugin ecosystem for path aliases) run via `npm test` from `web/`. Tests target the *pure, deterministic* functions in `storyArchitectureEngine/` — the actual site of every real bug found and fixed this session (the scene-density phantom-step bug, the multi-tag Critical Beat Earmark Index bug, the Thematic Anchor acknowledged-path marker bug, the `stepNumber` tagging gap in Canon Revision). Functions that require network I/O (Firestore reads/writes, the Anthropic API call) are either tested only for their pure/synchronous portions, or have their I/O boundary mocked with `vi.mock()` — never real network calls in a unit test.

**Tech Stack:** Vitest, `vite-tsconfig-paths` (so tests resolve `@/*` exactly like the app's own `tsconfig.json`), no new runtime dependencies.

## Global Constraints

- Test files live beside their source file, named `<name>.test.ts` (e.g. `sceneDensity.ts` → `sceneDensity.test.ts`), and are picked up by `include: ["src/**/*.test.ts"]` in `vitest.config.ts`.
- No test may make a real network call (no real Firestore, no real Anthropic API call). Any function under test that performs I/O gets that I/O mocked via `vi.mock("<module path>", ...)` at the top of the test file, mocking only the specific exports the function-under-test actually calls — never the whole module wholesale if only some exports are I/O.
- Every test must assert a real, specific expected value (`expect(x).toBe(y)` / `.toEqual(y)`), never merely `expect(x).toBeDefined()` or `expect(() => fn()).not.toThrow()` as the *only* assertion in a test - a "doesn't crash" check is fine as ONE assertion in a broader test, never the whole test.
- Prioritize covering the exact regressions this session's reviews found and fixed (each task below names them) over exhaustive coverage of every code path - depth on real bugs over breadth on trivial getters.
- `npm test` (added in Task 1) must exit 0 when all tests pass, non-zero when any fails - this is what makes it usable as a pre-deploy gate going forward.

---

### Task 1: Vitest setup

**Files:**
- Create: `web/vitest.config.ts`
- Modify: `web/package.json` (add `vitest` + `vite-tsconfig-paths` devDependencies, add a `"test": "vitest run"` script)
- Create: `web/src/lib/storyArchitectureEngine/sceneDensity.smoke.test.ts` (temporary-in-spirit but keep it — a permanent minimal smoke test is cheap insurance that the config itself works)

**Interfaces:**
- Produces: the `vitest.config.ts` and `npm test` script every later task's tests run under.

- [ ] **Step 1: Install dependencies**

From `web/`:
```
npm install -D vitest vite-tsconfig-paths
```

- [ ] **Step 2: Create `web/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the `test` script**

In `web/package.json`'s `"scripts"`, add `"test": "vitest run"` alongside the existing `dev`/`build`/`start`/`lint` scripts.

- [ ] **Step 4: Write one smoke test proving the config resolves `@/*` path aliases**

Create `web/src/lib/storyArchitectureEngine/sceneDensity.smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { MIN_TARGET_SCENES, MAX_TARGET_SCENES } from "./sceneDensity";
import type { StructuralUnit } from "@/lib/storyArchitectureEngine/stateLedger";

describe("vitest setup smoke test", () => {
  it("resolves a relative import and the @/ path alias in the same file", () => {
    expect(MIN_TARGET_SCENES).toBe(75);
    expect(MAX_TARGET_SCENES).toBe(150);
    const unit: StructuralUnit | null = null;
    expect(unit).toBeNull();
  });
});
```

(This file intentionally only proves the config works - Task 2 below covers `sceneDensity.ts` for real.)

- [ ] **Step 5: Run and verify**

```
npm test
```
Must report 1 passed test, exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/lib/storyArchitectureEngine/sceneDensity.smoke.test.ts
git commit -m "chore: add Vitest test infrastructure

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `sceneDensity.ts` and `canonRevision.ts` `stepNumber` tagging tests (issue #56)

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/sceneDensity.test.ts`
- Create: `web/src/lib/storyArchitectureEngine/canonRevision.test.ts`

**Interfaces:**
- Consumes: `computeSceneDensity`, `applySceneDensityDismissal`, `nextSceneDensityDismissal`, `DEFAULT_SCENE_DENSITY_DISMISSAL`, `MIN_TARGET_SCENES` (75), `MAX_TARGET_SCENES` (150), `MIN_COUNT_FOR_PROJECTION` (20), `MIN_STEPS_FOR_PROJECTION` (2) from `./sceneDensity`. `StructuralUnit`, `createUnit`, `setUnitContent`, `setUnitStatus`, `setUnitStepNumber` from `./stateLedger`. `resolveP4Conflict` and its param/result types from `./canonRevision`.

Read both source files in full before writing tests - the exact function signatures and the `StructuralUnit` shape (`unitId`, `type`, `status`, `content`, `canonRefs`, `stepNumber`, timestamps) are defined in `stateLedger.ts`; use its own `createUnit`/`setUnitContent`/`setUnitStatus`/`setUnitStepNumber` helpers to build test fixtures rather than hand-constructing raw objects, so fixtures stay valid if the shape ever changes.

- [ ] **Step 1: `sceneDensity.test.ts` - the phantom-step bug this session's final review caught and fixed**

The bug: a unit with no `stepNumber` key at all (a "legacy" unit predating this feature) must NOT be counted as a phantom step in the projection. Build one `StructuralUnit` via `createUnit(...)` and deliberately do NOT call `setUnitStepNumber` on it (so `stepNumber` stays at its `createUnit`-initialized value of `null`) alongside 2+ units that DO have a `stepNumber` set, and assert `computeSceneDensity` does not treat the legacy unit's `null` as if it were a real step - assert the specific numeric `projectedTotal` you compute by hand for the fixture, not just "not NaN"/"not null".

- [ ] **Step 2: `sceneDensity.test.ts` - `MIN_COUNT_FOR_PROJECTION` floor**

With fewer than `MIN_COUNT_FOR_PROJECTION` (20) Working+Confirmed units total, assert `computeSceneDensity` returns `alert: null` and `projectedTotal: null` regardless of how few steps are represented - the floor exists specifically to suppress a guaranteed false "under" alert early in Blueprint Priority's anchor-first routing (issue #56's own finding). Then build a fixture with `MIN_COUNT_FOR_PROJECTION` or more units and assert a real alert (`"under"` or `"over"`) is now possible when the projected total is genuinely outside `[MIN_TARGET_SCENES, MAX_TARGET_SCENES]`.

- [ ] **Step 3: `sceneDensity.test.ts` - alert thresholds and count**

One fixture whose Working+Confirmed count and step-spread projects to a total clearly under `MIN_TARGET_SCENES` → assert `alert: "under"`. One fixture projecting clearly over `MAX_TARGET_SCENES` → assert `alert: "over"`. One fixture projecting inside the range → assert `alert: null`. Assert `count` in the result equals the actual Working+Confirmed unit count you built, in all three cases.

- [ ] **Step 4: `sceneDensity.test.ts` - dismissal round-trip**

Call `nextSceneDensityDismissal` with a fixed `now` and an alert direction, assert the returned dismissal's shape (check `DEFAULT_SCENE_DENSITY_DISMISSAL`'s shape for what fields to expect). Then call `applySceneDensityDismissal` with that dismissal and confirm a density result that would otherwise alert in the SAME direction is suppressed, while a result alerting in the OTHER direction is NOT suppressed (dismissal is direction-specific, not a blanket mute - confirm this from reading the source; if the source shows dismissal is NOT direction-specific, test what it actually does instead, don't force this expectation).

- [ ] **Step 5: `canonRevision.test.ts` - mock the Firestore boundary**

At the top of the file:

```typescript
import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/canonEngine/canonStore", () => ({
  listDependents: vi.fn().mockResolvedValue([]),
  WORLD_ELEMENTS_COLLECTION: "worldElements",
}));

vi.mock("@/lib/canonEngine/storyStore", () => ({
  appendP4CanonRevisionLog: vi.fn().mockResolvedValue(undefined),
  appendOutstandingQuestions: vi.fn().mockResolvedValue(undefined),
}));

import { resolveP4Conflict } from "./canonRevision";
```

Read `canonRevision.ts`'s actual `ResolveP4ConflictParams`/`P4PendingConflict`-related types in full (imported from `@/lib/canonEngine/storyStore` and this file's own types) to build valid `conflict` fixtures for both a `unit_regression` kind and a `canon_contradiction` kind (with `sourceProject` something other than `"Project 3"`, to avoid needing to also fixture `listDependents`' return shape meaningfully - `[]` is enough since it's mocked to resolve empty).

- [ ] **Step 6: `canonRevision.test.ts` - the `stepNumber` tagging fix**

This is the actual regression this session's final review found and fixed: `resolveP4Conflict`'s `park` and `accept_and_update` branches previously never tagged the resolved unit's `stepNumber`, biasing `sceneDensity`'s projection upward. Call `resolveP4Conflict` with `resolution: "park"` and a non-null `activeStepNumber` (e.g. `4`), and assert the returned `units` array contains a unit for `conflict.unitId` whose `stepNumber` equals that same `4`. Repeat for `resolution: "accept_and_update"`. Then call with `activeStepNumber: null` and assert the resolved unit's `stepNumber` stays `null` (not coerced to some default) - confirming the `activeStepNumber !== null ? setUnitStepNumber(...) : contentApplied` branch in the source behaves as read.

- [ ] **Step 7: Run and verify**

```
npm test
```
All tests (Task 1's smoke test + this task's) must pass. Also re-run `npx tsc --noEmit -p .`, `npm run lint`, `npm run build` - all clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/sceneDensity.test.ts web/src/lib/storyArchitectureEngine/canonRevision.test.ts
git commit -m "test: add unit tests for scene density and canon revision stepNumber tagging (issue #56)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `developmentLoop.ts` tests - format checking and multi-tag scene parsing (issue #66, #70)

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/developmentLoop.test.ts`

**Interfaces:**
- Consumes: `checkSceneRegisterFormat`, `parseSceneRegisterEntry`, `ParsedSceneRegisterEntry` from `./developmentLoop`.

- [ ] **Step 1: `checkSceneRegisterFormat` - the happy path and each rejection reason**

Read the function in full. Write one test per distinct failure mode it can return (missing/malformed slugline, an unrecognized Critical Beat tag name, a paragraph with fewer than 3 or more than 4 sentences) asserting `{ ok: false, reason: <specific substring you expect> }`, and one test for a fully valid scene body asserting `{ ok: true }`.

- [ ] **Step 2: `checkSceneRegisterFormat` - does NOT reject a second valid tag**

This is the exact fact the final whole-branch review for issue #70 discovered by execution (disproving an earlier "unreachable" assumption): a scene body carrying TWO valid `[CRITICAL BEAT: ...]` tags passes this check (`{ ok: true }`), because the function only validates the first tag it finds and does not check for a second one. Write this as an explicit test - it's the reachability precondition the next two steps depend on, and it must stay documented as intentional/known behavior, not silently regress into rejecting multi-tag content (which would change what's compilable) or silently accepting it in a way nobody's aware of.

- [ ] **Step 3: `parseSceneRegisterEntry` - multi-tag collection (the fix)**

A scene body with two valid tags (e.g. `[CRITICAL BEAT: MIDPOINT]` and `[CRITICAL BEAT: FINAL IMAGE]`, each followed by a short sentence): assert `criticalBeatTags` equals `["MIDPOINT", "FINAL IMAGE"]` (order matters - first-encountered order), `criticalBeatTag` equals `"MIDPOINT"` (first tag, for backward-compatible single-tag display), and `paragraph` contains neither literal tag's bracket text (`toContain` assertions proving both are stripped, not just the first).

- [ ] **Step 4: `parseSceneRegisterEntry` - never throws, degrades honestly**

One test per malformed input already known to reach this function only when the author overrode issue #91's Formatting Check: no slugline at all, an unrecognized tag name, empty string, whitespace-only string. Assert `slugline` becomes the literal `"(malformed - no slugline found)"` placeholder where applicable, assert the call never throws (wrap in `expect(() => parseSceneRegisterEntry(input)).not.toThrow()` as one assertion among the specific-value assertions - not the only one).

- [ ] **Step 5: Run, verify, commit**

```
npm test
npx tsc --noEmit -p .
npm run lint
npm run build
```
All clean, then:
```bash
git add web/src/lib/storyArchitectureEngine/developmentLoop.test.ts
git commit -m "test: add unit tests for scene register format checking and multi-tag parsing (issues #66, #70)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `preCompilationAudit.ts` tests (issue #91)

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/preCompilationAudit.test.ts`

**Interfaces:**
- Consumes: `checkScale`, `checkEarmark`, `checkFormatting`, `runPreCompilationAudit`, `PreCompilationCheckFinding` from `./preCompilationAudit`. `MIN_TARGET_SCENES`/`MAX_TARGET_SCENES` from `./sceneDensity`. `CRITICAL_BEAT_LOOKUP` from `./structuralFramework` (read this file to get the real list of the 10 canonical tag names for fixtures).

- [ ] **Step 1: `checkScale`**

A fixture with Confirmed-unit count below `MIN_TARGET_SCENES`: assert `status: "flag"`. At or within `[MIN_TARGET_SCENES, MAX_TARGET_SCENES]`: assert `status: "pass"`. Above `MAX_TARGET_SCENES`: assert `status: "flag"`. Assert the `detail` string in each case contains the actual count you built.

- [ ] **Step 2: `checkEarmark` - the multi-tag undercounting bug this session's final review found and fixed**

The bug: this function used to reuse the shared non-global `CRITICAL_BEAT_TAG_PATTERN` directly, missing any beat tag beyond a unit's first. Build a fixture where ONE Confirmed unit's content carries TWO valid Critical Beat tags (covering two DIFFERENT canonical tags from `CRITICAL_BEAT_LOOKUP`) and no other unit covers either of those two tags. Assert `checkEarmark` reports BOTH tags as found (i.e., neither appears in a "missing" list / the `missing.length` your fixture implies is 0 for those two, given the rest of the 10 tags are covered by other fixture units) - this specifically proves the local global-clone fix, not just that some tags are found.

- [ ] **Step 3: `checkEarmark` - genuinely missing tags**

A fixture covering only some of the 10 canonical tags (Confirmed units, one tag each): assert `status: "flag"` and that the `detail` string names exactly the missing tags (from `Object.keys(CRITICAL_BEAT_LOOKUP)` minus what you covered). A fixture covering all 10: assert `status: "pass"`.

- [ ] **Step 4: `checkFormatting`**

Reuses `checkSceneRegisterFormat` (already tested in Task 3) against every Confirmed unit. One fixture where every Confirmed unit is well-formed: assert `status: "pass"`. One fixture with one malformed Confirmed unit: assert `status: "flag"` and that `detail` identifies it's a formatting problem (don't over-specify exact wording if you haven't read it - read the actual source string first, then assert against what it actually says).

- [ ] **Step 5: `runPreCompilationAudit` orchestration**

One fixture that fails all three checks: assert `failed: true` and `findings.length === 3` with all three `status: "flag"`. One fixture that passes all three: assert `failed: false` and every finding `status: "pass"`.

- [ ] **Step 6: Run, verify, commit**

```
npm test
npx tsc --noEmit -p .
npm run lint
npm run build
```
All clean, then:
```bash
git add web/src/lib/storyArchitectureEngine/preCompilationAudit.test.ts
git commit -m "test: add unit tests for the pre-compilation audit checks (issue #91)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `compileArchitectureDocument.ts` tests (issue #70)

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.test.ts`

**Interfaces:**
- Consumes: `compileScreenplayArchitectureDocumentJson`, `CompileScreenplayArchitectureDocumentParams`, `renderScreenplayArchitectureMarkdown` from `./compileArchitectureDocument`. `StructuralUnit`, `createUnit`, `setUnitContent`, `setUnitStatus` from `./stateLedger`. Read `IngestedCanon`'s shape from `./ingestCanon.ts` (type-only import is fine here - you only need it to type a fixture, and the compiler function only reads plain data off it, no I/O).

- [ ] **Step 1: The Section 4/5 cross-reference invariant - this session's single most important correctness property for this file**

Build a fixture with at least 3 Confirmed units in Scene Register order, where one unit's content carries TWO valid Critical Beat tags (same multi-tag fix as Tasks 3/4, now exercised at the full compile level - this is exactly the scenario the final whole-branch review's fix (commit `10b9ae16`) addressed). Call `compileScreenplayArchitectureDocumentJson`. Assert:
- `"5_critical_beat_earmark_index"` resolves BOTH of that unit's tags to the SAME `scene_number`/`unit_id`/`slugline`.
- Those resolved `scene_number`/`unit_id`/`slugline` values are byte-identical to that same unit's own entry in `"4_complete_approved_scene_register"` (read both off the same result object and compare them directly - don't hand-recompute expected values separately, since the point of this test is that the two sections cannot disagree by construction).
- Any of the other 8 canonical tags NOT present anywhere in your fixture resolve to `scene_number: null`, `unit_id: null`, `slugline: null`.

- [ ] **Step 2: Honest placeholder degradation when canon is missing**

Build a `CompileScreenplayArchitectureDocumentParams` fixture with `canon.p1: null` (or however `IngestedCanon` represents "Project 1 not yet ingested" - read `ingestCanon.ts` to get this right). Assert `"1_screenplay_metadata".working_title`, `"2_story_dna_blueprint".genre`/`.tone`/`.summary_of_core_promise`/`.core_dramatic_question` all equal the literal `"(not yet Confirmed)"` placeholder (read the exact source string first), and that the function does not throw.

- [ ] **Step 3: `outstanding` reflects non-Confirmed units, `projected_scene_count` reflects Confirmed-only count**

A fixture with a mix of Confirmed, Working, and Parked units: assert `"1_screenplay_metadata".projected_scene_count` equals the Confirmed-only count, and `"7_outstanding_decisions_version_history".outstanding` contains exactly the non-Confirmed units (by `unit_id`/`status`), not the Confirmed ones.

- [ ] **Step 4: `renderScreenplayArchitectureMarkdown` - the causal_tag content gap this session's Task 5 review found and fixed (for the docx/pdf exports) has a markdown baseline to compare against**

Build a document (via Step 1's or a fresh fixture's JSON output) whose Section 4 has a unit with a real `causal_tag` value. Assert the rendered markdown string contains that causal tag's text (`toContain`) - this is the reference behavior the docx/pdf exports are required to match; a future regression in the markdown renderer itself would silently invalidate that cross-format guarantee, so it needs its own direct test independent of the export-format files.

- [ ] **Step 5: Run, verify, commit**

```
npm test
npx tsc --noEmit -p .
npm run lint
npm run build
```
All clean, then:
```bash
git add web/src/lib/storyArchitectureEngine/compileArchitectureDocument.test.ts
git commit -m "test: add unit tests for the Screenplay Architecture Document compiler (issue #70)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `thematicAnchorAudit.ts` deterministic coverage check tests (issue #65)

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/thematicAnchorAudit.test.ts`

**Interfaces:**
- Consumes: `checkThematicAnchorCoverage`, `THEMATIC_ANCHOR_STEPS` from `./thematicAnchorAudit`.

Scope note: this task covers ONLY `checkThematicAnchorCoverage` - the fully deterministic, no-I/O function. `runThematicAnchorConsistencyCheck` and `runThematicAnchorAudit` make a real Anthropic API call via `extractTurn` and are explicitly OUT OF SCOPE for this plan (the actual bug this session found and fixed in this area - issue #91's final review finding - was in `document/route.ts`'s handling of the acknowledged-path marker, not in this file's own logic; that route-level gating logic is integration-level, not a unit under test here).

- [ ] **Step 1: Full coverage passes**

Build Confirmed units covering every step number in `THEMATIC_ANCHOR_STEPS` with real (non-empty) content. Assert the function's result shows no gap/flag for any of those steps (read the actual return shape first - likely a findings array or similar; assert against what it actually returns, matching this task's own real function signature).

- [ ] **Step 2: A genuinely missing step is flagged**

Omit one of `THEMATIC_ANCHOR_STEPS` from the Confirmed units entirely (no unit at that step number at all). Assert the result flags exactly that step and no others.

- [ ] **Step 3: A step exists but isn't Confirmed**

Include a unit at one of `THEMATIC_ANCHOR_STEPS`, but with status `"Working"` (not `"Confirmed"`). Assert this step is still flagged as not covered - `checkThematicAnchorCoverage` only counts Confirmed content per the ledger's own description of it, so a Working unit at the right step number must not count as coverage.

- [ ] **Step 4: Run, verify, commit**

```
npm test
npx tsc --noEmit -p .
npm run lint
npm run build
```
All clean, then:
```bash
git add web/src/lib/storyArchitectureEngine/thematicAnchorAudit.test.ts
git commit -m "test: add unit tests for the thematic anchor coverage check (issue #65)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
