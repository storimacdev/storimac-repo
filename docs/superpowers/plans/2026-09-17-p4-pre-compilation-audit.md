# P4 Pre-Compilation Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #91 — three deterministic checks (Scale, Earmark, Formatting)
that must pass, or be explicitly acknowledged, before compilation proceeds.

**Architecture:** A new pure module with three synchronous check functions and one orchestrator,
reusing existing infrastructure directly (issue #56's scene-count constants, issue #66's format
checker, issue #58's Critical Beat lookup). Combined into issue #65's existing 409/`acknowledged`
gate on the same compile route — one acknowledgment resolves both audits, not two separate flows.

**Tech Stack:** Plain TypeScript pure functions, one API route edit, and React/TSX banner edits.

## Global Constraints

- No test suite exists in this project — verification is `npx tsc --noEmit -p .`, `npm run
  lint`, `npm run build` (all from `web/`), plus a direct code trace.
- All three checks are fully synchronous/deterministic — no `Anthropic` parameter anywhere in
  this module, unlike `thematicAnchorAudit.ts`.
- Every check operates on `getConfirmedUnits(units)` only (matching what will actually appear in
  the compiled document) — never `Working`/`Exploring`/`Parked` units.
- Reuse, don't re-declare: `MIN_TARGET_SCENES`/`MAX_TARGET_SCENES` from `sceneDensity.ts`,
  `checkSceneRegisterFormat` from `developmentLoop.ts`, `CRITICAL_BEAT_LOOKUP` from
  `structuralFramework.ts`. `CRITICAL_BEAT_TAG_PATTERN` (currently private to
  `developmentLoop.ts`) is exported for reuse rather than re-declared with a second copy of the
  same regex.
- The combined gate uses ONE `acknowledged` flag for BOTH audits — never two separate
  confirm-then-retry flows for the same compile action.
- `preCompilationAudit` is always computed fresh, even when `acknowledged: true` — unlike
  `thematicAnchorAudit`, which skips its (nondeterministic, costly) model call on that path.
  Nothing here is nondeterministic or costly, so there's no reason to skip it, and skipping it
  would mean the author never sees a genuinely-fixed check reflected as passing.
- Design spec: `docs/superpowers/specs/2026-09-17-p4-pre-compilation-audit-design.md`.

---

### Task 1: `preCompilationAudit.ts` — three checks + orchestrator

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/preCompilationAudit.ts`
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts`

**Interfaces:**
- Consumes: `getConfirmedUnits`, `type StructuralUnit` from `./stateLedger`; `checkSceneRegisterFormat`
  and (newly exported) `CRITICAL_BEAT_TAG_PATTERN` from `./developmentLoop`; `CRITICAL_BEAT_LOOKUP`
  from `./structuralFramework`; `MIN_TARGET_SCENES`, `MAX_TARGET_SCENES` from `./sceneDensity`
  (all already exist, unchanged, except the one new export named below).
- Produces:
  ```ts
  export interface PreCompilationCheckFinding { id: string; status: "pass" | "flag"; detail: string; }
  export function checkScale(units: StructuralUnit[]): PreCompilationCheckFinding;
  export function checkEarmark(units: StructuralUnit[]): PreCompilationCheckFinding;
  export function checkFormatting(units: StructuralUnit[]): PreCompilationCheckFinding;
  export interface PreCompilationAuditResult { findings: PreCompilationCheckFinding[]; failed: boolean; }
  export function runPreCompilationAudit(units: StructuralUnit[]): PreCompilationAuditResult;
  ```
  Task 2 consumes `runPreCompilationAudit` and `type PreCompilationAuditResult`.

- [ ] **Step 1: Export `CRITICAL_BEAT_TAG_PATTERN` from `developmentLoop.ts`**

  In `web/src/lib/storyArchitectureEngine/developmentLoop.ts`, this line currently reads:
  ```ts
  const CRITICAL_BEAT_TAG_PATTERN = /\[CRITICAL BEAT:\s*([^\]]+)\]/i;
  ```
  Change it to:
  ```ts
  export const CRITICAL_BEAT_TAG_PATTERN = /\[CRITICAL BEAT:\s*([^\]]+)\]/i;
  ```
  Nothing else in this file changes — `checkSceneRegisterFormat`'s own two existing uses of this
  constant are untouched.

- [ ] **Step 2: Create `preCompilationAudit.ts`**

  Create `web/src/lib/storyArchitectureEngine/preCompilationAudit.ts`:
  ```ts
  import { CRITICAL_BEAT_LOOKUP } from "./structuralFramework";
  import { checkSceneRegisterFormat, CRITICAL_BEAT_TAG_PATTERN } from "./developmentLoop";
  import { MIN_TARGET_SCENES, MAX_TARGET_SCENES } from "./sceneDensity";
  import { getConfirmedUnits, type StructuralUnit } from "./stateLedger";

  /**
   * Project 4's Pre-Compilation Audit - GitHub issue #91, Screenplay
   * Structural Architecture Framework v3.0 §6. Distinct from issue
   * #65's Thematic Anchor Audit (which checks the internal-
   * transformation arc via one model call) - all three checks here
   * are fully deterministic, reusing existing infrastructure directly
   * rather than re-implementing any of it: issue #56's scene-count
   * constants, issue #66's format checker, issue #58's Critical Beat
   * lookup. Every check operates on Confirmed units only - what will
   * actually appear in the compiled document.
   */

  export interface PreCompilationCheckFinding {
    id: string;
    status: "pass" | "flag";
    detail: string;
  }

  /** Scale Check: total Confirmed scene count within the 75-150
   * target range. Unlike issue #56's own advisory monitor (which
   * counts Working+Confirmed and projects a trajectory mid-
   * development), this is a simple, un-projected count of Confirmed
   * units only, checked once the outline is considered complete. */
  export function checkScale(units: StructuralUnit[]): PreCompilationCheckFinding {
    const count = getConfirmedUnits(units).length;
    if (count < MIN_TARGET_SCENES || count > MAX_TARGET_SCENES) {
      return {
        id: "scale",
        status: "flag",
        detail: `${count} Confirmed scene(s) - outside the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
      };
    }
    return {
      id: "scale",
      status: "pass",
      detail: `${count} Confirmed scenes - within the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
    };
  }

  /** Earmark Check: all 10 Critical Beat tags (issue #58) appear
   * somewhere in the Confirmed Scene Register. Reuses the exact same
   * regex checkSceneRegisterFormat already validates a tag's value
   * against, applied per-unit and collected into a set. */
  export function checkEarmark(units: StructuralUnit[]): PreCompilationCheckFinding {
    const confirmed = getConfirmedUnits(units);
    const foundTags = new Set<string>();
    for (const unit of confirmed) {
      const content = typeof unit.content === "string" ? unit.content : "";
      const match = content.match(CRITICAL_BEAT_TAG_PATTERN);
      if (match) {
        const tagName = match[1].trim().toUpperCase();
        if (CRITICAL_BEAT_LOOKUP[tagName]) {
          foundTags.add(tagName);
        }
      }
    }
    const missing = Object.keys(CRITICAL_BEAT_LOOKUP).filter((tag) => !foundTags.has(tag));
    if (missing.length > 0) {
      return {
        id: "earmark",
        status: "flag",
        detail: `${missing.length} of 10 Critical Beats not yet tagged in any Confirmed scene: ${missing.join(", ")}.`,
      };
    }
    return { id: "earmark", status: "pass", detail: "All 10 Critical Beats are tagged in the Confirmed Scene Register." };
  }

  /** Formatting Check: every Confirmed scene has a standard slugline
   * and exactly one explanatory paragraph. In ordinary operation this
   * should nearly always pass - checkSceneRegisterFormat already
   * gates every Working/Confirmed transition before it happens - but
   * this is a genuine backstop against Confirmed content that
   * predates issue #66, matching issue #56's own precedent of
   * treating "content that predates a later-added check" as a real
   * case, not a hypothetical one. */
  export function checkFormatting(units: StructuralUnit[]): PreCompilationCheckFinding {
    const confirmed = getConfirmedUnits(units);
    const failing: string[] = [];
    for (const unit of confirmed) {
      const content = typeof unit.content === "string" ? unit.content : "";
      const result = checkSceneRegisterFormat(content);
      if (!result.ok) {
        failing.push(`${unit.unitId} (${result.reason ?? "malformed"})`);
      }
    }
    if (failing.length > 0) {
      return {
        id: "formatting",
        status: "flag",
        detail: `${failing.length} Confirmed scene(s) fail formatting: ${failing.join("; ")}.`,
      };
    }
    return {
      id: "formatting",
      status: "pass",
      detail: "Every Confirmed scene has a standard slugline and exactly one explanatory paragraph.",
    };
  }

  export interface PreCompilationAuditResult {
    findings: PreCompilationCheckFinding[];
    failed: boolean;
  }

  export function runPreCompilationAudit(units: StructuralUnit[]): PreCompilationAuditResult {
    const findings = [checkScale(units), checkEarmark(units), checkFormatting(units)];
    return { findings, failed: findings.some((f) => f.status === "flag") };
  }
  ```

- [ ] **Step 3: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand (or a throwaway `tsx` script) against representative
  `StructuralUnit[]` inputs (only `status`/`content`/`unitId` matter — other fields can be any
  valid placeholder value):

  - Exactly 74 `Confirmed` units → `checkScale` flags (`74 ... outside`).
  - Exactly 75 `Confirmed` units → `checkScale` passes.
  - Exactly 150 `Confirmed` units → `checkScale` passes.
  - Exactly 151 `Confirmed` units → `checkScale` flags.
  - A mix of `Working` and `Confirmed` units where only the `Confirmed` count falls in range →
    confirm `Working` units are correctly excluded from the count.
  - A set of `Confirmed` units whose content collectively tags 9 of the 10 real beat names (e.g.
    every tag except `"DIG DEEP DOWN"`) → `checkEarmark` flags, naming exactly the one missing
    tag.
  - The same set plus one more `Confirmed` unit tagging `"DIG DEEP DOWN"` → `checkEarmark` passes.
  - A `Confirmed` unit whose content is missing its slugline entirely → `checkFormatting` flags,
    naming that unit's id.
  - A well-formed set of `Confirmed` units (real slugline + 3-4 sentence paragraph each) →
    `checkFormatting` passes.
  - `runPreCompilationAudit` on a set where all three checks pass → `{ findings: [...3 pass
    findings...], failed: false }`. On a set where only `checkEarmark` flags → `failed: true`,
    exactly one `"flag"` finding among the three.

- [ ] **Step 4: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/preCompilationAudit.ts web/src/lib/storyArchitectureEngine/developmentLoop.ts
  git commit -m "feat: add P4 Pre-Compilation Audit (Scale/Earmark/Formatting checks) (issue #91)"
  ```

---

### Task 2: Wire into `architecture-chat/document/route.ts`

**Files:**
- Modify: `web/src/app/api/architecture-chat/document/route.ts`

**Interfaces:**
- Consumes (Task 1): `runPreCompilationAudit(units): PreCompilationAuditResult`, `type
  PreCompilationAuditResult`.

- [ ] **Step 1: Extend the import**

  In `web/src/app/api/architecture-chat/document/route.ts`, add a new import right after the
  existing `thematicAnchorAudit` import:
  ```ts
  import { runPreCompilationAudit } from "@/lib/storyArchitectureEngine/preCompilationAudit";
  ```

- [ ] **Step 2: Compute it and combine the gate**

  This line currently reads:
  ```ts
      const units = story.p4Units ?? [];
      let thematicAnchorAudit: ThematicAnchorAuditResult;
  ```
  Change it to:
  ```ts
      const units = story.p4Units ?? [];
      // Issue #91: fully deterministic, computed unconditionally on
      // every call (including the acknowledged retry) - unlike
      // thematicAnchorAudit's model call, there's no cost concern and
      // no risk of a nondeterministic contradiction, so recomputing it
      // fresh always reflects the story's real current state.
      const preCompilationAudit = runPreCompilationAudit(units);
      let thematicAnchorAudit: ThematicAnchorAuditResult;
  ```

  Then this block currently reads:
  ```ts
      if (thematicAnchorAudit.gapFound && !acknowledged) {
        return NextResponse.json({ needsAcknowledgment: true, thematicAnchorAudit }, { status: 409 });
      }

      const canon = await ingestCanon(storyId);
      const compiled = compileScreenplayArchitectureDocument(storyId, canon, units);
      return NextResponse.json({ ...compiled, thematicAnchorAudit });
  ```
  Change it to:
  ```ts
      const gapFound = thematicAnchorAudit.gapFound || preCompilationAudit.failed;
      if (gapFound && !acknowledged) {
        return NextResponse.json({ needsAcknowledgment: true, thematicAnchorAudit, preCompilationAudit }, { status: 409 });
      }

      const canon = await ingestCanon(storyId);
      const compiled = compileScreenplayArchitectureDocument(storyId, canon, units);
      return NextResponse.json({ ...compiled, thematicAnchorAudit, preCompilationAudit });
  ```

- [ ] **Step 3: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand:
  - A story whose units pass the Thematic Anchor Audit but fail `checkScale` (e.g. only 40
    Confirmed units, all 6 anchor steps covered) → `acknowledged` omitted → response is `409`
    with `thematicAnchorAudit.gapFound === false` and `preCompilationAudit.failed === true` both
    present in the payload.
  - The same story with `acknowledged: true` → response is `200`, `preCompilationAudit` in the
    response still correctly reports `failed: true` (never synthesized/skipped, unlike
    `thematicAnchorAudit` on this same path) alongside the compiled document.
  - A story where BOTH audits pass → `acknowledged` omitted → response is `200` directly, no
    409 round-trip needed.

- [ ] **Step 4: Commit**

  ```bash
  git add web/src/app/api/architecture-chat/document/route.ts
  git commit -m "feat: gate P4 compilation on the Pre-Compilation Audit too (issue #91)"
  ```

---

### Task 3: UI — extend the existing gap banner and success banner

**Files:**
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Consumes (Task 2): the `409`/`200` responses now also carry `preCompilationAudit: {
  findings: {id, status, detail}[]; failed: boolean } | undefined` (present whenever
  `thematicAnchorAudit` is, i.e. every response from this route).

- [ ] **Step 1: Add the client-side type**

  Add this type right after the existing `ThematicAnchorAudit` type declaration:
  ```ts
  type PreCompilationAudit = { findings: ThematicAnchorFinding[]; failed: boolean };
  ```
  (Reuses the existing `ThematicAnchorFinding` type — both audits' findings share the identical
  `{id, status, detail}` shape, so no new finding type is needed.)

- [ ] **Step 2: Add state**

  Right after the existing:
  ```ts
    const [compileNeedsAcknowledgment, setCompileNeedsAcknowledgment] = useState(false);
  ```
  add:
  ```ts
    const [preCompilationAudit, setPreCompilationAudit] = useState<PreCompilationAudit | null>(null);
  ```

- [ ] **Step 3: Update `compileDocument`**

  The function currently reads:
  ```ts
    async function compileDocument(acknowledged: boolean) {
      if (!canvasId || compiling) return;
      setCompiling(true);
      setCompileError(null);
      try {
        const res = await fetch("/api/architecture-chat/document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyId: canvasId, acknowledged }),
        });
        const data = await res.json();
        if (res.status === 409 && data.needsAcknowledgment) {
          setThematicAnchorAudit(data.thematicAnchorAudit);
          setCompileNeedsAcknowledgment(true);
          setCompiled(null);
          return;
        }
        if (!res.ok) {
          setCompileError(data.error ?? "Compile failed.");
          setCompiled(null);
          setThematicAnchorAudit(null);
          setCompileNeedsAcknowledgment(false);
          return;
        }
        setThematicAnchorAudit(data.thematicAnchorAudit);
        setCompileNeedsAcknowledgment(false);
        setCompiled(data);
      } catch {
        setCompileError("Couldn't reach the server.");
      } finally {
        setCompiling(false);
      }
    }
  ```
  Replace it with:
  ```ts
    async function compileDocument(acknowledged: boolean) {
      if (!canvasId || compiling) return;
      setCompiling(true);
      setCompileError(null);
      try {
        const res = await fetch("/api/architecture-chat/document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyId: canvasId, acknowledged }),
        });
        const data = await res.json();
        if (res.status === 409 && data.needsAcknowledgment) {
          setThematicAnchorAudit(data.thematicAnchorAudit);
          setPreCompilationAudit(data.preCompilationAudit);
          setCompileNeedsAcknowledgment(true);
          setCompiled(null);
          return;
        }
        if (!res.ok) {
          setCompileError(data.error ?? "Compile failed.");
          setCompiled(null);
          setThematicAnchorAudit(null);
          setPreCompilationAudit(null);
          setCompileNeedsAcknowledgment(false);
          return;
        }
        setThematicAnchorAudit(data.thematicAnchorAudit);
        setPreCompilationAudit(data.preCompilationAudit);
        setCompileNeedsAcknowledgment(false);
        setCompiled(data);
      } catch {
        setCompileError("Couldn't reach the server.");
      } finally {
        setCompiling(false);
      }
    }
  ```

- [ ] **Step 4: Merge both audits into the existing gap banner**

  The existing gap banner currently reads:
  ```tsx
        {compileNeedsAcknowledgment && thematicAnchorAudit && (
          <div className="border-b border-rose-500/30 bg-rose-950/30 px-6 py-3 text-xs text-rose-200">
            <p className="mb-2 font-semibold">Thematic Anchor Audit found a gap before compiling:</p>
            <ul className="mb-2 list-disc pl-4">
              {thematicAnchorAudit.findings
                .filter((f) => f.status === "flag")
                .map((f) => (
                  <li key={f.id}>{f.detail}</li>
                ))}
            </ul>
            <button
              onClick={() => compileDocument(true)}
              disabled={compiling}
              className="rounded-lg border border-rose-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Compile anyway
            </button>
          </div>
        )}
  ```
  Replace it with:
  ```tsx
        {compileNeedsAcknowledgment && (thematicAnchorAudit || preCompilationAudit) && (
          <div className="border-b border-rose-500/30 bg-rose-950/30 px-6 py-3 text-xs text-rose-200">
            <p className="mb-2 font-semibold">Before compiling:</p>
            <ul className="mb-2 list-disc pl-4">
              {[...(thematicAnchorAudit?.findings ?? []), ...(preCompilationAudit?.findings ?? [])]
                .filter((f) => f.status === "flag")
                .map((f) => (
                  <li key={f.id}>{f.detail}</li>
                ))}
            </ul>
            <button
              onClick={() => compileDocument(true)}
              disabled={compiling}
              className="rounded-lg border border-rose-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Compile anyway
            </button>
          </div>
        )}
  ```

- [ ] **Step 5: Update the success banner's summary text**

  The existing success banner currently reads:
  ```tsx
        {compiled && (
          <div className="border-b border-purple-500/30 bg-purple-950/20 px-6 py-3 text-xs text-purple-200">
            <p className="mb-2">
              Compiled — {compiled.outstandingCount} outstanding item{compiled.outstandingCount === 1 ? "" : "s"}.
              {thematicAnchorAudit &&
                (thematicAnchorAudit.gapFound
                  ? " Thematic Anchor Audit: overridden with gap(s) acknowledged."
                  : " Thematic Anchor Audit: passed.")}
            </p>
  ```
  Replace the paragraph's contents with:
  ```tsx
        {compiled && (
          <div className="border-b border-purple-500/30 bg-purple-950/20 px-6 py-3 text-xs text-purple-200">
            <p className="mb-2">
              Compiled — {compiled.outstandingCount} outstanding item{compiled.outstandingCount === 1 ? "" : "s"}.
              {(thematicAnchorAudit || preCompilationAudit) &&
                (thematicAnchorAudit?.gapFound || preCompilationAudit?.failed
                  ? " Pre-compile audits: overridden with issue(s) acknowledged."
                  : " Pre-compile audits: passed.")}
            </p>
  ```
  (Everything else in this block — the download button — stays exactly as it is.)

- [ ] **Step 6: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace the component's render logic by hand against hand-constructed
  `thematicAnchorAudit`/`preCompilationAudit` objects: both flagged (banner lists items from
  both), only one flagged (banner lists only that one's items, no crash from the other being
  `null`), both clean on a successful compile (success banner reads "passed"), one overridden on
  a successful compile (success banner reads "overridden").

- [ ] **Step 7: Commit**

  ```bash
  git add web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: surface P4 Pre-Compilation Audit findings in the compile UI (issue #91)"
  ```
