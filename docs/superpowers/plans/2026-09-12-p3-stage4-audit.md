# P3 Stage 4 — System Integration Audit (Issue #49) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute a Stage 4 audit (dependency-graph completeness, redundancy, and model-driven physical/economic/historical/narrative consistency) across all Confirmed World Entries, and block Stage 5 (Compile) until the author explicitly approves the summary.

**Architecture:** Per the design spec (`docs/superpowers/specs/2026-09-12-p3-stage4-audit-design.md`), Project 1's Stage 7 Creative Audit is the only existing "compute → persist → gate next stage on explicit ack → re-inject into grounding" precedent in this codebase — reusable as a *pattern*, not as code (it's hardcoded to Project 1's own element ids and has no generic stage-gate to hook into; P3 has zero app-level stage enforcement today). Three-part detection: two rules-based checks (dependency completeness — which doubles as the AC's "unresolved Dependency Review items," reinterpreted as a live recomputation since neither existing Dependency Review mechanism persists anything to look up instead; and redundancy, mirroring Stage 7's own word-overlap technique) plus one model-driven consistency pass (the one part with no rules-based precedent, since Stage 7's technique only works for two fixed named elements, not an arbitrary Confirmed-entry set). Gating is narrow: only the 4→5 transition is enforced; Stages 1-3 stay exactly as unenforced as they are today.

**Tech Stack:** Firestore (new `p3Stage4Audit` Story field), Zod turn schema, a second one-shot `extractTurn` call for the consistency pass, Next.js API route, new React component.

## Global Constraints

- The audit computes **once per story**, triggered the first time the model reports `current_stage >= 4`, not on every subsequent turn — re-running it every turn would repeat the model-driven consistency call's cost/latency for no reason once an audit already exists.
- "Unresolved Dependency Review items" (AC) is answered by `checkDependencyCompleteness`: a live recomputation, at audit time, of which Confirmed entries depend on a not-yet-Confirmed entry — not a historical flag lookup, since neither issue #48 mechanism (the pillar confirm-gate, the post-Revise cascade review) ever persists anything as "open."
- The model-driven consistency check is a **separate, one-shot `extractTurn` call** with its own minimal schema/tool — not an extension of `WorldTurnSchema`/`EMIT_WORLD_TURN_TOOL`, since it's a one-time analysis pass over pre-assembled entry text, not a conversational turn.
- A failed consistency-check call must surface as a visible, honest flag in the audit ("the consistency pass couldn't complete") — never a silent skip and never a hard 500, matching this route's established degrade-gracefully convention, but treating "silently dropping a whole check" as worse than "loudly saying it failed."
- Approval requires the model to report a NEW `stage4_audit_approved: boolean` field true only on the turn the author gives a clear, unambiguous approval — mirroring `resolution`/`validated_status`'s existing "requires a clear verdict" convention, not Stage 7's weaker "any reply at all counts as acknowledgment."
- Only the 4→5 transition is clamped. If the model reports `current_stage: 5` while the persisted audit isn't yet author-approved, the app overrides the value it returns to the author (not what the model itself believes, which the app cannot control) back to `4`. Stages 1-3 are untouched by this issue.
- `Stage4AuditFinding`/`P3Stage4Audit` are new, P3-local types defined in `storyStore.ts` (mirroring exactly how `P3PendingConflict`/`P3ConflictLogEntry` are already defined there, not imported from a project-specific module) — `worldEngine/stage4Audit.ts` imports them from there, the same layering `conflictResolution.ts` already establishes (it imports `type P3PendingConflict` from `@/lib/canonEngine/storyStore` today).
- Every new Firestore write must degrade gracefully within its own try/catch (logged via `console.warn`, never propagating to a 500), matching every other Stage-3/4-adjacent write in this route.

---

### Task 1: Add `P3Stage4Audit` state to `storyStore.ts`

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces: `export interface Stage4AuditFinding { id: string; category: "dependency" | "redundancy" | "consistency"; status: "pass" | "flag" | "skipped"; detail: string; }`, `export interface P3Stage4Audit { findings: Stage4AuditFinding[]; generatedAt: string; authorApproved: boolean; }`, a new `Story.p3Stage4Audit?: P3Stage4Audit | null` field, `export async function setP3Stage4Audit(storyId: string, audit: P3Stage4Audit | null): Promise<void>`. Later tasks import all of these.

