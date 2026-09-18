# P4 Pre-Compilation Audit — Design Spec

GitHub issue: #91 ("[P4] Implement Pre-Compilation Audit (Scale/Earmark/Formatting checks)")
PRD ref: Screenplay Structural Architecture Framework v3.0 §6 — "Prior to generating the final
Screenplay Outline, run these checks: **Scale Check:** verify total scene count is within the
75-150 target range. **Earmark Check:** confirm all 10 structural Critical Beats are clearly
tagged for Project 5 handoff. **Formatting Check:** verify every scene has a standard slugline
and exactly one explanatory paragraph."

## Problem

Issue #65 (Thematic Anchor Audit) already established the pre-compile gate machinery
(`document/route.ts`'s synchronous 409/`acknowledged: true` flow), but only checks one thing
(the internal-transformation arc). This issue is a distinct gate the framework doc calls out
separately, and all three of its checks are, unlike #65's, **fully deterministic** — no model
call needed at all.

## Design

### 1. All three checks are pure, synchronous, and reuse existing infrastructure — no model call

Unlike #65, nothing here requires a semantic judgment:

- **Scale Check**: `getConfirmedUnits(units).length` within `[MIN_TARGET_SCENES,
  MAX_TARGET_SCENES]` (75/150) — reuses #56's `sceneDensity.ts` constants directly rather than
  re-declaring the same magic numbers. Unlike #56's own advisory monitor (which counts
  `Working`+`Confirmed` and projects a trajectory), this is a simple, un-projected count of
  `Confirmed` units only — what will actually appear in the compiled Scene Register (Section 4),
  checked once the outline is considered complete, not mid-development.
- **Earmark Check**: scan every `Confirmed` unit's `content` for a `[CRITICAL BEAT: <NAME>]`
  tag (reusing `developmentLoop.ts`'s existing `CRITICAL_BEAT_TAG_PATTERN` regex — exported for
  the first time, previously private to that file) and collect the set of found, valid tag
  names against `structuralFramework.ts`'s existing `CRITICAL_BEAT_LOOKUP` (whose 10 keys are
  the full, canonical beat list). Any of the 10 keys missing from the found set is a failure.
- **Formatting Check**: `checkSceneRegisterFormat(content)` (issue #66, already exported) run
  against every `Confirmed` unit's content directly — no new parsing logic. In ordinary
  operation this should nearly always pass (that same function already gates every `Working`/
  `Confirmed` transition before it happens), but it's still worth re-checking here as a genuine
  backstop against any Confirmed content that predates issue #66, or reached Confirmed through
  a path that bypassed the ordinary gate (e.g. legacy data, matching #56's own precedent of
  treating "content that predates a later-added check" as a real, not hypothetical, case).

### 2. New module: `preCompilationAudit.ts`

```ts
export interface PreCompilationCheckFinding {
  id: string;
  status: "pass" | "flag";
  detail: string;
}

export function checkScale(units: StructuralUnit[]): PreCompilationCheckFinding
export function checkEarmark(units: StructuralUnit[]): PreCompilationCheckFinding
export function checkFormatting(units: StructuralUnit[]): PreCompilationCheckFinding

export interface PreCompilationAuditResult {
  findings: PreCompilationCheckFinding[];
  failed: boolean;
}

export function runPreCompilationAudit(units: StructuralUnit[]): PreCompilationAuditResult
```

Entirely synchronous — no `Anthropic` parameter, unlike `runThematicAnchorAudit`. Each of the
three functions returns exactly one finding (pass or flag), not a variable-length array, since
each check has a single yes/no outcome (unlike Thematic Anchor's per-step coverage findings).

### 3. Combined gating: one 409, one acknowledgment, both audits

`document/route.ts` already gates on `thematicAnchorAudit.gapFound`. This issue adds a second,
purely deterministic audit to the same request — computed unconditionally (cheap, no cost
concern, no risk of contradiction on a retry since it's deterministic, unlike #65's model call)
—and combines both into a single decision:

```ts
const preCompilationAudit = runPreCompilationAudit(units);
// ...thematicAnchorAudit computed as before (unconditional on acknowledged, per #65's existing logic)...
const gapFound = thematicAnchorAudit.gapFound || preCompilationAudit.failed;
if (gapFound && !acknowledged) {
  return NextResponse.json({ needsAcknowledgment: true, thematicAnchorAudit, preCompilationAudit }, { status: 409 });
}
// ...compile...
return NextResponse.json({ ...compiled, thematicAnchorAudit, preCompilationAudit });
```

One `acknowledged: true` override resolves both audits at once — the author sees every flagged
issue from both checks in one banner and makes one decision, rather than clicking through two
separate confirm-then-retry gates for the same compile action. `preCompilationAudit` is never
skipped/synthesized on the acknowledged path the way `thematicAnchorAudit` is (issue #65's own
finding I2) — that skip existed specifically to avoid a second nondeterministic model call
contradicting the first; nothing here is nondeterministic, so recomputing it fresh on every call
is both cheap and correct (if the author genuinely fixed something between attempts, they should
see that reflected, not a stale synthetic override marker).

### 4. UI: extend the existing rose banner, don't add a second one

`ArchitectureInterview.tsx` already renders a rose "gap found" banner sourced from
`thematicAnchorAudit.findings`. This issue extends that same banner to also include
`preCompilationAudit.findings`, merging both audits' flagged items into one list under one
"Compile anyway" button — a single override decision for a single compile action, not two
separate acknowledgment flows stacked on the same screen. The existing purple success banner's
text is similarly extended to summarize both audits' pass/override status in one line rather
than two.

## What's out of scope

- Any change to how the Scale/Earmark/Formatting checks are computed if #70 (the full compiler)
  later changes the document's own section shapes — this issue audits the CURRENT `p4Units`
  ledger, not the compiled output; that reasoning is inherited from #65 and #56, not re-derived
  here.
- Persisting this audit anywhere — same reasoning as #65's own §4 (resolved within one
  button-click interaction, not a multi-turn conversational stage).
- Live-model verification — not applicable; this audit has no model-facing surface at all.

## Files touched

- Create: `web/src/lib/storyArchitectureEngine/preCompilationAudit.ts`
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts` (export
  `CRITICAL_BEAT_TAG_PATTERN`)
- Modify: `web/src/app/api/architecture-chat/document/route.ts` (combine both audits into one
  gate)
- Modify: `web/src/components/ArchitectureInterview.tsx` (extend the existing rose/purple
  banners)

## Testing

No test suite exists in this project. Verification is `tsc --noEmit`, `npm run lint`,
`npm run build`, plus a direct code trace: a unit set with exactly 74 and exactly 151 Confirmed
units (Scale Check fails both directions at the boundary), exactly 75 and exactly 150 (passes at
the boundary), a unit set missing one of the 10 Critical Beat tags (Earmark Check fails, names
the missing tag), a unit set with all 10 tagged (passes), a Confirmed unit with malformed content
(Formatting Check fails), and the combined route's 409/`acknowledged: true`/200 paths with both
audits' findings present in the response — matching #65's own standard.
