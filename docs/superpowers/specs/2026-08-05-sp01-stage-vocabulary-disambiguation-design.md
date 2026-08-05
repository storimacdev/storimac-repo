# sp01 Stage-Vocabulary Disambiguation — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-05

## Problem

A follow-up to the just-merged stage-drift-catchup branch (`5e971ace` on `main`). That branch's final whole-branch review flagged several places where `sp01-sdos-systemprompt.md`'s §6 stage descriptions use wording that could plausibly steer the model toward the wrong canonical element ID for a fact — a live risk now that `EMIT_TURN_TOOL`'s `element_id` is a closed 46-value enum (`web/src/lib/canonEngine/elementRegistry.ts`), because the catch-up loop that same branch added means a stage whose gate *never* passes (because its facts keep landing under a sibling stage's ID) is now permanently stuck, the same failure class as the original drift bug, just triggered by prompt ambiguity instead of free-text invention.

Cross-referencing all 29 stage-gated IDs against every stage's §6 prose narrowed the risk to two concrete, evidence-backed cases (the other two candidates raised during triage — `emotional_engine`/`emotional_journey` and `theme_statement`/`external_theme`/`internal_theme` — turned out to be a milder "never asked about" gap rather than an active wrong-ID collision, since neither `emotional_journey` nor `external_theme`/`internal_theme` is ever named in §6 at all; that class is already covered by the Stage 8 fix from the prior branch, "walk §7's taxonomy... ask about anything still open"):

1. **Stage 3 says "Target Audience," but Stage 3's actual gate ID is `audience`.** Stage 1's gate is `target_audience`. `foundationDoc.ts`'s existing defensive fallback (`str(byId, "audience") || str(byId, "target_audience")`) is direct prior evidence these two have already collided in real data — the app's own document compiler was written to expect it. Checked the original reference prompt this sp01 was adapted from (`project-docs/storimac-prompts/P1-Prompt1-...md`): it has the identical "Target Audience" wording at Stage 3, and neither it nor the PRD explains what distinguishes the two. This ambiguity is inherited from the source material, not introduced later — resolving it here requires picking a reasonable interpretation, not recovering a lost one.
2. **Stage 6 says "Plot Point 1"/"Plot Point 2," but the canonical IDs are `first_turning_point`/`second_turning_point`.** Not a cross-stage collision (no other stage claims these IDs) — but §7's own document taxonomy (line 79 of the same file) already says "First Turning Point"/"Second Turning Point" for this exact data, so §6 is internally inconsistent with §7 in the same document.

## Decision (confirmed during brainstorming, 2026-08-05)

**Interpretation for the `audience`/`target_audience` split**: Stage 1's `target_audience` is the author's loose initial impression, captured during open-ended discovery ("who did you picture reading/watching this"). Stage 3's `audience` is formal audience/market positioning — it sits alongside Genre, Tone, Style, and Scale in the document's "Genre & Tone Specification" section (§7 item 6), the kind of categorization confirmed once genre and tone are locked in. Stage 3's instruction must tell the model explicitly not to treat Stage 1's answer as already covering this — refine it into the more specific categorization instead of skipping the question.

Scope: both fixes land in §6 only, one line each (plus one added clarifying sentence for Stage 3). No other section of sp01 changes. No code changes.

## Changes to `web/system-prompts/sp01-sdos-systemprompt.md`

**STAGE 3 (§6)** — current text:
```
STAGE 3: BUILD THE CORE STORY
Focus: Establish Genre, Subgenre, Tone, Style, Target Audience, and Scale. Develop the Core Dramatic Question and Theme.
```
Replace with:
```
STAGE 3: BUILD THE CORE STORY
Focus: Establish Genre, Subgenre, Tone, Style, Audience, and Scale. Develop the Core Dramatic Question and Theme.
Audience here is formal audience/market positioning alongside Genre and Tone (e.g. age category, demographic) - distinct from Stage 1's initial Target Audience impression. Confirm or refine that impression into this more specific categorization; don't treat Stage 1's answer as already covering it.
```

**STAGE 6 (§6)** — current text:
```
STAGE 6: BUILD THE STORY SPINE
Focus: Define 7 structural turning points in 1–2 sentences each: Opening Image, Inciting Incident, Plot Point 1, Midpoint, Plot Point 2, Climax, Closing Image. Defer outlines.
```
Replace with:
```
STAGE 6: BUILD THE STORY SPINE
Focus: Define 7 structural turning points in 1–2 sentences each: Opening Image, Inciting Incident, First Turning Point, Midpoint, Second Turning Point, Climax, Closing Image. Defer outlines.
```

## Error Handling

None needed — this is prompt text only, no new code path, no new failure mode. The change is strictly narrowing/clarifying existing instructions; it cannot make any previously-passing gate fail, since it doesn't touch which IDs are canonical (that's `elementRegistry.ts`, already merged) or how gates are checked (`stageFsm.ts`, unchanged).

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build` (prompt-text-only files don't affect either, but this project's convention runs both after every change touching `web/`), plus manual review of the prompt diff for internal consistency: confirm Stage 3's new wording doesn't contradict §7 item 6's "Genre & Tone Specification: [Genre, Subgenre, Tone, Style, Audience, Scale]" (it doesn't — this fix makes them match, where before Stage 3 said "Target Audience" and §7 already said "Audience," a pre-existing inconsistency this fix also happens to resolve), and confirm Stage 6's new wording matches §7 item 11 exactly (it does, by construction). As with the prior sp01 fix, there's no live Anthropic credentials in this sandbox to test model behavior directly. Note that the `[chat] unknown element_id` log added in the stage-drift-catchup branch will NOT catch a regression here — that log only fires on IDs outside the 46-value enum, and `target_audience` is itself a valid enum member, just the wrong one for Stage 3. The only real verification is checking real Stage 3 turns after deploy: `audience` should start appearing as its own distinct Confirmed element (via the Canon panel or a direct Firestore read), not a re-write of `target_audience`.