- [ ] **Step 1: Add the types**

Add near `P3PendingConflict`'s definition (same section of the file):

```ts
/** Project 3's Stage 4 System Integration Audit (issue #49) - computed
 * once per story, the first time the model reports reaching Stage 4+;
 * gates only the 4->5 (Compile) transition. Findings mix two rules-based
 * checks (dependency-graph completeness, redundancy) with one
 * model-driven consistency pass - see worldEngine/stage4Audit.ts, which
 * computes these but doesn't own the persisted shape (same split already
 * established for P3PendingConflict/conflictResolution.ts). */
export interface Stage4AuditFinding {
  id: string;
  category: "dependency" | "redundancy" | "consistency";
  status: "pass" | "flag" | "skipped";
  detail: string;
}

export interface P3Stage4Audit {
  findings: Stage4AuditFinding[];
  generatedAt: string;
  /** Set only when the author gives a clear, explicit approval (issue
   * #49's AC requires this - deliberately stronger than Stage 7's own
   * "any reply counts as acknowledgment" convention). Gates Stage 5. */
  authorApproved: boolean;
}
```

- [ ] **Step 2: Add the `Story.p3Stage4Audit` field**

Add near the existing `p3PendingConflict?: P3PendingConflict | null;` field on the `Story` interface:

```ts
  /**
   * Project 3's Stage 4 System Integration Audit (issue #49), computed
   * once per story and cleared only if the story is ever reset. Optional/
   * nullable since Stories created before this field existed won't have
   * it in Firestore.
   */
  p3Stage4Audit?: P3Stage4Audit | null;
```

- [ ] **Step 3: Add `setP3Stage4Audit`**

Add near `setP3PendingConflict`:

```ts
/** Records or clears Project 3's Stage 4 audit (issue #49); pass null only if the story is ever reset. */
export async function setP3Stage4Audit(
  storyId: string,
  audit: P3Stage4Audit | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p3Stage4Audit: audit, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. Nothing else constructs a full `Story` object literal (Firestore documents are read via `.data() as Story`, not hand-built), so this should not force any other file to change.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: add P3Stage4Audit state to storyStore (issue #49)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body (use this exact line regardless of which underlying model you are — this is a fixed session-wide convention, not a self-attribution).

---

### Task 2: Build the rules-based Stage 4 audit checks

**Files:**
- Create: `web/src/lib/worldEngine/stage4Audit.ts`

**Interfaces:**
- Consumes: `type { CanonElement } from "@/lib/canonEngine/types"` (already exists). `type { WorldEntryValue } from "./worldEntry"` (already exists). `type { Stage4AuditFinding } from "@/lib/canonEngine/storyStore"` (Task 1).
- Produces: `export function checkDependencyCompleteness(confirmedEntries: CanonElement[]): Stage4AuditFinding[]`, `export function checkRedundancy(confirmedEntries: CanonElement[]): Stage4AuditFinding[]`. A later task calls both with the same pre-filtered (`status === "Confirmed"`) entry list and combines their output with the model-driven consistency findings (Task 3, same file) into one `P3Stage4Audit`.

- [ ] **Step 1: Create the module with the two rules-based checks**

Create `web/src/lib/worldEngine/stage4Audit.ts`:

```ts
import type { CanonElement } from "@/lib/canonEngine/types";
import type { Stage4AuditFinding } from "@/lib/canonEngine/storyStore";
import type { WorldEntryValue } from "./worldEntry";

/**
 * Project 3's Stage 4 System Integration Audit (issue #49) - computes
 * the rules-based half of the audit (this file) and, once Task 3 lands,
 * the model-driven consistency pass (same file). Mirrors the *pattern*
 * Project 1's Stage 7 Creative Audit established (canonEngine/
 * stage7Audit.ts) - compute → persist → gate next stage on explicit
 * author approval - but none of that file's code, since it's hardcoded
 * to Project 1's own fixed-pair element comparisons and has no
 * generic stage-gate P3 could plug into. See the design doc
 * (docs/superpowers/specs/2026-09-12-p3-stage4-audit-design.md) for the
 * full reasoning, including why "unresolved Dependency Review items"
 * (AC) is answered here as a live recomputation rather than a
 * historical-flag lookup.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "will", "would", "that", "this",
  "it", "its", "his", "her", "their", "they", "he", "she", "who", "what",
  "when", "where", "how", "why", "does", "do", "not", "no", "can", "must",
]);

function contentWords(value: unknown): Set<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

/** Overlap of meaningful words - same technique as Stage 7's own
 * sharedWordCount, reimplemented locally rather than imported (that
 * function is private to canonEngine/stage7Audit.ts). */
