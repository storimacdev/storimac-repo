# P4 Thematic Anchor Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #65 — before compiling, verify Steps 2, 5, 6, 7, 8, 9 (the
protagonist's internal-transformation arc) have Confirmed content and form a coherent arc;
surface any gap explicitly instead of silently compiling around it.

**Architecture:** Mirrors Project 3's Stage 4 System Integration Audit *pattern*
(`worldEngine/stage4Audit.ts`, issue #49): deterministic coverage checks + one model-driven
semantic judgment, combined into a `findings[]` array. Gated via a synchronous confirm-then-retry
`409`, mirroring `world-chat/canon-status/route.ts`'s Dependency Review precedent (issue #48) —
not persisted, since this resolves within one button-click interaction rather than a multi-turn
conversational stage.

**Tech Stack:** Plain TypeScript pure/async functions, one `extractTurn` one-shot model call, a
Next.js API route, and a React client component.

## Global Constraints

- No test suite exists in this project — verification is `npx tsc --noEmit -p .`, `npm run
  lint`, `npm run build` (all from `web/`), plus a direct code trace/throwaway script.
- The 6 anchor steps are exactly `[2, 5, 6, 7, 8, 9]` — hardcoded, not derived from
  `STRUCTURAL_STEPS`'s `type` field (Step 6 is a Plot Point, not a Set Piece, so "every Set
  Piece step" would be both wrong and incomplete).
- Coverage uses `Confirmed` units only (matching what will actually appear in the compiled
  document) and reads each unit's `stepNumber` field (issue #56) — no new persisted state, no
  change to `ArchitectureTurnSchema` or `sp04-sae-systemprompt.md`.
- The model consistency call only ever runs when coverage is fully clean (all 6 steps have
  Confirmed content) — never when any step is missing entirely.
- The audit is NOT persisted to `Story` — computed fresh on every `POST
  /api/architecture-chat/document` call.
- This is a disclosure gate, not a hard block: a gap blocks the FIRST call with a `409` unless
  the caller passes `acknowledged: true`, at which point compilation proceeds regardless.
- Design spec: `docs/superpowers/specs/2026-09-17-p4-thematic-anchor-audit-design.md`.

---

### Task 1: `thematicAnchorAudit.ts` — coverage check, consistency check, orchestrator

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/thematicAnchorAudit.ts`

**Interfaces:**
- Consumes: `getConfirmedUnits`, `type StructuralUnit` from `./stateLedger` (already exist,
  unchanged); `STRUCTURAL_STEPS` from `./structuralFramework` (already exists, unchanged);
  `extractTurn` from `@/lib/canonEngine/extractTurn` (already exists, unchanged — same shape
  `worldEngine/stage4Audit.ts`'s `runConsistencyCheck` already calls it with:
  `{anthropic, model, system, messages, tool, schema}`).
- Produces:
  ```ts
  export const THEMATIC_ANCHOR_STEPS: readonly [2, 5, 6, 7, 8, 9];
  export interface ThematicAnchorFinding { id: string; status: "pass" | "flag"; detail: string; }
  export function checkThematicAnchorCoverage(units: StructuralUnit[]): ThematicAnchorFinding[];
  export function runThematicAnchorConsistencyCheck(anthropic: Anthropic, unitsByStep: Map<number, StructuralUnit[]>): Promise<ThematicAnchorFinding[]>;
  export interface ThematicAnchorAuditResult { findings: ThematicAnchorFinding[]; gapFound: boolean; generatedAt: string; }
  export function runThematicAnchorAudit(anthropic: Anthropic, units: StructuralUnit[]): Promise<ThematicAnchorAuditResult>;
  export function formatThematicAnchorAuditSummary(audit: ThematicAnchorAuditResult): string;
  ```
  Task 2 consumes `runThematicAnchorAudit` and `type ThematicAnchorAuditResult`. Task 3 consumes
  the JSON shape of `ThematicAnchorAuditResult` (via the route's response, not this module
  directly — Task 3 never imports this file).

- [ ] **Step 1: Create the file**

  Create `web/src/lib/storyArchitectureEngine/thematicAnchorAudit.ts`:
  ```ts
  import type Anthropic from "@anthropic-ai/sdk";
  import { z } from "zod";
  import { extractTurn } from "@/lib/canonEngine/extractTurn";
  import { STRUCTURAL_STEPS } from "./structuralFramework";
  import { getConfirmedUnits, type StructuralUnit } from "./stateLedger";

  /**
   * Project 4's Thematic Anchor Audit - GitHub issue #65, PRD §7.6
   * FR-6.5. Mirrors the *pattern* Project 3's Stage 4 System
   * Integration Audit established (worldEngine/stage4Audit.ts, issue
   * #49): deterministic checks + one model-driven semantic judgment,
   * both returned as a findings[] array with a pass/flag status per
   * finding. Not that file's code - P4 has its own data model
   * (StructuralUnit, not CanonElement) and this audit isn't persisted
   * (see the design doc's §4: it resolves within one button-click
   * interaction, not a multi-turn conversational stage that needs to
   * survive a reload).
   */

  /** The 6 steps FR-6.5 names as carrying the internal-transformation
   * arc: Step 2 (Thematic Core), 5 (B Story Intro), 6 (Midpoint), 7
   * (All Is Lost), 8 (Break Into 3), 9 (Dig Deep Down/finale).
   * Hardcoded, not derived from STRUCTURAL_STEPS's `type` field - the
   * PRD names these 6 specifically, not "every Set Piece step" (Step 6
   * is a Plot Point, not a Set Piece). */
  export const THEMATIC_ANCHOR_STEPS = [2, 5, 6, 7, 8, 9] as const;

  export interface ThematicAnchorFinding {
    id: string;
    status: "pass" | "flag";
    detail: string;
  }

  /**
   * Deterministic half: does each of the 6 anchor steps have at least
   * one Confirmed unit tagged with that stepNumber (issue #56's
   * field)? A step with zero Confirmed content has no internal-
   * transformation beat to contribute - caught for free, no model
   * call needed.
   */
  export function checkThematicAnchorCoverage(units: StructuralUnit[]): ThematicAnchorFinding[] {
    const confirmed = getConfirmedUnits(units);
    const findings: ThematicAnchorFinding[] = [];
    for (const stepNumber of THEMATIC_ANCHOR_STEPS) {
      const step = STRUCTURAL_STEPS.find((s) => s.stepNumber === stepNumber);
      const covered = confirmed.some((u) => u.stepNumber === stepNumber);
      if (!covered) {
        findings.push({
          id: `coverage-step-${stepNumber}`,
          status: "flag",
          detail: `Step ${stepNumber} (${step?.title ?? "?"}) has no Confirmed content yet - the internal-transformation arc can't be complete without it.`,
        });
      }
    }
    if (findings.length === 0) {
      findings.push({
        id: "coverage-complete",
        status: "pass",
        detail: "Every anchor step (2, 5, 6, 7, 8, 9) has Confirmed content.",
      });
    }
    return findings;
  }

  const ThematicAnchorConsistencySchema = z.object({
    gap_found: z.boolean(),
    detail: z.string().min(1),
  });

  const EMIT_THEMATIC_ANCHOR_CONSISTENCY_TOOL: Anthropic.Tool = {
    name: "emit_thematic_anchor_consistency",
    description:
      "Report whether the Confirmed content across Steps 2, 5, 6, 7, 8, and 9 forms a genuinely unbroken internal-transformation arc. Call this exactly once.",
    input_schema: {
      type: "object",
      properties: {
        gap_found: {
          type: "boolean",
          description: "true if there is a genuine thematic/emotional gap in the arc, false if it reads as unbroken.",
        },
        detail: {
          type: "string",
          description: "A specific, concrete explanation either way, naming the steps involved.",
        },
      },
      required: ["gap_found", "detail"],
    },
  };

  /**
   * Model's job - the same class of judgment Core-Purpose validation
   * and Stage 4's own consistency check already own
   * (developmentLoop.ts's header comment gives the same reasoning for
   * why a deterministic function can't honestly make this call). A
   * single one-shot extractTurn call, not a conversational turn - runs
   * once per compile attempt, not per chat turn, exactly
   * stage4Audit.ts's runConsistencyCheck shape.
   */
  export async function runThematicAnchorConsistencyCheck(
    anthropic: Anthropic,
    unitsByStep: Map<number, StructuralUnit[]>
  ): Promise<ThematicAnchorFinding[]> {
    const stepDescriptions = THEMATIC_ANCHOR_STEPS.map((stepNumber) => {
      const step = STRUCTURAL_STEPS.find((s) => s.stepNumber === stepNumber);
      const stepUnits = unitsByStep.get(stepNumber) ?? [];
      const contentLines = stepUnits.map((u) => `  - ${JSON.stringify(u.content)}`).join("\n");
      return `Step ${stepNumber} (${step?.title ?? "?"}) - Core Purpose: ${step?.corePurpose ?? "?"}\n${contentLines}`;
    }).join("\n\n");

    const result = await extractTurn({
      anthropic,
      model: "claude-sonnet-5",
      system:
        "You are auditing a screenplay's structural outline for its protagonist's internal-transformation arc. Review the Confirmed content across the 6 steps below (in story order) and judge whether it forms a genuinely unbroken emotional/thematic through-line, or whether there's a real gap - not a stylistic opinion, only a genuine break in the arc's logic.",
      messages: [{ role: "user", content: `Confirmed content at each anchor step:\n\n${stepDescriptions}` }],
      tool: EMIT_THEMATIC_ANCHOR_CONSISTENCY_TOOL,
      schema: ThematicAnchorConsistencySchema,
    });

    if (!result.gap_found) {
      return [
        {
          id: "consistency-clean",
          status: "pass",
          detail: "The internal-transformation arc across Steps 2, 5, 6, 7, 8, and 9 reads as unbroken.",
        },
      ];
    }
    return [
      {
        id: "consistency-gap",
        status: "flag",
        detail: result.detail,
      },
    ];
  }

  export interface ThematicAnchorAuditResult {
    findings: ThematicAnchorFinding[];
    gapFound: boolean;
    generatedAt: string;
  }

  /**
   * Orchestrator: runs the coverage check first: if it flags anything,
   * returns immediately (gapFound: true, no model call) - a still-
   * incomplete arc has nothing further for the model to usefully
   * judge. Only when coverage is fully clean does it spend the one
   * model call.
   */
  export async function runThematicAnchorAudit(
    anthropic: Anthropic,
    units: StructuralUnit[]
  ): Promise<ThematicAnchorAuditResult> {
    const coverageFindings = checkThematicAnchorCoverage(units);
    const hasCoverageGap = coverageFindings.some((f) => f.status === "flag");

    if (hasCoverageGap) {
      return { findings: coverageFindings, gapFound: true, generatedAt: new Date().toISOString() };
    }

    const confirmed = getConfirmedUnits(units);
    const unitsByStep = new Map<number, StructuralUnit[]>();
    for (const stepNumber of THEMATIC_ANCHOR_STEPS) {
      unitsByStep.set(stepNumber, confirmed.filter((u) => u.stepNumber === stepNumber));
    }

    const consistencyFindings = await runThematicAnchorConsistencyCheck(anthropic, unitsByStep);
    const findings = [...coverageFindings, ...consistencyFindings];
    return {
      findings,
      gapFound: consistencyFindings.some((f) => f.status === "flag"),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Renders the audit as author-facing summary text - mirrors Stage
   * 4's formatStage4AuditSummary rendering convention. */
  export function formatThematicAnchorAuditSummary(audit: ThematicAnchorAuditResult): string {
    const lines: string[] = ["Thematic Anchor Audit:", ""];
    for (const f of audit.findings) {
      lines.push(`${f.status === "pass" ? "✅" : "⚠️"} ${f.detail}`);
    }
    return lines.join("\n");
  }
  ```

- [ ] **Step 2: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand (or a throwaway `tsx` script) against representative
  `StructuralUnit[]` inputs (build minimal literals — only `status` and `stepNumber` matter for
  `checkThematicAnchorCoverage`; every other field can be any valid placeholder value):
  - No units at all → all 6 steps flagged (`coverage-step-2` through `coverage-step-9`), no
    `coverage-complete` finding.
  - `Confirmed` units at steps 2, 5, 6 only (7, 8, 9 missing) → exactly 3 flags (for 7, 8, 9),
    steps 2/5/6 produce no flag.
  - `Working` (not `Confirmed`) units at all 6 steps → all 6 still flagged — `Working` doesn't
    count.
  - `Confirmed` units at all 6 steps → exactly one finding, `coverage-complete`, `status: "pass"`.
  - `runThematicAnchorAudit` with the "all 6 covered" unit set — since this makes a real
    Anthropic call, either (a) run it live if `ANTHROPIC_API_KEY` is available in this
    environment and confirm you get back a `ThematicAnchorAuditResult` with `findings.length === 2`
    (one coverage-complete + one consistency finding) and a boolean `gapFound`, or (b) if no
    live call is practical here, trace `runThematicAnchorConsistencyCheck`'s two response
    branches (`gap_found: true` and `gap_found: false`) directly against hand-constructed
    `extractTurn` return values to confirm the finding shape each branch produces — do not skip
    this verification, only choose which method to use.

- [ ] **Step 3: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/thematicAnchorAudit.ts
  git commit -m "feat: add P4 Thematic Anchor Audit coverage/consistency checks (issue #65)"
  ```

---

### Task 2: Wire into `architecture-chat/document/route.ts`

**Files:**
- Modify: `web/src/app/api/architecture-chat/document/route.ts`

**Interfaces:**
- Consumes (Task 1): `runThematicAnchorAudit(anthropic, units): Promise<ThematicAnchorAuditResult>`,
  `type ThematicAnchorAuditResult`.
- Produces: `POST /api/architecture-chat/document` now accepts an optional `acknowledged:
  boolean` body field; on a gap-found audit without acknowledgment, returns `409` with
  `{ needsAcknowledgment: true, thematicAnchorAudit }`; on success (clean audit, or
  acknowledged), returns the existing `{ markdown, outstandingCount }` shape plus
  `thematicAnchorAudit`. Task 3 consumes both response shapes.

- [ ] **Step 1: Replace the file**

  The current file (`web/src/app/api/architecture-chat/document/route.ts`) reads:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { requireUser } from "@/lib/session";
  import { errorResponse } from "@/lib/apiErrors";
  import { getMembership } from "@/lib/workspace/workspaceStore";
  import { getStory } from "@/lib/canonEngine/storyStore";
  import { ingestCanon } from "@/lib/storyArchitectureEngine/ingestCanon";
  import { compileScreenplayArchitectureDocument } from "@/lib/storyArchitectureEngine/compileArchitectureDocument";

  export const runtime = "nodejs";

  /** Compiles the current Screenplay Architecture Document on demand (issue #111, Decision 3) - no versioning/storage yet, matching compileArchitectureDocument.ts's own current on-demand, non-persisted shape. */
  export async function POST(req: NextRequest) {
    try {
      const user = await requireUser();
      const body = await req.json().catch(() => null);
      const storyId: unknown = body?.storyId;
      if (typeof storyId !== "string" || !storyId) {
        return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
      }
      const story = await getStory(storyId);
      if (!story) {
        return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
      }
      const membership = await getMembership(story.workspaceId, user.uid);
      if (!membership) {
        return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
      }

      const canon = await ingestCanon(storyId);
      const compiled = compileScreenplayArchitectureDocument(storyId, canon, story.p4Units ?? []);
      return NextResponse.json(compiled);
    } catch (err) {
      return errorResponse(err);
    }
  }
  ```

  Replace its entire contents with:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import Anthropic from "@anthropic-ai/sdk";
  import { requireUser } from "@/lib/session";
  import { errorResponse } from "@/lib/apiErrors";
  import { getMembership } from "@/lib/workspace/workspaceStore";
  import { getStory } from "@/lib/canonEngine/storyStore";
  import { ingestCanon } from "@/lib/storyArchitectureEngine/ingestCanon";
  import { compileScreenplayArchitectureDocument } from "@/lib/storyArchitectureEngine/compileArchitectureDocument";
  import { runThematicAnchorAudit, type ThematicAnchorAuditResult } from "@/lib/storyArchitectureEngine/thematicAnchorAudit";

  export const runtime = "nodejs";

  /** Compiles the current Screenplay Architecture Document on demand
   * (issue #111, Decision 3), gated by the Thematic Anchor Audit
   * (issue #65) - a synchronous confirm-then-retry gate, mirroring
   * world-chat/canon-status/route.ts's own Dependency Review
   * precedent (issue #48): a gap-found result blocks the FIRST call
   * with a 409 unless the caller passes `acknowledged: true`, at
   * which point compilation proceeds anyway (disclosure, not
   * prevention - matching the issue's own "surface it explicitly...
   * rather than silently compiling around it" wording, not a hard
   * block). No versioning/storage of either the audit or the document
   * itself yet, matching compileArchitectureDocument.ts's own current
   * on-demand, non-persisted shape. */
  export async function POST(req: NextRequest) {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: "Server is not configured with an Anthropic API key." }, { status: 500 });
      }
      const user = await requireUser();
      const body = await req.json().catch(() => null);
      const storyId: unknown = body?.storyId;
      const acknowledged = body?.acknowledged === true;
      if (typeof storyId !== "string" || !storyId) {
        return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
      }
      const story = await getStory(storyId);
      if (!story) {
        return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
      }
      const membership = await getMembership(story.workspaceId, user.uid);
      if (!membership) {
        return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
      }

      const units = story.p4Units ?? [];
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      let thematicAnchorAudit: ThematicAnchorAuditResult;
      try {
        thematicAnchorAudit = await runThematicAnchorAudit(anthropic, units);
      } catch (auditErr) {
        console.warn(`[architecture-chat/document] Thematic Anchor Audit failed for story ${storyId}:`, auditErr);
        thematicAnchorAudit = {
          findings: [
            {
              id: "consistency-unavailable",
              status: "flag",
              detail: "The Thematic Anchor Audit's consistency check couldn't complete - please try again before compiling.",
            },
          ],
          gapFound: true,
          generatedAt: new Date().toISOString(),
        };
      }

      if (thematicAnchorAudit.gapFound && !acknowledged) {
        return NextResponse.json({ needsAcknowledgment: true, thematicAnchorAudit }, { status: 409 });
      }

      const canon = await ingestCanon(storyId);
      const compiled = compileScreenplayArchitectureDocument(storyId, canon, units);
      return NextResponse.json({ ...compiled, thematicAnchorAudit });
    } catch (err) {
      return errorResponse(err);
    }
  }
  ```

- [ ] **Step 2: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand:
  - A story with `p4Units` covering all 6 anchor steps with `Confirmed` content, `acknowledged`
    omitted from the body → the route calls `runThematicAnchorAudit`, which (assuming a live or
    mocked clean consistency result) returns `gapFound: false` → response is `200` with
    `{ markdown, outstandingCount, thematicAnchorAudit }`.
  - A story with `p4Units` missing Step 7 entirely, `acknowledged` omitted → `runThematicAnchorAudit`
    returns `gapFound: true` with no model call → response is `409` with `{ needsAcknowledgment:
    true, thematicAnchorAudit }` — confirm `compileScreenplayArchitectureDocument` is never
    called in this path (no `ingestCanon` call either).
  - The same missing-Step-7 story, but `acknowledged: true` in the body → response is `200`
    with the compiled document AND `thematicAnchorAudit.gapFound === true` still present in the
    response (the UI needs this to show "overridden").
  - Missing `storyId` → `400`. Nonexistent `storyId` → `404`. Valid `storyId` but caller not a
    workspace member → `403`. Missing `ANTHROPIC_API_KEY` → `500` before any other logic runs.

- [ ] **Step 3: Commit**

  ```bash
  git add web/src/app/api/architecture-chat/document/route.ts
  git commit -m "feat: gate P4 compilation on the Thematic Anchor Audit (issue #65)"
  ```

---

### Task 3: UI — audit banner and "Compile anyway"

**Files:**
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Consumes (Task 2): `POST /api/architecture-chat/document` with body `{ storyId, acknowledged?:
  boolean }`; a `409` response shaped `{ needsAcknowledgment: true, thematicAnchorAudit: {
  findings: {id, status, detail}[], gapFound: boolean } }`; a `200` response shaped `{ markdown,
  outstandingCount, thematicAnchorAudit }` (same `thematicAnchorAudit` shape).

- [ ] **Step 1: Add types**

  Add this type right after the existing `SceneDensity` type declaration:
  ```ts
  type ThematicAnchorFinding = { id: string; status: "pass" | "flag"; detail: string };
  type ThematicAnchorAudit = { findings: ThematicAnchorFinding[]; gapFound: boolean };
  ```

- [ ] **Step 2: Add state**

  Right after the existing:
  ```ts
    const [compileError, setCompileError] = useState<string | null>(null);
  ```
  add:
  ```ts
    const [thematicAnchorAudit, setThematicAnchorAudit] = useState<ThematicAnchorAudit | null>(null);
    const [compileNeedsAcknowledgment, setCompileNeedsAcknowledgment] = useState(false);
  ```

- [ ] **Step 3: Update `compileDocument`**

  The function currently reads:
  ```ts
    async function compileDocument() {
      if (!canvasId || compiling) return;
      setCompiling(true);
      setCompileError(null);
      try {
        const res = await fetch("/api/architecture-chat/document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyId: canvasId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setCompileError(data.error ?? "Compile failed.");
          return;
        }
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
          setCompileNeedsAcknowledgment(true);
          return;
        }
        if (!res.ok) {
          setCompileError(data.error ?? "Compile failed.");
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

- [ ] **Step 4: Update the Compile button's click handler**

  The button currently reads:
  ```tsx
            <button
              onClick={compileDocument}
              disabled={compiling}
              className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {compiling ? "Compiling…" : "Compile"}
            </button>
  ```
  `compileDocument` now takes a required `acknowledged` argument — `onClick={compileDocument}`
  would pass the click's `SyntheticEvent` object positionally instead. Change the handler to:
  ```tsx
            <button
              onClick={() => compileDocument(false)}
              disabled={compiling}
              className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {compiling ? "Compiling…" : "Compile"}
            </button>
  ```

- [ ] **Step 5: Add the gap-found banner and extend the success banner**

  The existing `{compiled && (...)}` block currently reads:
  ```tsx
        {compiled && (
          <div className="border-b border-purple-500/30 bg-purple-950/20 px-6 py-3 text-xs text-purple-200">
            <p className="mb-2">
              Compiled — {compiled.outstandingCount} outstanding item{compiled.outstandingCount === 1 ? "" : "s"}.
            </p>
            <button
              onClick={() => downloadText("screenplay-architecture.md", compiled.markdown, "text/markdown")}
              className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
            >
              Download .md
            </button>
          </div>
        )}
  ```
  Add a new block immediately BEFORE it (so a blocked-compile banner appears above where the
  success banner would later appear), and extend the success banner's text:
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

        {compiled && (
          <div className="border-b border-purple-500/30 bg-purple-950/20 px-6 py-3 text-xs text-purple-200">
            <p className="mb-2">
              Compiled — {compiled.outstandingCount} outstanding item{compiled.outstandingCount === 1 ? "" : "s"}.
              {thematicAnchorAudit &&
                (thematicAnchorAudit.gapFound
                  ? " Thematic Anchor Audit: overridden with gap(s) acknowledged."
                  : " Thematic Anchor Audit: passed.")}
            </p>
            <button
              onClick={() => downloadText("screenplay-architecture.md", compiled.markdown, "text/markdown")}
              className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
            >
              Download .md
            </button>
          </div>
        )}
  ```
  This is visually distinct (rose) from every existing banner color (red rejection, amber
  placement guardrail, orange Canon Revision Path/cascade, sky scene-density, purple compile
  success) — rose signals "a decision is needed before proceeding," different from red's "this
  is blocked" and from sky's "purely informational."

- [ ] **Step 6: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean.

- [ ] **Step 7: Commit**

  ```bash
  git add web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: add P4 Thematic Anchor Audit banner and Compile-anyway flow (issue #65)"
  ```