function sharedWordCount(a: unknown, b: unknown): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n;
}

/**
 * Every Confirmed entry whose depends_on includes an id that isn't
 * itself Confirmed - this is the AC's "unresolved Dependency Review
 * items" line, made concrete as a live graph check (see this file's
 * header comment for why).
 */
export function checkDependencyCompleteness(confirmedEntries: CanonElement[]): Stage4AuditFinding[] {
  const confirmedIds = new Set(confirmedEntries.map((e) => e.element_id));
  const findings: Stage4AuditFinding[] = [];
  for (const entry of confirmedEntries) {
    const value = entry.value as WorldEntryValue | undefined;
    const unresolvedDeps = (entry.depends_on ?? []).filter((depId) => !confirmedIds.has(depId));
    if (unresolvedDeps.length > 0) {
      findings.push({
        id: `dependency-${entry.element_id}`,
        category: "dependency",
        status: "flag",
        detail: `"${value?.name ?? entry.element_id}" depends on ${unresolvedDeps.length} entr${
          unresolvedDeps.length > 1 ? "ies" : "y"
        } that aren't Confirmed yet: ${unresolvedDeps.join(", ")}.`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "dependency-complete",
      category: "dependency",
      status: "pass",
      detail: "Every Confirmed entry's dependencies are themselves Confirmed - no unresolved Dependency Review items.",
    });
  }
  return findings;
}

/**
 * Pairwise shared-word overlap between same-category Confirmed entries'
 * functionalDescription - bounded to same-category pairs (realistic
 * per-story entry counts are in the tens, not thousands, so this stays
 * cheap). Threshold is deliberately higher than Stage 7's own overlap>=1
 * (which compares exactly two fixed, expected-to-be-linked elements) -
 * this scans arbitrary pairs across a potentially large entry set, so a
 * much stronger signal is needed to avoid false-positive flooding.
 */
const REDUNDANCY_OVERLAP_THRESHOLD = 4;

export function checkRedundancy(confirmedEntries: CanonElement[]): Stage4AuditFinding[] {
  const findings: Stage4AuditFinding[] = [];
  const byCategory = new Map<string, CanonElement[]>();
  for (const entry of confirmedEntries) {
    const value = entry.value as WorldEntryValue | undefined;
    const category = value?.category ?? "(uncategorized)";
    const list = byCategory.get(category) ?? [];
    list.push(entry);
    byCategory.set(category, list);
  }
  for (const [category, entries] of byCategory) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i].value as WorldEntryValue | undefined;
        const b = entries[j].value as WorldEntryValue | undefined;
        const overlap = sharedWordCount(a?.functionalDescription, b?.functionalDescription);
        if (overlap >= REDUNDANCY_OVERLAP_THRESHOLD) {
          findings.push({
            id: `redundancy-${entries[i].element_id}-${entries[j].element_id}`,
            category: "redundancy",
            status: "flag",
            detail: `"${a?.name ?? entries[i].element_id}" and "${b?.name ?? entries[j].element_id}" (both ${category}) share ${overlap} concepts in their descriptions - consider whether they should be merged or more clearly differentiated.`,
          });
        }
      }
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "redundancy-none",
      category: "redundancy",
      status: "pass",
      detail: "No significant overlap found between same-category Confirmed entries.",
    });
  }
  return findings;
}
```

- [ ] **Step 2: Verify with manual trace scenarios**

Run `npm run lint` and `npm run build` from `web/` (both must be clean; this module isn't imported anywhere yet). Then manually trace (a `tsx` script constructing fake `CanonElement[]` inputs and calling both functions directly is the fastest way to actually execute these):

1. `checkDependencyCompleteness` with 2 Confirmed entries, neither depending on anything → one `"pass"` finding, no `"flag"`.
2. `checkDependencyCompleteness` with a Confirmed entry whose `depends_on` includes the id of a `"Working"`-status entry (not in the `confirmedEntries` list passed in, since the caller is expected to pass only Confirmed ones) → one `"flag"` finding naming that dependency.
3. `checkRedundancy` with 2 Confirmed entries in the same category whose `functionalDescription` shares fewer than 4 meaningful words → one `"pass"` finding, no flag.
4. `checkRedundancy` with 2 Confirmed entries in the same category whose `functionalDescription` shares 4+ meaningful words (construct two similar-sounding descriptions to hit this) → one `"flag"` finding naming both entries.
5. `checkRedundancy` with 2 Confirmed entries in DIFFERENT categories with heavily overlapping descriptions → no flag (categories differ, so they're never compared) — confirms the category-scoping is genuinely applied, not just claimed.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/stage4Audit.ts
git commit -m "feat: add rules-based Stage 4 audit checks (dependency completeness, redundancy) (issue #49)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 3: Add the model-driven consistency check and summary formatter

**Files:**
- Modify: `web/src/lib/worldEngine/stage4Audit.ts`

**Interfaces:**
- Consumes: `Anthropic` (the SDK type), `extractTurn`, `TurnValidationError`, `RateLimitTimeoutError` (all already exist, imported the same way `world-chat/route.ts` already imports them). `z` from `"zod"`.
- Produces: `export async function runConsistencyCheck(anthropic: Anthropic, confirmedEntries: CanonElement[]): Promise<Stage4AuditFinding[]>`, `export function formatStage4AuditSummary(audit: P3Stage4Audit): string`. A later task calls both.

- [ ] **Step 1: Add the consistency-check schema, tool, and function**

Add to the top of `web/src/lib/worldEngine/stage4Audit.ts` (after the existing imports):

```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { extractTurn } from "@/lib/canonEngine/extractTurn";
import type { P3Stage4Audit } from "@/lib/canonEngine/storyStore";
```

Add near the bottom of the file (after `checkRedundancy`):

```ts
const Stage4ConsistencyFindingSchema = z.object({
  category: z.enum(["physical", "economic", "historical", "narrative"]),
  detail: z.string().min(1),
});

const Stage4ConsistencySchema = z.object({
  findings: z.array(Stage4ConsistencyFindingSchema),
});

const EMIT_STAGE4_CONSISTENCY_TOOL: Anthropic.Tool = {
  name: "emit_stage4_consistency_findings",
  description:
    "Report any physical, economic, historical, or narrative consistency problems you found across the Confirmed World Entries provided. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["physical", "economic", "historical", "narrative"],
              description: "Which kind of consistency problem this is.",
            },
            detail: {
              type: "string",
              description: "A specific, concrete description of the contradiction or inconsistency, naming the entries involved.",
            },
          },
          required: ["category", "detail"],
        },
        description: "Every consistency problem you found. Empty array if none.",
      },
    },
    required: ["findings"],
  },
};

/**
 * The one part of this audit with no rules-based precedent to lean on
 * (see this file's header comment) - a single one-shot extractTurn call,
 * not a conversational turn, reviewing all Confirmed entries together
 * for contradictions a word-overlap heuristic can't meaningfully detect.
 * Runs once per audit computation, not per chat turn.
 */
export async function runConsistencyCheck(
  anthropic: Anthropic,
  confirmedEntries: CanonElement[]
): Promise<Stage4AuditFinding[]> {
  if (confirmedEntries.length === 0) {
    return [
      {
        id: "consistency-empty",
        category: "consistency",
        status: "skipped",
        detail: "No Confirmed entries yet to check.",
      },
    ];
  }

  const entryDescriptions = confirmedEntries
    .map((e) => {
      const v = e.value as WorldEntryValue | undefined;
      return `- ${v?.name ?? e.element_id} (${v?.category ?? "?"}): ${v?.functionalDescription ?? ""} Governing rules: ${v?.governingRules ?? ""}`;
    })
    .join("\n");

  const result = await extractTurn({
    anthropic,
    model: "claude-sonnet-5",
    system:
      "You are auditing a fictional world's Confirmed canon for internal consistency. Review the entries below and report any physical, economic, historical, or narrative contradictions between them - not stylistic opinions, only genuine logical inconsistencies.",
    messages: [{ role: "user", content: `Confirmed World Entries:\n${entryDescriptions}` }],
    tool: EMIT_STAGE4_CONSISTENCY_TOOL,
    schema: Stage4ConsistencySchema,
  });

  if (result.findings.length === 0) {
    return [
      {
        id: "consistency-clean",
        category: "consistency",
        status: "pass",
        detail: "No physical, economic, historical, or narrative contradictions found across Confirmed entries.",
      },
    ];
  }

  return result.findings.map((f, i) => ({
    id: `consistency-${i}`,
    category: "consistency" as const,
    status: "flag" as const,
    detail: `[${f.category}] ${f.detail}`,
  }));
}

/** Renders the audit as the author-facing summary text (mirrors Stage
 * 7's formatAuditSummary rendering convention). */
export function formatStage4AuditSummary(audit: P3Stage4Audit): string {
  const lines: string[] = ["System Integration Audit complete. Here's what I found:", ""];
  for (const f of audit.findings) {
    const mark = f.status === "pass" ? "✅" : f.status === "flag" ? "⚠️" : "⏭️";
    lines.push(`${mark} ${f.detail}`);
  }
  lines.push(
    "",
    "Let me know if you'd like to address any flags, or give an explicit approval so we can move on to compiling your World Bible."
  );
  return lines.join("\n");
}
```

- [ ] **Step 2: Verify**

Run `npm run lint` and `npm run build` from `web/` (both must be clean).

Manually trace `runConsistencyCheck`'s empty-entries branch (a `tsx` script calling it with `confirmedEntries: []` — this doesn't need a real API key since it returns before ever calling `extractTurn`) — confirm it returns the `"skipped"` finding without attempting a network call. The non-empty branch requires a real `ANTHROPIC_API_KEY` and network access to actually exercise the model call; if you have one available in this sandbox, run it once with 2-3 constructed Confirmed entries (including at least one pair with a genuine, obvious contradiction, e.g. two entries whose `governingRules` directly conflict) and confirm the returned findings are sensible. If no API key is available, trace the function by reading it carefully instead and say so clearly in your report — do not fabricate a model-call test.

Trace `formatStage4AuditSummary` against a constructed `P3Stage4Audit` with one finding of each status (`pass`/`flag`/`skipped`) and confirm the ✅/⚠️/⏭️ marks line up correctly.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/stage4Audit.ts
git commit -m "feat: add model-driven consistency check and summary formatter to Stage 4 audit (issue #49)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 4: Add `stage4_audit_approved` to the World turn schema

**Files:**
- Modify: `web/src/lib/worldEngine/worldTurnSchema.ts`

**Interfaces:**
- `WorldTurnSchema` gains `stage4_audit_approved: z.boolean()` (top-level, required, plain boolean like `conflict_detected`). `EMIT_WORLD_TURN_TOOL` gains a matching property and `required` entry. A later task reads `delta.stage4_audit_approved`.

- [ ] **Step 1: Add the field to `WorldTurnSchema`**

Add after the existing `pillar_dependencies: z.array(...)` field (currently the last field):

```ts
  stage4_audit_approved: z.boolean(),
```

- [ ] **Step 2: Add the field to `EMIT_WORLD_TURN_TOOL`**

Add after the existing `pillar_dependencies` property:

```ts
      stage4_audit_approved: {
        type: "boolean",
        description:
          "True only on the turn where the author has just given a clear, explicit approval of the Stage 4 System Integration Audit summary the app showed you (via an internal grounding note) - not merely acknowledging a flag, a genuine 'yes, proceed' verdict. False on every other turn, including every turn no audit is currently pending approval.",
      },
```

Add `"stage4_audit_approved"` to the tool's top-level `required` array (currently ends with `"pillar_dependencies"`).

- [ ] **Step 3: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. No other file constructs a full `WorldTurnSchema`/`EMIT_WORLD_TURN_TOOL` object literal yet (a later task is the only consumer), so this should not force any other file to change.

Manually trace 2 scenarios against the real Zod schema (a `tsx` script is fastest): (a) `stage4_audit_approved: false` alongside all other required fields at their normal defaults — parses; (b) `stage4_audit_approved: true` — parses.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/worldEngine/worldTurnSchema.ts
git commit -m "feat: add stage4_audit_approved field to WorldTurnSchema (issue #49)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 5: Wire the Stage 4 audit into `world-chat/route.ts`

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Consumes: `setP3Stage4Audit`, `type P3Stage4Audit`, `type Stage4AuditFinding` (add to the existing `@/lib/canonEngine/storyStore` import block). `checkDependencyCompleteness`, `checkRedundancy`, `runConsistencyCheck`, `formatStage4AuditSummary` from `@/lib/worldEngine/stage4Audit` (Tasks 2-3). `delta.stage4_audit_approved` (Task 4).

The current file has, in order: the World Entries grounding block, the Adopted Pillars grounding block, the Conflict Resolution grounding block, the Final-reminder block, `extractTurn`, the scope-guardrail block, `appendMessage`/`logTurnHeuristics`, the deferred-items persistence, the WCL/Pillar proposal tracking, the pillar-dependency write block, the Conflict Resolution resolve/detect block, the Stage 3 try/catch block, and the final `return NextResponse.json(...)`.

- [ ] **Step 1: Add the imports**

Add `setP3Stage4Audit,`, `type P3Stage4Audit,`, `type Stage4AuditFinding,` into the existing `@/lib/canonEngine/storyStore` import block (alongside `getStory, appendMessage, ...`).

Add a new import line:

```ts
import { checkDependencyCompleteness, checkRedundancy, runConsistencyCheck, formatStage4AuditSummary } from "@/lib/worldEngine/stage4Audit";
```

- [ ] **Step 2: Inject the Stage 4 audit grounding block**

Find the Adopted Pillars grounding block (ends with the `system += ... Adopted Pillars So Far ...` line). Immediately after it, before the "Conflict Resolution Protocol grounding" comment, insert:

```ts
    // Stage 4 audit grounding (issue #49) - only while an audit exists
    // and hasn't been approved yet, so the model knows to present the
    // summary and get explicit approval rather than silently reporting
    // Stage 5 (which the app would clamp back to 4 anyway - see Step 4).
    const stage4AuditBefore = story.p3Stage4Audit ?? null;
    if (stage4AuditBefore && !stage4AuditBefore.authorApproved) {
      system += `\n\n[STAGE 4 AUDIT PENDING - internal grounding only, never narrate this raw data to the author. ${formatStage4AuditSummary(stage4AuditBefore)} Present this summary to the author in your own words if you haven't already this session, and set stage4_audit_approved to true only once they give a clear, explicit approval to proceed to Compile - do not report current_stage as 5 until then, it will be ignored.]`;
    }
```

- [ ] **Step 3: Compute the audit and handle approval, after the Stage 3 block**

Find the end of the Stage 3 try/catch block (`} catch (stage3Err) { console.warn(...); }`). Immediately after its closing `}`, before the final `return NextResponse.json({...})`, insert:

```ts
    // Stage 4 System Integration Audit (issue #49) - computed once per
    // story, the first time the model reports reaching Stage 4+. Only
    // the 4->5 (Compile) transition is enforced; Stages 1-3 remain
    // exactly as unenforced as before this issue. A failed consistency
    // check surfaces as a visible flag rather than a silent skip or a
    // hard error - a systems audit that quietly drops one of its three
    // checks is worse than one that says so.
    let stage4AuditForResponse: P3Stage4Audit | null = stage4AuditBefore;
    let effectiveStage = delta.current_stage;
    try {
      if (delta.current_stage >= 4 && !stage4AuditForResponse) {
        const confirmedEntries = existingEntries.filter((e) => e.status === "Confirmed");
        let consistencyFindings: Stage4AuditFinding[];
        try {
          consistencyFindings = await runConsistencyCheck(anthropic, confirmedEntries);
        } catch (consistencyErr) {
          console.warn(`[world-chat] Stage 4 consistency check failed for turn ${turnId}:`, consistencyErr);
          consistencyFindings = [
            {
              id: "consistency-error",
              category: "consistency",
              status: "flag",
              detail: "The consistency pass couldn't complete - please try again before compiling.",
            },
          ];
        }
        const newAudit: P3Stage4Audit = {
          findings: [
            ...checkDependencyCompleteness(confirmedEntries),
            ...checkRedundancy(confirmedEntries),
            ...consistencyFindings,
          ],
          generatedAt: new Date().toISOString(),
          authorApproved: false,
        };
        await setP3Stage4Audit(storyId, newAudit);
        stage4AuditForResponse = newAudit;
      }

      if (delta.stage4_audit_approved && stage4AuditForResponse && !stage4AuditForResponse.authorApproved) {
        const approvedAudit: P3Stage4Audit = { ...stage4AuditForResponse, authorApproved: true };
        await setP3Stage4Audit(storyId, approvedAudit);
        stage4AuditForResponse = approvedAudit;
      }

      if (effectiveStage === 5 && !(stage4AuditForResponse?.authorApproved ?? false)) {
        effectiveStage = 4;
      }
    } catch (stage4Err) {
      console.warn(`[world-chat] Stage 4 audit failed for turn ${turnId}:`, stage4Err);
    }
```

Note `existingEntries` is the same array already fetched earlier in this route for the World Entries grounding block - reused here, not re-fetched, to avoid a duplicate Firestore read. `anthropic` is the same client instance already created earlier for the main turn's `extractTurn` call.

- [ ] **Step 4: Return the clamped stage and audit in the response**

Find the final `return NextResponse.json({...})` block. Change `current_stage: delta.current_stage` to `current_stage: effectiveStage`, and add one field:

```ts
    return NextResponse.json({
      reply: finalReply,
      context: finalContext,
      current_stage: effectiveStage,
      p3: p3ForResponse,
      entryWarning,
      pendingConflict: pendingConflictForResponse,
      cascadeReview,
      stage4Audit: stage4AuditForResponse,
    });
```

Also find where the assistant message is persisted (`await appendMessage(storyId, { role: "assistant", ..., current_stage: delta.current_stage, }, ...)`) - change that `current_stage: delta.current_stage` to `current_stage: effectiveStage` too, so the transcript's own record of the turn matches what was actually shown to the author, not the model's un-clamped self-report.

- [ ] **Step 5: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

Manually trace these scenarios (a `tsx` script isolating just the branching logic, mirroring the real code's structure, is the most reliable way — there is no automated test runner in this repo):

1. `delta.current_stage = 3`, no audit exists yet → audit block's `if (delta.current_stage >= 4 ...)` doesn't fire, `stage4AuditForResponse` stays `null`, `effectiveStage` stays `3` (the `=== 5` clamp check never applies).
2. `delta.current_stage = 4`, no audit exists yet → a new audit is computed and persisted with `authorApproved: false`, `effectiveStage` stays `4` (the clamp only triggers on `=== 5`).
3. Same story, next turn: `delta.current_stage = 5`, an unapproved audit already exists (from scenario 2) → the compute-branch is skipped (`!stage4AuditForResponse` is false), `delta.stage4_audit_approved = false` so the approval branch doesn't fire either, and `effectiveStage === 5 && !authorApproved` clamps `effectiveStage` back to `4`.
4. Same story, next turn: `delta.stage4_audit_approved = true`, `delta.current_stage = 5` → the approval branch fires (marking `authorApproved: true` and persisting it), and NOW `effectiveStage === 5 && !(...)` evaluates false (audit IS approved), so `effectiveStage` stays `5` — Compile is unblocked.
5. `runConsistencyCheck` throwing (simulate by reading the code path) → the inner catch produces the fallback `"consistency-error"` finding, the audit still gets computed and persisted with the other two checks' real findings plus this one flag, and the outer flow proceeds normally to the response (no 500).
6. `setP3Stage4Audit` itself throwing (simulate by reading the code path) → the outer `catch (stage4Err)` logs via `console.warn`, `stage4AuditForResponse`/`effectiveStage` stay at their pre-computation values, and the function still proceeds normally to the final response.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/world-chat/route.ts
git commit -m "feat: wire the Stage 4 System Integration Audit into the world-chat turn handler (issue #49)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 6: Build the audit UI and wire it into `WorldInterview.tsx`

**Files:**
- Create: `web/src/components/StageAuditCard.tsx`
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- `StageAuditCard` (new): props `{ audit: { findings: { id: string; category: string; status: "pass" | "flag" | "skipped"; detail: string }[]; authorApproved: boolean }; onApprove: () => void; disabled: boolean }`. `WorldInterview.tsx` renders it.

This follows the established `ConflictCard`/`WorldSidePanel`'s cascade-review-block pattern (a real UI affordance, a canned message sent through the normal chat flow on the approve action) rather than relying on the model alone to correctly interpret the author's intent to approve.

- [ ] **Step 1: Create `StageAuditCard.tsx`**

Create `web/src/components/StageAuditCard.tsx`:

```tsx
"use client";

export interface StageAuditFindingView {
  id: string;
  category: string;
  status: "pass" | "flag" | "skipped";
  detail: string;
}

export interface StageAuditCardProps {
  audit: { findings: StageAuditFindingView[]; authorApproved: boolean };
  onApprove: () => void;
  disabled: boolean;
}

const STATUS_MARK: Record<StageAuditFindingView["status"], string> = {
  pass: "✅",
  flag: "⚠️",
  skipped: "⏭️",
};

export default function StageAuditCard({ audit, onApprove, disabled }: StageAuditCardProps) {
  if (audit.authorApproved) return null;

  return (
    <div
      data-testid="stage-audit-card"
      className="mt-3 rounded-xl border-2 border-orange-500 bg-orange-950/30 px-4 py-3 text-sm text-neutral-100"
    >
      <p className="mb-2 font-semibold text-orange-200">System Integration Audit</p>
      <ul className="mb-3 space-y-1.5 text-xs text-neutral-300">
        {audit.findings.map((f) => (
          <li key={f.id}>
            {STATUS_MARK[f.status]} {f.detail}
          </li>
        ))}
      </ul>
      <button
        onClick={onApprove}
        disabled={disabled}
        className="rounded-lg border border-orange-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-orange-200 hover:bg-orange-900/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Approve and continue to Compile
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `WorldInterview.tsx`**

Add imports near the top:

```ts
import StageAuditCard from "@/components/StageAuditCard";
import type { P3Stage4Audit } from "@/lib/canonEngine/storyStore";
```

Add state near the existing `pendingConflict`/`cascadeReview` declarations:

```ts
  const [stage4Audit, setStage4Audit] = useState<P3Stage4Audit | null>(null);
```

Extend `applyTurnResponse`'s parameter type and body:

```ts
  function applyTurnResponse(data: {
    reply: string;
    context?: string | null;
    current_stage?: number;
    p3?: P3State;
    pendingConflict?: P3PendingConflict | null;
    cascadeReview?: { entryId: string; name: string }[] | null;
    stage4Audit?: P3Stage4Audit | null;
  }) {
```

(only the type signature changes here — leave the function body's existing lines alone, just add one more line at the end, before the closing `}`):

```ts
    setStage4Audit(data.stage4Audit ?? null);
```

Add a handler near `chooseConflictResolution`:

```ts
  function approveStage4Audit() {
    sendMessage("I approve this System Integration Audit summary - please proceed to Compile.");
  }
```

In the chat pane's message list, find the `cascadeReview` block (the `{cascadeReview && cascadeReview.length > 0 && (...)}` block). Immediately after it, before the `{error && ...}` block, insert:

```tsx
                {stage4Audit && !stage4Audit.authorApproved && (
                  <StageAuditCard audit={stage4Audit} onApprove={approveStage4Audit} disabled={loading} />
                )}
```

- [ ] **Step 3: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

For browser verification, follow the same approach issues #45/#47/#48 used if a real authenticated session isn't reachable in your sandbox (no Firestore emulator, no test credentials): network-mock the `/api/world-chat` response to include a `stage4Audit` payload with `authorApproved: false` and a mix of pass/flag findings, drive the real component, and confirm: (a) the card renders with all findings and the correct status marks; (b) clicking "Approve and continue to Compile" sends the canned message through the normal `sendMessage` flow; (c) once a subsequent mocked response returns `stage4Audit.authorApproved: true` (or `stage4Audit: null`), the card no longer renders. Clearly disclose what you could not verify end-to-end rather than fabricating a full authenticated test.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/StageAuditCard.tsx web/src/components/WorldInterview.tsx
git commit -m "feat: add StageAuditCard UI and wire it into the World Bible interview (issue #49)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.
